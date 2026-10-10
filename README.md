# Bilis — Your connection, at a glance

Bilis is a native-PHP internet speed test with a custom dashboard and the
official open-source LibreSpeed measurement engine. No framework, database,
build step, or CDN is required. Open `public/index.html`, press Start, and the
browser measures ping, jitter, sustained download, and sustained upload
directly against the chosen test server.

Repo: https://github.com/charlesevangeliojr/bilis.git

## 1. Big picture: how a test flows

```text
Browser (public/index.html)
  ├─ public/js/client-info.js  → shows your public IPv4 (ipify, display only)
  ├─ public/js/speedtest.js    → adapter: config, server pick, lifecycle, UI
  │     ├─ GET api/settings.php → measurement parameters + server list
  │     ├─ probe servers (ping) → lowest median latency wins (Automatic)
  │     └─ LibreSpeed engine (public/vendor/librespeed/speedtest.js)
  │           └─ Web Worker (public/speedtest_worker.js → vendor worker)
  │                 ├─ ping:     GET pingURL (empty body, 10 samples)
  │                 ├─ download: GET dlURL/garbage (6 parallel streams, ~15 s)
  │                 └─ upload:   POST ulURL/empty (3 parallel streams, ~15 s)
  └─ results → gauge, Download / Upload / Ping panels, Test details log
```

Key design rules:

- The browser talks **directly** to the selected backend. Bilis never proxies
  public test traffic through PHP, so results reflect your route to that server.
- LibreSpeed telemetry and ISP lookup are disabled (`telemetry_level: none`,
  `getIp_ispInfo: false` in `public/js/speedtest.js:225`).
- Test results are not stored by Bilis. The public backend necessarily sees the
  connecting device's IP address; Bilis itself keeps nothing.
- Warm-up is excluded from the measurement (LibreSpeed defaults: 1.5 s
  download, 3 s upload), so the reported Mbps is sustained throughput, not
  TCP slow-start.

## 2. Frontend

### 2.1 `public/index.html:1` — dashboard shell

Static page with:

- Header/brand, intro, and `How it works` explainer.
- Test card: status pill (`#status`), gauge (`#speedGauge`, `#gaugeArc`,
  `#downHero`), phase text (`#phase`), progress (`#progress`), Start
  (`#startBtn`) / Cancel (`#cancelBtn`) buttons.
- Metric panels: `#down`, `#up`, `#ping` (jitter goes to the Test details log).
- Connection panels: public IPv4 (`#clientIp`, `#retryIp`) and server chooser
  (`#serverSelect`, `#serverHost`, `#serverHint`).
- `Test details` (`#log`) — the human-readable transcript of the run.

Scripts load with `defer` in dependency order: vendor engine, `client-info.js`,
then the adapter `speedtest.js`.

### 2.2 `public/js/client-info.js:12` — public IP display

On page load (and on Retry), the browser calls `https://api.ipify.org?format=json`
directly with an 8 s timeout. This is intentional: a browser-side request shows
the **visitor's** IP. A PHP-side lookup would wrongly show the server's IP on
localhost/LAN hosting. The value is display-only, never sent to Bilis, never
logged server-side. Failure shows `Unavailable` + Retry and never blocks testing.

### 2.3 `public/js/speedtest.js` — the adapter (all orchestration lives here)

This file does not measure bytes itself; it configures, selects, starts, and
renders the LibreSpeed engine.

1. **Load config** — `GET api/settings.php` (`public/js/speedtest.js:219`).
   Populates the server dropdown: `Automatic`, `Bilis server`, then every entry
   from `config/servers.json` (`public/js/speedtest.js:11`). The chooser is
   locked while a run is active.
