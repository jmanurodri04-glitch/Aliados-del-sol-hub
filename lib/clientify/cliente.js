// Cliente HTTP mínimo de la API de Clientify (https://api.clientify.net/v1).
// Autenticación: `Authorization: Token <CLIENTIFY_API_KEY>` (confirmado contra la API).
// Solo lo usan las funciones de servidor en /api: el navegador nunca habla con Clientify (§1).
//
// Formatos por confirmar con la API real (developer.clientify.com no es accesible desde el
// entorno donde se escribió): filtro `?email=`, forma de `custom_fields` ({ field, value }) y
// `POST /contacts/{id}/tags/` con { name }. Si alguno difiere, se ajusta solo aquí.

const URL_BASE = 'https://api.clientify.net/v1';
const TIEMPO_MAXIMO_MS = 8000;

export class ErrorClientify extends Error {
  constructor(mensaje, { status = null, reintentable = true } = {}) {
    super(mensaje);
    this.name = 'ErrorClientify';
    this.status = status;
    this.reintentable = reintentable;
  }
}

export function crearClienteClientify({ apiKey, urlBase = URL_BASE, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new ErrorClientify('Falta CLIENTIFY_API_KEY', { reintentable: false });

  async function solicitar(metodo, ruta, cuerpo) {
    let respuesta;
    try {
      respuesta = await fetchImpl(urlBase.replace(/\/$/, '') + ruta, {
        method: metodo,
        headers: {
          Authorization: 'Token ' + apiKey,
          Accept: 'application/json',
          ...(cuerpo ? { 'Content-Type': 'application/json' } : {})
        },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS)
      });
    } catch (e) {
      throw new ErrorClientify(`Sin respuesta de Clientify (${metodo} ${ruta.split('?')[0]}): ${e.name}`);
    }

    const texto = await respuesta.text();
    let datos = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch { datos = null; }

    if (!respuesta.ok) {
      // 4xx (salvo 408/429) son errores de datos: reintentarlos no los arregla, pero igual se
      // registran y se reintentan con espera por si el problema se corrige en Clientify.
      const detalle = datos && (datos.detail || JSON.stringify(datos).slice(0, 200));
      throw new ErrorClientify(`Clientify respondió ${respuesta.status} (${metodo} ${ruta.split('?')[0]})${detalle ? ': ' + detalle : ''}`, {
        status: respuesta.status,
        reintentable: respuesta.status >= 500 || respuesta.status === 408 || respuesta.status === 429
      });
    }
    return datos;
  }

  return {
    /** Busca un contacto por correo. Verifica la coincidencia exacta porque el filtro puede ser parcial. */
    async buscarContactoPorCorreo(correo) {
      const objetivo = correo.trim().toLowerCase();
      const datos = await solicitar('GET', '/contacts/?email=' + encodeURIComponent(objetivo));
      const resultados = (datos && (datos.results || datos)) || [];
      return (Array.isArray(resultados) ? resultados : []).find((c) => {
        const correos = [c.email, ...(c.emails || []).map((e) => e && e.email)].filter(Boolean);
        return correos.some((e) => String(e).trim().toLowerCase() === objetivo);
      }) || null;
    },

    crearContacto(datos) {
      return solicitar('POST', '/contacts/', datos);
    },

    actualizarContacto(id, datos) {
      return solicitar('PATCH', `/contacts/${encodeURIComponent(id)}/`, datos);
    },

    agregarEtiqueta(id, nombre) {
      return solicitar('POST', `/contacts/${encodeURIComponent(id)}/tags/`, { name: nombre });
    }
  };
}
