// «Mi QR» del aliado (fase 11, CLAUDE.md §4.10): el QR que muestra para canjear sus Puntos Sol.
//
// Se abre con el evento `ads:qr-abrir` (botones del Hub) y se pinta encima de la página, en pantalla completa.
// La sesión y las llamadas a Supabase las hace js/supabase.js (ads:qr-generar → ads:qr; ads:qr-estado →
// ads:qr-estado-resultado). Aquí solo se dibuja:
//   · cada QR es un enlace a /canje.html#q=<ficha>; vale 5 minutos y sirve una sola vez;
//   · mientras la pantalla está abierta se pide uno nuevo cada 60 s (el nuevo anula el anterior, así una captura
//     de pantalla deja de servir enseguida);
//   · sin señal se conserva el último QR, que sigue sirviendo hasta que vence;
//   · cada 3 s se pregunta si ya se canjeó, para mostrarle al aliado el resultado y su nuevo saldo.
// El QR no contiene aliados.id ni datos personales: solo la ficha.

const RENOVAR_CADA = 60;   // segundos
const CONSULTAR_CADA = 3;  // segundos
const LIB_QR = 'https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.mjs';

let raiz = null;
let qrLib = null;
let actual = null;        // { url, codigo, venceAt, renovarAt }
let pidiendo = false;
let reloj = null;
let sondeo = null;
let wakeLock = null;
let abierto = false;

const $ = (sel) => raiz.querySelector(sel);
const hora = (ms) => new Date(ms).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
const numero = (v) => Number(v || 0).toLocaleString('es-CO');
const formatoCodigo = (c) => String(c || '').replace(/^(.{4})(.{4})$/, '$1-$2');

function crear() {
  raiz = document.createElement('div');
  raiz.id = 'mi-qr';
  raiz.hidden = true;
  raiz.setAttribute('role', 'dialog');
  raiz.setAttribute('aria-modal', 'true');
  raiz.setAttribute('aria-label', 'Mi QR para canjear');
  raiz.innerHTML = `
<style>
  #mi-qr { position:fixed; inset:0; z-index:1000; display:flex; flex-direction:column; align-items:center; overflow-y:auto;
    padding:max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom)); background:#07070A; color:#F2F0EC;
    font-family:'Titillium Web',system-ui,sans-serif; }
  #mi-qr[hidden], #mi-qr [hidden] { display:none !important; }
  #mi-qr .cab { width:100%; max-width:420px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
  #mi-qr .cab b { font-size:18px; }
  #mi-qr .cab span { display:block; font-size:11px; font-weight:700; letter-spacing:.2em; text-transform:uppercase; color:#FFCA05; }
  #mi-qr button { font:inherit; cursor:pointer; }
  #mi-qr .cerrar { padding:10px 14px; border:1px solid rgba(255,255,255,.18); border-radius:10px; background:transparent; color:#F2F0EC; font-weight:600; min-height:44px; }
  #mi-qr .cuerpo { width:100%; max-width:420px; display:flex; flex-direction:column; align-items:center; gap:14px; margin-top:18px; text-align:center; }
  #mi-qr .ayuda { margin:0; color:#B4B0A9; font-size:15px; line-height:1.45; }
  #mi-qr .tarjeta-qr { position:relative; width:min(100%, 340px); aspect-ratio:1/1; padding:14px; border-radius:20px; background:#fff; display:grid; place-items:center; }
  #mi-qr .tarjeta-qr svg { width:100%; height:100%; display:block; }
  #mi-qr .tarjeta-qr.apagado svg { opacity:.12; filter:blur(3px); }
  #mi-qr .tarjeta-qr .sobre { position:absolute; inset:0; display:grid; place-items:center; padding:24px; color:#1B1915; font-weight:700; font-size:17px; }
  #mi-qr .codigo { font-family:ui-monospace,'SF Mono',Menlo,monospace; font-size:28px; font-weight:700; letter-spacing:.14em; color:#F2F0EC; }
  #mi-qr .codigo-ayuda { margin:-10px 0 0; font-size:13px; color:#8E8B86; }
  #mi-qr .estado { font-size:14px; color:#B4B0A9; min-height:1.4em; }
  #mi-qr .estado.alerta { color:#F9A51A; font-weight:600; }
  #mi-qr .saldo { display:flex; gap:10px; width:100%; }
  #mi-qr .saldo div { flex:1; padding:10px 12px; border:1px solid rgba(255,255,255,.09); border-radius:12px; background:rgba(255,255,255,.03); }
  #mi-qr .saldo span { display:block; font-size:11px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:#6B6762; }
  #mi-qr .saldo strong { font-size:20px; color:#FFCA05; }
  #mi-qr .primario { width:100%; padding:14px; border:none; border-radius:12px; background:linear-gradient(135deg,#FFCA05,#F37920); color:#1A1200; font-weight:700; font-size:16px; min-height:48px; }
  #mi-qr .exito { font-size:64px; line-height:1; color:#5FBF8B; }
  #mi-qr h2 { margin:0; font-size:24px; }
</style>
<div class="cab">
  <div><span>Aliados del Sol</span><b>Mi QR para canjear</b></div>
  <button class="cerrar" data-qr="cerrar">Cerrar</button>
</div>
<div class="cuerpo" data-qr="vista-qr">
  <p class="ayuda">Muéstrale este QR a la persona que te entrega la recompensa. Ella elige la recompensa y la confirma.</p>
  <div class="tarjeta-qr apagado" data-qr="tarjeta"><div class="sobre" data-qr="sobre">Generando tu QR…</div></div>
  <div class="codigo" data-qr="codigo" aria-label="Código del QR"></div>
  <p class="codigo-ayuda">Si la cámara no lo lee, dile este código.</p>
  <div class="estado" data-qr="estado" aria-live="polite"></div>
  <div class="saldo">
    <div><span>Puntos disponibles</span><strong data-qr="saldo">—</strong></div>
    <div><span>Nivel</span><strong data-qr="nivel">—</strong></div>
  </div>
  <button class="primario" data-qr="reintentar" hidden>Generar QR</button>
</div>
<div class="cuerpo" data-qr="vista-exito" hidden>
  <div class="exito">✔</div>
  <h2>¡Canje registrado!</h2>
  <p class="ayuda" data-qr="exito-texto"></p>
  <button class="primario" data-qr="cerrar">Listo</button>
  <button class="cerrar" data-qr="otro" style="width:100%">Mostrar otro QR</button>
</div>`;
  document.body.appendChild(raiz);
  raiz.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-qr]');
    if (!b) return;
    if (b.dataset.qr === 'cerrar') cerrar();
    if (b.dataset.qr === 'reintentar' || b.dataset.qr === 'otro') { mostrarVista('qr'); pedirQR(); }
  });
  document.addEventListener('keydown', (ev) => { if (abierto && ev.key === 'Escape') cerrar(); });
}

