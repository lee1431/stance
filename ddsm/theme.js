/* DDSM appearance only. Never store work data or authentication here. */
(() => {
  'use strict';
  const KEY = 'ddsm:theme:v1';
  const root = document.documentElement;
  let chosen = 'neo-mint';
  try { chosen = localStorage.getItem(KEY) === 'dark' ? 'dark' : 'neo-mint'; } catch (_) {}
  function apply(theme) {
    chosen = theme === 'dark' ? 'dark' : 'neo-mint';
    root.dataset.theme = chosen;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = chosen === 'dark' ? '#0F172A' : '#F4FBF9';
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const dark = chosen === 'dark';
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? '다크 모드 끄기' : '다크 모드 켜기');
      button.title = dark ? '네오 민트 모드로 전환' : '야간 다크 모드로 전환';
    });
    try { localStorage.setItem(KEY, chosen); } catch (_) {}
  }
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.addEventListener('click', () => apply(chosen === 'dark' ? 'neo-mint' : 'dark'));
  });
  apply(chosen);
})();
