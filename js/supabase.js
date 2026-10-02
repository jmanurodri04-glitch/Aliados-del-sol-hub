// Integración del Hub con Supabase: registro, login, sesión, cierre de sesión y "Nueva oportunidad".
//
// Las páginas no llaman a Supabase directamente: emiten eventos `ads:*` en `window`
// y este módulo responde con otros eventos. Así la lógica de Supabase vive en un solo lugar.
//
//   Página → módulo                     Módulo → página
//   ads:join-register  {datos}          ads:join-resultado  { ok, mensaje?, confirmarCorreo? }
//   ads:login          {email,password} ads:login-resultado { ok, mensaje?, aliado? }
//   ads:logout                          ads:sesion          { activa, aliado? }
//   ads:consultar-sesion                ads:aviso           { mensaje, tono }  (p. ej. al volver del correo de confirmación)
//   ads:referral {datos, archivo?}      ads:referral-resultado { ok, mensaje?, es_perfecto?, movimientos?, puntos_disponibles?, nivel? }
//   ads:consultar-dashboard             ads:dashboard       { ok, aliado?, movimientos?, referidos?, modulos? }
//   ads:modulo-completado {codigo}      ads:modulo-resultado { ok, codigo, mensaje?, nuevo?, puntos?, recompensa_estado? }
//   ads:evento-registrar {datos, archivo?} ads:evento-resultado { ok, mensaje?, evento_id? }
//   ads:qr-generar                      ads:qr              { ok, ficha?, url?, codigo_corto?, vence_en?, sinConexion?, mensaje? }
//   ads:qr-estado {codigo}              ads:qr-estado-resultado { ok, estado?, recompensa?, puntos?, puntos_disponibles?, sinConexion? }
//   ads:recuperar {email}               ads:recuperar-resultado { ok, mensaje? }
//   ads:clave-nueva {password}          ads:clave-nueva-resultado { ok: false, mensaje, vencido? }  (si sale bien: ads:login-resultado con claveNueva)
//
// Recuperar contraseña: el correo "Restablece tu contraseña" (supabase/templates/recuperacion.html) trae
// #recuperacion=<token_hash>. El código solo se usa (verifyOtp) cuando la persona guarda la contraseña nueva, así
// un antivirus de correo o una vista previa que abra el enlace no lo gasta. #recuperar abre el formulario para
// pedir el enlace (lo usan admin.html y canje.html).
//
// El QR de canje (fase 11) lo pinta js/mi-qr.js; aquí solo se llaman generar_qr_canje y estado_qr_canje con la sesión
// del aliado. El QR es un enlace a /canje.html#q=<ficha>: la ficha vale 5 minutos y sirve una sola vez.
// Una cuenta de operador (quien registra canjes) que entre al Hub se envía a /canje.html, y una de admin a /admin.html.
//
// El dashboard (fase 8) sale de las vistas v_aliado_dashboard, v_mis_movimientos, v_mis_referidos y
// v_mis_modulos (y v_mis_eventos, fase 9; v_mis_canjes y v_recompensas, fase 10), que solo devuelven lo del aliado de la sesión. Se recarga al entrar, después de un
// referido y al completar un módulo.
//
// En el navegador solo se usan la URL y la publishable key (GET /api/config); la seguridad la da RLS.
// Nunca se registran contraseñas ni datos personales en la consola.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';

// Ids de tipo del formulario → valores del enum tipo_aliado en la base de datos.
const TIPOS_ALIADO = {
  financiero: 'financiero',
  emi: 'emi',
  linker: 'linker',
  embajador: 'cliente_embajador',
  gremial: 'agremiaciones'
};

