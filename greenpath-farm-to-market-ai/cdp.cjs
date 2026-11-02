const WebSocket = require('ws');
const pageId = '1C9E521DFE7CE6A78382C4DD597F9E50';
const ws = new WebSocket('ws://localhost:9222/devtools/page/' + pageId);
ws.on('open', () => {
  ws.send(JSON.stringify({id:1,method:'Runtime.enable'}));
  ws.send(JSON.stringify({id:2,method:'Console.enable'}));
  ws.send(JSON.stringify({id:3,method:'Log.enable'}));
  setTimeout(() => { ws.send(JSON.stringify({id:4,method:'Page.reload'})); }, 500);
});
ws.on('message', (m) => {
  const d = JSON.parse(m);
  if (d.method) console.log(d.method, JSON.stringify(d.params||{}).slice(0,1000));
});
setTimeout(() => process.exit(0), 15000);
