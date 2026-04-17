/**
 * Gemeinsames Theme-Handling fuer Dashboard, Setup, Detail.
 *
 * - Lese gespeicherte Praeferenz aus localStorage
 * - Setze data-theme auf <html>
 * - Injiziere einen Toggle-Button in den Header (.app-header nav wird nach
 *   rechts in ein Flex-Container verschoben)
 * - Emittiere `themechange` CustomEvent, damit Seiten ihre Charts neu
 *   aufbauen koennen (Chart.js cached sonst die alten Farben)
 */
(function () {
  const KEY = 'faecherlofts-theme';
  const DARK_ICON = '☀';   // Klick -> hell
  const LIGHT_ICON = '☾';  // Klick -> dunkel

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try { localStorage.setItem(KEY, theme); } catch {}
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.textContent = theme === 'light' ? LIGHT_ICON : DARK_ICON;
      btn.title = theme === 'light' ? 'Dark Mode' : 'Light Mode';
    }
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }

  // Initial sofort anwenden (vor DOMContentLoaded!), damit kein Flicker.
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light') applyTheme('light');
  } catch {}

  function injectButton() {
    const header = document.querySelector('.app-header');
    if (!header) return;
    const nav = header.querySelector('nav');
    if (!nav) return;

    // nav in ein Wrapper-Element packen, damit der Button rechts daneben sitzt
    let right = header.querySelector('.app-header__right');
    if (!right) {
      right = document.createElement('div');
      right.className = 'app-header__right';
      nav.parentNode.insertBefore(right, nav);
      right.appendChild(nav);
    }

    const btn = document.createElement('button');
    btn.id = 'theme-toggle-btn';
    btn.className = 'theme-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Theme umschalten');
    btn.textContent = currentTheme() === 'light' ? LIGHT_ICON : DARK_ICON;
    btn.title = currentTheme() === 'light' ? 'Dark Mode' : 'Light Mode';
    btn.addEventListener('click', () => {
      applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
    });
    right.appendChild(btn);

    // Logout-Button
    const logout = document.createElement('button');
    logout.className = 'theme-toggle';
    logout.type = 'button';
    logout.textContent = '⏻';
    logout.title = 'Abmelden';
    logout.setAttribute('aria-label', 'Abmelden');
    logout.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch {}
      window.location.href = '/login';
    });
    right.appendChild(logout);

    // User-Anzeige (Name + Rolle, klein)
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(user => {
      if (!user || !user.displayName) return;
      const info = document.createElement('span');
      info.style.cssText = 'font-size:11px;color:var(--color-text-muted);white-space:nowrap';
      info.textContent = user.displayName;
      right.insertBefore(info, btn);
    }).catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButton);
  } else {
    injectButton();
  }
})();
