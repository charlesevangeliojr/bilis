# Deploy Bilis on InfinityFree

1. Run `powershell -ExecutionPolicy Bypass -File scripts/package-infinityfree.ps1`.
2. Extract `dist/bilis-infinityfree.zip` on your computer.
3. In InfinityFree's File Manager, open this domain's `htdocs` folder.
4. Upload the **contents** of the extracted `htdocs` folder into it:

   ```text
   htdocs/
     .htaccess
     public/
       .htaccess
       index.html
       favicon.svg
       speedtest_worker.js
       api/
       css/
       js/
       vendor/
     config/
     src/
   ```

5. Delete InfinityFree's default `index2.html` after uploading Bilis. If an old
   `index.html` or `index.php` from another site exists, back it up before replacing
   it. Keep InfinityFree's `.htaccess` outside `htdocs` untouched.
6. Open your website's main address. You do not need `/public` in the URL.

If InfinityFree shows a `.htaccess` error after uploading the source project,
replace `htdocs/public/.htaccess` with the current `public/.htaccess`:

```apache
DirectoryIndex index.html
```

Replace the file rather than appending this line: the old tuning directives
must be removed. Keep the project's root `.htaccess` in `htdocs/.htaccess`.
The optional `deploy/apache-public.htaccess` is for other Apache hosts and
must not be uploaded as an active `.htaccess` on InfinityFree.

The root `.htaccess` internally routes page, CSS, JavaScript, favicon, worker,
and API requests into `public/`. It blocks web requests to `config/`, `src/`,
and hidden files. Both `config/` and `src/` must be uploaded because the PHP APIs
include them. Uploading only `public/` leaves those dependencies missing.

The bundle uses a minimal `public/.htaccess`, omits `.user.ini`, and excludes
development tools and Apache/Nginx virtual-host files. InfinityFree manages the
web server; `router.php` and `run.ps1` are for local development.

HTTPS: enable a valid SSL certificate in InfinityFree before enabling any
HTTP-to-HTTPS redirect. This bundle does not force a scheme or domain, so it
also works in a subfolder without a hard-coded hostname or redirect loop.

Check in a browser:

- `/` shows Bilis, and the favicon and styles load.
- `/api/settings.php` returns JSON with the server choices.
- `/config/config.php` is forbidden.
- Automatic/manual public-server speed tests work.

Public test transfers go directly to the selected LibreSpeed backend.
The **Bilis server** choice tests InfinityFree itself and remains subject to
its upload limits, buffering, resource limits, and browser security layer.
These hosting limits cannot be removed by a redirect rule.

References:
- https://forum.infinityfree.com/t/how-to-change-the-root-directory/88574
- https://forum.infinityfree.com/t/index-files/35330
- https://forum.infinityfree.com/t/editing-htaccess-file/25977
