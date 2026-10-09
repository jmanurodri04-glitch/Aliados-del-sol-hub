// Captcha «No soy un robot» (Cloudflare Turnstile) de los formularios sin sesión.
//
// Cada formulario deja un contenedor vacío con su nombre: [data-captcha="registro"], [data-captcha="login"],
// [data-captcha="recuperar"] (Hub, admin.html y canje.html) y [data-captcha-referido] (formulario público de
// referidos, nombre "referido"). Este módulo los detecta, carga Turnstile y pinta un widget en cada uno con la
// site key de GET /api/config. El token lo leen js/supabase.js, js/admin.js y js/canje.js con
// window.adsCaptcha.token(nombre):
//   - registro, login y recuperar lo envían a Supabase Auth (`options.captchaToken`), que lo verifica con la
//     protección CAPTCHA de Auth (Authentication → Attack Protection);
//   - referido lo verifica el servidor (lib/referido-publico.js).
// Cada token sirve una sola vez: después de cada intento se reinicia el widget.
//
// Sin site key (Preview sin configurar) no se pinta nada: el registro y el login funcionan solo si la protección
// CAPTCHA de Supabase también está apagada, y el servidor del formulario público la omite fuera de Production.

const URL_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let siteKeyPromesa = null;
let scriptPromesa = null;
const widgets = new Map(); // nombre → { contenedor, id, token }

function siteKey() {
  if (!siteKeyPromesa) {
    siteKeyPromesa = fetch('/api/config', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : {}))
      .then((c) => c.turnstileSiteKey || null)
      .catch(() => { siteKeyPromesa = null; return null; });
  }
  return siteKeyPromesa;
}

function cargarTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromesa) {
    scriptPromesa = new Promise((resolver, rechazar) => {
      const s = document.createElement('script');
      s.src = URL_TURNSTILE;
      s.async = true;
      s.onload = () => resolver(window.turnstile);
      s.onerror = () => { scriptPromesa = null; rechazar(new Error('turnstile')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromesa;
}

function nombreDe(contenedor) {
  return contenedor.dataset.captcha || (contenedor.hasAttribute('data-captcha-referido') ? 'referido' : 'general');
}

// Tema del widget: el Hub lo guarda en un contenedor [data-theme]; admin.html y canje.html siguen al dispositivo.
function temaOscuro() {
  const t = document.querySelector('[data-theme]');
  if (t) return t.getAttribute('data-theme') !== 'light';
  return !(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
}

async function montar(nombre, w) {
  const clave = await siteKey();
  if (!clave || !w.contenedor.isConnected) return;
  let ts;
  try { ts = await cargarTurnstile(); } catch { return; }
  if (widgets.get(nombre) !== w || !w.contenedor.isConnected || w.contenedor.childElementCount) return;
  w.id = ts.render(w.contenedor, {
    sitekey: clave,
    language: 'es',
    theme: temaOscuro() ? 'dark' : 'light',
    callback: (t) => { w.token = t; },
    'expired-callback': () => { w.token = null; },
    'error-callback': () => { w.token = null; }
  });
}

// Los formularios aparecen y desaparecen (pasos, rutas, vistas): se vigila el DOM y se monta cada widget cuando hace falta.
function revisar() {
  const vistos = new Set();
  for (const c of document.querySelectorAll('[data-captcha], [data-captcha-referido]')) {
    const nombre = nombreDe(c);
    vistos.add(nombre);
    const w = widgets.get(nombre);
    if (w && w.contenedor === c) continue;
    const nuevo = { contenedor: c, id: null, token: null };
    widgets.set(nombre, nuevo);
    montar(nombre, nuevo);
  }
  for (const [nombre, w] of widgets) {
    if (!vistos.has(nombre)) {
      if (window.turnstile && w.id !== null) { try { window.turnstile.remove(w.id); } catch { /* ya no existe */ } }
      widgets.delete(nombre);
    }
  }
}

new MutationObserver(revisar).observe(document.documentElement, { childList: true, subtree: true });
revisar();

window.adsCaptcha = {
  /** Token vigente del widget `nombre`, o null si la persona aún no pasó el captcha (o no hay captcha configurado). */
  token: (nombre = 'referido') => (widgets.get(nombre) || {}).token || null,
  /** ¿Hay captcha en esta página? Sin site key no se pinta ningún widget. */
  activo: async () => !!(await siteKey()),
  /** Pide un token nuevo para el widget `nombre` (cada token sirve una sola vez). */
  reiniciar: (nombre = 'referido') => {
    const w = widgets.get(nombre);
    if (!w) return;
    w.token = null;
    if (window.turnstile && w.id !== null) { try { window.turnstile.reset(w.id); } catch { /* ya no existe */ } }
  }
};