2. **Select backend**:
   - `Automatic`: probe each candidate with 3 ping requests, take the median,
     probe at most 6 servers concurrently to avoid a connection burst, pick the
     lowest-latency reachable server (`public/js/speedtest.js:104`). Unreachable
     servers are skipped; if none respond, the test errors instead of silently
     falling back to localhost.
   - Manual: probe only that server; error if it is down.
   - `Bilis server`: validate the local PHP endpoints with a 1 KiB
     ping/download/upload round-trip first (`public/js/speedtest.js:91`), then
     measure against this Bilis instance. On localhost that is local
     performance; on LAN hosting it is the device-to-server connection.
3. **Start engine** — creates `new Speedtest()`, applies parameters from
   `settings.php`, forces `test_order: P_D_U`, disables telemetry, points local
   mode at `api/download.php`, `api/upload.php`, `api/ping.php?empty=1`
   (`public/js/speedtest.js:224`), enables multi-potential-object testing
   (`mpot`) for public servers, then `engine.start()`.
4. **Render** — `engine.onupdate` drives gauge, metrics, phase, and progress
   (`public/js/speedtest.js:145`); `engine.onend` writes the final
   ping/jitter/download/upload lines and completion timestamp
   (`public/js/speedtest.js:258`). Cancel aborts fetches, terminates the worker,
   and resets state (`public/js/speedtest.js:63`). A 2-minute overall timeout
   (`public/js/speedtest.js:204`) prevents a stalled test from hanging.

### 2.4 Worker chain

- `public/speedtest_worker.js:1` — thin guard loaded by the page. It patches
  `XMLHttpRequest` inside the worker so HTTP error pages (status ≥ 400 or wrong
  download content-type) become hard stream errors with a readable message.
  Upstream LibreSpeed would otherwise accept an error page as bytes. It then
  `importScripts()` the pinned upstream worker unchanged.
- `public/vendor/librespeed/` — unmodified engine (`speedtest.js`,
  `speedtest_worker.js`), pinned at the commit in
  `public/vendor/librespeed/UPSTREAM.md:3`, LGPLv3 (see `LICENSE`, `COPYING`).
  Refresh with `node scripts/vendor-librespeed.cjs`; re-run verification after.

## 3. Backend (native PHP, no framework)

Why native: a framework bootstrap (10–30 ms, several MB per request) would skew
ping/jitter and cap throughput. These endpoints do one thing with minimal
overhead, `no-store` caching, no compression, and no buffering.

| Endpoint | Method | What it does |
|---|---|---|
| `public/api/settings.php:1` | GET | Returns LibreSpeed parameters + server list as JSON. Downgrades to 1 stream per phase on PHP's single-threaded dev server when no public servers are configured (`public/api/settings.php:11`). |
| `public/api/ping.php:1` | GET | Default: `{"t": <ms>}`. With `?empty=1`: empty `text/plain` body, which is what LibreSpeed requires for latency probes. |
| `public/api/download.php:1` | GET | Streams `?bytes=N` (or LibreSpeed `?ckSize=M` in MiB), clamped to `1 KiB–100 MiB`. Sends one incompressible `random_bytes()` buffer repeatedly (avoids benchmarking RNG speed), with `Content-Length`, `X-Accel-Buffering: no`, and gzip/output-buffering disabled. |
| `public/api/upload.php:1` | POST | Streams `php://input` in 64 KiB chunks, counts bytes, discards everything (never writes a file), enforces the 100 MiB app limit, returns `{"received": N}`. |
| `src/Response.php:6` | — | Shared helper: `no-store` headers, JSON responses, error responses. |

Limits: `config/config.php:4` caps each request at 100 MiB; server configs allow
150 MiB at the HTTP layer so PHP — not Nginx/Apache — is the single gate.
Measurement tuning lives in `config/config.php:16`: 15 s download/upload caps
(adaptive shortening on fast links), 6 download / 3 upload streams, 10 ping
samples, 20 MiB upload blobs.

## 4. Server list