function mostrarVista(cual) {
  $('[data-qr="vista-qr"]').hidden = cual !== 'qr';
  $('[data-qr="vista-exito"]').hidden = cual !== 'exito';
}

function estado(texto, alerta = false) {
  const e = $('[data-qr="estado"]');
  e.textContent = texto;
  e.className = 'estado' + (alerta ? ' alerta' : '');
}

function apagarQR(texto) {
  $('[data-qr="tarjeta"]').classList.add('apagado');
  $('[data-qr="sobre"]').textContent = texto;
  $('[data-qr="sobre"]').hidden = false;
}

async function dibujar(url) {
  if (!qrLib) {
    try { qrLib = (await import(LIB_QR)).default; } catch (e) { qrLib = null; }
  }
  const tarjeta = $('[data-qr="tarjeta"]');
  tarjeta.querySelectorAll('svg').forEach((s) => s.remove());
  if (!qrLib) {
    apagarQR('No pudimos dibujar el QR. Dile el código de abajo a quien te entrega la recompensa.');
    return;
  }
  const qr = qrLib(0, 'M');
  qr.addData(url);
  qr.make();
  tarjeta.insertAdjacentHTML('afterbegin', qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true, alt: 'Código QR de canje' }));
  tarjeta.classList.remove('apagado');
  $('[data-qr="sobre"]').hidden = true;
}

function pedirQR() {
  if (pidiendo) return;
  pidiendo = true;
  if (!actual) estado('Generando tu QR…');
  window.dispatchEvent(new CustomEvent('ads:qr-generar'));
}

async function recibirQR(d) {
  pidiendo = false;
  if (!abierto) return;
  if (!d.ok) {
    // Sin señal: el QR que ya se ve sigue sirviendo hasta que vence.
    if (d.sinConexion && actual && actual.venceAt > Date.now()) {
      actual.renovarAt = Date.now() + 15000; // reintenta pronto
      return;
    }
    actual = null;
    apagarQR(d.mensaje || 'No pudimos generar tu QR.');
    $('[data-qr="codigo"]').textContent = '';
    estado('');
    $('[data-qr="reintentar"]').hidden = false;
    return;
  }
  $('[data-qr="reintentar"]').hidden = true;
  const ahora = Date.now();
  actual = { url: d.url, codigo: d.codigo_corto, venceAt: ahora + d.vence_en * 1000, renovarAt: ahora + RENOVAR_CADA * 1000 };
  $('[data-qr="codigo"]').textContent = formatoCodigo(d.codigo_corto);
  $('[data-qr="saldo"]').textContent = numero(d.puntos_disponibles);
  $('[data-qr="nivel"]').textContent = String(d.nivel || '').replace('circulo_solar', 'Círculo Solar').replace(/^./, (c) => c.toUpperCase());
  await dibujar(d.url);
  tic();
}

