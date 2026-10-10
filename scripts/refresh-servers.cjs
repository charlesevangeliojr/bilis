'use strict';
const fs = require('node:fs');
const sources = [
 'https://librespeed.org/backend-servers/servers.php',
 'https://raw.githubusercontent.com/librespeed/speedtest/master/server-list.json',
];
const origin = 'https://bilis.example';
const snapshot = 'config/servers.json';
const reportPath = 'config/servers-verification.json';

async function get(url, options = {}) {
 const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
 if (!response.ok) {
  await response.body?.cancel();
  throw new Error(`HTTP ${response.status}`);
 }
 return response;
}
function normalize(item) {
 const base = new URL(item.server.startsWith('//') ? `https:${item.server}` : item.server);
 if (base.protocol !== 'https:') throw new Error('HTTPS is required');
 if (!base.pathname.endsWith('/')) base.pathname += '/';
 for (const field of ['name', 'dlURL', 'ulURL', 'pingURL']) {
  if (typeof item[field] !== 'string' || !item[field]) throw new Error(`Missing ${field}`);
 }
 const sponsor = typeof item.sponsorName === 'string' ? item.sponsorName : '';
 const name = sponsor && !item.name.includes(sponsor) ? `${item.name} (${sponsor})` : item.name;
 return {name, server:base.href, dlURL:item.dlURL, ulURL:item.ulURL, pingURL:item.pingURL, getIpURL:item.getIpURL || ''};
}
function endpoint(server, field, parameters = {}) {
 const url = new URL(server[field], server.server);
 if (url.protocol !== 'https:') throw new Error('HTTPS endpoint is required');
 for (const [key, value] of Object.entries({cors:'true', r:Math.random(), ...parameters})) url.searchParams.set(key, value);
 return url;
}
function allowsOrigin(response) {
 return ['*', origin].includes(response.headers.get('access-control-allow-origin'));
}
async function verify(server) {
 let stage = 'ping';
 const checks = {};
 try {
  // Repeat ping to catch intermittently failing endpoints, not just one good response.
  for (let i = 0; i < 3; i++) {
   const ping = await get(endpoint(server, 'pingURL'), {headers:{Origin:origin}});
   if (!allowsOrigin(ping) || (await ping.text()).length !== 0) throw new Error('Ping/CORS incompatible');
  }
  checks.ping = true;
  stage = 'download';
  const download = await get(endpoint(server, 'dlURL', {ckSize:'1'}), {headers:{Origin:origin}});
  if (!download.headers.get('content-type')?.includes('application/octet-stream') || !allowsOrigin(download)) {
   await download.body?.cancel();
   throw new Error('Download/CORS incompatible');
  }
  const length = (await download.arrayBuffer()).byteLength;
  if (length < 1024) throw new Error('Download too short');
  checks.downloadBytes = length;
  stage = 'upload preflight';
  // XHR upload progress and Content-Encoding trigger a browser preflight.
  const uploadURL = endpoint(server, 'ulURL');
  const preflight = await get(uploadURL, {method:'OPTIONS', headers:{
   Origin:origin,
   'Access-Control-Request-Method':'POST',
   'Access-Control-Request-Headers':'content-encoding,content-type',
  }});
  const methods = (preflight.headers.get('access-control-allow-methods') || '').toUpperCase().split(/\s*,\s*/);
  const headers = (preflight.headers.get('access-control-allow-headers') || '').toLowerCase().split(/\s*,\s*/);
  await preflight.body?.cancel();
  if (!allowsOrigin(preflight) || !methods.some(method => ['POST', '*'].includes(method)) ||
      !['content-encoding', 'content-type'].every(header => headers.includes(header) || headers.includes('*'))) {
   throw new Error('Upload preflight/CORS incompatible');
  }
  checks.uploadPreflight = true;
  stage = 'upload';
  const upload = await get(uploadURL, {method:'POST', headers:{
   Origin:origin, 'Content-Type':'application/octet-stream', 'Content-Encoding':'identity',
  }, body:new Uint8Array(1024)});
  if (!allowsOrigin(upload) || (await upload.text()).length !== 0) throw new Error('Upload/CORS incompatible');
  checks.upload = true;
  return {server, checks};
 } catch (error) {
  return {server, checks, stage, error:error.cause?.code ? `${error.message} (${error.cause.code})` : error.message};
 }
}
async function checkAll(servers) {
 const queue = [...servers];
 const results = [];
 async function check() {
  while (queue.length) {
   const result = await verify(queue.shift());
   results.push(result);
   console.log(result.error ? 'FAIL' : 'PASS', result.server.name, result.error ? `${result.stage}: ${result.error}` : '');
  }
 }
 await Promise.all(Array.from({length:Math.min(6, queue.length)}, check));
 return results;
}
(async () => {
 const existing = JSON.parse(fs.readFileSync(snapshot, 'utf8')).map(normalize);
 const key = server => new URL(server.pingURL, server.server).href;
 const known = new Set(existing.map(key));
 console.log(`Checking ${existing.length} configured servers first…`);
 const existingResults = await checkAll(existing);
 const candidates = new Map();
 const sourceFailures = [];
 for (const url of sources) {
  try {
   const list = await (await get(url)).json();
   if (!Array.isArray(list)) throw new Error('Directory did not return a server array');
   for (const item of list) {
    try {
     const server = normalize(item);
     if (!known.has(key(server))) candidates.set(key(server), server);
    } catch (error) {
     sourceFailures.push({source:url, name:item?.name, error:error.message});
    }
   }
  } catch (error) {
   sourceFailures.push({source:url, error:error.message});
   console.warn('Directory unavailable:', url, error.message);
  }
 }
 console.log(`Checking ${candidates.size} additional candidates…`);
 const newResults = await checkAll([...candidates.values()]);
 const results = [...existingResults, ...newResults];
 const verified = results.filter(result => !result.error).map(result => result.server);
 const rank = name => /Philippines|Manila|Cebu|Davao/i.test(name)?0:/Singapore|Hong Kong|Taiwan|Tokyo|Japan|Indonesia|Malaysia|Korea/i.test(name)?1:2;
 verified.sort((a,b) => rank(a.name)-rank(b.name) || a.name.localeCompare(b.name));
 const retained = existingResults.filter(result => !result.error).length;
 const added = newResults.filter(result => !result.error).length;
 const updated = verified.length >= 4;
 fs.writeFileSync(reportPath, JSON.stringify({
  checkedAt:new Date().toISOString(), sources, origin, configured:existing.length, retained, added,
  verified:verified.length, philippines:verified.filter(server => rank(server.name) === 0).length,
  configurationUpdated:updated, sourceFailures,
  results:results.map(result => ({...result, previouslyConfigured:known.has(key(result.server))})),
 }, null, 2)+'\n');
 if (!updated) throw new Error('Too few verified servers; existing configuration retained. See verification report.');
 fs.writeFileSync(snapshot, JSON.stringify(verified, null, 2)+'\n');
 console.log(`Verified ${verified.length} servers: ${retained} retained, ${added} added, ${existing.length-retained} failed configured servers removed.`);
})().catch(error => {console.error(error); process.exitCode = 1;});
