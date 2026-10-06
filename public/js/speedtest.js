'use strict';
const $ = (id) => document.getElementById(id);
let activeRun = null;

function setGaugeMode(direction) {
  $('speedGauge').dataset.direction = direction;
  $('heroLabel').textContent = direction === 'upload' ? 'UPLOAD SPEED' : 'DOWNLOAD SPEED';
  $('heroIcon').textContent = direction === 'upload' ? '\u2191' : '\u2193';
}
function serverKey(server) { return JSON.stringify([server.server, server.pingURL, server.name]); }
function populateServers(settings, selection = $('serverSelect').value) {
  const select = $('serverSelect');
  select.replaceChildren(new Option('Automatic (best latency)', 'auto'));
  select.add(new Option('Bilis server', 'local'));
  for (const server of settings.servers) select.add(new Option(server.name, serverKey(server)));
  select.value = Array.from(select.options).some(option => option.value === selection) ? selection : 'auto';
  select.disabled = !!activeRun;
}

function log(message) { $('log').textContent += `${message}\n`; }
function setStatus(message, state = 'running') {
  $('status').textContent = message;
  $('statusPill').dataset.state = state;
}
function setProgress(value) {
  const percent = Math.max(0, Math.min(100, value));
  $('progress').style.width = `${percent}%`;
  $('progressTrack').setAttribute('aria-valuenow', String(Math.round(percent)));
}
function showSpeed(value) {
  $('downHero').textContent = value.toFixed(1);
  const marks = [[0, 0], [10, 20], [100, 50], [500, 80], [1000, 100]];
  let percent = 100;
  for (let i = 1; i < marks.length; i++) {
    if (value <= marks[i][0]) {
      const [lowValue, lowPosition] = marks[i - 1];
      const [highValue, highPosition] = marks[i];
      percent = lowPosition + (value - lowValue) / (highValue - lowValue) * (highPosition - lowPosition);
      break;
    }
  }
  $('gaugeArc').style.strokeDasharray = `${percent} 100`;
}
function setPhase(name, description) {
  setStatus(`Testing ${name}`);
  $('phase').textContent = description;
  for (const metric of ['ping', 'download', 'upload']) {
    $(`${metric}Metric`).classList.toggle('active', name === metric);
  }
}
function endpoint(path) { return new URL(path, document.baseURI).href; }
function withQuery(url, parameters) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(parameters)) target.searchParams.set(key, value);
  target.searchParams.set('r', Math.random());
  return target.href;
}
async function request(run, url, options = {}) {
  const response = await fetch(url, { ...options, cache: 'no-store', signal: run.controller.signal });
  if (!response.ok) throw new Error(`Server returned HTTP ${response.status}. Please try again.`);
  return response;
}
function finish(run, state, message) {
  if (activeRun !== run) return;
  activeRun = null;
  clearTimeout(run.timeout);
  run.controller.abort();
  if (run.engine) {
    run.engine.onupdate = null;
    run.engine.onend = null;
    clearInterval(run.engine.updater);
    run.engine.worker?.terminate();
  }
  setStatus(state === 'complete' ? 'Test complete' : state === 'cancelled' ? 'Test cancelled' : 'Test failed', state === 'error' ? 'error' : state);
  $('phase').textContent = message;
  if (state === 'complete') setProgress(100);
  log(message);
  setGaugeMode('download');
  if (state === 'complete') {
    $('downHero').textContent = '--';
    $('gaugeArc').style.strokeDasharray = '0 100';
  } else if (Number.isFinite(Number(run.latest?.dlStatus)) && run.latest.dlStatus !== '') {
    showSpeed(Number(run.latest.dlStatus));
  }
  $('startBtn').disabled = false;
  $('buttonLabel').textContent = 'Test again';
  $('cancelBtn').hidden = true;
  $('serverSelect').disabled = $('serverSelect').options.length <= 1;
  for (const metric of ['ping', 'download', 'upload']) $(`${metric}Metric`).classList.remove('active');
}
async function checkLocalBackend(run) {
  // Check response bodies as well as status before trusting a measurement.
  const ping = await request(run, endpoint('api/ping.php'));
  if (!Number.isFinite((await ping.json()).t)) throw new Error('The ping server returned an invalid response.');
  const download = await request(run, withQuery(endpoint('api/download.php'), { bytes: 1024 }));
  if (!download.headers.get('content-type')?.includes('application/octet-stream') || (await download.arrayBuffer()).byteLength !== 1024) {
    throw new Error('The download server returned an invalid response.');
  }
  const upload = await request(run, endpoint('api/upload.php'), {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(1024),
  });
  if ((await upload.json()).received !== 1024) throw new Error('The upload server returned an invalid response.');
}
async function selectServer(run, definitions, manual = false) {
  setStatus('Selecting server');
  $('phase').textContent = manual ? 'Checking your selected test server…' : 'Finding the test server with the lowest latency…';
  const probe = async (definition) => {
    if (!definition || typeof definition.name !== 'string' || typeof definition.server !== 'string') throw new Error('Invalid test server configuration.');
    const base = new URL(definition.server.endsWith('/') ? definition.server : `${definition.server}/`, document.baseURI);
    if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Invalid test server URL.');
    if (location.protocol === 'https:' && base.protocol !== 'https:') throw new Error('HTTPS pages require HTTPS test servers.');
    const server = { ...definition, server: base.href, getIpURL: definition.getIpURL || '' };
    for (const field of ['dlURL', 'ulURL', 'pingURL']) {
      if (typeof server[field] !== 'string' || !server[field]) throw new Error(`Missing ${field} in server configuration.`);
    }
    const times = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const response = await fetch(withQuery(new URL(server.pingURL, base).href, { cors: 'true' }), {
        cache: 'no-store', signal: AbortSignal.any([run.controller.signal, AbortSignal.timeout(3000)]),
      });
      if (!response.ok || (await response.text()).length !== 0) throw new Error('Test server is unavailable or its ping endpoint is not empty.');
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return { server, latency: times[1] };
  };
  // Limit discovery traffic when the chooser contains many public servers.
  let next = 0;
  const candidates = [];
  const probeNext = async () => {
    while (next < definitions.length && activeRun === run) {
      const [result] = await Promise.allSettled([probe(definitions[next++])]);
      candidates.push(result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, definitions.length) }, probeNext));
  if (activeRun !== run) throw new DOMException('Cancelled', 'AbortError');
  const available = candidates.filter(result => result.status === 'fulfilled').map(result => result.value);
  available.sort((a, b) => a.latency - b.latency);
  if (!available.length) throw new Error(manual ? 'Your selected server is unreachable. Choose another server or Automatic, then try again.' : 'No configured test server is reachable. Check its URL, HTTPS, and CORS settings.');
  log(`${manual ? 'Manually selected' : 'Selected'} ${available[0].server.name} (${available[0].latency.toFixed(1)} ms) from ${available.length} reachable server(s).`);
  return available[0].server;
}
function update(run, data) {
  if (activeRun !== run) return;
  run.latest = data;
  if (data.error) {
    finish(run, 'error', data.error);
    return;
  }
  if (['dlStatus', 'ulStatus', 'pingStatus', 'jitterStatus'].some(key => data[key] === 'Fail')) {
    const failed = [['dlStatus', 'Download'], ['ulStatus', 'Upload'], ['pingStatus', 'Ping']].filter(([key]) => data[key] === 'Fail').map(([, name]) => name).join(', ');
    finish(run, 'error', `${failed || 'Connection'} measurement failed. Check your connection and test server, then try again.`);
    return;
  }
  for (const [field, id, decimals] of [['pingStatus', 'ping', 0], ['dlStatus', 'down', 1], ['ulStatus', 'up', 1]]) {
    if (data[field] !== '' && Number.isFinite(Number(data[field]))) $(id).textContent = Number(data[field]).toFixed(decimals);
  }
  if (run.phase !== data.testState) {
    run.phase = data.testState;
    if (data.testState === 2) setPhase('ping', 'Measuring latency and connection stability…');
    if (data.testState === 1) {
      setPhase('download', 'Measuring sustained download speed…');
      setGaugeMode('download');
    }
    if (data.testState === 3) {
      setPhase('upload', 'Measuring sustained upload speed…');
      setGaugeMode('upload');
      $('downHero').textContent = '—';
      $('gaugeArc').style.strokeDasharray = '0 100';
    }
  }
  if (data.testState === 2) setProgress(data.pingProgress * 15);
  if (data.testState === 1) {
    setProgress(15 + data.dlProgress * 45);
    if (data.dlStatus !== '' && Number.isFinite(Number(data.dlStatus))) showSpeed(Number(data.dlStatus));
  }
  if (data.testState === 3) {
    setProgress(60 + data.ulProgress * 40);
    if (data.ulStatus !== '' && Number.isFinite(Number(data.ulStatus))) showSpeed(Number(data.ulStatus));
  }
}
$('serverHost').textContent = 'Automatic selection';
$('serverSelect').addEventListener('change', () => {
  const select = $('serverSelect');
  $('serverHost').textContent = select.value === 'auto' ? 'Automatic selection' : select.selectedOptions[0].textContent;
  $('serverHint').textContent = select.value === 'local' ? 'Local test: measures the connection to this Bilis server' : 'Measured between your device and this server';
});
// Populate the chooser before the first test, without probing public servers.
fetch(endpoint('api/settings.php'), { cache: 'no-store' }).then(async response => {
  if (!response.ok) throw new Error('Cannot load server list');
  const settings = await response.json();
  if (!Array.isArray(settings.servers)) throw new Error('Invalid server list');
  if (!activeRun) populateServers(settings);
}).catch(() => { /* Starting a test retries configuration and reports errors. */ });
$('cancelBtn').addEventListener('click', () => {
  if (activeRun) finish(activeRun, 'cancelled', 'Test cancelled. Ready when you are.');
});
$('startBtn').addEventListener('click', async () => {
  if (activeRun) return;
  const run = { controller: new AbortController(), latest: null, phase: null, engine: null, selection: $('serverSelect').value };
  activeRun = run;
  run.timeout = setTimeout(() => finish(run, 'error', 'The test timed out. Check your connection and try again.'), 120000);
  $('startBtn').disabled = true;
  $('buttonLabel').textContent = 'Testing your connection…';
  $('cancelBtn').hidden = false;
  $('serverSelect').disabled = true;
  $('log').textContent = '';
  setGaugeMode('download');
  for (const id of ['ping', 'down', 'up', 'downHero']) $(id).textContent = '—';
  $('gaugeArc').style.strokeDasharray = '0 100';
  setProgress(0);
  setStatus('Preparing test');
  $('phase').textContent = 'Checking the test server…';
  try {
    if (typeof Speedtest !== 'function' || !window.Worker) throw new Error('The LibreSpeed engine could not load or this browser does not support Web Workers.');
    const settings = await (await request(run, endpoint('api/settings.php'))).json();
    if (!Array.isArray(settings.servers) || !settings.parameters) throw new Error('Invalid test configuration.');
    if (activeRun !== run) return;
    populateServers(settings, run.selection);
    const engine = new Speedtest();
    run.engine = engine;
    for (const [key, value] of Object.entries(settings.parameters)) engine.setParameter(key, value);
    for (const [key, value] of Object.entries({
      test_order: 'P_D_U', telemetry_level: 'none', getIp_ispInfo: false,
      xhr_ignoreErrors: 0, url_dl: endpoint('api/download.php'),
      url_ul: endpoint('api/upload.php'), url_ping: endpoint('api/ping.php?empty=1'),
    })) engine.setParameter(key, value);
    if (run.selection !== 'local' && settings.servers.length) {
      const manual = run.selection !== 'auto';
      const candidates = manual ? settings.servers.filter(server => serverKey(server) === run.selection) : settings.servers;
      if (!candidates.length) throw new Error('Your selected server is no longer configured. Choose another server and try again.');
      const selected = await selectServer(run, candidates, manual);
      engine.setParameter('mpot', true);
      engine.setSelectedServer(selected);
      $('serverHost').textContent = selected.name;
      run.serverName = selected.name;
      $('serverHint').textContent = 'Measured between your device and this server';
    } else {
      if (!['auto', 'local'].includes(run.selection)) throw new Error('Your selected server is no longer configured. Choose Automatic and try again.');
      await checkLocalBackend(run);
      run.serverName = 'Bilis server';
      $('serverHost').textContent = run.serverName;
      $('serverHint').textContent = 'Local test: measures the connection to this Bilis server';
      if (settings.localDevelopment) {
        settings.parameters.xhr_dlMultistream = 1;
        settings.parameters.xhr_ulMultistream = 1;
        engine.setParameter('xhr_dlMultistream', 1);
        engine.setParameter('xhr_ulMultistream', 1);
      }
      if (settings.localDevelopment) log('Local PHP development server: one stream per phase. Use Apache/PHP-FPM or a public backend for parallel testing.');
    }
    if (activeRun !== run) return;
    log('Engine: LibreSpeed. Adaptive sustained transfers; warm-up excluded.');
    log(`Streams: ${settings.parameters.xhr_dlMultistream} download / ${settings.parameters.xhr_ulMultistream} upload. Data usage depends on connection speed.`);
    engine.onupdate = data => update(run, data);
    engine.onend = aborted => {
      if (activeRun !== run) return;
      if (aborted) { finish(run, 'error', 'The measurement was interrupted. Please try again.'); return; }
      const data = run.latest;
      if (!data || ['pingStatus', 'dlStatus', 'ulStatus', 'jitterStatus'].some(key => data[key] === '' || !Number.isFinite(Number(data[key])))) {
        finish(run, 'error', 'The server did not return complete test results. Please try again.');
        return;
      }
      log(`Ping: ${data.pingStatus} ms | Jitter: ${data.jitterStatus} ms`);
      log(`Download: ${data.dlStatus} Mbps | Upload: ${data.ulStatus} Mbps`);
      log(`Completed at ${new Date().toLocaleTimeString()}. Measured against ${run.serverName}.`);
      finish(run, 'complete', 'All done. Your connection, at a glance.');
    };
    engine.start();
    engine.worker.onerror = () => finish(run, 'error', 'The measurement worker could not run. Please reload and try again.');
  } catch (error) {
    if (activeRun !== run) return;
    finish(run, 'error', error instanceof Error ? error.message : String(error));
  }
});
