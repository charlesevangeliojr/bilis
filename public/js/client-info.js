'use strict';
let ipLookupPending = false;

function validIpAddress(value) {
  if (typeof value !== 'string' || value.length > 15) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return value.split('.').every(part => Number(part) <= 255);
  }
  return false;
}

async function loadClientIp() {
  if (ipLookupPending) return;
  ipLookupPending = true;
  const value = document.getElementById('clientIp');
  const retry = document.getElementById('retryIp');
  value.textContent = 'Detecting…';
  retry.hidden = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    // Request from the visitor's browser, so localhost never reports the PHP
    // host's address. Use the IPv4-only endpoint as requested.
    const response = await fetch('https://api.ipify.org?format=json', {
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
    });
    if (!response.ok) throw new Error('IP lookup failed');
    const data = await response.json();
    if (!validIpAddress(data.ip)) throw new Error('Invalid IP response');
    value.textContent = data.ip;
  } catch {
    value.textContent = 'Unavailable';
    retry.hidden = false;
  } finally {
    clearTimeout(timeout);
    ipLookupPending = false;
  }
}
document.getElementById('retryIp').addEventListener('click', loadClientIp);
loadClientIp();
