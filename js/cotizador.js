// Cotizador Solar (Herramientas del Hub y sitio público).
//
// Publica el motor de cálculo (js/cotizador-calculo.js) en window.ADS_COTIZADOR para el componente
// ADSCotizador.dc.html y le da el puente con el servidor. El componente emite y este módulo responde:
//   ads:cotizador-simular  { pid, segmento, datos, unidad, valor, aislado, bateria, autoriza }
//     → ads:cotizador-simular-resultado  { pid, ok, id?, mensaje? }     (guarda la simulación: «Conectar al inversor»)
//   ads:cotizador-propuesta { pid, segmento, id }
//     → ads:cotizador-propuesta-resultado { pid, ok, mensaje? }         («Solicitar propuesta»: la envía a Clientify)
// No usa la sesión ni el código del aliado: el cotizador está aparte del programa de puntos (decisión del equipo).
// El navegador nunca habla con Clientify; todo pasa por POST /api/cotizador.

import * as calculo from './cotizador-calculo.js';

const POLITICA_URL = 'assets/legal/politica-tratamiento-datos-2026-09-25.pdf';

window.ADS_COTIZADOR = Object.assign({}, calculo, { POLITICA_URL });
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

async function post(cuerpo) {
  const r = await fetch('/api/cotizador', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
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

window.addEventListener('ads:cotizador-propuesta', async (e) => {
  const d = e.detail || {};
  const responder = (r) => emitir('ads:cotizador-propuesta-resultado', Object.assign({ pid: d.pid }, r));
  try {
    const { status, datos } = await post({ accion: 'propuesta', segmento: d.segmento, id: d.id });
    if (status === 200 && datos.ok) return responder({ ok: true });
    responder({ ok: false, mensaje: mensajeDe(status, datos, 'No pudimos enviar la solicitud. Intenta de nuevo en unos minutos.') });
  } catch {
    responder({ ok: false, mensaje: MENSAJES.red });
  }
});
