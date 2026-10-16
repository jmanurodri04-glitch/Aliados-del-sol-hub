// Cotizador Solar y Comparador de propuestas (Herramientas del Hub; solo con sesión de aliado).
//
// Publica el motor de cálculo (js/cotizador-calculo.js) y las preguntas MEDDPICC (js/cotizador-meddpicc.js) en
// window.ADS_COTIZADOR para ADSCotizador.dc.html, y el cálculo del comparador (js/comparador-calculo.js) en
// window.ADS_COMPARADOR para ADSComparador.dc.html. Les da el puente con el servidor. El componente emite y este
// módulo responde:
//   ads:cotizador-simular  { pid, id?, segmento, datos, unidad, valor, aislado, bateria, autoriza }
//     → ads:cotizador-simular-resultado  { pid, ok, id?, repetido?, mensaje? }  («Conectar al inversor»: guarda o
//       actualiza la cotización `id`)
//   ads:cotizador-nombre { pid, nombre, id? } → ads:cotizador-nombre-resultado { pid, ok, disponible?, mensaje? }
//   ads:cotizador-correo { pid, correo } → ads:cotizador-correo-resultado { pid, ok, aliado?, mensaje? }
//   ads:cotizador-propuesta { pid, segmento, id } → ads:cotizador-propuesta-resultado { pid, ok, puntos?, mensaje? }
//   ads:cotizador-meddpicc { pid, segmento, id, respuestas } → ads:cotizador-meddpicc-resultado { pid, ok, mensaje? }
//   ads:comparador-cotizaciones { pid } → ads:comparador-cotizaciones-resultado { pid, ok, cotizaciones?, mensaje? }
//   ads:cotizador-sesion { activa }  (al cambiar la sesión; también en window.ADS_COTIZADOR.sesionActiva)
// Cada llamada lleva el token de la sesión (window.adsSesionCotizador, js/supabase.js); sin sesión no se llama.
// El navegador nunca habla con Clientify; todo pasa por POST /api/cotizador.

import * as calculo from './cotizador-calculo.js';
import * as meddpicc from './cotizador-meddpicc.js';
import * as comparador from './comparador-calculo.js';

const POLITICA_URL = 'assets/legal/politica-tratamiento-datos-2026-09-25.pdf';

window.ADS_COTIZADOR = Object.assign({}, calculo, { POLITICA_URL, sesionActiva: false, meddpicc });
window.ADS_COMPARADOR = Object.assign({}, comparador);
function marcarSesion(activa) {
  if (window.ADS_COTIZADOR.sesionActiva === activa) return;
  window.ADS_COTIZADOR.sesionActiva = activa;
  emitir('ads:cotizador-sesion', { activa });
}
window.addEventListener('ads:sesion', (e) => marcarSesion(!!(e.detail && e.detail.activa)));
// Por si la sesión ya se anunció antes de cargar este módulo.
if (window.adsSesionCotizador) window.adsSesionCotizador().then((s) => marcarSesion(!!s.activa)).catch(() => {});
window.dispatchEvent(new CustomEvent('ads:cotizador-listo'));
window.dispatchEvent(new CustomEvent('ads:comparador-listo'));

const MENSAJES = {
  red: 'No hubo conexión. Revisa tu internet e intenta de nuevo.',
  sesion: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  limite: 'Hiciste muchos intentos seguidos. Espera un momento e intenta de nuevo.',
  general: 'No pudimos guardar el diseño. Intenta de nuevo en unos minutos.'
};

function emitir(evento, detalle) {
  window.dispatchEvent(new CustomEvent(evento, { detail: detalle }));
}

/** POST a /api/cotizador con el token de la sesión. Sin sesión devuelve { status: 401 } sin llamar al servidor. */
async function post(cuerpo) {
  const sesion = window.adsSesionCotizador ? await window.adsSesionCotizador() : { activa: false };
  if (!sesion.activa || !sesion.token) return { status: 401, datos: {} };
  const r = await fetch('/api/cotizador', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + sesion.token },
    body: JSON.stringify(cuerpo)
  });
  let datos = {};
  try { datos = await r.json(); } catch { /* respuesta sin cuerpo */ }
  return { status: r.status, datos };
}

function mensajeDe(status, datos, porDefecto) {
  if (status === 429) return MENSAJES.limite;
  if (status === 401) return MENSAJES.sesion;
  // 403 (no es aliado activo), 404 (venció), 409 (nombre repetido) y 422 (validación): el servidor dice qué hacer.
  if ([403, 404, 409, 422].includes(status) && datos && datos.error) return datos.error;
  return porDefecto;
}

/** Escucha `evento`, llama al servidor con lo que arme `cuerpo` y responde en `evento-resultado`. */
function puente(evento, cuerpo, exito, porDefecto) {
  window.addEventListener(evento, async (e) => {
    const d = e.detail || {};
    const responder = (r) => emitir(evento + '-resultado', Object.assign({ pid: d.pid }, r));
    try {
      const { status, datos } = await post(cuerpo(d));
      const r = exito(status, datos);
      if (r) return responder(Object.assign({ ok: true }, r));
      responder({ ok: false, repetido: status === 409, mensaje: mensajeDe(status, datos, porDefecto) });
    } catch {
      responder({ ok: false, mensaje: MENSAJES.red });
    }
  });
}

puente('ads:cotizador-simular',
  (d) => ({
    accion: 'simular', id: d.id || undefined, segmento: d.segmento, datos: d.datos,
    unidad: d.unidad, valor: d.valor, aislado: !!d.aislado, bateria: d.bateria, autoriza: !!d.autoriza
  }),
  (status, datos) => status === 201 && datos.id && { id: datos.id },
  MENSAJES.general);

puente('ads:cotizador-nombre',
  (d) => ({ accion: 'nombre', nombre: d.nombre, id: d.id || undefined }),
  (status, datos) => status === 200 && { disponible: datos.disponible === true, mensaje: datos.mensaje },
  'No pudimos revisar el nombre. Intenta de nuevo.');

puente('ads:cotizador-correo',
  (d) => ({ accion: 'correo', correo: d.correo }),
  (status, datos) => status === 200 && { aliado: datos.aliado === true },
  'No pudimos revisar el correo. Intenta de nuevo.');

puente('ads:cotizador-propuesta',
  (d) => ({ accion: 'propuesta', segmento: d.segmento, id: d.id }),
  (status, datos) => status === 200 && datos.ok && { puntos: Number(datos.puntos) || 0 },
  'No pudimos enviar la solicitud. Intenta de nuevo en unos minutos.');

puente('ads:cotizador-meddpicc',
  (d) => ({ accion: 'meddpicc', segmento: d.segmento, id: d.id, respuestas: d.respuestas }),
  (status, datos) => status === 200 && datos.ok && {},
  'No pudimos guardar las respuestas. Intenta de nuevo.');

puente('ads:comparador-cotizaciones',
  () => ({ accion: 'mis_cotizaciones' }),
  (status, datos) => status === 200 && { cotizaciones: Array.isArray(datos.cotizaciones) ? datos.cotizaciones : [] },
  'No pudimos traer tus cotizaciones. Intenta de nuevo.');

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