- Snapshot: `config/servers.json` (19 verified backends, Tokyo A573 first).
  Each entry: `name`, `server` (base URL ending in `/`), `dlURL`, `ulURL`,
  `pingURL`, `getIpURL` (paths relative to base; ping must return an empty body).
- Source directories: `https://librespeed.org/backend-servers/servers.php`.
- Refresh: `node scripts/refresh-servers.cjs` checks every configured server
  first, then checks additional candidates from the source directories. Checks
  include three empty ping responses, a small download, upload, CORS, and the
  browser's upload preflight. Only passing servers enter the refreshed snapshot.
  Detailed per-server results and directory failures go to
  `config/servers-verification.json`, even if too few servers pass to safely
  replace the snapshot. These are endpoint checks, not full throughput tests;
  availability changes over time.
- Add your own (including Philippine servers when available) by editing
  `config/servers.json`. Ookla servers are incompatible (different protocol).
  HTTPS pages require HTTPS backends; cross-origin backends need LibreSpeed CORS.
- Local-only mode: set `test_servers` to `[]` in `config/config.php:29`.

## 5. Run locally

### Requirements

- PHP 8.2 or newer, available as `php` in your terminal. On Windows, you can
  install PHP separately or use XAMPP and add its PHP folder (usually
  `C:\xampp\php`) to your `PATH`.
- A modern browser and an internet connection to test against public servers.
- Git only if cloning the repository. Node.js is optional, needed for the
  maintenance and verification scripts, not to run the app.

No database, Composer install, or npm install is required.

### Windows (PowerShell)

1. Download and extract the project, or clone it:

   ```powershell
   git clone https://github.com/charlesevangeliojr/bilis.git
   cd bilis
   ```

   If you already have the project, open PowerShell in the project root—the
   folder containing `run.ps1` and `router.php`.

2. Confirm PHP is available, then start the server:

   ```powershell
   php --version
   .\run.ps1
   ```

3. Open **http://127.0.0.1:8000** in your browser. Choose **Automatic** or a
   public server and press **Start** to test your internet connection.

Keep the terminal open while using Bilis. Press **Ctrl+C** to stop the server.
Do not open `public/index.html` directly: the app needs the PHP settings API.

