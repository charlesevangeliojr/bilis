param([int]$Port = 8000, [switch]$Tunnel)
$ErrorActionPreference = 'Stop'

# Fail fast if port is already taken (e.g. another php -S running)
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  Write-Error "Port $Port is already in use (PID $($listener.OwningProcess)). Stop it or use: .\run.ps1 -Port 8002"
}

$tempPath = [System.IO.Path]::GetTempPath()

if ($Tunnel) {
  $cf = @('C:\Program Files (x86)\cloudflared\cloudflared.exe', 'C:\Program Files\cloudflared\cloudflared.exe') |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $cf) { $cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source }
  if (-not $cf) { Write-Error 'cloudflared not found. Install: winget install --id Cloudflare.cloudflared -e' }

  # QUIC/UDP is blocked on this network (see tunnel pre-checks), force HTTP/2.
  Start-Process $cf -ArgumentList "tunnel --protocol http2 --url http://127.0.0.1:$Port" -NoNewWindow
  Write-Host "Tunnel starting for http://127.0.0.1:$Port (watch for trycloudflare URL)..."
}

& php -d "upload_tmp_dir=$tempPath" -d "sys_temp_dir=$tempPath" -d 'post_max_size=150M' -d 'zlib.output_compression=Off' -S "127.0.0.1:$Port" (Join-Path $PSScriptRoot 'router.php')