const MENSAJES = {
  generico: 'No pudimos completar la operación. Intenta de nuevo en unos minutos.',
  sinConexion: 'No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.',
  correoRegistrado: 'Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.',
  registroInvalido: 'No pudimos crear tu cuenta. Revisa que todos los datos estén completos y que tu celular no esté registrado en otra cuenta, y vuelve a intentarlo.',
  contrasenaDebil: 'La contraseña es muy débil. Usa al menos 8 caracteres y evita contraseñas comunes.',
  demasiadosIntentos: 'Hiciste demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
  credenciales: 'Correo o contraseña incorrectos.',
  correoSinConfirmar: 'Aún no confirmas tu correo. Revisa tu bandeja de entrada (y la carpeta de spam) y abre el enlace que te enviamos.',
  pendiente: 'Tu solicitud está en revisión. GEENERA valida tu perfil y te avisa por correo cuando tu cuenta esté activa.',
  suspendido: 'Tu cuenta está suspendida. Escríbenos a c.arenas@geenera.com si crees que es un error.',
  rechazado: 'Tu solicitud no fue aprobada. Si crees que es un error, escríbenos a c.arenas@geenera.com.',
  sinPerfil: 'Tu usuario no tiene un perfil de aliado. Escríbenos a c.arenas@geenera.com.',
  correoConfirmado: 'Confirmaste tu correo. GEENERA está validando tu perfil y te avisará por correo cuando tu cuenta esté activa.',
  facturaNoSubio: 'No pudimos subir la factura. Revisa tu conexión e intenta de nuevo.',
  sesionVencida: 'Tu sesión expiró. Vuelve a iniciar sesión para referir.',
  sesionVencidaModulo: 'Tu sesión expiró. Vuelve a iniciar sesión para registrar tu avance.',
  sesionVencidaEvento: 'Tu sesión expiró. Vuelve a iniciar sesión para reportar el evento.',
  archivoNoSubio: 'No pudimos subir el registro de asistentes. Revisa tu conexión e intenta de nuevo.',
  enlaceVencido: 'El enlace de confirmación venció o ya fue usado. Inicia sesión; si tu correo sigue sin confirmar, regístrate de nuevo para recibir otro enlace.',
  enlaceRecuperacion: 'El enlace para crear tu contraseña venció o ya se usó. Pide uno nuevo con «¿Olvidaste tu contraseña?».',
  mismaContrasena: 'Usa una contraseña distinta a la anterior.',
  claveGuardada: 'Guardamos tu contraseña nueva.',
  operador: 'Tu cuenta es para registrar canjes. Te llevamos a la página de canjes.',
  admin: 'Tu cuenta es de administración. Te llevamos al panel de administración.',
  sesionVencidaQR: 'Tu sesión expiró. Vuelve a iniciar sesión para ver tu QR.',
  qrNoActivo: 'Tu cuenta no está activa: aún no puedes canjear.',
  qrLimite: 'Generaste muchos QR seguidos. Espera unos minutos y vuelve a abrir «Mi QR».'
};

// Se lee antes de crear el cliente, porque supabase-js limpia el hash de la URL al procesarlo.
const hashInicial = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const vieneDeConfirmacion = hashInicial.get('type') === 'signup';
const errorEnEnlace = hashInicial.get('error_code') || hashInicial.get('error');
let codigoRecuperacion = hashInicial.get('recuperacion');
const pideRecuperar = hashInicial.has('recuperar');
let recuperacionVerificada = false; // el código ya se usó y hay sesión: un reintento solo cambia la contraseña

let clientePromesa = null;
let sesionActual = { activa: false };
let avisoPendiente = null; // se reenvía si la página se monta después de emitirlo
let dashboardActual = null; // último dashboard cargado; se reenvía si la página lo pide

function emitir(nombre, detalle) {
  window.dispatchEvent(new CustomEvent(nombre, { detail: detalle }));
}

function avisar(aviso) {
  avisoPendiente = aviso;
  emitir('ads:aviso', aviso);
}

function obtenerCliente() {
  if (!clientePromesa) {
    clientePromesa = fetch('/api/config', { headers: { accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error('config ' + r.status);
        return r.json();
      })
      .then((c) => createClient(c.supabaseUrl, c.supabasePublishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      }))
      .catch((e) => {
        clientePromesa = null; // permite reintentar
        throw e;
      });
  }
  return clientePromesa;
}

