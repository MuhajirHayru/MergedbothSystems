const WebSocket = require('ws');
const http = require('http');
http.get('http://localhost:9222/json', (res) => {
  let data='';
  res.on('data', c=>data+=c);
  res.on('end', () => {
    const pages = JSON.parse(data);
    const page = pages.find(p => p.type==='page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({id:1,method:'Page.enable'}));
      ws.send(JSON.stringify({id:2,method:'Runtime.enable'}));
      ws.send(JSON.stringify({id:3,method:'Page.navigate',params:{url:'http://127.0.0.1:3000/'}}));
      setTimeout(() => {
        ws.send(JSON.stringify({id:4,method:'Runtime.evaluate',params:{expression:'document.body ? document.body.innerText.slice(0,3000) : "NO BODY"',returnByValue:true}}));
      }, 12000);
    });
    ws.on('message', (m) => {
      const d = JSON.parse(m);
      if (d.id===4) { console.log('BODY_TEXT:', d.result?.result?.value); process.exit(0); }
      if (d.method === 'Page.loadEventFired') console.log('LOADED');
      if (d.method && d.method.includes('Exception')) console.log('EXC:', JSON.stringify(d));
    });
  });
});
setTimeout(()=>process.exit(0),30000);
