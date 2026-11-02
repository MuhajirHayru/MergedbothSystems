/**
 * End-to-end verification of the messaging contract the UI relies on:
 * REST conversation creation, real-time delivery over /ws/chat/, typing,
 * read receipts and persisted history. Uses the seeded GreenPath accounts.
 *
 *   node scripts/verify-chat.mjs
 */
import WebSocket from 'ws';

const API = process.env.API_BASE || 'http://127.0.0.1:8000/api/v1';
const WS_BASE = process.env.WS_BASE || 'ws://127.0.0.1:8000';
// The Django origin validator requires a browser-style Origin header.
const ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function call(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: response.status, data };
}

async function login(email, password = 'Green@2024') {
  const { status, data } = await call('/auth/login/', {
    method: 'POST',
    body: { email, password },
  });
  if (status !== 200 || !data.access) throw new Error(`login failed for ${email}: ${JSON.stringify(data)}`);
  const me = await call('/auth/me/', { token: data.access });
  return { token: data.access, user: me.data.user };
}

function openSocket(path, token, label) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${WS_BASE}${path}?token=${encodeURIComponent(token)}`, {
      headers: { Origin: ORIGIN },
    });
    const events = [];
    socket.on('message', (raw) => {
      try {
        events.push(JSON.parse(String(raw)));
      } catch {
        /* ignore */
      }
    });
    socket.on('open', () => resolve({ socket, events, label }));
    socket.on('unexpected-response', (_request, response) =>
      reject(new Error(`${label} socket rejected with HTTP ${response.statusCode}`))
    );
    socket.on('error', (error) => reject(new Error(`${label} socket error: ${error.message}`)));
    setTimeout(() => reject(new Error(`${label} socket timeout`)), 10000);
  });
}

const waitFor = async (predicate, timeout = 8000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return null;
};

async function main() {
  const farmer = await login('farmer01@greenpath.et');
  const wholesaler = await login('wholesaler01@greenpath.et');
  record('both seeded marketplace accounts authenticate', Boolean(farmer.token && wholesaler.token));

  const created = await call('/chat/channels/', {
    token: farmer.token,
    method: 'POST',
    body: { participant_ids: [wholesaler.user.id] },
  });
  let channelId = created.data?.channel?.id;
  if (!channelId) {
    const list = await call('/chat/channels/', { token: farmer.token });
    const rows = list.data?.results || [];
    channelId = rows.find((row) =>
      row.participants.some((participant) => String(participant.id) === String(wholesaler.user.id))
    )?.id;
  }
  record('conversation create/reuse returns a channel id', Boolean(channelId), channelId || '');

  const farmerSocket = await openSocket(`/ws/chat/${channelId}/`, farmer.token, 'farmer');
  const wholesalerSocket = await openSocket(`/ws/chat/${channelId}/`, wholesaler.token, 'wholesaler');
  record('both participants connect to the channel socket', true);

  const text = `Verification message about the avocado lot, reference ${Date.now().toString(36)}`;
  const sent = await call(`/chat/channels/${channelId}/messages/`, {
    token: farmer.token,
    method: 'POST',
    body: { content: text, kind: 'TEXT' },
  });
  record('farmer sends a message over REST', sent.status === 201 && sent.data?.message?.id, `status ${sent.status}`);

  const received = await waitFor(() =>
    wholesalerSocket.events.find(
      (event) => event.type === 'chat.message' && event.message?.content === text
    )
  );
  record(
    'recipient receives it live over the socket (no refresh)',
    Boolean(received),
    received ? `from ${received.message.sender_name}` : 'not received'
  );

  const echo = await waitFor(() =>
    farmerSocket.events.find(
      (event) => event.type === 'chat.message' && event.message?.content === text
    )
  );
  record('sender socket receives the persisted message echo', Boolean(echo));

  farmerSocket.socket.send(JSON.stringify({ action: 'typing', is_typing: true }));
  const typing = await waitFor(() =>
    wholesalerSocket.events.find((event) => event.type === 'chat.typing' && event.is_typing)
  );
  record('typing indicator fans out in real time', Boolean(typing), typing?.user || '');

  const replyText = `Reply about the avocado lot, reference ${Date.now().toString(36)}`;
  const reply = await call(`/chat/channels/${channelId}/messages/`, {
    token: wholesaler.token,
    method: 'POST',
    body: { content: replyText, kind: 'TEXT' },
  });
  const farmerGetsReply = await waitFor(() =>
    farmerSocket.events.find(
      (event) => event.type === 'chat.message' && event.message?.content === replyText
    )
  );
  record(
    'recipient reply reaches the original sender live',
    reply.status === 201 && Boolean(farmerGetsReply)
  );

  const unreadBefore = await call('/chat/channels/', { token: farmer.token });
  const farmerChannel = (unreadBefore.data?.results || []).find((row) => row.id === channelId);
  record(
    'channel list exposes live unread counter',
    typeof farmerChannel?.unread_count === 'number' && farmerChannel.unread_count >= 1,
    `unread=${farmerChannel?.unread_count}`
  );

  const read = await call(`/chat/channels/${channelId}/mark-read/`, {
    token: farmer.token,
    method: 'POST',
    body: {},
  });
  const history = await call(`/chat/channels/${channelId}/messages/`, { token: wholesaler.token });
  const rows = history.data?.results || [];
  const persisted = rows.filter((row) => row.content === text || row.content === replyText);
  record(
    'history persists and read receipts are recorded',
    read.status === 200 && persisted.length >= 2 && persisted.some((row) => row.is_read),
    `persisted=${persisted.length}`
  );

  const outsider = await call(`/chat/channels/${channelId}/messages/`, {
    token: (await login('retailer01@greenpath.et')).token,
  });
  record('a non-participant cannot read the conversation', outsider.status === 404, `status ${outsider.status}`);

  farmerSocket.socket.close();
  wholesalerSocket.socket.close();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('verification crashed:', error);
  process.exit(1);
});
