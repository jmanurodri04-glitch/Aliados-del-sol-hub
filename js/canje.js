// Registro de canjes con el QR del aliado (fase 11, CLAUDE.md §4.10).
//
// La usa un operador (o un admin) desde el celular:
//   1. escanea el QR del aliado con la cámara (o escribe el código corto que va debajo);
//   2. ve al aliado (código, nombre corto, nivel, saldo) y las recompensas de su proveedor;
//   3. elige una, confirma y entrega la recompensa.
// Las reglas (QR vigente y de un solo uso, cuenta activa, nivel, saldo, 30 canjes por hora) las aplica la base con
// consultar_qr_canje y canjear_qr, que verifican al operador por su sesión. Esta página no ve aliados.id (§2).
//
// El QR es un enlace a /canje.html#q=<ficha>: si se escanea con la cámara normal del celular, se abre aquí mismo.
// Los enlaces de invitación de Supabase llegan con #access_token=…&type=invite (o recovery): se pide crear la contraseña.
// Todo texto que viene de la base se escapa antes de insertarlo en la página.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';

const NIVELES = { bronce: 'Bronce', plata: 'Plata', oro: 'Oro', platino: 'Platino', diamante: 'Diamante', circulo_solar: 'Círculo Solar' };
const CODIGO_CORTO = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
const FICHA = /^[A-Za-z0-9_-]{40,64}$/;

// Mensajes para cada respuesta de la base. Los QR que no sirven no son errores: la base responde { ok: false, codigo }.
const MENSAJES = {
  qr_invalido: ['Código no encontrado', 'Revisa que esté bien escrito, o pide al aliado que abra de nuevo «Mi QR».'],
  qr_vencido: ['Este QR venció', 'Cada QR dura 5 minutos. Pide al aliado que abra de nuevo «Mi QR» y escanea el nuevo.'],
  qr_usado: ['Este QR ya se usó', 'Cada QR sirve para un solo canje. Pide al aliado el QR que tiene ahora en pantalla.'],
  qr_reemplazado: ['Este QR ya no es válido', 'El aliado generó uno más nuevo (puede ser una captura de pantalla vieja). Pídele el QR que tiene ahora en pantalla.'],
  propio_qr: ['No puedes canjear tu propio QR', 'Otra persona del equipo debe registrar tu canje.'],
  no_autorizado: ['Sin acceso', 'Esta cuenta no puede registrar canjes, o fue desactivada.'],
  limite_intentos: ['Demasiados códigos inválidos', 'Espera unos minutos antes de volver a intentar.'],
  aliado_no_activo: ['La cuenta del aliado no está activa', 'No puede canjear mientras su cuenta esté en revisión o suspendida.'],
  nivel_insuficiente: ['Nivel insuficiente', 'El aliado aún no tiene el nivel que exige esta recompensa.'],
  saldo_insuficiente: ['Puntos insuficientes', 'El aliado no tiene puntos disponibles suficientes para esta recompensa.'],
  recompensa_inexistente: ['Recompensa no disponible', 'La recompensa ya no está activa o no corresponde a tu proveedor.'],
  limite_canjes: ['Límite de canjes', 'Este aliado ya hizo 30 canjes en la última hora. Intenta más tarde.'],
  sin_conexion: ['Sin conexión', 'No pudimos hablar con el servidor y no sabemos si el canje quedó registrado. Revisa la señal y toca «Reintentar»: si ya quedó, se mostrará confirmado sin descontar dos veces.'],
  generico: ['No se pudo completar', 'Intenta de nuevo en unos segundos.']
};

const $ = (id) => document.getElementById(id);
let supabase = null;
let pendiente = null;      // ficha que llegó en el enlace (#q=…) antes de iniciar sesión
let actual = null;         // { qr, datos } del aliado escaneado
let reintento = null;      // última acción de canje, por si falló la conexión
let stream = null;
let lector = null;
let reloj = null;

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const numero = (v) => Number(v || 0).toLocaleString('es-CO');
function vista(id) {
  ['vista-cargando', 'vista-login', 'vista-clave', 'vista-sin-acceso', 'vista-escanear', 'vista-aliado', 'vista-resultado']
    .forEach((v) => { $(v).hidden = v !== id; });
  window.scrollTo(0, 0);
}

/** Lo que trae un QR o lo que escribe el operador → ficha o código corto, o null si no es de un canje del Hub. */
function fichaDe(texto) {
  const t = String(texto || '').trim();
  const i = t.indexOf('#q=');
  if (i >= 0) {
    const f = decodeURIComponent(t.slice(i + 3).split('&')[0]);
    return FICHA.test(f) ? f : null;
  }
  if (FICHA.test(t)) return t;
  const c = t.toUpperCase().replace(/[\s-]/g, '');
  return CODIGO_CORTO.test(c) ? c : null;
}

