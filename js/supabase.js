// Integración del Hub con Supabase Auth: registro, login, sesión y cierre de sesión.
//
// Las páginas no llaman a Supabase directamente: emiten eventos `ads:*` en `window`
// y este módulo responde con otros eventos. Así la lógica de Supabase vive en un solo lugar.
//
//   Página → módulo                     Módulo → página
//   ads:join-register  {datos}          ads:join-resultado  { ok, mensaje?, confirmarCorreo? }
//   ads:login          {email,password} ads:login-resultado { ok, mensaje?, aliado? }
//   ads:logout                          ads:sesion          { activa, aliado? }
//   ads:consultar-sesion                ads:aviso           { mensaje, tono }  (p. ej. al volver del correo de confirmación)
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
  sinPerfil: 'Tu usuario no tiene un perfil de aliado. Escríbenos a c.arenas@geenera.com.',
  correoConfirmado: 'Confirmaste tu correo. GEENERA está validando tu perfil y te avisará por correo cuando tu cuenta esté activa.',
  enlaceVencido: 'El enlace de confirmación venció o ya fue usado. Inicia sesión; si tu correo sigue sin confirmar, regístrate de nuevo para recibir otro enlace.'
};

// Se lee antes de crear el cliente, porque supabase-js limpia el hash de la URL al procesarlo.
const hashInicial = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const vieneDeConfirmacion = hashInicial.get('type') === 'signup';
const errorEnEnlace = hashInicial.get('error_code') || hashInicial.get('error');

let clientePromesa = null;
let sesionActual = { activa: false };
let avisoPendiente = null; // se reenvía si la página se monta después de emitirlo

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
  emitir('ads:sesion', sesionActual);
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
}

window.addEventListener('ads:join-register', (e) => registrar(e.detail || {}));
window.addEventListener('ads:login', (e) => iniciarSesion(e.detail || {}));
window.addEventListener('ads:logout', () => cerrarSesion());
// La página puede montarse antes o después de este módulo: al montarse pregunta el estado.
window.addEventListener('ads:consultar-sesion', () => {
  emitir('ads:sesion', sesionActual);
  if (avisoPendiente) {
    emitir('ads:aviso', avisoPendiente);
    avisoPendiente = null;
  }
});

iniciar();
