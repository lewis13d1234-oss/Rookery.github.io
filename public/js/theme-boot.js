// Runs before first paint to avoid a theme flash.
try { const p = JSON.parse(localStorage.getItem('rk_prefs') || '{}'); const t = p.theme === 'system' || !p.theme ? (matchMedia('(prefers-color-scheme: light)').matches && p.theme === 'system' ? 'light' : (p.theme ? 'dark' : 'dark')) : p.theme; document.documentElement.dataset.theme = t; } catch {}