/** Error de Supabase → clave de MENSAJES. */
function claveDeError(error) {
  const texto = String((error && error.message) || '');
  const prefijo = texto.split(':')[0].trim();
  if (MENSAJES[prefijo]) return prefijo;
  if (!navigator.onLine || /fetch|network|load failed/i.test(texto)) return 'sin_conexion';
  return 'generico';
}

async function rpc(nombre, args) {
  try {
    const { data, error } = await supabase.rpc(nombre, args);
    if (error) return { error: claveDeError(error) };
    return { data };
  } catch (e) {
    return { error: 'sin_conexion' };
  }
}

// Resultado (pantalla final) ---------------------------------------------------------------------------------------

function mostrarResultado(ok, titulo, texto, conReintento = false) {
  $('resultado').className = 'tarjeta resultado ' + (ok ? 'ok' : 'error');
  $('resultado-icono').textContent = ok ? '✔' : '✖';
  $('resultado-titulo').textContent = titulo;
  $('resultado-texto').textContent = texto;
  $('otro').textContent = conReintento ? 'Reintentar' : 'Escanear otro';
  $('otro').dataset.reintentar = conReintento ? '1' : '';
  vista('vista-resultado');
}
const mostrarError = (clave) => mostrarResultado(false, MENSAJES[clave][0], MENSAJES[clave][1], clave === 'sin_conexion');

// Escanear -------------------------------------------------------------------------------------------------------------

async function cargarHoy() {
  const r = await rpc('mis_canjes_registrados', {});
  const filas = r.data || [];
  $('hoy').innerHTML = filas.length ? filas.map((c) => `<li>
    <span><b>${esc(c.recompensa)}</b><span class="sub">${new Date(c.fecha).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' })} · <span class="codigo">${esc(c.codigo_aliado)}</span>${c.estado === 'anulado' ? ' · anulado' : ''}</span></span>
    <span>${numero(c.puntos)} pts</span></li>`).join('') : '<li><span class="sub">Aún no registras canjes hoy.</span></li>';
}

function irAEscanear() {
  actual = null;
  clearInterval(reloj);
  $('codigo').value = '';
  $('escanear-mensaje').textContent = '';
  vista('vista-escanear');
  cargarHoy();
}

function cerrarCamara() {
  clearTimeout(lector);
  lector = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  $('camara').hidden = true;
  $('cerrar-camara').hidden = true;
  $('abrir-camara').hidden = false;
}

// jsQR (lector de QR en JavaScript) se publica como script clásico: expone window.jsQR.
function cargarJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  return new Promise((ok, falla) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
    s.onload = () => (window.jsQR ? ok(window.jsQR) : falla(new Error('jsQR')));
    s.onerror = () => falla(new Error('jsQR'));
    document.head.appendChild(s);
  });
}

async function abrirCamara() {
  $('escanear-mensaje').textContent = '';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('escanear-mensaje').textContent = 'Este navegador no permite usar la cámara. Escribe el código que aparece debajo del QR.';
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (e) {
    $('escanear-mensaje').textContent = e && e.name === 'NotAllowedError'
      ? 'Permite el uso de la cámara en el navegador (ícono del candado junto a la dirección) o escribe el código.'
      : 'No pudimos abrir la cámara. Escribe el código que aparece debajo del QR.';
    return;
  }
  const video = $('video');
  video.srcObject = stream;
  $('camara').hidden = false;
  $('abrir-camara').hidden = true;
  $('cerrar-camara').hidden = false;
  $('camara-estado').textContent = 'Buscando el QR…';
  await video.play().catch(() => {});

  // Android (Chrome) trae un lector de QR; en iPhone (Safari) se usa jsQR, que se carga solo si hace falta.
  let detectar;
  try {
    if ('BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      detectar = async () => { const c = await detector.detect(video); return c.length ? c[0].rawValue : null; };
    }
  } catch (e) { /* sin lector nativo */ }
  if (!detectar) {
    let jsQR;
    try {
      jsQR = await cargarJsQR();
    } catch (e) {
      cerrarCamara();
      $('escanear-mensaje').textContent = 'No pudimos cargar el lector de QR. Revisa la conexión o escribe el código.';
      return;
    }
    const lienzo = document.createElement('canvas');
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    detectar = async () => {
      if (!video.videoWidth) return null;
      const escala = Math.min(1, 640 / video.videoWidth);
      lienzo.width = Math.round(video.videoWidth * escala);
      lienzo.height = Math.round(video.videoHeight * escala);
      ctx.drawImage(video, 0, 0, lienzo.width, lienzo.height);
      const r = jsQR(ctx.getImageData(0, 0, lienzo.width, lienzo.height).data, lienzo.width, lienzo.height, { inversionAttempts: 'dontInvert' });
      return r ? r.data : null;
    };
  }

  const buscarEnVideo = async () => {
    if (!stream) return;
    let texto = null;
    try { texto = await detectar(); } catch (e) { /* cuadro ilegible: se intenta con el siguiente */ }
    if (texto) {
      const ficha = fichaDe(texto);
      if (ficha) {
        if (navigator.vibrate) navigator.vibrate(80);
        cerrarCamara();
        return buscar(ficha);
      }
      $('camara-estado').textContent = 'Ese QR no es de un canje de Aliados del Sol.';
    }
    lector = setTimeout(buscarEnVideo, 200);
  };
  buscarEnVideo();
}

