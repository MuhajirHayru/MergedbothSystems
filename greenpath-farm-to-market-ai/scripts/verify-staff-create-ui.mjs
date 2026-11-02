/**
 * End-to-end: create a staff account through the real UI modal, confirm the
 * backend persisted it with the chosen scope, then remove the test account.
 *
 *   node scripts/verify-staff-create-ui.mjs <userAdminToken>
 */
import WebSocket from 'ws';

const CDP_HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:9333';
const APP = process.env.APP_URL || 'http://localhost:3000';
const API = process.env.API_BASE || 'http://127.0.0.1:8000/api/v1';
const token = process.argv[2];
if (!token) {
  console.error('usage: node scripts/verify-staff-create-ui.mjs <userAdminToken>');
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

const setInput = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

async function main() {
  const version = await (await fetch(`${CDP_HTTP}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl, { maxPayload: 1 << 26 });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const cdp = new Cdp(socket);

  const { targetId } = await cdp.send('Target.createTarget', { url: `${APP}/` });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await sleep(2000);
  await cdp.evaluate(sessionId, `localStorage.setItem('greenpath_auth_token', ${JSON.stringify(token)}); true`);
  await cdp.send('Page.navigate', { url: `${APP}/staff` }, sessionId);

  const ready = await cdp.waitFor(
    sessionId,
    `!!document.querySelector('h1') && document.querySelector('h1').innerText.trim() === 'Staff Management'`
  );
  record('staff page loads for the administrator', Boolean(ready));

  await cdp.waitFor(
    sessionId,
    `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('Create staff member')); return Boolean(b) && !b.disabled; })()`
  );
  await cdp.evaluate(
    sessionId,
    `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('Create staff member')); b?.click(); return true; })()`
  );
  record(
    'create modal opens',
    Boolean(await cdp.waitFor(sessionId, `!!document.querySelector('div.fixed.inset-0 form')`))
  );

  const stamp = Date.now().toString(36);
  const email = `ui.verify.${stamp}@greenpath.test`;
  const fullName = `UI Verify ${stamp}`;

  await cdp.evaluate(sessionId, setInput('div.fixed.inset-0 input[placeholder="e.g. Selam Tadesse"]', fullName));
  await cdp.evaluate(sessionId, setInput('div.fixed.inset-0 input[type="email"]', email));
  await cdp.evaluate(sessionId, setInput('div.fixed.inset-0 input[placeholder="+2519…"]', '+251911223344'));
  await cdp.evaluate(
    sessionId,
    setInput('div.fixed.inset-0 input[type="password"]', 'VerifyPass123!')
  );

  // Drill the backend location cascade one level at a time, waiting for each
  // child column to arrive from the locations API.
  for (let depth = 0; depth < 4; depth += 1) {
    const columnReady = await cdp.waitFor(
      sessionId,
      `(() => {
        const modal = document.querySelector('div.fixed.inset-0 form');
        if (!modal) return false;
        return [...modal.querySelectorAll('select')].slice(1).length > ${depth};
      })()`,
      8000
    );
    if (!columnReady) break;

    const picked = await cdp.evaluate(
      sessionId,
      `(() => {
        const modal = document.querySelector('div.fixed.inset-0 form');
        const target = [...modal.querySelectorAll('select')].slice(1)[${depth}];
        if (!target) return null;
        const option = [...target.options].find((o) => o.value);
        if (!option) return null;
        Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(
          target,
          option.value
        );
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return option.text;
      })()`
    );
    if (!picked) break;
    await sleep(1200);
  }

  const chosenScope = await cdp.evaluate(
    sessionId,
    `(() => {
      const text = (document.querySelector('div.fixed.inset-0 form') || {}).innerText || '';
      const match = text.split('\\n').filter((line) => line.includes('→')).pop();
      return match ? match.trim() : '';
    })()`
  );
  record('geographic scope was selected from the backend cascade', Boolean(chosenScope), chosenScope || 'none');

  await cdp.evaluate(
    sessionId,
    `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('Create account')); b?.click(); return true; })()`
  );

  const toast = await cdp.waitFor(
    sessionId,
    `!!document.body && /created successfully/i.test(document.body.innerText)`,
    20000
  );
  record('success is shown only after the backend confirms creation', Boolean(toast));

  const modalClosed = await cdp.waitFor(sessionId, `!document.querySelector('div.fixed.inset-0 form')`, 8000);
  record('modal closes after a successful create', Boolean(modalClosed));

  const listing = await (
    await fetch(`${API}/superadmin/accounts/?status=ALL&search=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const created = (listing.results || []).find((row) => row.email === email);
  record(
    'the new account is persisted and returned by the backend',
    Boolean(created),
    created ? `${created.role} / ${created.scope_label} / ${created.location_name}` : 'missing'
  );
  record(
    'persisted scope matches the selected location',
    Boolean(created) && chosenScope.includes(created.location_name),
    `${chosenScope} vs ${created?.location_name}`
  );

  const inTable = await cdp.waitFor(
    sessionId,
    `!!document.body && document.body.innerText.includes(${JSON.stringify(email)})`,
    12000
  );
  record('new account appears in the refreshed staff list', Boolean(inTable));

  if (created) {
    const removed = await fetch(`${API}/superadmin/accounts/${created.id}/`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    record('verification account cleaned up', [200, 204].includes(removed.status), `status ${removed.status}`);
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
