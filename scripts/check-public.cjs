// Optional real internet smoke check. Requires Chrome debugging on port 9223.
const assert = require('node:assert/strict');
(async () => {
 const pages = await (await fetch('http://127.0.0.1:9223/json')).json();
 const ws = new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
 let sequence=0; const pending=new Map();let onLoad;
 ws.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.id){const p=pending.get(d.id);pending.delete(d.id);d.error?p.reject(d.error):p.resolve(d.result)}if(d.method==='Page.loadEventFired'&&onLoad)onLoad()});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 try {
  await call('Page.enable');
  const loaded=new Promise(resolve=>{onLoad=resolve});
  await call('Page.navigate',{url:'http://127.0.0.1:8000'});await loaded;onLoad=null;
  await evaluate(`new Promise(resolve=>{const i=setInterval(()=>{if(document.getElementById('startBtn')&&typeof Speedtest==='function'){clearInterval(i);resolve()}},100)})`);
  if (process.argv.includes('--ip-only')) {
    await evaluate(`new Promise((resolve,reject)=>{let n=0;const i=setInterval(()=>{if(document.getElementById('clientIp').textContent!=='Detecting…'){clearInterval(i);resolve()}else if(++n>100){clearInterval(i);reject(new Error('IP check timed out'))}},100)})`);
    assert.equal(await evaluate("validIpAddress(document.getElementById('clientIp').textContent)"), true);
    console.log('PASS: live public IP lookup in browser (address not printed)');
    return;
  }
  await evaluate("document.getElementById('startBtn').click()");
  await evaluate(`new Promise((resolve,reject)=>{let n=0;const i=setInterval(()=>{if(!document.getElementById('startBtn').disabled){clearInterval(i);resolve()}else if(++n>1250){clearInterval(i);reject(new Error('Public check timed out'))}},100)})`);
  const result=await evaluate(`({status:document.getElementById('status').textContent,server:document.getElementById('serverHost').textContent,log:document.getElementById('log').textContent})`);
  console.log(JSON.stringify(result,null,2));assert.equal(result.status,'Test complete');
 } finally {ws.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
