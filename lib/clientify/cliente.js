// Cliente HTTP mínimo de la API de Clientify (https://api.clientify.net/v1).
// Autenticación: `Authorization: Token <CLIENTIFY_API_KEY>` (confirmado contra la API, que es Django REST
// Framework: paginación { count, next, results } e ignora campos desconocidos).
// Solo lo usan las funciones de servidor en /api: el navegador nunca habla con Clientify (§1).
//
// Formatos por confirmar con la API real (developer.clientify.com no es accesible desde el entorno donde se
// escribió). Si alguno difiere, se ajusta SOLO aquí:
//   - filtros `?email=` (contactos) y `?name=` (empresas);
//   - `custom_fields` como [{ field, value }];
//   - `POST /contacts/{id}/tags/` con { name };
//   - vínculo contacto → empresa con el campo `company` (URL de la empresa);
//   - adjuntar documentos a la empresa: `POST /companies/{id}/files/` multipart con el campo `file`;
// Confirmado con el diagnóstico (fase 6): las etiquetas se listan en /contacts/tags/, los embudos y fases en
// /deals/pipelines/ y /deals/pipelines/stages/, y el filtro `?contact=` de /deals/ NO filtra (devuelve todas).

const URL_BASE = 'https://api.clientify.net/v1';
const TIEMPO_MAXIMO_MS = 8000;
const TIEMPO_MAXIMO_ARCHIVOS_MS = 20000;

export class ErrorClientify extends Error {
  constructor(mensaje, { status = null, reintentable = true } = {}) {
    super(mensaje);
    this.name = 'ErrorClientify';
    this.status = status;
    this.reintentable = reintentable;
  }
}

const iguales = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const resultados = (datos) => {
  const lista = (datos && (datos.results || datos)) || [];
  return Array.isArray(lista) ? lista : [];
};

