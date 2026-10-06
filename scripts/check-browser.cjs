// Dependency-free Chrome smoke test. Launch Chrome with --remote-debugging-port=9222 first.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const http = require('node:http');
(async () => {
  const counts = { downloads: 0, peakDownloads: 0, uploads: 0, peakUploads: 0 };
  const fixture = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Encoding, Content-Type');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.end(); return; }
    if (req.url.startsWith('/ping')) { res.end(); return; }
    if (req.url.startsWith('/download')) {
      res.setHeader('Content-Type', 'application/octet-stream');
      counts.peakDownloads = Math.max(counts.peakDownloads, ++counts.downloads);
      const timer = setInterval(() => res.write(Buffer.alloc(65536, 173)), 10);
      res.on('close', () => { clearInterval(timer); counts.downloads--; });
      return;
    }
    if (req.url.startsWith('/upload')) {
      counts.peakUploads = Math.max(counts.peakUploads, ++counts.uploads);
      req.resume();
      req.on('end', () => setTimeout(() => res.end(), 100));
      res.on('close', () => counts.uploads--);
      return;
    }
    res.writeHead(503); res.end('Unavailable');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const fixtureBase = `http://127.0.0.1:${fixture.address().port}/`;
  const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
  const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let sequence = 0;
  let onLoad = null;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id) { const cb = pending.get(data.id); pending.delete(data.id); data.error ? cb.reject(data.error) : cb.resolve(data.result); }
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text);
    if (data.method === 'Page.loadEventFired' && onLoad) onLoad();
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const navigate = async () => {
    const loaded = new Promise(resolve => { onLoad = resolve; });
    await call('Page.navigate', { url: 'http://127.0.0.1:8000' });
    await loaded;
    onLoad = null;
  };
  const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const waitFor = expression => evaluate(`new Promise((resolve,reject)=>{let n=0;const i=setInterval(()=>{if(${expression}){clearInterval(i);resolve(true)}else if(++n>600){clearInterval(i);reject(new Error('Timed out'))}},100)})`);
  try {
    await call('Runtime.enable');
    await call('Page.enable');
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `{
      const originalFetch=window.fetch;
      window.fetch=(url,options)=>String(url).startsWith('https://api.ipify.org')
        ? Promise.resolve(new Response(JSON.stringify({ip:'203.0.113.42'}),{headers:{'Content-Type':'application/json'}}))
        : originalFetch(url,options);
    }` });
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
    await navigate();
    await waitFor("document.getElementById('startBtn') && document.getElementById('serverHost').textContent === 'Automatic selection'");
    await waitFor("document.getElementById('serverSelect').options.length > 1 && !document.getElementById('serverSelect').disabled");
    await waitFor("document.getElementById('clientIp').textContent === '203.0.113.42'");
    await evaluate("window.ipOriginalFetch=window.fetch;window.fetch=async()=>new Response('Unavailable',{status:503});loadClientIp()");
    await waitFor("document.getElementById('clientIp').textContent === 'Unavailable'");
    assert.equal(await evaluate("document.getElementById('retryIp').hidden"), false);
    assert.equal(await evaluate("document.getElementById('startBtn').disabled"), false);
    await evaluate("window.fetch=async()=>new Response(JSON.stringify({ip:'2001:db8::42'}),{headers:{'Content-Type':'application/json'}});document.getElementById('retryIp').click()");
    await waitFor("document.getElementById('clientIp').textContent === 'Unavailable'");
    assert.equal(await evaluate("document.getElementById('retryIp').hidden"), false);
    await evaluate("window.fetch=async()=>new Response(JSON.stringify({ip:'203.0.113.42'}),{headers:{'Content-Type':'application/json'}});document.getElementById('retryIp').click()");
    await waitFor("document.getElementById('clientIp').textContent === '203.0.113.42'");
    assert.equal(await evaluate("document.getElementById('retryIp').hidden"), true);
    await evaluate("window.fetch=window.ipOriginalFetch");
    console.log('PASS: public IPv4 display, IPv6 rejection, lookup failure, retry recovery');
    // Deterministic local integration checks; do not consume public bandwidth.
    await evaluate(`window.liveFetch=window.fetch;window.fetch=async(url,options)=>{
      const response=await window.liveFetch(url,options);
      if(!String(url).includes('api/settings.php'))return response;
      const settings=await response.json();settings.localDevelopment=true;
      settings.parameters.xhr_dlMultistream=1;settings.parameters.xhr_ulMultistream=1;
      return new Response(JSON.stringify(settings),{headers:{'Content-Type':'application/json'}})
    }`);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    fs.writeFileSync('scripts/desktop-preview.png', Buffer.from((await call('Page.captureScreenshot', { captureBeyondViewport: true })).data, 'base64'));
    await evaluate("document.getElementById('serverSelect').value='local';document.getElementById('serverSelect').dispatchEvent(new Event('change'));document.getElementById('startBtn').click()");
    await waitFor("document.getElementById('status').textContent === 'Test complete' || document.getElementById('status').textContent === 'Test failed'");
    assert.equal(await evaluate("document.getElementById('status').textContent"), 'Test complete', await evaluate("document.getElementById('log').textContent"));
    for (const id of ['ping', 'down', 'up']) assert.ok(Number.isFinite(Number(await evaluate(`document.getElementById('${id}').textContent`))));
    assert.equal(await evaluate("document.getElementById('progressTrack').getAttribute('aria-valuenow')"), '100');
    assert.equal(await evaluate("document.getElementById('downHero').textContent"), '--');
    assert.equal(await evaluate("document.getElementById('gaugeArc').style.strokeDasharray"), '0, 100');
    const icon = await evaluate("fetch(document.querySelector('link[rel=icon]').href).then(async response=>({status:response.status,type:response.headers.get('content-type'),body:await response.text()}))");
    assert.equal(icon.status, 200);
    assert.equal(icon.type, 'image/svg+xml');
    assert.ok(icon.body.includes('<svg'));
    assert.ok((await evaluate("document.getElementById('log').textContent")).includes('Jitter:'));
    assert.ok((await evaluate("document.getElementById('log').textContent")).includes('LibreSpeed'));
    assert.equal(await evaluate("document.getElementById('serverHost').textContent"), 'Bilis server');
    assert.equal(await evaluate("document.getElementById('serverSelect').value"), 'local');
    assert.ok((await evaluate("document.getElementById('serverHint').textContent")).startsWith('Local test:'));
    console.log('PASS: real LibreSpeed ping/jitter, sustained download/upload, completion, results, progress');
    await evaluate("document.getElementById('startBtn').click();document.getElementById('cancelBtn').click()");
    await waitFor("!document.getElementById('startBtn').disabled");
    assert.equal(await evaluate("document.getElementById('status').textContent"), 'Test cancelled');
    console.log('PASS: cancellation and button recovery');
    await evaluate("document.getElementById('startBtn').click()");
    await waitFor("document.getElementById('status').textContent === 'Testing download'");
    await evaluate("document.getElementById('cancelBtn').click()");
    assert.equal(await evaluate("document.getElementById('status').textContent"), 'Test cancelled');
    assert.equal(await evaluate('activeRun'), null);
    console.log('PASS: cancellation during an active worker transfer');
    await evaluate("window.originalFetch=window.fetch;window.fetch=async()=>new Response('Unavailable',{status:503});document.getElementById('startBtn').click()");
    await waitFor("!document.getElementById('startBtn').disabled");
    assert.equal(await evaluate("document.getElementById('status').textContent"), 'Test failed');
    assert.ok((await evaluate("document.getElementById('phase').textContent")).includes('503'));
    await evaluate('window.fetch=window.originalFetch');
    console.log('PASS: HTTP failure and retry recovery');
    // Use a real concurrent backend fixture to exercise public-server mode.
    await evaluate(`window.originalFetch=window.fetch;window.fetch=async(url,options)=>{
      const response=await window.originalFetch(url,options);
      if(!String(url).includes('api/settings.php'))return response;
      const settings=await response.json();
      settings.parameters.time_dl_max=1;settings.parameters.time_ul_max=1;
      settings.parameters.time_auto=false;settings.parameters.count_ping=3;
      settings.parameters.xhr_dlMultistream=6;settings.parameters.xhr_ulMultistream=3;
      settings.parameters.xhr_ul_blob_megabytes=1;
      settings.servers=[{name:'Unavailable',server:${JSON.stringify(fixtureBase)},pingURL:'missing',dlURL:'download',ulURL:'upload'},
        {name:'Concurrent test backend',server:${JSON.stringify(fixtureBase)},pingURL:'ping',dlURL:'download',ulURL:'upload'}];
      return new Response(JSON.stringify(settings),{headers:{'Content-Type':'application/json'}})
    };document.getElementById('serverSelect').value='auto';document.getElementById('startBtn').click()`);
    await waitFor("document.getElementById('status').textContent === 'Testing download'");
    assert.equal(await evaluate("document.getElementById('speedGauge').dataset.direction"), 'download');
    assert.equal(await evaluate("document.getElementById('heroIcon').textContent"), '↓');
    assert.equal(await evaluate("document.getElementById('serverSelect').disabled"), true);
    await waitFor("document.getElementById('status').textContent === 'Testing upload'");
    assert.equal(await evaluate("document.getElementById('speedGauge').dataset.direction"), 'upload');
    assert.equal(await evaluate("document.getElementById('heroIcon').textContent"), '↑');
    await waitFor("!document.getElementById('startBtn').disabled");
    assert.equal(await evaluate("document.getElementById('status').textContent"), 'Test complete', await evaluate("document.getElementById('log').textContent"));
    assert.equal(await evaluate("document.getElementById('serverHost').textContent"), 'Concurrent test backend');
    assert.ok(counts.peakDownloads >= 6, `Expected 6 parallel downloads, saw ${counts.peakDownloads}`);
    assert.ok(counts.peakUploads >= 3, `Expected 3 parallel uploads, saw ${counts.peakUploads}`);
    assert.equal(await evaluate("document.getElementById('speedGauge').dataset.direction"), 'download');
    console.log('PASS: automatic reachable-server selection, CORS, six parallel downloads, three parallel uploads');
    await evaluate(`{const chooser=document.getElementById('serverSelect');
      chooser.value=Array.from(chooser.options).find(option=>option.text==='Concurrent test backend').value;
      chooser.dispatchEvent(new Event('change'));document.getElementById('startBtn').click()}`);
    await waitFor("document.getElementById('status').textContent === 'Testing download'");
    assert.ok((await evaluate("document.getElementById('log').textContent")).includes('Manually selected Concurrent test backend'));
    await evaluate("document.getElementById('cancelBtn').click()");
    assert.equal(await evaluate("document.getElementById('serverSelect').disabled"), false);
    assert.equal(await evaluate("document.getElementById('serverSelect').selectedOptions[0].textContent"), 'Concurrent test backend');
    await evaluate(`{const chooser=document.getElementById('serverSelect');
      chooser.value=Array.from(chooser.options).find(option=>option.text==='Unavailable').value;
      chooser.dispatchEvent(new Event('change'));document.getElementById('startBtn').click()}`);
    await waitFor("!document.getElementById('startBtn').disabled");
    assert.equal(await evaluate("document.getElementById('status').textContent"), 'Test failed');
    assert.ok((await evaluate("document.getElementById('phase').textContent")).includes('Your selected server is unreachable'));
    await evaluate("document.getElementById('serverSelect').value='auto';document.getElementById('serverSelect').dispatchEvent(new Event('change'))");
    console.log('PASS: download/upload indicators, chooser locking, manual selection, unavailable selection without fallback');
    await evaluate(`const serverFetch=window.fetch;window.fetch=async(url,options)=>{
      const response=await serverFetch(url,options);
      if(!String(url).includes('api/settings.php'))return response;
      const settings=await response.json();settings.servers=settings.servers.slice(1);settings.servers[0].dlURL='missing';
      return new Response(JSON.stringify(settings),{headers:{'Content-Type':'application/json'}})
    };document.getElementById('startBtn').click()`);
    await waitFor("!document.getElementById('startBtn').disabled");
    assert.equal(await evaluate("document.getElementById('status').textContent"), 'Test failed');
    await evaluate('window.fetch=window.originalFetch');
    console.log('PASS: HTTP failure inside the measurement worker does not produce a false success');
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate();
    await waitFor("document.getElementById('startBtn') && document.getElementById('serverHost').textContent === 'Automatic selection'");
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    fs.writeFileSync('scripts/mobile-preview.png', Buffer.from((await call('Page.captureScreenshot', { captureBeyondViewport: true })).data, 'base64'));
    for (const width of [320, 768]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `Overflow at ${width}px`);
    }
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await evaluate("getComputedStyle(document.getElementById('gaugeArc')).transitionDuration"), '0s');
    assert.deepEqual(errors, []);
    console.log('PASS: desktop, tablet, 390px and 320px mobile layouts, reduced motion, no JS exceptions');
  } finally { ws.close(); fixture.closeAllConnections(); fixture.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
