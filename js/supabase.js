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
//
// El dashboard (fase 8) sale de las vistas v_aliado_dashboard, v_mis_movimientos, v_mis_referidos y
// v_mis_modulos (y v_mis_eventos, fase 9), que solo devuelven lo del aliado de la sesión. Se recarga al entrar, después de un
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
  registroInvalido: 'No pudimos crear tu cuenta. Revisa que todos los datos estén completos y vuelve a intentarlo.',
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
  enlaceVencido: 'El enlace de confirmación venció o ya fue usado. Inicia sesión; si tu correo sigue sin confirmar, regístrate de nuevo para recibir otro enlace.'
};

// Se lee antes de crear el cliente, porque supabase-js limpia el hash de la URL al procesarlo.
const hashInicial = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const vieneDeConfirmacion = hashInicial.get('type') === 'signup';
const errorEnEnlace = hashInicial.get('error_code') || hashInicial.get('error');

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
  if (codigo === 'unexpected_failure' || texto.includes('database error')) return MENSAJES.registroInvalido;
  if (error.name === 'AuthRetryableFetchError' || error instanceof TypeError) return MENSAJES.sinConexion;
  return MENSAJES.generico;
}

// Datos visibles del aliado de la sesión. Nunca se lee ni se expone `id` (CLAUDE.md §2).
async function leerAliado(supabase) {
  const { data, error } = await supabase
    .from('aliados')
    .select('codigo_aliado, nombre_completo, tipo_aliado, estado, nivel, puntos_nivel, puntos_disponibles')
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Solo las cuentas activas entran al Hub; las demás cierran sesión con un mensaje.
async function resolverAcceso(supabase) {
  const aliado = await leerAliado(supabase);
  if (aliado && aliado.estado === 'activo') {
    sesionActual = { activa: true, aliado };
    return { ok: true, aliado };
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
    const [aliado, movimientos, referidos, modulos, eventos] = await Promise.all([
      supabase.from('v_aliado_dashboard').select('*').maybeSingle(),
      supabase.from('v_mis_movimientos').select('*').order('fecha', { ascending: false }).order('secuencia', { ascending: false }).limit(500),
      supabase.from('v_mis_referidos').select('*').order('created_at', { ascending: false }),
      supabase.from('v_mis_modulos').select('*').order('orden'),
      supabase.from('v_mis_eventos').select('*').order('fecha', { ascending: false })
    ]);
    const error = aliado.error || movimientos.error || referidos.error || modulos.error || eventos.error;
    if (error || !aliado.data) {
      emitir('ads:dashboard', { ok: false, mensaje: MENSAJES.generico });
      return;
    }
    dashboardActual = { ok: true, aliado: aliado.data, movimientos: movimientos.data, referidos: referidos.data, modulos: modulos.data, eventos: eventos.data };
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

// Al cargar: procesa el enlace de confirmación (si viene de uno) y restaura la sesión guardada.
async function iniciar() {
  try {
    const supabase = await obtenerCliente();
    const { data } = await supabase.auth.getSession();

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
window.addEventListener('ads:consultar-dashboard', () => {
  if (dashboardActual) emitir('ads:dashboard', dashboardActual);
  else cargarDashboard();
});
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
