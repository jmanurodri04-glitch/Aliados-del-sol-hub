// Cotizador Solar (Herramientas del Hub y sitio público).
//
// Publica el motor de cálculo (js/cotizador-calculo.js) en window.ADS_COTIZADOR para el componente
// ADSCotizador.dc.html y le da el puente con el servidor. El componente emite y este módulo responde:
//   ads:cotizador-simular  { pid, segmento, datos, unidad, valor, aislado, bateria, autoriza }
//     → ads:cotizador-simular-resultado  { pid, ok, id?, mensaje? }     (guarda la simulación: «Conectar al inversor»)
//   ads:cotizador-correo { pid, correo }
//     → ads:cotizador-correo-resultado { pid, ok, aliado?, mensaje? }   (paso 2: un correo de aliado no se acepta)
//   ads:cotizador-propuesta { pid, segmento, id, correo_referente? }
//     → ads:cotizador-propuesta-resultado { pid, ok, mensaje? }         («Solicitar propuesta»: la envía a Clientify)
//   ads:cotizador-sesion { activa }  (al cambiar la sesión; también en window.ADS_COTIZADOR.sesionActiva)
// Con sesión de aliado, «Solicitar propuesta» lleva su token (window.adsSesionCotizador, js/supabase.js) para que el
// servidor ponga su ID_aliado en Clientify; sin sesión, el «Email de quien refiere» opcional. No da puntos.
// El navegador nunca habla con Clientify; todo pasa por POST /api/cotizador.

import * as calculo from './cotizador-calculo.js';

const POLITICA_URL = 'assets/legal/politica-tratamiento-datos-2026-09-25.pdf';

window.ADS_COTIZADOR = Object.assign({}, calculo, { POLITICA_URL, sesionActiva: false });
function marcarSesion(activa) {
  if (window.ADS_COTIZADOR.sesionActiva === activa) return;
  window.ADS_COTIZADOR.sesionActiva = activa;
  emitir('ads:cotizador-sesion', { activa });
}
window.addEventListener('ads:sesion', (e) => marcarSesion(!!(e.detail && e.detail.activa)));
// Por si la sesión ya se anunció antes de cargar este módulo.
if (window.adsSesionCotizador) window.adsSesionCotizador().then((s) => marcarSesion(!!s.activa)).catch(() => {});
window.dispatchEvent(new CustomEvent('ads:cotizador-listo'));

const MENSAJES = {
  red: 'No hubo conexión. Revisa tu internet e intenta de nuevo.',
  captcha: 'Confirma que no eres un robot y vuelve a intentarlo.',
  limite: 'Hiciste muchos intentos seguidos. Espera un momento e intenta de nuevo.',
  general: 'No pudimos guardar el diseño. Intenta de nuevo en unos minutos.'
};

function emitir(evento, detalle) {
  window.dispatchEvent(new CustomEvent(evento, { detail: detalle }));
}

async function post(cuerpo, token) {
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const r = await fetch('/api/cotizador', {
    method: 'POST',
    headers,
    body: JSON.stringify(cuerpo)
  });
  let datos = {};
  try { datos = await r.json(); } catch { /* respuesta sin cuerpo */ }
  return { status: r.status, datos };
}

// Captcha «No soy un robot» del paso 5 ([data-captcha="cotizador"], js/captcha.js). Sin site key no se pinta y el
// servidor lo omite fuera de Production.
async function tokenCaptcha() {
  const c = window.adsCaptcha;
  if (!c) return { token: undefined };
  const token = c.token('cotizador');
  if (token) return { token };
  return (await c.activo()) ? { falta: true } : { token: undefined };
}

function mensajeDe(status, datos, porDefecto) {
  if (status === 429) return MENSAJES.limite;
  if (status === 403) return MENSAJES.captcha;
  if (status === 422 && datos && datos.error) return datos.error; // validación: el servidor dice qué corregir
  return porDefecto;
}

