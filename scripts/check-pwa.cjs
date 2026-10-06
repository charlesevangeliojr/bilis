// Run with Bilis on :8000 and a dedicated Chrome debugging session on :9222.
const assert = require('node:assert/strict');
(async () => {
  const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
  const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const handler = pending.get(message.id);
      pending.delete(message.id);
      message.error ? handler.reject(message.error) : handler.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = condition => evaluate(`new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(${condition}){clearInterval(timer);resolve(true)}else if(++n>200){clearInterval(timer);reject(new Error('Timed out: '+${JSON.stringify(condition)}))}},100)})`);
  let promptScript;
  try {
    await call('Runtime.enable');
    await call('Page.enable');
    await call('Network.enable');
    // Simulated outcomes must not race Chrome's genuine install-ready event.
    promptScript = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.addEventListener('beforeinstallprompt', event => {
        if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
    ` });
    await call('Page.navigate', { url: 'http://127.0.0.1:8000/' });
    await wait("document.getElementById('themeToggle') && document.readyState === 'complete'");
    await evaluate("localStorage.removeItem('bilis-theme')");
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await call('Page.reload');
    await wait("document.readyState === 'complete' && document.documentElement.dataset.theme === 'dark'");
    assert.equal(await evaluate("getComputedStyle(document.documentElement).backgroundColor"), 'rgb(16, 28, 23)');
    await evaluate("document.getElementById('themeToggle').click()");
    assert.equal(await evaluate("localStorage.getItem('bilis-theme')"), 'light');
    await call('Page.reload');
    await wait("document.readyState === 'complete' && document.documentElement.dataset.theme === 'light'");
    await evaluate("document.getElementById('themeToggle').click()");
    assert.equal(await evaluate("document.getElementById('themeToggle').getAttribute('aria-pressed')"), 'true');
    for (const width of [320, 390, 768, 1440]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `Overflow at ${width}`);
    }
    await wait('navigator.serviceWorker.controller');
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate("sessionStorage.removeItem('bilis-install-dismissed')");
    await call('Page.reload');
    await wait("document.getElementById('installModal')?.open");
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
    await evaluate("document.getElementById('laterInstall').click()");
    assert.equal(await evaluate("document.getElementById('installModal').open"), false);
    await call('Page.reload');
    await wait("document.readyState === 'complete'");
    await evaluate("new Promise(resolve=>setTimeout(resolve,3000))");
    assert.equal(await evaluate("document.getElementById('installModal').open"), true);
    await evaluate("document.getElementById('laterInstall').click()");
    await wait("!document.documentElement.classList.contains('install-dialog-open')");
    assert.equal(await evaluate("document.documentElement.classList.contains('install-dialog-open')"), false);
    // A landscape phone is detected even when its viewport is wider than 600px.
    const phoneScript = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
      Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (Linux; Android 14) Mobile'});
      window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();event.stopImmediatePropagation()},true);
    ` });
    await evaluate("sessionStorage.removeItem('bilis-install-dismissed')");
    await call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
    await call('Page.reload');
    await wait("document.getElementById('installModal')?.open");
    assert.equal(await evaluate("document.getElementById('confirmInstall').hidden"), false);
    await evaluate("document.getElementById('confirmInstall').click()");
    assert.ok((await evaluate("document.getElementById('installInstructions').textContent")).includes('Install app'));
    assert.equal(await evaluate("document.getElementById('confirmInstall').textContent"), 'Got it');
    assert.equal(await evaluate("document.getElementById('installModal').getBoundingClientRect().height <= innerHeight - 24"), true);
    await evaluate("document.getElementById('confirmInstall').click()");
    await wait("!document.documentElement.classList.contains('install-dialog-open')");
    await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: phoneScript.identifier });
    const iosScript = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
      Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'});
      window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();event.stopImmediatePropagation()},true);
    ` });
    await evaluate("sessionStorage.removeItem('bilis-install-dismissed')");
    await call('Page.reload');
    await wait("document.getElementById('installModal')?.open");
    await evaluate("document.getElementById('confirmInstall').click()");
    assert.ok((await evaluate("document.getElementById('installInstructions').textContent")).includes('Safari'));
    for (const [width,height] of [[320,568],[390,844],[844,390]]) {
      await call('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:1,mobile:true });
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
      assert.equal(await evaluate("document.getElementById('installModal').getBoundingClientRect().width <= innerWidth"), true);
      assert.equal(await evaluate("document.getElementById('confirmInstall').getBoundingClientRect().height >= 44"), true);
    }
    await call('Input.dispatchKeyEvent', { type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27 });
    await wait("!document.getElementById('installModal').open");
    assert.equal(await evaluate("document.documentElement.classList.contains('install-dialog-open')"), false);
    await call('Page.removeScriptToEvaluateOnNewDocument', { identifier:iosScript.identifier });
    const standaloneScript = await call('Page.addScriptToEvaluateOnNewDocument', { source:"Object.defineProperty(navigator,'standalone',{value:true});" });
    await evaluate("sessionStorage.removeItem('bilis-install-dismissed')");
    await call('Page.reload');
    await wait("document.readyState === 'complete'");
    await evaluate("new Promise(resolve=>setTimeout(resolve,2000))");
    assert.equal(await evaluate("document.getElementById('installModal').open"), false);
    assert.equal(await evaluate("document.getElementById('installBtn').hidden"), true);
    await call('Page.removeScriptToEvaluateOnNewDocument', { identifier:standaloneScript.identifier });
    await evaluate("sessionStorage.setItem('bilis-install-dismissed','true')");
    await call('Page.reload');
    await wait("document.readyState === 'complete'");
    await evaluate("document.getElementById('installBtn').click()");
    assert.equal(await evaluate("document.getElementById('installModal').open"), true);
    await evaluate(`{const event=new Event('beforeinstallprompt',{cancelable:true});
      event.prompt=async()=>{throw new Error('Prompt unavailable')};window.dispatchEvent(event);}`);
    await evaluate("document.getElementById('confirmInstall').click()");
    await wait("document.getElementById('installModal').open && !document.getElementById('installInstructions').hidden");
    assert.equal(await evaluate("document.documentElement.classList.contains('install-dialog-open')"), true);
    await evaluate(`{const event=new Event('beforeinstallprompt',{cancelable:true});
      event.prompt=async()=>{window.installRequested=true};
      event.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(event);}`);
    assert.equal(await evaluate("document.getElementById('confirmInstall').hidden"), false);
    await evaluate("document.getElementById('confirmInstall').click()");
    assert.equal(await evaluate('window.installRequested'), true);
    assert.equal(await evaluate("document.getElementById('installModal').open"), false);
    const manifest = await call('Page.getAppManifest');
    assert.equal(manifest.errors.length, 0, JSON.stringify(manifest.errors));
    const install = await call('Page.getInstallabilityErrors');
    assert.deepEqual(install.installabilityErrors, []);
    const cached = await evaluate("caches.open('bilis-shell-v6').then(cache=>cache.keys()).then(keys=>keys.map(key=>key.url))");
    assert.ok(cached.some(url => url.endsWith('/icons/icon-512.png')));
    assert.ok(!cached.some(url => url.includes('/api/')));
    await evaluate("fetch('api/ping.php').then(response=>response.text())");
    assert.equal(await evaluate("caches.match(new URL('api/ping.php',document.baseURI)).then(Boolean)"), false);
    await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await call('Page.reload');
    await wait("document.readyState === 'complete' && document.getElementById('offlineNotice') && !document.getElementById('offlineNotice').hidden");
    assert.equal(await evaluate("document.documentElement.dataset.theme"), 'dark');
    await evaluate("document.getElementById('startBtn').click()");
    assert.equal(await evaluate("document.getElementById('cancelBtn').hidden"), true);
    await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await wait("document.getElementById('offlineNotice').hidden");
    assert.deepEqual(errors, []);
    console.log('PASS: theme persistence, Android/iOS automatic popup including landscape, native install action, installation instructions, popup returns on reload, standalone suppression, responsive modal/touch targets/Escape, manifest/installability, offline reload, online recovery, API cache exclusion');
  } finally {
    if (promptScript) await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: promptScript.identifier });
    await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await call('Emulation.setEmulatedMedia', { features: [] });
    ws.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