export function crearClienteClientify({ apiKey, urlBase = URL_BASE, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new ErrorClientify('Falta CLIENTIFY_API_KEY', { reintentable: false });
  const base = urlBase.replace(/\/$/, '');

  async function solicitar(metodo, ruta, cuerpo, { multipart = false } = {}) {
    let respuesta;
    try {
      respuesta = await fetchImpl(base + ruta, {
        method: metodo,
        headers: {
          Authorization: 'Token ' + apiKey,
          Accept: 'application/json',
          // Con FormData, fetch pone el Content-Type multipart con su boundary.
          ...(cuerpo && !multipart ? { 'Content-Type': 'application/json' } : {})
        },
        body: cuerpo ? (multipart ? cuerpo : JSON.stringify(cuerpo)) : undefined,
        signal: AbortSignal.timeout(multipart ? TIEMPO_MAXIMO_ARCHIVOS_MS : TIEMPO_MAXIMO_MS)
      });
    } catch (e) {
      throw new ErrorClientify(`Sin respuesta de Clientify (${metodo} ${ruta.split('?')[0]}): ${e.name}`);
    }

    const texto = await respuesta.text();
    let datos = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch { datos = null; }

    if (!respuesta.ok) {
      // 4xx (salvo 408/429) son errores de datos: se registran y se reintentan con espera por si se corrigen en Clientify.
      const detalle = datos && (datos.detail || JSON.stringify(datos).slice(0, 200));
      throw new ErrorClientify(`Clientify respondió ${respuesta.status} (${metodo} ${ruta.split('?')[0]})${detalle ? ': ' + detalle : ''}`, {
        status: respuesta.status,
        reintentable: respuesta.status >= 500 || respuesta.status === 408 || respuesta.status === 429
      });
    }
    return datos;
  }

  /** GET que devuelve null si el recurso no existe (fue eliminado en Clientify). */
  async function obtener(ruta) {
    try {
      return await solicitar('GET', ruta);
    } catch (e) {
      if (e instanceof ErrorClientify && e.status === 404) return null;
      throw e;
    }
  }

  /** Recorre las páginas de un listado (máximo `paginas`). */
  async function listar(ruta, paginas) {
    const todos = [];
    let siguiente = ruta;
    for (let i = 0; i < paginas && siguiente; i++) {
      const datos = await solicitar('GET', siguiente);
      todos.push(...resultados(datos));
      siguiente = datos && datos.next ? String(datos.next).replace(base, '') : null;
      if (siguiente && /^https?:/.test(siguiente)) siguiente = null; // otro dominio: no se sigue
    }
    return todos;
  }

  return {
    /** Lectura genérica (solo la usa el diagnóstico). */
    leer(ruta) {
      return solicitar('GET', ruta);
    },

    /**
     * Sondeo de solo lectura (GET u OPTIONS) para el diagnóstico: no lanza error y devuelve el código, los
     * métodos permitidos (encabezado Allow) y el cuerpo, para averiguar rutas y permisos de la API.
     */
    async sondear(metodo, ruta) {
      if (metodo !== 'GET' && metodo !== 'OPTIONS') throw new Error('sondear solo admite GET u OPTIONS');
      try {
        const r = await fetchImpl(base + ruta, { method: metodo, headers: { Authorization: 'Token ' + apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS) });
        const texto = await r.text();
        let cuerpo = null;
        try { cuerpo = texto ? JSON.parse(texto) : null; } catch { cuerpo = null; }
        return { status: r.status, allow: r.headers.get('allow'), cuerpo };
      } catch (e) {
        return { status: null, error: e.name };
      }
    },

    obtenerContacto(id) {
      return obtener(`/contacts/${encodeURIComponent(id)}/`);
    },

    obtenerOportunidad(id) {
      return obtener(`/deals/${encodeURIComponent(id)}/`);
    },

    /** Catálogo de fases de todos los embudos (nombre, embudo y posición). */
    listarFases() {
      return listar('/deals/pipelines/stages/?page_size=200', 5);
    },

    /** Todas las oportunidades (para el escaneo; la API no filtra por contacto). Máximo `paginas` × 100. */
    listarOportunidades(paginas = 100) {
      return listar('/deals/?page_size=100', paginas);
    },

    /** Busca un contacto por correo. Verifica la coincidencia exacta porque el filtro puede ser parcial. */
    async buscarContactoPorCorreo(correo) {
      const datos = await solicitar('GET', '/contacts/?email=' + encodeURIComponent(String(correo).trim().toLowerCase()));
      return resultados(datos).find((c) =>
        [c.email, ...(c.emails || []).map((e) => e && e.email)].filter(Boolean).some((e) => iguales(e, correo))) || null;
    },

    crearContacto(datos) {
      return solicitar('POST', '/contacts/', datos);
    },

    actualizarContacto(id, datos) {
      return solicitar('PATCH', `/contacts/${encodeURIComponent(id)}/`, datos);
    },

    agregarEtiqueta(id, nombre) {
      return solicitar('POST', `/contacts/${encodeURIComponent(id)}/tags/`, { name: nombre });
    },

    /** Busca una empresa por nombre exacto (sin distinguir mayúsculas), para no duplicarla. */
    async buscarEmpresaPorNombre(nombre) {
      const datos = await solicitar('GET', '/companies/?name=' + encodeURIComponent(String(nombre).trim()));
      return resultados(datos).find((c) => iguales(c.name, nombre)) || null;
    },

    crearEmpresa(datos) {
      return solicitar('POST', '/companies/', datos);
    },

    /** URL de la empresa para vincular contactos (la API la devuelve en `url`; si no, se arma). */
    urlEmpresa(empresa) {
      return (empresa && empresa.url) || `${base}/companies/${encodeURIComponent(empresa.id)}/`;
    },

    /** Adjunta un documento (la factura) a la ficha de la empresa. */
    subirDocumentoEmpresa(id, { nombre, tipo, contenido }) {
      const formulario = new FormData();
      formulario.append('file', new Blob([contenido], { type: tipo }), nombre);
      return solicitar('POST', `/companies/${encodeURIComponent(id)}/files/`, formulario, { multipart: true });
    }
  };
}