function mensajeDeError(error) {
  if (!error) return MENSAJES.generico;
  const codigo = error.code || '';
  const texto = (error.message || '').toLowerCase();
  if (error.status === 429 || codigo === 'over_request_rate_limit' || codigo === 'over_email_send_rate_limit') return MENSAJES.demasiadosIntentos;
  if (codigo === 'invalid_credentials' || texto.includes('invalid login credentials')) return MENSAJES.credenciales;
  if (codigo === 'email_not_confirmed' || texto.includes('email not confirmed')) return MENSAJES.correoSinConfirmar;
  if (codigo === 'user_already_exists' || codigo === 'email_exists' || texto.includes('already registered')) return MENSAJES.correoRegistrado;
  if (codigo === 'weak_password') return MENSAJES.contrasenaDebil;
  if (codigo === 'same_password') return MENSAJES.mismaContrasena;
  if (codigo === 'unexpected_failure' || texto.includes('database error')) return MENSAJES.registroInvalido;
  if (error.name === 'AuthRetryableFetchError' || error instanceof TypeError) return MENSAJES.sinConexion;
  return MENSAJES.generico;
}

// Datos visibles del aliado de la sesión. Nunca se lee ni se expone `id` (CLAUDE.md §2): solo se filtra por el
// usuario de la sesión, porque un admin puede leer todas las filas de `aliados` (RLS).
async function leerAliado(supabase) {
  const { data: sesion } = await supabase.auth.getSession();
  const usuario = sesion && sesion.session && sesion.session.user;
  if (!usuario) return null;
  const { data, error } = await supabase
    .from('aliados')
    .select('codigo_aliado, nombre_completo, tipo_aliado, estado, rol, nivel, puntos_nivel, puntos_disponibles')
    .eq('id', usuario.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ¿La sesión es de un operador (fase 11)? RLS solo le deja leer su propia fila de `operadores`.
async function esOperador(supabase) {
  const { data: sesion } = await supabase.auth.getSession();
  const usuario = sesion && sesion.session && sesion.session.user;
  if (!usuario) return false;
  const { data } = await supabase.from('operadores').select('activo').eq('usuario_id', usuario.id).maybeSingle();
  return !!data;
}

// Solo las cuentas activas entran al Hub; las demás cierran sesión con un mensaje. Un operador va a /canje.html
// y una cuenta de admin va a /admin.html (decisión del equipo: el admin usa solo el panel, no el Hub).
async function resolverAcceso(supabase) {
  const aliado = await leerAliado(supabase);
  if (aliado && aliado.estado === 'activo' && aliado.rol === 'admin') {
    sesionActual = { activa: false };
    window.location.assign('/admin.html');
    return { ok: false, motivo: 'admin', mensaje: MENSAJES.admin };
  }
  if (aliado && aliado.estado === 'activo') {
    sesionActual = { activa: true, aliado };
    return { ok: true, aliado };
  }
  if (!aliado && await esOperador(supabase)) {
    sesionActual = { activa: false };
    window.location.assign('/canje.html');
    return { ok: false, motivo: 'operador', mensaje: MENSAJES.operador };
  }
  await supabase.auth.signOut();
  sesionActual = { activa: false };
  if (!aliado) return { ok: false, motivo: 'sin_perfil', mensaje: MENSAJES.sinPerfil };
  return { ok: false, motivo: aliado.estado, mensaje: MENSAJES[aliado.estado] || MENSAJES.generico };
}

async function registrar(datos) {
  try {
    const supabase = await obtenerCliente();
    const { data, error } = await supabase.auth.signUp({
      email: (datos.email || '').trim(),
      password: datos.password,
      options: {
        emailRedirectTo: window.location.origin + '/',
        data: {
          nombre_completo: datos.name,
          celular: datos.phone,
          regional: datos.regional || null,
          tipo_aliado: TIPOS_ALIADO[datos.ally_type] || datos.ally_type,
          organizacion: datos.organization || null,
          cargo: datos.role_title || null,
          como_llega_empresas: datos.reach || null,
          autorizacion_datos: datos.autorizacion_datos === true,
          acepta_terminos: datos.acepta_terminos === true
        }
      }
    });
    if (error) return emitir('ads:join-resultado', { ok: false, mensaje: mensajeDeError(error) });

    // Con confirmación de correo activa, Supabase no revela si el correo ya existía:
    // responde un usuario sin identidades. Lo tratamos como correo ya registrado.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return emitir('ads:join-resultado', { ok: false, mensaje: MENSAJES.correoRegistrado });
    }

    // Si no hay confirmación de correo, signUp abre sesión; la cuenta igual queda pendiente.
    if (data.session) await supabase.auth.signOut();
    emitir('ads:join-resultado', { ok: true, confirmarCorreo: !data.session });
  } catch (e) {
    emitir('ads:join-resultado', { ok: false, mensaje: mensajeDeError(e) });
  }
}

async function iniciarSesion({ email, password }) {
  try {
    const supabase = await obtenerCliente();
    const { error } = await supabase.auth.signInWithPassword({ email: (email || '').trim(), password: password || '' });
    if (error) return emitir('ads:login-resultado', { ok: false, mensaje: mensajeDeError(error) });
    emitir('ads:login-resultado', await resolverAcceso(supabase));
    emitir('ads:sesion', sesionActual);
    cargarDashboard(supabase);
  } catch (e) {
    emitir('ads:login-resultado', { ok: false, mensaje: mensajeDeError(e) });
  }
}

function limpiarHash() {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

async function pedirRecuperacion({ email }) {
  try {
    const supabase = await obtenerCliente();
    const { error } = await supabase.auth.resetPasswordForEmail((email || '').trim(), { redirectTo: window.location.origin + '/' });
    // Supabase no revela si el correo existe; solo se informan los límites y la falta de conexión.
    if (error && (error.status === 429 || error.name === 'AuthRetryableFetchError')) {
      return emitir('ads:recuperar-resultado', { ok: false, mensaje: mensajeDeError(error) });
    }
    emitir('ads:recuperar-resultado', { ok: true });
  } catch (e) {
    emitir('ads:recuperar-resultado', { ok: false, mensaje: mensajeDeError(e) });
  }
}

async function guardarClaveNueva({ password }) {
  try {
    const supabase = await obtenerCliente();
    if (!recuperacionVerificada) {
      if (!codigoRecuperacion) return emitir('ads:clave-nueva-resultado', { ok: false, vencido: true, mensaje: MENSAJES.enlaceRecuperacion });
      const { error } = await supabase.auth.verifyOtp({ token_hash: codigoRecuperacion, type: 'recovery' });
      // Sin conexión el código sigue sirviendo: se puede reintentar sin pedir otro enlace.
      if (error && error.name === 'AuthRetryableFetchError') return emitir('ads:clave-nueva-resultado', { ok: false, mensaje: MENSAJES.sinConexion });
      codigoRecuperacion = null;
      limpiarHash();
      if (error) return emitir('ads:clave-nueva-resultado', { ok: false, vencido: true, mensaje: MENSAJES.enlaceRecuperacion });
      recuperacionVerificada = true;
    }
    const { error } = await supabase.auth.updateUser({ password: password || '' });
    if (error) return emitir('ads:clave-nueva-resultado', { ok: false, mensaje: mensajeDeError(error) });
    recuperacionVerificada = false;
    // Entra con las mismas reglas del login: activo → Hub; pendiente, rechazado o suspendido → su mensaje; operador → canje.html.
    const acceso = await resolverAcceso(supabase);
    if (!acceso.ok) acceso.mensaje = MENSAJES.claveGuardada + ' ' + acceso.mensaje;
    emitir('ads:login-resultado', Object.assign(acceso, { claveNueva: true }));
    emitir('ads:sesion', sesionActual);
    if (sesionActual.activa) cargarDashboard(supabase);
  } catch (e) {
    emitir('ads:clave-nueva-resultado', { ok: false, mensaje: mensajeDeError(e) });
  }
}

async function cerrarSesion() {
  try {
    const supabase = await obtenerCliente();
    await supabase.auth.signOut();
  } catch (e) {
    // Sin conexión: la sesión local se descarta igual.
  }
  sesionActual = { activa: false };
  dashboardActual = null;
  emitir('ads:sesion', sesionActual);
}

// "Nueva oportunidad" (CLAUDE.md §7.2). La factura se sube directo a Storage con una URL firmada de un
// solo uso que entrega /api/oportunidades/factura; luego /api/oportunidades registra todo y otorga los puntos.
async function llamarApi(supabase, ruta, cuerpo) {
  const { data } = await supabase.auth.getSession();
  const token = data.session && data.session.access_token;
  if (!token) return { status: 401, datos: { error: MENSAJES.sesionVencida } };
  const r = await fetch(ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify(cuerpo)
  });
  let datos = {};
  try { datos = await r.json(); } catch (e) { /* respuesta sin cuerpo */ }
  return { status: r.status, datos };
}

async function referir({ datos, archivo }) {
  const fallo = (mensaje) => emitir('ads:referral-resultado', { ok: false, mensaje: mensaje || MENSAJES.generico });
  try {
    const supabase = await obtenerCliente();
    let empresaId = null;
    let factura = null;
    if (archivo) {
      const permiso = await llamarApi(supabase, '/api/oportunidades/factura', { nombre_archivo: archivo.name, tipo: archivo.type, tamano: archivo.size });
      if (permiso.status !== 200) return fallo(permiso.datos.error);
      const { error } = await supabase.storage.from('facturas')
        .uploadToSignedUrl(permiso.datos.ruta, permiso.datos.token, archivo, { contentType: archivo.type });
      if (error) return fallo(MENSAJES.facturaNoSubio);
      empresaId = permiso.datos.empresa_id;
      factura = { ruta: permiso.datos.ruta, nombre_archivo: archivo.name };
    }
    const r = await llamarApi(supabase, '/api/oportunidades', { empresa_id: empresaId || crypto.randomUUID(), datos, factura });
    if (r.status !== 201) return fallo(r.status === 401 ? MENSAJES.sesionVencida : r.datos.error);

    const { es_perfecto, movimientos, puntos_disponibles, puntos_nivel, nivel } = r.datos;
    if (sesionActual.activa) {
      sesionActual = { activa: true, aliado: Object.assign({}, sesionActual.aliado, { puntos_disponibles, puntos_nivel, nivel }) };
      emitir('ads:sesion', sesionActual);
    }
    emitir('ads:referral-resultado', { ok: true, es_perfecto, movimientos, puntos_disponibles, nivel });
    cargarDashboard(supabase);
  } catch (e) {
    fallo(mensajeDeError(e));
  }
}

// Dashboard del aliado (CLAUDE.md §9). Las vistas filtran por la sesión: nunca llega información de otro aliado.
async function cargarDashboard(supabaseDado) {
  try {
    const supabase = supabaseDado || await obtenerCliente();
    if (!sesionActual.activa) return;
    const [aliado, movimientos, referidos, modulos, eventos, canjes, recompensas] = await Promise.all([
      supabase.from('v_aliado_dashboard').select('*').maybeSingle(),
      supabase.from('v_mis_movimientos').select('*').order('fecha', { ascending: false }).order('secuencia', { ascending: false }).limit(500),
      supabase.from('v_mis_referidos').select('*').order('created_at', { ascending: false }),
      supabase.from('v_mis_modulos').select('*').order('orden'),
      supabase.from('v_mis_eventos').select('*').order('fecha', { ascending: false }),
      supabase.from('v_mis_canjes').select('*').order('fecha', { ascending: false }).limit(200),
      supabase.from('v_recompensas').select('*').order('puntos')
    ]);
    const error = aliado.error || movimientos.error || referidos.error || modulos.error || eventos.error || canjes.error || recompensas.error;
    if (error || !aliado.data) {
      emitir('ads:dashboard', { ok: false, mensaje: MENSAJES.generico });
      return;
    }
    ultimaRecarga = Date.now();
    dashboardActual = { ok: true, aliado: aliado.data, movimientos: movimientos.data, referidos: referidos.data, modulos: modulos.data, eventos: eventos.data,
      canjes: canjes.data, recompensas: recompensas.data };
    emitir('ads:dashboard', dashboardActual);
  } catch (e) {
    emitir('ads:dashboard', { ok: false, mensaje: mensajeDeError(e) });
  }
}

// El aliado terminó la última lección de un curso de la Academy (CLAUDE.md §5.3).
async function completarModulo({ codigo }) {
  const resultado = (d) => emitir('ads:modulo-resultado', Object.assign({ codigo }, d));
  try {
    const supabase = await obtenerCliente();
    const r = await llamarApi(supabase, '/api/modulos', { codigo });
    if (r.status !== 200) return resultado({ ok: false, mensaje: r.status === 401 ? MENSAJES.sesionVencidaModulo : (r.datos.error || MENSAJES.generico) });
    const { nuevo, puntos, recompensa_estado, puntos_disponibles, puntos_nivel, nivel } = r.datos;
    if (sesionActual.activa && puntos_disponibles != null) {
      sesionActual = { activa: true, aliado: Object.assign({}, sesionActual.aliado, { puntos_disponibles, puntos_nivel, nivel }) };
      emitir('ads:sesion', sesionActual);
    }
    resultado({ ok: true, nuevo, puntos, recompensa_estado });
    cargarDashboard(supabase);
  } catch (e) {
    resultado({ ok: false, mensaje: mensajeDeError(e) });
  }
}

// El aliado reporta un evento (CLAUDE.md §4.8). El registro de asistentes se sube directo a Storage con una URL
// firmada de un solo uso que entrega /api/eventos; después se registra el evento y un admin lo valida.
async function registrarEvento({ datos, archivo }) {
  const resultado = (d) => emitir('ads:evento-resultado', d);
  try {
    const supabase = await obtenerCliente();
    let eventoId = crypto.randomUUID();
    let ruta = null;
    if (archivo) {
      const permiso = await llamarApi(supabase, '/api/eventos', { accion: 'subir', nombre_archivo: archivo.name, tipo: archivo.type, tamano: archivo.size });
      if (permiso.status !== 200) return resultado({ ok: false, mensaje: permiso.status === 401 ? MENSAJES.sesionVencidaEvento : (permiso.datos.error || MENSAJES.generico) });
      const { error } = await supabase.storage.from('eventos').uploadToSignedUrl(permiso.datos.ruta, permiso.datos.token, archivo, { contentType: archivo.type });
      if (error) return resultado({ ok: false, mensaje: MENSAJES.archivoNoSubio });
      eventoId = permiso.datos.evento_id;
      ruta = permiso.datos.ruta;
    }
    const r = await llamarApi(supabase, '/api/eventos', { accion: 'registrar', evento_id: eventoId, datos, archivo: ruta });
    if (r.status !== 201) return resultado({ ok: false, mensaje: r.status === 401 ? MENSAJES.sesionVencidaEvento : (r.datos.error || MENSAJES.generico) });
    resultado({ ok: true, evento_id: r.datos.evento_id });
    cargarDashboard(supabase);
  } catch (e) {
    resultado({ ok: false, mensaje: mensajeDeError(e) });
  }
}

// QR de canje (fase 11). Un error de red se informa como sinConexion: js/mi-qr.js conserva el QR que ya muestra,
// que sigue sirviendo hasta que vence.
const sinRed = (error) => !navigator.onLine || /fetch|network|load failed/i.test(String((error && error.message) || ''));

async function generarQR() {
  const resultado = (d) => emitir('ads:qr', d);
  try {
    const supabase = await obtenerCliente();
    if (!sesionActual.activa) return resultado({ ok: false, mensaje: MENSAJES.sesionVencidaQR });
    const { data, error } = await supabase.rpc('generar_qr_canje');
    if (error) {
      const codigo = String(error.message || '').split(':')[0].trim();
      if (codigo === 'aliado_no_activo') return resultado({ ok: false, mensaje: MENSAJES.qrNoActivo });
      if (codigo === 'limite_qr') return resultado({ ok: false, mensaje: MENSAJES.qrLimite });
      return resultado({ ok: false, sinConexion: sinRed(error), mensaje: sinRed(error) ? MENSAJES.sinConexion : MENSAJES.generico });
    }
    resultado(Object.assign({ ok: true, url: window.location.origin + '/canje.html#q=' + data.ficha }, data));
  } catch (e) {
    resultado({ ok: false, sinConexion: true, mensaje: MENSAJES.sinConexion });
  }
}

async function estadoQR({ codigo }) {
  const resultado = (d) => emitir('ads:qr-estado-resultado', d);
  try {
    const supabase = await obtenerCliente();
    const { data, error } = await supabase.rpc('estado_qr_canje', { p_codigo: codigo });
    if (error) return resultado({ ok: false, sinConexion: sinRed(error) });
    resultado(Object.assign({ ok: true, codigo }, data));
    // Se canjeó: el saldo y "Mis canjes" cambian.
    if (data.estado === 'usado' && sesionActual.activa) {
      sesionActual = { activa: true, aliado: Object.assign({}, sesionActual.aliado, { puntos_disponibles: data.puntos_disponibles }) };
      emitir('ads:sesion', sesionActual);
      cargarDashboard(supabase);
    }
  } catch (e) {
    resultado({ ok: false, sinConexion: true });
  }
}

// Al cargar: procesa el enlace de confirmación (si viene de uno) y restaura la sesión guardada.
async function iniciar() {
  try {
    const supabase = await obtenerCliente();
    const { data } = await supabase.auth.getSession();

    if (codigoRecuperacion) {
      // Enlace del correo de recuperación: se pide la contraseña nueva antes de entrar. Si había otra sesión
      // abierta en este navegador, se cierra para no mezclar cuentas.
      if (data.session) await supabase.auth.signOut({ scope: 'local' });
      avisar({ mensaje: '', tono: 'info', ruta: 'login', modo: 'clave' });
      emitir('ads:sesion', sesionActual);
      return;
    }
    if (pideRecuperar) {
      limpiarHash();
      if (!data.session) {
        avisar({ mensaje: '', tono: 'info', ruta: 'login', modo: 'olvido' });
        emitir('ads:sesion', sesionActual);
        return;
      }
    }
    if (errorEnEnlace) {
      avisar({ mensaje: MENSAJES.enlaceVencido, tono: 'error', ruta: 'login' });
    } else if (data.session) {
      const acceso = await resolverAcceso(supabase);
      if (vieneDeConfirmacion && acceso.motivo === 'pendiente') {
        avisar({ mensaje: MENSAJES.correoConfirmado, tono: 'ok', ruta: 'login' });
      } else if (!acceso.ok) {
        avisar({ mensaje: acceso.mensaje, tono: 'info', ruta: 'login' });
      }
    }
  } catch (e) {
    // Sin configuración o sin red: el sitio público sigue funcionando.
  }
  emitir('ads:sesion', sesionActual);
  if (sesionActual.activa) cargarDashboard();
}

window.addEventListener('ads:join-register', (e) => registrar(e.detail || {}));
window.addEventListener('ads:login', (e) => iniciarSesion(e.detail || {}));
window.addEventListener('ads:logout', () => cerrarSesion());
window.addEventListener('ads:referral', (e) => referir(e.detail || {}));
window.addEventListener('ads:modulo-completado', (e) => completarModulo(e.detail || {}));
window.addEventListener('ads:evento-registrar', (e) => registrarEvento(e.detail || {}));
window.addEventListener('ads:qr-generar', () => generarQR());
window.addEventListener('ads:qr-estado', (e) => estadoQR(e.detail || {}));
window.addEventListener('ads:recuperar', (e) => pedirRecuperacion(e.detail || {}));
window.addEventListener('ads:clave-nueva', (e) => guardarClaveNueva(e.detail || {}));
window.addEventListener('ads:consultar-dashboard', () => {
  if (dashboardActual) emitir('ads:dashboard', dashboardActual);
  else cargarDashboard();
});
// Los puntos pueden cambiar sin que el aliado haga nada (un admin anula un canje, Clientify avanza un referido): al
// volver a la pestaña o a la app, y cada 2 minutos con la página visible, se recarga el dashboard (máximo cada 30 s).
let ultimaRecarga = 0;
function recargarSiVisible() {
  if (!sesionActual.activa || document.visibilityState !== 'visible' || Date.now() - ultimaRecarga < 30000) return;
  ultimaRecarga = Date.now();
  cargarDashboard();
}
document.addEventListener('visibilitychange', recargarSiVisible);
window.addEventListener('focus', recargarSiVisible);
setInterval(recargarSiVisible, 120000);

// La página puede montarse antes o después de este módulo: al montarse pregunta el estado.
window.addEventListener('ads:consultar-sesion', () => {
  emitir('ads:sesion', sesionActual);
  if (dashboardActual) emitir('ads:dashboard', dashboardActual);
  if (avisoPendiente) {
    emitir('ads:aviso', avisoPendiente);
    avisoPendiente = null;
  }
});

iniciar();
