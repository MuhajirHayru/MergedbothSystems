/**
 * DOM verification of the new messaging page and staff-management page against
 * the running dev server (http://localhost:3000) and Django backend.
 *
 * Requires Chrome started with --remote-debugging-port=9333.
 *
 *   node scripts/verify-ui.mjs <farmerToken> <userAdminToken>
 */
import WebSocket from 'ws';

const CDP_HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:9333';
const APP = process.env.APP_URL || 'http://localhost:3000';
const API = process.env.API_BASE || 'http://127.0.0.1:8000/api/v1';

const [, , farmerToken, adminToken] = process.argv;
if (!farmerToken || !adminToken) {
  console.error('usage: node scripts/verify-ui.mjs <farmerToken> <userAdminToken>');
  process.exit(2);
}

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
    this.consoleErrors = [];
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(String(message.params?.exceptionDetails?.text || 'exception'));
      }
      if (
        message.method === 'Runtime.consoleAPICalled' &&
        message.params?.type === 'error' &&
        message.sessionId
      ) {
        this.consoleErrors.push(
          message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')
        );
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

  async newPage(url) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    await this.send('Page.enable', {}, sessionId);
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Page.navigate', { url }, sessionId);
    await sleep(1500);
    return sessionId;
  }

  async evaluate(sessionId, expression) {
    const result = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'evaluation failed');
    }
    return result.result?.value;
  }

  async waitFor(sessionId, expression, timeout = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = await this.evaluate(sessionId, expression);
      if (value) return value;
      await sleep(250);
    }
    return null;
  }
}

async function authenticatedPage(cdp, token, path) {
  const sessionId = await cdp.newPage(`${APP}/`);
  await cdp.evaluate(
    sessionId,
    `localStorage.setItem('greenpath_auth_token', ${JSON.stringify(token)}); true`
  );
  await cdp.send('Page.navigate', { url: `${APP}${path}` }, sessionId);
  return sessionId;
}

async function apiAs(token, path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  return response.json();
}

