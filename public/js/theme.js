(() => {
  const system = matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem('bilis-theme'); } catch {}
  const apply = () => {
    const dark = preference === 'dark' || (preference !== 'light' && system.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#101c17' : '#f5f7f4';
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(dark));
      toggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
      toggle.title = toggle.getAttribute('aria-label');
      document.getElementById('themeIcon').textContent = dark ? '☀' : '☾';
    }
  };
  apply();
  system.addEventListener('change', apply);
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('themeToggle').addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('bilis-theme', preference); } catch {}
      apply();
    });
  });
})();
