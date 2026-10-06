# Bilis Android APK

The APK opens `https://bilis.infinityfree.me/` in an Android WebView, including
the live server list and LibreSpeed measurements. It needs an internet
connection and Android 6.0 or newer. External links open in the browser.
It does not require PWA installation support or Play Store services.

The download is `public/downloads/bilis.apk`; after uploading, its public URL
is `https://bilis.infinityfree.me/downloads/bilis.apk`.

Build with `powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1`.
The script uses portable Java 17, Android platform 35, and SDK Build Tools
35.0.0 extracted under `dist/android-tools/{jdk,platform,build-tools}`.
Sources are compiled with Google's AAPT2/D8 tools and the APK is aligned and
signed with `apksigner`. No external app libraries are included.

Back up **both** `dist/bilis-signing.p12` and `dist/bilis-signing.password`
securely. Reuse them for APK updates; changing the signing key prevents an
update over the existing app. Do not upload either file to web hosting.

Website changes appear in the app without rebuilding. Changes to the native
app require rebuilding with a higher manifest version code.

Build/signature verification does not replace testing on an Android device.