If PowerShell blocks the script, run it with a temporary, process-only policy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1
```

If port 8000 is already in use:

```powershell
.\run.ps1 -Port 8002
# Open http://127.0.0.1:8002
```

### macOS / Linux, or without the PowerShell script

From the project root, with PHP installed:

```sh
php -d post_max_size=150M -d zlib.output_compression=Off -S 127.0.0.1:8000 router.php
```

Open **http://127.0.0.1:8000** and stop the server with **Ctrl+C** when finished.
This command also works in a Windows terminal.

### Troubleshooting and optional sharing

- **`php` is not recognized / command not found:** install PHP or add its
  executable folder to `PATH`, then reopen the terminal.
- **Page will not load:** keep the server running, use the same port shown in
  the terminal, and start it from the project root.
- **Bilis server** measures your connection to this local PHP instance, not
  your ISP speed. Use a public server for an internet speed test. PHP's built-in
  server is for development, not production or accurate local benchmarking.
- `.\run.ps1 -Tunnel` — also start a Cloudflare quick tunnel (demo sharing only;
  a tunnel measures the proxy, not ISP speed; forces `--protocol http2` because
  QUIC/UDP is blocked on some networks). Requires `cloudflared`; on Windows,
  install it with `winget install --id Cloudflare.cloudflared -e`.
- `run.ps1:23` picks a writable temp dir, sets `post_max_size=150M`, and
  disables output compression. `router.php:5` safely maps `/` → `index.html`,
  serves static assets with correct content types, allows only the four
  `public/api/*.php` entry points, and blocks everything else with 404.

## 6. Deploy (Apache / Nginx + PHP-FPM)

For InfinityFree with the whole project inside `htdocs`, follow
[the InfinityFree upload instructions](deploy/INFINITYFREE.md). Create your
own ZIP containing only the root `.htaccess`, `public/`, `config/`, and `src/`.
Omit `public/.user.ini` on InfinityFree. Keep developer files, `dist/`, `.git/`,
and the Android source/signing keys out of the upload.

Point the document root at `public/` and keep compression/buffering off so the
server never becomes the bottleneck:

- `deploy/nginx-bilis.conf:1` — `client_max_body_size 0`,
  `fastcgi_request_buffering off`, `fastcgi_buffering off`, `gzip off`,
  per-endpoint `PHP_VALUE` limits, `access_log off`, block non-API PHP.
- `deploy/apache-bilis.conf:1` — `LimitRequestBody 0`, `no-gzip` on `/api/`,
  loosened `mod_reqtimeout`, PHP-FPM via `proxy:fcgi`, PHP upload limits.
- Shared hosting: `public/.htaccess` uses only `DirectoryIndex index.html`.
  For Apache hosts that allow server tuning, the optional
  `deploy/apache-public.htaccess` + `public/.user.ini` provide
  `LimitRequestBody 0`, `no-gzip`, and `post_max_size 150M`.
- Give PHP enough workers for 6 download + 3 upload parallel streams. The PHP
  dev server is single-threaded — fine for functional checks, wrong for
  benchmarking (local mode auto-drops to 1 stream there).

## 7. Verification

### Dark mode and installed app

The header theme button remembers your choice locally; otherwise Bilis follows
your device's light/dark setting. Mobile visitors see an install modal with a
native install button when supported, or instructions for their browser.
Phone detection includes Android/iOS devices in landscape and small screens.
The modal has an Install Bilis button: it opens the native prompt when
available, otherwise it shows installation steps. On InfinityFree it offers
a home-screen shortcut, because its security system prevents full PWA installation.
Dismissing hides the invitation until the page is reloaded; the header button
can reopen it anytime.
Installed apps do not show the invitation.
`public/manifest.webmanifest` and `public/sw.js`
provide installation and offline app-shell support. Speed tests and IP detection
still require a connection; measurement requests and API responses are never
cached. Serve the app over HTTPS (localhost works for development). Supported
browsers show an Install app button when installation is available; on iPhone,
use Safari's Share menu and Add to Home Screen.

Upload the new manifest, service worker, `icons/`, JavaScript, HTML, and CSS
together. Increment the cache version in `public/sw.js` (currently
`bilis-shell-v6`) when changing the offline asset list. Existing open app windows use the current worker
until closed, allowing updates without interrupting an active test.

```powershell
php -l router.php
node --check public/js/speedtest.js
node --check public/speedtest_worker.js
node scripts/check-browser.cjs
node scripts/check-pwa.cjs
```

Lint PHP under `public/api/`, `config/`, `src/` too. `scripts/check-browser.cjs`
needs Bilis at `127.0.0.1:8000` plus Chrome with a dedicated temp profile on
`--remote-debugging-port=9222`; it uses local PHP + a concurrent fixture (no
public bandwidth) and covers real worker measurements, jitter, cancel
before/during transfer, HTTP-failure recovery, auto-selection, 6× download /
3× upload parallelism, overflow, reduced motion, and JS exceptions (previews in
`scripts/`). `node scripts/check-public.cjs` (separate profile, port 9223) is the
optional real-internet check against public backends and consumes test bandwidth.
`scripts/check-pwa.cjs` uses the same local Chrome session to check theme
persistence, installability, offline reload, and exclusion of API traffic from
the offline cache.

## 8. License

LibreSpeed engine: GNU LGPLv3, © LibreSpeed contributors — see
`public/vendor/librespeed/LICENSE` and `COPYING`. Upstream files are unmodified;
Bilis integration (dashboard, adapter, PHP endpoints, configs) lives in separate
files. Upstream source: https://github.com/librespeed/speedtest