window.addEventListener('ads:cotizador-simular', async (e) => {
  const d = e.detail || {};
  const responder = (r) => emitir('ads:cotizador-simular-resultado', Object.assign({ pid: d.pid }, r));
  const captcha = await tokenCaptcha();
  if (captcha.falta) return responder({ ok: false, mensaje: MENSAJES.captcha });
  try {
    const { status, datos } = await post({
      accion: 'simular', captcha: captcha.token, segmento: d.segmento, datos: d.datos,
      unidad: d.unidad, valor: d.valor, aislado: !!d.aislado, bateria: d.bateria, autoriza: !!d.autoriza
    });
    if (status === 201 && datos.id) return responder({ ok: true, id: datos.id });
    responder({ ok: false, mensaje: mensajeDe(status, datos, MENSAJES.general) });
  } catch {
    responder({ ok: false, mensaje: MENSAJES.red });
  } finally {
    if (window.adsCaptcha) window.adsCaptcha.reiniciar('cotizador'); // cada token sirve una vez
  }
});

window.addEventListener('ads:cotizador-correo', async (e) => {
  const d = e.detail || {};
  const responder = (r) => emitir('ads:cotizador-correo-resultado', Object.assign({ pid: d.pid }, r));
  try {
    const { status, datos } = await post({ accion: 'correo', correo: d.correo });
    if (status === 200) return responder({ ok: true, aliado: datos.aliado === true });
    responder({ ok: false, mensaje: mensajeDe(status, datos, 'No pudimos revisar el correo. Intenta de nuevo.') });
  } catch {
    responder({ ok: false, mensaje: MENSAJES.red });
  }
});

window.addEventListener('ads:cotizador-propuesta', async (e) => {
  const d = e.detail || {};
  const responder = (r) => emitir('ads:cotizador-propuesta-resultado', Object.assign({ pid: d.pid }, r));
  try {
    const sesion = window.adsSesionCotizador ? await window.adsSesionCotizador() : { activa: false };
    const cuerpo = { accion: 'propuesta', segmento: d.segmento, id: d.id };
    if (!sesion.activa && d.correo_referente) cuerpo.correo_referente = d.correo_referente;
    const { status, datos } = await post(cuerpo, sesion.token);
    if (status === 200 && datos.ok) return responder({ ok: true });
    responder({ ok: false, mensaje: mensajeDe(status, datos, 'No pudimos enviar la solicitud. Intenta de nuevo en unos minutos.') });
  } catch {
    responder({ ok: false, mensaje: MENSAJES.red });
  }
});

// «Descargar precotización (PDF)»: se arma en el navegador con jsPDF (js/cotizador-pdf.js); no pasa por el servidor.
//   ads:cotizador-pdf { pid, segmento, datos, unidad, valor, aislado, bateria } → ads:cotizador-pdf-resultado { pid, ok, mensaje? }
const LIB_PDF = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
let jsPdfPromesa = null;
function cargarJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!jsPdfPromesa) {
    jsPdfPromesa = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB_PDF;
      s.async = true;
      s.onload = () => (window.jspdf && window.jspdf.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF')));
      s.onerror = () => { jsPdfPromesa = null; reject(new Error('jsPDF')); };
      document.head.appendChild(s);
    });
  }
  return jsPdfPromesa;
}

window.addEventListener('ads:cotizador-pdf', async (e) => {
  const d = e.detail || {};
  const responder = (r) => emitir('ads:cotizador-pdf-resultado', Object.assign({ pid: d.pid }, r));
  try {
    const [JsPDF, pdf] = await Promise.all([cargarJsPdf(), import('./cotizador-pdf.js')]);
    const info = pdf.infoPrecotizacion(d);
    if (!info) return responder({ ok: false, mensaje: 'Completa el diseño para descargar la precotización.' });
    pdf.construirPrecotizacion(JsPDF, info).save(info.archivo);
    responder({ ok: true });
  } catch {
    responder({ ok: false, mensaje: 'No pudimos preparar el PDF. Revisa tu conexión e intenta de nuevo.' });
  }
});
