const fs = require('node:fs');
(async () => {
 const response = await fetch('https://api.github.com/repos/librespeed/speedtest/commits/master', {headers:{'User-Agent':'Bilis'}});
 if (!response.ok) throw new Error(`GitHub: ${response.status}`);
 const {sha} = await response.json();
 const target = 'public/vendor/librespeed';
 fs.mkdirSync(target,{recursive:true});
 const files = {};
 for (const file of ['speedtest.js','speedtest_worker.js','LICENSE']) {
  const result = await fetch(`https://raw.githubusercontent.com/librespeed/speedtest/${sha}/${file}`);
  if (!result.ok) throw new Error(`${file}: ${result.status}`);
  files[file] = await result.text();
 }
 // SPDX's standard license text includes the GPL incorporated by LGPLv3.
 const gpl = await fetch('https://raw.githubusercontent.com/spdx/license-list-data/main/text/GPL-3.0-only.txt');
 if (!gpl.ok) throw new Error(`GPL license: ${gpl.status}`);
 files['COPYING'] = await gpl.text();
 for (const [file, content] of Object.entries(files)) fs.writeFileSync(`${target}/${file}`, content);
 fs.writeFileSync(`${target}/UPSTREAM.md`,`LibreSpeed\nhttps://github.com/librespeed/speedtest\nPinned commit: ${sha}\nFiles are unmodified. See LICENSE for LGPL terms.\n`);
 console.log('Vendored LibreSpeed commit',sha);
})().catch(e=>{console.error(e);process.exitCode=1});