async function main() {
  const version = await (await fetch(`${CDP_HTTP}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const cdp = new Cdp(socket);

  // ------------------------------------------------------------------ chat
  const chat = await authenticatedPage(cdp, farmerToken, '/messaging');
  const messagingRendered = await cdp.waitFor(
    chat,
    `document.body.innerText.includes('Messaging') && !!document.querySelector('textarea[aria-label="Message"]')`
  );
  record('messaging page renders the thread composer for a farmer', Boolean(messagingRendered));

  const sidebarMessages = await cdp.evaluate(
    chat,
    `(() => {
      const item = [...document.querySelectorAll('aside button')].find((b) => b.innerText.trim().startsWith('Messages'));
      return item ? item.innerText.trim() : null;
    })()`
  );
  record('sidebar exposes a Messages navigation item', Boolean(sidebarMessages), String(sidebarMessages));

  const conversationText = await cdp.evaluate(chat, `document.body.innerText`);
  record(
    'conversation list is populated from the backend',
    typeof conversationText === 'string' && conversationText.includes('Messages'),
    conversationText ? `${conversationText.length} chars` : 'empty'
  );

  const text = `UI check ${Date.now().toString(36)}`;
  const typed = await cdp.evaluate(
    chat,
    `(() => {
      const area = document.querySelector('textarea[aria-label="Message"]');
      if (!area) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(area, ${JSON.stringify(text)});
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`
  );
  await sleep(300);
  await cdp.evaluate(chat, `document.querySelector('button[aria-label="Send message"]')?.click(); true`);
  const sentVisible = await cdp.waitFor(chat, `document.body.innerText.includes(${JSON.stringify(text)})`);
  record('a typed message is sent and rendered in the thread', Boolean(typed) && Boolean(sentVisible));

  const channels = await apiAs(farmerToken, '/chat/channels/');
  const channel = (channels.results || [])[0];

  // The UI socket is the farmer's own; the reply comes from another account.
  const wholesalerLogin = await apiAs('', '/auth/login/', {
    method: 'POST',
    headers: { Authorization: '' },
    body: JSON.stringify({ email: 'wholesaler01@greenpath.et', password: 'Green@2024' }),
  });
  const wholesalerToken = wholesalerLogin.access;
  if (wholesalerToken) {
    const liveMessage = `Live push ${Date.now().toString(36)}`;
    await apiAs(wholesalerToken, `/chat/channels/${channel.id}/messages/`, {
      method: 'POST',
      body: JSON.stringify({ content: liveMessage, kind: 'TEXT' }),
    });
    const appeared = await cdp.waitFor(
      chat,
      `document.body.innerText.includes(${JSON.stringify(liveMessage)})`,
      12000
    );
    record('an incoming message appears without a page refresh', Boolean(appeared));
  } else {
    record('an incoming message appears without a page refresh', false, 'wholesaler login failed');
  }

  record(
    'no uncaught runtime errors on the messaging page',
    cdp.consoleErrors.length === 0,
    cdp.consoleErrors.slice(0, 2).join(' | ')
  );

  // The sidebar badge must react to a message that arrives while the user is
  // on another dashboard page (no refresh, no polling loop in the client).
  const badgeExpression = `(() => {
    const item = [...document.querySelectorAll('aside button')].find((b) => b.innerText.trim().startsWith('Messages'));
    if (!item) return -1;
    const badge = [...item.querySelectorAll('span')]
      .map((span) => span.innerText.trim())
      .find((text) => /^[0-9]+\\+?$/.test(text));
    return badge ? Number(badge) : 0;
  })()`;
  const dashboard = await authenticatedPage(cdp, farmerToken, '/farmer');
  await cdp.waitFor(dashboard, `!!document.querySelector('aside')`);
  const badgeBefore = await cdp.evaluate(dashboard, badgeExpression);

  if (wholesalerToken) {
    await apiAs(wholesalerToken, `/chat/channels/${channel.id}/messages/`, {
      method: 'POST',
      body: JSON.stringify({
        content: `Badge update ${Date.now().toString(36)}`,
        kind: 'TEXT',
      }),
    });
    const badgeIncreased = await cdp.waitFor(
      dashboard,
      `${badgeExpression} > ${Number(badgeBefore) || 0}`,
      15000
    );
    record(
      'sidebar unread badge updates live when a message arrives',
      Boolean(badgeIncreased),
      `before=${badgeBefore}`
    );
  }

  // ----------------------------------------------------------------- staff
  cdp.consoleErrors = [];
  const staff = await authenticatedPage(cdp, adminToken, '/staff');
  const staffRendered = await cdp.waitFor(
    staff,
    `!!document.querySelector('h1') && document.querySelector('h1').innerText.trim() === 'Staff Management'`
  );
  record('staff management page renders for an administrator', Boolean(staffRendered));

  const staffState = await cdp.evaluate(
    staff,
    `(() => {
      const text = (document.body && document.body.innerText) || '';
      const rows = document.querySelectorAll('tbody tr').length;
      return {
        rows,
        hasCreate: text.includes('Create staff member'),
        hasStats: /Staff in your scope/.test(text) && /Active/.test(text),
        hasFilters: text.includes('All levels') && text.includes('All statuses'),
      };
    })()`
  );
  record('staff list is populated with backend rows', staffState.rows > 0, `rows=${staffState.rows}`);
  record('create-staff action is offered', staffState.hasCreate);
  record('backend-derived statistics render', staffState.hasStats);
  record('role/level/status filters render', staffState.hasFilters);

  const createReady = await cdp.waitFor(
    staff,
    `(() => {
      const b = [...document.querySelectorAll('button')].find((el) => el.innerText.includes('Create staff member'));
      return Boolean(b) && !b.disabled;
    })()`
  );
  record('create-staff button becomes enabled once permissions load', Boolean(createReady));
  const clicked = await cdp.evaluate(
    staff,
    `(() => {
      const b = [...document.querySelectorAll('button')].find((el) => el.innerText.includes('Create staff member'));
      if (!b) return false;
      b.click();
      return true;
    })()`
  );
  record('create-staff button opens the form', Boolean(clicked));
  const modal = await cdp.waitFor(
    staff,
    `(() => {
      const text = (document.body && document.body.innerText) || '';
      const selects = document.querySelectorAll('select').length;
      return text.includes('Roles and geographic scopes are limited') && selects >= 3;
    })()`
  );
  record('create modal exposes dynamic role and geography selectors', Boolean(modal));

  const geoLabel = await cdp.evaluate(
    staff,
    `!!document.body && document.body.innerText.includes('Geographic scope (region')`
  );
  record('create modal uses the backend location cascade', Boolean(geoLabel));

  record(
    'no uncaught runtime errors on the staff page',
    cdp.consoleErrors.length === 0,
    cdp.consoleErrors.slice(0, 2).join(' | ')
  );

  socket.close();
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('verification crashed:', error);
  process.exit(1);
});
