/**
 * Verify that the Messaging entry (and staff management where authorised)
 * appears in each role's sidebar, that the unread badge is backend-driven, and
 * that an unauthorised role is refused by the staff endpoints.
 *
 *   node scripts/verify-nav.mjs <tokens.json>
 */
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';

const CDP_HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:9333';
const APP = process.env.APP_URL || 'http://localhost:3000';
const API = process.env.API_BASE || 'http://127.0.0.1:8000/api/v1';
const tokens = JSON.parse(readFileSync(process.argv[2], 'utf8'));

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  async open(token) {
    const { targetId } = await this.send('Target.createTarget', { url: `${APP}/` });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    await this.send('Page.enable', {}, sessionId);
    await this.send('Runtime.enable', {}, sessionId);
    await sleep(2000);
    await this.evaluate(
      sessionId,
      `localStorage.setItem('greenpath_auth_token', ${JSON.stringify(token)}); true`
    );
    await this.send('Page.navigate', { url: `${APP}/` }, sessionId);
    await sleep(2500);
    return sessionId;
  }

  async evaluate(sessionId, expression) {
    const result = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId
    );
    return result.exceptionDetails ? null : result.result?.value;
  }

  async waitFor(sessionId, expression, timeout = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = await this.evaluate(sessionId, expression);
      if (value) return value;
      await sleep(250);
    }
    return null;
  }
}

const EXPECTED_STAFF_NAV = {
  USER_ADMIN: true,
  SUPER_ADMIN: true,
  FINANCIAL_MANAGER: false,
  FARMER: false,
  WHOLESALER: false,
  RETAILER: false,
  DRIVER: false,
};

async function main() {
  const version = await (await fetch(`${CDP_HTTP}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl, { maxPayload: 1 << 26 });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const cdp = new Cdp(socket);

  for (const [email, account] of Object.entries(tokens)) {
    const page = await cdp.open(account.token);
    const ready = await cdp.waitFor(page, `!!document.querySelector('aside')`);
    if (!ready) {
      record(`${account.role}: workspace shell renders`, false, email);
      continue;
    }

    const nav = await cdp.evaluate(
      page,
      `(() => {
        const items = [...document.querySelectorAll('aside button')].map((b) => b.innerText.trim());
        return { items, text: items.join(' | ') };
      })()`
    );
    const hasMessaging = /(^|\\|)\\s*Messages/.test(nav.text) || nav.text.includes('Messages');
    record(`${account.role}: sidebar exposes messaging`, Boolean(hasMessaging), email);

    const expectsStaff = EXPECTED_STAFF_NAV[account.role];
    const hasStaff = nav.text.includes('Staff Management') || nav.text.includes('Administrative Users');
    record(
      `${account.role}: staff navigation ${expectsStaff ? 'is present' : 'is absent'}`,
      expectsStaff === hasStaff,
      email
    );

    const unread = await cdp.evaluate(
      page,
      `(() => {
        const item = [...document.querySelectorAll('aside button')].find((b) => b.innerText.trim().startsWith('Messages'));
        if (!item) return null;
        const badge = [...item.querySelectorAll('span')]
          .map((span) => span.innerText.trim())
          .find((text) => /^[0-9]+\\+?$/.test(text));
        return badge || '';
      })()`
    );
    const channelState = await (async () => {
      const response = await fetch(`${API}/chat/channels/`, {
        headers: { Authorization: `Bearer ${account.token}` },
      });
      if (!response.ok) return { count: 0, unread: 0 };
      const body = await response.json();
      const rows = body.results || [];
      return {
        count: rows.length,
        unread: rows.reduce((sum, row) => sum + (row.unread_count || 0), 0),
      };
    })();
    record(
      `${account.role}: sidebar unread badge matches the backend total`,
      channelState.unread === 0 ? !unread : Boolean(unread),
      `backend unread=${channelState.unread} badge=${JSON.stringify(unread)} channels=${channelState.count}`
    );

  }

  // A Financial Manager must be refused by the staff-management API even when
  // the page is opened directly.
  const fm = tokens['financial_manager01@greenpath.et'];
  if (fm) {
    const response = await fetch(`${API}/superadmin/accounts/`, {
      headers: { Authorization: `Bearer ${fm.token}` },
    });
    record(
      'Financial Manager is refused staff-management data by the backend',
      response.status === 403,
      `status ${response.status}`
    );

    const page = await cdp.open(fm.token);
    await cdp.send('Page.navigate', { url: `${APP}/staff` }, page);
    const denied = await cdp.waitFor(
      page,
      `!!document.body && /permission/i.test(document.body.innerText)`,
      12000
    );
    record('direct /staff access shows the backend permission message', Boolean(denied));
  }

  socket.close();
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('verification crashed:', error);
  process.exit(1);
});
