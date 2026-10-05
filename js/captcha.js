// Captcha del formulario público de referidos (Cloudflare Turnstile, "Verifica que eres humano").
//
// La página deja un contenedor vacío [data-captcha-referido] en el paso 2 del formulario; este módulo lo detecta,
// carga Turnstile y pinta ahí el widget con la site key de GET /api/config. El token lo lee js/supabase.js con
// window.adsCaptcha.token() al enviar y lo verifica el servidor (lib/referido-publico.js). Cada token sirve una
// sola vez: después de cada envío se reinicia el widget.
//
// Sin site key (Preview sin configurar) no se pinta nada y el servidor omite la verificación fuera de Production.

const URL_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let siteKeyPromesa = null;
let scriptPromesa = null;
let token = null;
let widgetId = null;
let contenedorActual = null;

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

async function montar(contenedor) {
  const clave = await siteKey();
  if (!clave || !contenedor.isConnected) return;
  let ts;
  try { ts = await cargarTurnstile(); } catch { return; }
  if (!contenedor.isConnected || contenedor.childElementCount) return;
  token = null;
  const oscuro = !document.querySelector('[data-theme="light"]'); // el tema del Hub vive en un contenedor [data-theme]
  widgetId = ts.render(contenedor, {
    sitekey: clave,
    language: 'es',
    theme: oscuro ? 'dark' : 'light',
    callback: (t) => { token = t; },
    'expired-callback': () => { token = null; },
    'error-callback': () => { token = null; }
  });
}

// El formulario aparece y desaparece (pasos, envío): se vigila el DOM y se monta el widget cuando hace falta.
function revisar() {
  const contenedor = document.querySelector('[data-captcha-referido]');
  if (contenedor === contenedorActual) return;
  contenedorActual = contenedor;
  token = null;
  if (contenedor) montar(contenedor);
}

new MutationObserver(revisar).observe(document.documentElement, { childList: true, subtree: true });
revisar();

window.adsCaptcha = {
  /** Token vigente, o null si la persona aún no pasó el captcha (o no hay captcha configurado). */
  token: () => token,
  /** ¿Hay captcha en esta página? Si no hay site key, el servidor decide (fuera de Production lo omite). */
  activo: async () => !!(await siteKey()),
  /** Pide un token nuevo (cada token sirve una sola vez). */
  reiniciar: () => {
    token = null;
    if (window.turnstile && widgetId !== null) { try { window.turnstile.reset(widgetId); } catch { /* ya no existe */ } }
  }
};
