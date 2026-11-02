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
      ws.send(JSON.stringify({id:1,method:'Console.enable'}));
      ws.send(JSON.stringify({id:2,method:'Runtime.enable'}));
      ws.send(JSON.stringify({id:3,method:'Log.enable'}));
      ws.send(JSON.stringify({id:4,method:'Page.navigate',params:{url:'http://127.0.0.1:3000/'}}));
      setTimeout(() => {
        ws.send(JSON.stringify({id:5,method:'Runtime.evaluate',params:{expression:'document.documentElement.outerHTML.slice(0,4000)',returnByValue:true}}));
      }, 12000);
    });
    ws.on('message', (m) => {
      const d = JSON.parse(m);
      if (d.method === 'Console.messageAdded') console.log('CONSOLE:', d.params?.message?.level, d.params?.message?.text);
      if (d.method === 'Runtime.exceptionThrown') console.log('EXCEPTION:', JSON.stringify(d.params));
      if (d.method === 'Log.entryAdded') console.log('LOG:', d.params?.entry?.level, d.params?.entry?.text);
      if (d.id===5) { console.log('HTML:', d.result?.result?.value); process.exit(0); }
    });
  });
});
setTimeout(()=>process.exit(0),30000);
