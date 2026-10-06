$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$toolRoot = Join-Path $projectRoot 'dist/android-tools'
$jdkRoot = (Get-ChildItem (Join-Path $toolRoot 'jdk') -Directory | Select-Object -First 1).FullName
$buildTools = (Get-ChildItem (Join-Path $toolRoot 'build-tools') -Directory | Select-Object -First 1).FullName
$platform = (Get-ChildItem (Join-Path $toolRoot 'platform') -Directory | Select-Object -First 1).FullName
$androidJar = Join-Path $platform 'android.jar'
$java = Join-Path $jdkRoot 'bin/java.exe'
function Invoke-BilisTool([string]$tool, [string[]]$toolArguments) {
    & $tool @toolArguments
    if ($LASTEXITCODE -ne 0) { throw "Build tool failed: $tool ($LASTEXITCODE)" }
}
$work = Join-Path $projectRoot ('dist/android-build-' + [guid]::NewGuid().ToString('N'))
$classes = Join-Path $work 'classes'
$dex = Join-Path $work 'dex'
$res = Join-Path $work 'res/drawable'
New-Item -ItemType Directory -Path $classes,$dex,$res -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'public/icons/icon-512.png') -Destination (Join-Path $res 'icon.png')
$resources = Join-Path $work 'resources.zip'
$unsigned = Join-Path $work 'unsigned.apk'
$aligned = Join-Path $work 'aligned.apk'
$classJar = Join-Path $work 'classes.jar'
Invoke-BilisTool (Join-Path $buildTools 'aapt2.exe') @('compile','--dir',(Join-Path $work 'res'),'-o',$resources)
Invoke-BilisTool (Join-Path $buildTools 'aapt2.exe') @('link','-I',$androidJar,'--manifest',(Join-Path $projectRoot 'android/AndroidManifest.xml'),'-o',$unsigned,$resources)
$sources = @(Get-ChildItem (Join-Path $projectRoot 'android/src') -Filter '*.java' -Recurse | Select-Object -ExpandProperty FullName)
Invoke-BilisTool (Join-Path $jdkRoot 'bin/javac.exe') (@('-encoding','UTF-8','-source','8','-target','8','-bootclasspath',$androidJar,'-d',$classes) + $sources)
Invoke-BilisTool (Join-Path $jdkRoot 'bin/jar.exe') @('cf',$classJar,'-C',$classes,'.')
Invoke-BilisTool $java @('-cp',(Join-Path $buildTools 'lib/d8.jar'),'com.android.tools.r8.D8','--lib',$androidJar,'--min-api','23','--output',$dex,$classJar)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($unsigned,[System.IO.Compression.ZipArchiveMode]::Update)
try { [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $dex 'classes.dex'),'classes.dex') | Out-Null } finally { $zip.Dispose() }
Invoke-BilisTool (Join-Path $buildTools 'zipalign.exe') @('-f','-p','4',$unsigned,$aligned)
$key = Join-Path $projectRoot 'dist/bilis-signing.p12'
$passwordFile = Join-Path $projectRoot 'dist/bilis-signing.password'
if (!(Test-Path -LiteralPath $passwordFile)) {
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $random.GetBytes($bytes)
    $random.Dispose()
    [Convert]::ToBase64String($bytes) | Set-Content -LiteralPath $passwordFile
}
$env:BILIS_SIGNING_PASSWORD = (Get-Content -LiteralPath $passwordFile -Raw).Trim()
try {
    if (!(Test-Path -LiteralPath $key)) {
        Invoke-BilisTool (Join-Path $jdkRoot 'bin/keytool.exe') @('-genkeypair','-keystore',$key,'-storetype','PKCS12','-storepass:env','BILIS_SIGNING_PASSWORD','-alias','bilis','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=Bilis')
    }
    $output = Join-Path $projectRoot 'public/downloads'
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    $apk = Join-Path $output 'bilis.apk'
    $signer = Join-Path $buildTools 'lib/apksigner.jar'
    Invoke-BilisTool $java @('-jar',$signer,'sign','--ks',$key,'--ks-pass','env:BILIS_SIGNING_PASSWORD','--ks-key-alias','bilis','--out',$apk,$aligned)
    Invoke-BilisTool $java @('-jar',$signer,'verify','--verbose',$apk)
    Invoke-BilisTool (Join-Path $buildTools 'zipalign.exe') @('-c','-p','4',$apk)
    Get-FileHash -LiteralPath $apk -Algorithm SHA256
    Write-Output "Signed APK: $apk"
} finally { Remove-Item Env:BILIS_SIGNING_PASSWORD -ErrorAction SilentlyContinue }