function recibirEstado(d) {
  if (!abierto || !actual || !d.ok || d.codigo !== actual.codigo) return;
  if (d.estado === 'usado') {
    actual = null;
    $('[data-qr="exito-texto"]').textContent =
      `Canjeaste «${d.recompensa}» por ${numero(d.puntos)} puntos. Te quedan ${numero(d.puntos_disponibles)} puntos disponibles.`;
    mostrarVista('exito');
    if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
  } else if (d.estado === 'reemplazado') {
    // Se abrió «Mi QR» en otro dispositivo: el QR de esta pantalla ya no sirve.
    actual = null;
    apagarQR('Abriste tu QR en otro dispositivo, así que este ya no sirve.');
    $('[data-qr="codigo"]').textContent = '';
    estado('');
    $('[data-qr="reintentar"]').textContent = 'Mostrar el QR aquí';
    $('[data-qr="reintentar"]').hidden = false;
  }
}

// Cada segundo: cuenta regresiva, renovación y aviso sin señal.
function tic() {
  if (!abierto || !actual) return;
  const ahora = Date.now();
  if (ahora >= actual.venceAt) {
    apagarQR(navigator.onLine ? 'Este QR venció. Generando uno nuevo…' : 'Este QR venció. Conéctate a internet para ver uno nuevo.');
    estado('');
    if (navigator.onLine) pedirQR();
    return;
  }
  if (!navigator.onLine) {
    estado(`Sin señal: este QR sirve hasta las ${hora(actual.venceAt)}.`, true);
    return;
  }
  const s = Math.max(0, Math.ceil((actual.renovarAt - ahora) / 1000));
  estado(`Se renueva solo en ${s} s. Una captura de pantalla no sirve.`);
  if (s === 0) pedirQR();
}

async function pedirPantallaEncendida() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { wakeLock = null; }
}

// La pantalla se ajusta al área visible del celular (visualViewport): si la página de fondo es más ancha que la
// pantalla, un position:fixed normal quedaría corrido y el QR cortado.
function ajustar() {
  const vv = window.visualViewport;
  if (!raiz || !vv) return;
  Object.assign(raiz.style, { left: vv.offsetLeft + 'px', top: vv.offsetTop + 'px', width: vv.width + 'px', height: vv.height + 'px', right: 'auto', bottom: 'auto' });
}

function abrir() {
  if (!raiz) crear();
  abierto = true;
  raiz.hidden = false;
  ajustar();
  document.documentElement.style.overflow = 'hidden';
  mostrarVista('qr');
  actual = null;
  $('[data-qr="reintentar"]').textContent = 'Generar QR';
  apagarQR('Generando tu QR…');
  pedirQR();
  clearInterval(reloj);
  clearInterval(sondeo);
  reloj = setInterval(tic, 1000);
  sondeo = setInterval(() => {
    if (actual && navigator.onLine && document.visibilityState === 'visible') {
      window.dispatchEvent(new CustomEvent('ads:qr-estado', { detail: { codigo: actual.codigo } }));
    }
  }, CONSULTAR_CADA * 1000);
  pedirPantallaEncendida();
}

function cerrar() {
  abierto = false;
  if (raiz) raiz.hidden = true;
  document.documentElement.style.overflow = '';
  clearInterval(reloj);
  clearInterval(sondeo);
  actual = null;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

window.addEventListener('ads:qr-abrir', abrir);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', ajustar);
  window.visualViewport.addEventListener('scroll', ajustar);
}
window.addEventListener('ads:qr', (e) => recibirQR(e.detail || {}));
window.addEventListener('ads:qr-estado-resultado', (e) => recibirEstado(e.detail || {}));
window.addEventListener('ads:logout', cerrar);
window.addEventListener('online', tic);
window.addEventListener('offline', tic);
document.addEventListener('visibilitychange', () => {
  if (!abierto) return;
  if (document.visibilityState === 'visible') {
    pedirPantallaEncendida();
    if (!actual || Date.now() >= actual.renovarAt) pedirQR();
  }
});