// Consultar al aliado y elegir la recompensa ------------------------------------------------------------------------------

function motivoDe(r, aliado) {
  if (r.motivo === 'nivel_insuficiente') return `Requiere nivel ${NIVELES[r.nivel_minimo] || r.nivel_minimo}`;
  if (r.motivo === 'saldo_insuficiente') return `Le faltan ${numero(r.puntos - aliado.puntos_disponibles)} puntos`;
  if (r.motivo === 'aliado_no_activo') return 'Cuenta no activa';
  return r.descripcion || r.categoria || '';
}

async function buscar(qr) {
  $('escanear-mensaje').textContent = 'Buscando…';
  const r = await rpc('consultar_qr_canje', { p_qr: qr });
  $('escanear-mensaje').textContent = '';
  if (r.error) return mostrarError(r.error);
  if (!r.data.ok) return mostrarError(MENSAJES[r.data.codigo] ? r.data.codigo : 'generico');

  actual = { qr, datos: r.data };
  const a = r.data.aliado;
  $('aliado-nombre').textContent = a.nombre;
  $('aliado-codigo').textContent = a.codigo_aliado;
  $('aliado-nivel').textContent = NIVELES[a.nivel] || a.nivel;
  $('aliado-saldo').textContent = numero(a.puntos_disponibles);
  const lista = [...r.data.recompensas].sort((x, y) => Number(y.disponible) - Number(x.disponible));
  $('recompensas').innerHTML = lista.length ? lista.map((x) => `
    <button class="recompensa" data-recompensa="${esc(x.codigo)}" ${x.disponible ? '' : 'disabled'}>
      <span class="txt"><b>${esc(x.nombre)}</b><span>${esc(motivoDe(x, a))}</span></span>
      <span class="pts">${numero(x.puntos)} pts</span>
    </button>`).join('') : '<p class="nota">Tu proveedor no tiene recompensas activas. Pide al equipo GEENERA que las cree en el panel.</p>';

  // Cuenta regresiva del QR: al vencer ya no se puede canjear con él.
  const vence = Date.now() + r.data.vence_en * 1000;
  clearInterval(reloj);
  const pintar = () => {
    const s = Math.max(0, Math.round((vence - Date.now()) / 1000));
    $('aliado-vence').textContent = s > 0 ? `Este QR vence en ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
      : 'El QR venció: pide al aliado que abra de nuevo «Mi QR».';
    if (!s) { clearInterval(reloj); document.querySelectorAll('.recompensa').forEach((b) => { b.disabled = true; }); }
  };
  pintar();
  reloj = setInterval(pintar, 1000);
  vista('vista-aliado');
}

function pedirConfirmacion(codigo) {
  const x = actual.datos.recompensas.find((r) => r.codigo === codigo);
  if (!x) return;
  const a = actual.datos.aliado;
  $('confirmar-texto').innerHTML = `<b>${esc(x.nombre)}</b> por <b>${numero(x.puntos)} puntos</b> para ${esc(a.nombre)} (<span class="codigo">${esc(a.codigo_aliado)}</span>).<br><br>Al confirmar se descuentan los puntos: entrega la recompensa después de ver el ✔.`;
  $('confirmar').dataset.recompensa = codigo;
  $('confirmar').showModal();
}

async function canjear(qr, codigo) {
  reintento = { qr, codigo };
  const boton = $('confirmar-si');
  boton.disabled = true;
  const r = await rpc('canjear_qr', { p_qr: qr, p_recompensa: codigo });
  boton.disabled = false;
  $('confirmar').close();
  clearInterval(reloj);
  if (r.error) return mostrarError(r.error);
  if (!r.data.ok) return mostrarError(MENSAJES[r.data.codigo] ? r.data.codigo : 'generico');
  reintento = null;
  const d = r.data;
  mostrarResultado(true, 'Canje registrado',
    `${d.recompensa} · −${numero(d.puntos)} puntos. Nuevo saldo de ${d.codigo_aliado}: ${numero(d.puntos_disponibles)}. `
    + (d.duplicado ? 'Ya estaba registrado: no se descontó dos veces. ' : '')
    + `Entrega la recompensa. Canje n.º ${String(d.canje_id).slice(0, 8).toUpperCase()}.`);
}

// Sesión -----------------------------------------------------------------------------------------------------------------

async function entrar() {
  const r = await rpc('perfil_operador', {});
  if (r.error === 'no_autorizado') return vista('vista-sin-acceso');
  if (r.error) { $('vista-cargando').innerHTML = '<p class="nota">No pudimos conectarnos. Recarga la página.</p>'; return vista('vista-cargando'); }
  $('quien').hidden = false;
  $('quien-nombre').textContent = `${r.data.nombre} · ${r.data.es_admin ? 'admin' : r.data.proveedor}`;
  irAEscanear();
  if (pendiente) {
    const qr = pendiente;
    pendiente = null;
    buscar(qr);
  }
}

async function iniciar() {
  // Lo que viene después del '#': una ficha de QR (#q=…) o un enlace de invitación/recuperación de Supabase.
  const hash = new URLSearchParams(location.hash.slice(1));
  const tipoEnlace = hash.get('type');
  const errorEnlace = hash.get('error_description');
  if (hash.get('q')) {
    pendiente = fichaDe('#q=' + hash.get('q'));
    history.replaceState(null, '', location.pathname); // la ficha no se queda en la barra de direcciones
  }

  try {
    const r = await fetch('/api/config', { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('config');
    const c = await r.json();
    supabase = createClient(c.supabaseUrl, c.supabasePublishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  } catch (e) {
    $('vista-cargando').innerHTML = '<p class="nota">No pudimos conectarnos. Revisa la señal y recarga la página.</p>';
    return;
  }

  $('abrir-camara').addEventListener('click', abrirCamara);
  $('cerrar-camara').addEventListener('click', cerrarCamara);
  $('form-codigo').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const ficha = fichaDe($('codigo').value);
    if (!ficha) { $('escanear-mensaje').textContent = 'El código tiene 8 letras y números (p. ej. K7M2-QX9T).'; return; }
    cerrarCamara();
    buscar(ficha);
  });
  $('recompensas').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-recompensa]');
    if (b && !b.disabled) pedirConfirmacion(b.dataset.recompensa);
  });
  $('confirmar-no').addEventListener('click', () => $('confirmar').close());
  $('confirmar-si').addEventListener('click', () => canjear(actual.qr, $('confirmar').dataset.recompensa));
  $('cancelar').addEventListener('click', irAEscanear);
  $('otro').addEventListener('click', () => {
    if ($('otro').dataset.reintentar && reintento) return canjear(reintento.qr, reintento.codigo);
    irAEscanear();
  });
  $('salir').addEventListener('click', async () => { cerrarCamara(); await supabase.auth.signOut(); location.replace(location.pathname); });

  $('form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('login-boton').disabled = true; $('login-mensaje').textContent = '';
    const { error } = await supabase.auth.signInWithPassword({ email: $('login-correo').value.trim(), password: $('login-clave').value });
    $('login-boton').disabled = false;
    if (error) { $('login-mensaje').textContent = 'Correo o contraseña incorrectos.'; return; }
    $('login-clave').value = '';
    entrar();
  });

  $('form-clave').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const clave = $('clave-1').value;
    if (clave.length < 8) { $('clave-mensaje').textContent = 'Mínimo 8 caracteres.'; return; }
    if (clave !== $('clave-2').value) { $('clave-mensaje').textContent = 'Las contraseñas no coinciden.'; return; }
    $('clave-boton').disabled = true; $('clave-mensaje').textContent = '';
    const { error } = await supabase.auth.updateUser({ password: clave });
    $('clave-boton').disabled = false;
    if (error) { $('clave-mensaje').textContent = 'No pudimos guardar la contraseña. Si el enlace venció, pide uno nuevo al equipo GEENERA.'; return; }
    history.replaceState(null, '', location.pathname);
    entrar();
  });

  const { data } = await supabase.auth.getSession();
  if (data.session && (tipoEnlace === 'invite' || tipoEnlace === 'recovery')) return vista('vista-clave');
  if (!data.session) {
    if (errorEnlace) $('login-mensaje').textContent = 'El enlace venció o ya se usó. Pide uno nuevo al equipo GEENERA.';
    $('login-qr-pendiente').hidden = !pendiente;
    return vista('vista-login');
  }
  entrar();
}

iniciar();
