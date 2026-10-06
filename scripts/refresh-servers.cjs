'use strict';
const fs = require('node:fs');
const directory = 'https://librespeed.org/backend-servers/servers.php';
const source = 'https://raw.githubusercontent.com/librespeed/speedtest/master/server-list.json';
const origin = 'http://127.0.0.1:8000';
async function get(url, options = {}) {
 const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
 if (!response.ok) throw new Error(`HTTP ${response.status}`);
 return response;
}
(async () => {
 const all = [];
 for (const url of [directory, source]) {
  const list = await (await get(url)).json();
  all.push(...list);
 }
 const unique = new Map();
 for (const item of all) {
  const base = new URL(item.server.startsWith('//') ? `https:${item.server}` : item.server);
  if (base.protocol !== 'https:') continue;
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const sponsor = typeof item.sponsorName === 'string' ? item.sponsorName : '';
  const name = sponsor && !item.name.includes(sponsor) ? `${item.name} (${sponsor})` : item.name;
  const server = {name,server:base.href,dlURL:item.dlURL,ulURL:item.ulURL,pingURL:item.pingURL,getIpURL:item.getIpURL};
  unique.set(new URL(server.pingURL,base).href,server);
 }
 const queue = Array.from(unique.values());
 const verified=[];const failures=[];
 async function check() {
  while(queue.length) {
   const server=queue.shift();
   try {
    const pingURL=new URL(server.pingURL,server.server);pingURL.searchParams.set('cors','true');
    const ping=await get(pingURL,{headers:{Origin:origin}});
    if (!['*',origin].includes(ping.headers.get('access-control-allow-origin')) || (await ping.text()).length!==0) throw new Error('Ping/CORS incompatible');
    const dlURL=new URL(server.dlURL,server.server);dlURL.searchParams.set('cors','true');dlURL.searchParams.set('ckSize','1');
    const download=await get(dlURL,{headers:{Origin:origin}});
    if (!download.headers.get('content-type')?.includes('application/octet-stream') || !['*',origin].includes(download.headers.get('access-control-allow-origin'))) {await download.body.cancel();throw new Error('Download/CORS incompatible')}
    const length=(await download.arrayBuffer()).byteLength;if(length<1024)throw new Error('Download too short');
    const ulURL=new URL(server.ulURL,server.server);ulURL.searchParams.set('cors','true');
    const upload=await get(ulURL,{method:'POST',headers:{Origin:origin,'Content-Type':'application/octet-stream'},body:new Uint8Array(1024)});
    if(!['*',origin].includes(upload.headers.get('access-control-allow-origin')) || (await upload.text()).length!==0)throw new Error('Upload/CORS incompatible');
    verified.push(server);console.log('PASS',server.name);
   } catch(error) {failures.push({name:server.name,error:error.message});console.log('SKIP',server.name,error.message)}
  }
 }
 await Promise.all(Array.from({length:6},check));
 const rank = name => /Philippines|Manila|Cebu|Davao/i.test(name)?0:/Singapore|Hong Kong|Taiwan|Tokyo|Japan|Indonesia|Malaysia|Korea/i.test(name)?1:2;
 verified.sort((a,b)=>rank(a.name)-rank(b.name)||a.name.localeCompare(b.name));
 if(verified.length<4)throw new Error('Too few verified servers; existing configuration retained');
 fs.writeFileSync('config/servers.json',JSON.stringify(verified,null,2)+'\n');
 fs.writeFileSync('config/servers-verification.json',JSON.stringify({checkedAt:new Date().toISOString(),sources:[directory,source],verified:verified.length,philippines:verified.filter(s=>rank(s.name)===0).length,failures},null,2)+'\n');
 console.log('Verified',verified.length,'servers; Philippines:',verified.filter(s=>rank(s.name)===0).length);
})().catch(error=>{console.error(error);process.exitCode=1});
