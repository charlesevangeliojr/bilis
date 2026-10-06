$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$outputRoot = Join-Path $projectRoot 'dist'
$stagingRoot = Join-Path $outputRoot ('infinityfree-' + [guid]::NewGuid().ToString('N'))
$htdocs = Join-Path $stagingRoot 'htdocs'
New-Item -ItemType Directory -Path $htdocs -Force | Out-Null
foreach ($folder in @('public', 'config', 'src')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $folder) -Destination $htdocs -Recurse
}
Copy-Item -LiteralPath (Join-Path $projectRoot '.htaccess') -Destination (Join-Path $htdocs '.htaccess')
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy/infinityfree-public.htaccess') -Destination (Join-Path $htdocs 'public/.htaccess') -Force
# Leave PHP limits to the hosting provider; retain the app's own byte limits.
Remove-Item -LiteralPath (Join-Path $htdocs 'public/.user.ini') -ErrorAction SilentlyContinue
$archive = Join-Path $outputRoot 'bilis-infinityfree.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive }
[System.IO.Compression.ZipFile]::CreateFromDirectory($stagingRoot, $archive)
Write-Output "Upload-ready archive: $archive"
Write-Output "Upload the contents of its htdocs folder into your domain's htdocs folder."
