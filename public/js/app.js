(() => {
  const notice = document.getElementById('offlineNotice');
  const updateConnection = () => { notice.hidden = navigator.onLine; };
  updateConnection();
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
  // Keep the speed test's own running/disabled state intact.
  document.getElementById('startBtn').addEventListener('click', event => {
    if (!navigator.onLine) {
      event.stopImmediatePropagation();
      notice.hidden = false;
    }
  }, true);
  const installButton = document.getElementById('installBtn');
  const modal = document.getElementById('installModal');
  const confirm = document.getElementById('confirmInstall');
  const instructions = document.getElementById('installInstructions');
  const mobile = matchMedia('(max-width: 600px)');
  const standalone = matchMedia('(display-mode: standalone)');
  let installedThisVisit = false;
  const installed = () => installedThisVisit || standalone.matches || navigator.standalone === true || /BilisAndroid\//.test(navigator.userAgent);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(navigator.userAgent) && !ios;
  const phone = () => ios || android || navigator.userAgentData?.mobile === true || /iPhone|iPod|Mobile/i.test(navigator.userAgent) || mobile.matches;
  const downloadApk = () => {
    const link = document.createElement('a');
    link.href = 'downloads/bilis.apk';
    link.download = 'bilis.apk';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  let installPrompt;
  let showingSteps = false;
  let dismissedThisVisit = false;
  const infinityFree = location.hostname.endsWith('.infinityfree.me');
  const updateInstall = () => {
    installButton.hidden = installed() || ios || (!installPrompt && !phone());
    confirm.hidden = false;
    confirm.textContent = android ? 'Download Android app'
      : !installPrompt && showingSteps ? 'Got it'
      : !installPrompt && infinityFree ? 'Add to home screen' : 'Install Bilis';
    instructions.hidden = !showingSteps;
    instructions.textContent = !window.isSecureContext
      ? 'Open this website using HTTPS to install Bilis, then try again.'
      : ios
        ? '1. Open Bilis in Safari. 2. Tap Share. 3. Choose Add to Home Screen, then tap Add. Enable Open as Web App if shown.'
        : infinityFree
          ? 'Full app installation is unavailable on this hosting. In Chrome, open the menu (⋮), choose Add to Home screen, then Create shortcut. The shortcut opens Bilis in Chrome.'
        : android
        ? 'On Android, tap "Download Android app" to get the Bilis APK, then open the downloaded file to install. Allow installation from your browser if asked.'
      : '1. Open your browser’s menu (⋮). 2. Choose Install app or Add to Home screen. 3. Confirm to add Bilis. If the option is missing, try Chrome or Samsung Internet outside an in-app browser.';
    if (installed() && modal.open) modal.close();
  };
  const openInstall = () => {
    if (installed()) return;
    showingSteps = false;
    updateInstall();
    if (!modal.open) {
      modal.showModal();
      document.documentElement.classList.add('install-dialog-open');
    }
  };
  const dismiss = () => {
    // A native prompt failure can reopen the dialog before its close event runs.
    if (modal.open) return;
    document.documentElement.classList.remove('install-dialog-open');
    dismissedThisVisit = true;
  };
  modal.addEventListener('close', dismiss);
  document.getElementById('closeInstall').addEventListener('click', () => modal.close());
  document.getElementById('laterInstall').addEventListener('click', () => modal.close());
  modal.addEventListener('click', event => { if (event.target === modal) {
    const box = modal.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) modal.close();
  } });
  const requestInstall = async () => {
    if (!installPrompt) {
      if (showingSteps) { modal.close(); return; }
      showingSteps = true;
      updateInstall();
      instructions.focus();
      return;
    }
    const prompt = installPrompt;
    installPrompt = null;
    if (modal.open) modal.close();
    updateInstall();
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') installedThisVisit = true;
      updateInstall();
    } catch {
      openInstall();
      showingSteps = true;
      updateInstall();
    }
  };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    showingSteps = false;
    updateInstall();
  });
  installButton.addEventListener('click', () => {
    // Priority: Android downloads the APK. iOS is excluded for now.
    if (android) { downloadApk(); return; }
    if (ios) return;
    if (installPrompt) { requestInstall(); return; }
    openInstall();
  });
  confirm.addEventListener('click', () => android ? downloadApk() : requestInstall());
  mobile.addEventListener('change', updateInstall);
  standalone.addEventListener('change', updateInstall);
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installedThisVisit = true;
    installButton.hidden = true;
    if (modal.open) modal.close();
  });
  updateInstall();
  const autoInvite = () => {
    if (installed() || ios || dismissedThisVisit || document.hidden) return;
    if (phone() && document.getElementById('cancelBtn').hidden) openInstall();
  };
  setTimeout(autoInvite, 1500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) autoInvite(); });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI))
      .catch(error => console.warn('Bilis offline support could not start:', error.message));
  }
})();
