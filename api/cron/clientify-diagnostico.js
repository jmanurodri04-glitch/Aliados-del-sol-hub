// GET /api/cron/clientify-diagnostico — lectura de la configuración de Clientify para confirmar el mapeo
// (CLAUDE.md §8 y §14, preguntas 1 y 2). Protegido con CRON_SECRET. Solo lee; no cambia nada.
//
// Devuelve NOMBRES y ESTRUCTURA, nunca datos personales:
//   - catálogos (campos personalizados, etiquetas, embudos y fases, estados): nombres;
//   - contactos y oportunidades: las claves de cada objeto con el tipo del valor (valores ocultos) y los valores
//     distintos de los campos que son listas de opciones (status, fase, estado…);
//   - los últimos webhooks recibidos: su estructura, para confirmar cómo se interpretan.
//
// Desde Supabase (SQL Editor):  select interno.invocar_cron_hub('clientify-diagnostico');
// y luego:                        select content from net._http_response order by created desc limit 1;

import { contextoClientify, validarCron } from '../../lib/cron.js';
import { interpretarWebhook } from '../../lib/clientify/mapeo.js';

// Rutas confirmadas con el primer diagnóstico (la API no tiene un catálogo de Status de contacto: sus valores
// salen de la muestra de contactos). Se siguen hasta 5 páginas.
const CATALOGOS = {
  campos_personalizados: ['/custom-fields/?page_size=200'],
  etiquetas: ['/contacts/tags/?page_size=200'],
  embudos: ['/deals/pipelines/?page_size=50'],
  fases: ['/deals/pipelines/stages/?page_size=200']
};
const siguientePagina = (datos) => (datos && datos.next ? String(datos.next).replace(/^https?:\/\/[^/]+\/v\d+/, '') : null);
// Claves de catálogos que se muestran tal cual (no son datos personales).
const CLAVES_CATALOGO = ['id', 'name', 'label', 'field', 'content_type', 'model', 'type', 'field_type', 'choices', 'options',
  'pipeline', 'pipeline_desc', 'position', 'order', 'probability', 'slug', 'status', 'description'];
// En contactos y oportunidades, claves cuyos valores son opciones de una lista y se pueden listar.
const ENUMERABLES = /^tags$|(status|stage|pipeline|lifecycle|contact_type|contact_source|estado|fase|^medium$|^channel$|type|tipo)/;

// Campo "Tipo" del contacto (correcciones-hub): la lista de contactos no lo trae, así que se lee la ficha completa
// de algunos contactos y se busca dónde está el valor "Aliados Estratégicos". Solo se devuelven rutas de claves y
// valores de claves enumerables, nunca nombres, correos ni teléfonos.
const VALOR_TIPO_BUSCADO = 'aliados estrategicos';
const MAX_FICHAS = 25;
const normalizar = (v) => String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

const tipo = (v) => (v === null ? 'null' : Array.isArray(v) ? 'lista' : typeof v === 'object' ? 'objeto' : typeof v);

/** Estructura de un objeto: clave → tipo (un nivel de objetos y listas anidadas). */
function estructura(obj, nivel = 0) {
  const r = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && nivel < 1) r[k] = estructura(v, nivel + 1);
    else if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && nivel < 1) r[k] = [estructura(v[0], nivel + 1)];
    else r[k] = tipo(v);
  }
  return r;
}

const nombreDe = (v) => (v && typeof v === 'object' ? v.name ?? v.label ?? v.value ?? null : v);

/** Valores distintos de las claves enumerables (p. ej. los Status en uso) y los nombres de campos personalizados. */
function valoresDistintos(lista) {
  const r = {};
  const campos = new Set();
  for (const obj of lista) {
    for (const [k, v] of Object.entries(obj || {})) {
      if (k === 'custom_fields' && Array.isArray(v)) {
        v.forEach((c) => c && campos.add(String(c.field ?? c.name ?? c.label ?? '?')));
        continue;
      }
      if (!ENUMERABLES.test(k)) continue;
      const valores = Array.isArray(v) ? v.map(nombreDe) : [nombreDe(v)];
      for (const x of valores) {
        if (x == null || typeof x === 'object' || String(x).length > 80) continue;
        (r[k] ||= new Set()).add(String(x));
      }
    }
  }
  return {
    ...Object.fromEntries(Object.entries(r).map(([k, s]) => [k, [...s].slice(0, 50)])),
    nombres_campos_personalizados: [...campos]
  };
}

async function probar(clientify, rutas) {
  const intentos = [];
  for (const ruta of rutas) {
    try {
      let datos = await clientify.leer(ruta);
      const total = datos && datos.count;
      const lista = Array.isArray(datos) ? datos : (datos && datos.results) || [];
      for (let pagina = 1, sig = siguientePagina(datos); pagina < 5 && sig; pagina++, sig = siguientePagina(datos)) {
        datos = await clientify.leer(sig);
        lista.push(...((datos && datos.results) || []));
      }
      return {
        ruta, total: total != null ? total : lista.length,
        elementos: lista.map((x) => Object.fromEntries(CLAVES_CATALOGO.filter((k) => k in x).map((k) => [k, x[k]]))),
        intentos
      };
    } catch (e) {
      intentos.push({ ruta, error: e.status || e.message });
    }
  }
  return { ruta: null, intentos };
}

async function muestra(clientify, ruta) {
  try {
    const datos = await clientify.leer(ruta);
    const lista = (datos && datos.results) || [];
    return { ruta, total: datos && datos.count, estructura: estructura(lista[0]), valores: valoresDistintos(lista), lista };
  } catch (e) {
    return { ruta, error: e.status || e.message };
  }
}

/** Rutas de las claves cuyo valor es "Aliados Estratégicos" (los campos personalizados se nombran por su campo). */
export function rutasConValor(valor, buscado = VALOR_TIPO_BUSCADO, ruta = '') {
  if (valor == null) return [];
  if (typeof valor !== 'object') return normalizar(valor) === buscado ? [ruta] : [];
  if (Array.isArray(valor)) {
    return valor.flatMap((x, i) => {
      const nombre = x && typeof x === 'object' && (x.field ?? x.name) != null ? `[field=${x.field ?? x.name}]` : `[${i}]`;
      return rutasConValor(x, buscado, `${ruta}${nombre}`);
    });
  }
  return Object.entries(valor).flatMap(([k, v]) => rutasConValor(v, buscado, ruta ? `${ruta}.${k}` : k));
}

/**
 * Lee la ficha completa de hasta MAX_FICHAS contactos (primero los que tienen etiquetas del programa) o del
 * contacto indicado, y devuelve: las claves que la ficha trae y la lista no, dónde aparece "Aliados Estratégicos"
 * y los valores distintos de las claves enumerables de la ficha.
 */
async function campoTipo(clientify, lista, contactoId) {
  const delPrograma = (c) => (c.tags || []).some((t) => /aliad|^ads /i.test(String(t && typeof t === 'object' ? t.name : t)));
  const ids = contactoId ? [contactoId]
    : [...lista.filter(delPrograma), ...lista.filter((c) => !delPrograma(c))].map((c) => c.id).filter((id) => id != null).slice(0, MAX_FICHAS);
  const clavesLista = new Set(lista[0] ? Object.keys(lista[0]) : []);
  const fichas = [];
  const errores = [];
  for (const id of ids) {
    try {
      fichas.push(await clientify.leer(`/contacts/${encodeURIComponent(id)}/`));
    } catch (e) {
      errores.push(e.status || e.message);
    }
  }
  const rutas = {};
  for (const f of fichas) for (const r of rutasConValor(f)) rutas[r] = (rutas[r] || 0) + 1;
  return {
    fichas_leidas: fichas.length,
    errores,
    claves_solo_en_ficha: [...new Set(fichas.flatMap((f) => Object.keys(f || {})))].filter((k) => !clavesLista.has(k)),
    estructura_ficha: estructura(fichas[0]),
    rutas_con_aliados_estrategicos: rutas,
    valores_ficha: valoresDistintos(fichas)
  };
}

// Adjuntar la factura a la empresa (correcciones-hub): `POST /companies/{id}/files/` respondió 403. Con
// ?archivos=<id de una empresa> se sondean, solo con GET y OPTIONS (nada se crea), la raíz de la API, la ficha
// de la empresa y las rutas candidatas de archivos. Se devuelven códigos, métodos permitidos y estructura
// (claves y tipos), nunca valores, salvo los textos de error y las definiciones de campos de OPTIONS.
export function resumenSondeo(s) {
  const r = { status: s.status, allow: s.allow || null };
  if (s.error) r.error = s.error;
  const c = s.cuerpo;
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    if (typeof c.detail === 'string') r.detalle = c.detail.slice(0, 300);
    if (c.actions && typeof c.actions === 'object') {
      // OPTIONS de Django REST Framework: métodos de escritura con la definición de cada campo (sin datos).
      r.acciones = Object.fromEntries(Object.entries(c.actions).map(([m, campos]) => [m,
        Object.fromEntries(Object.entries(campos || {}).map(([k, d]) => [k, {
          tipo: d && d.type, requerido: !!(d && d.required), solo_lectura: !!(d && d.read_only),
          // Las opciones de un campo de lista son nombres del catálogo de Clientify (p. ej. sectores), no datos personales.
          ...(d && Array.isArray(d.choices) ? { opciones: d.choices.slice(0, 60).map((o) => (o && typeof o === 'object' ? `${o.value} = ${o.display_name}` : String(o))) } : {})
        }]))]));
    }
    if (Array.isArray(c.results)) { r.count = c.count ?? c.results.length; if (c.results[0]) r.estructura_item = estructura(c.results[0]); }
    else if (!r.acciones && !r.detalle) r.estructura = estructura(c);
  } else if (Array.isArray(c)) {
    r.count = c.length; if (c[0] && typeof c[0] === 'object') r.estructura_item = estructura(c[0]);
  }
  return r;
}

const MARCA_PRUEBA = '+prueba';

async function sondearArchivos(clientify, idEmpresa, idContacto) {
  const id = encodeURIComponent(idEmpresa);
  const raiz = await clientify.sondear('GET', '/');
  const rutasRaiz = raiz.cuerpo && typeof raiz.cuerpo === 'object' && !Array.isArray(raiz.cuerpo) ? Object.keys(raiz.cuerpo) : null;
  const empresa = await clientify.sondear('GET', `/companies/${id}/`);
  const clavesEmpresa = empresa.cuerpo && typeof empresa.cuerpo === 'object' ? Object.keys(empresa.cuerpo) : null;
  const candidatas = [`/companies/${id}/files/`, `/companies/${id}/documents/`, `/companies/${id}/attachments/`,
    `/companies/${id}/wall_entries/`, `/companies/${id}/wall-entries/`, `/companies/${id}/notes/`, `/companies/${id}/note/`,
    '/files/', '/documents/', '/attachments/', '/wall_entries/', '/wall-entries/', '/notes/', '/companies/files/', '/companies/attachments/'];
  const rutas = {};
  for (const ruta of candidatas) {
    rutas[ruta] = { GET: resumenSondeo(await clientify.sondear('GET', ruta)), OPTIONS: resumenSondeo(await clientify.sondear('OPTIONS', ruta)) };
  }
  // El muro de la empresa (wall_entries) suele guardar los archivos subidos a mano: se leen hasta 5 entradas
  // (solo su estructura y las claves que parecen de archivos) para ver cómo los guarda Clientify.
  const muro = [];
  const entradas = empresa.cuerpo && Array.isArray(empresa.cuerpo.wall_entries) ? empresa.cuerpo.wall_entries.slice(0, 5) : [];
  for (const entrada of entradas) {
    const url = typeof entrada === 'string' ? entrada : entrada && entrada.url;
    if (typeof url !== 'string' || !url.startsWith(clientify.urlBase)) { muro.push({ estructura: estructura(entrada) }); continue; }
    const ruta = url.slice(clientify.urlBase.length);
    const s = await clientify.sondear('GET', ruta);
    const o = await clientify.sondear('OPTIONS', ruta);
    const c = s.cuerpo || {};
    muro.push({ ruta: ruta.replace(/\d+/g, '{id}'), GET: resumenSondeo(s), OPTIONS: resumenSondeo(o),
      // Cómo guarda Clientify un archivo subido a mano: tipo de la entrada, su texto (recortado) y la forma del enlace.
      valores: { type: c.type ?? null, extra: typeof c.extra === 'string' ? c.extra.slice(0, 150) : null,
        link: typeof c.link === 'string' ? c.link.replace(/\?.*$/, '?…').replace(/[A-Za-z0-9_-]{24,}/g, '…') : null } });
  }

  // Campos que aceptan los contactos y las empresas al crearse (tipo y opciones), para enviar cada dato donde va.
  const campos = {};
  for (const ruta of ['/contacts/', '/companies/']) campos[ruta] = resumenSondeo(await clientify.sondear('OPTIONS', ruta)).acciones || null;

  // Cómo quedó la empresa en un contacto de prueba creado por el Hub (solo si su correo lleva +prueba).
  let contactoPrueba = null;
  if (idContacto) {
    const s = await clientify.sondear('GET', `/contacts/${encodeURIComponent(idContacto)}/`);
    const c = s.cuerpo || {};
    const correos = [c.email, ...((c.emails || []).map((x) => (x && typeof x === 'object' ? x.email : x)))].filter(Boolean).map(String);
    contactoPrueba = correos.some((x) => x.includes(MARCA_PRUEBA))
      ? { status: s.status, ...Object.fromEntries(Object.entries(c).filter(([k]) => /company|address/i.test(k))) }
      : { status: s.status, aviso: 'Solo se muestran contactos de prueba (correo con +prueba)' };
  }
  return {
    raiz: { status: raiz.status, rutas: rutasRaiz },
    muro: { tipo: tipo(empresa.cuerpo && empresa.cuerpo.wall_entries), cantidad: entradas.length, entradas: muro },
    campos,
    contacto_prueba: contactoPrueba,
    empresa: { status: empresa.status, claves: clavesEmpresa, claves_de_archivos: (clavesEmpresa || []).filter((k) => /file|document|attach|archivo/i.test(k)) },
    rutas
  };
}

export default async function handler(req, res) {
  if (!validarCron(req, res)) return;
  let contexto;
  try {
    contexto = contextoClientify();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  const { clientify, supabase } = contexto;

  const idEmpresa = String((req.query && req.query.archivos) || '');
  if (/^\d{1,20}$/.test(idEmpresa)) {
    const idContacto = /^\d{1,20}$/.test(String((req.query && req.query.contacto) || '')) ? String(req.query.contacto) : null;
    return res.status(200).json({ entorno: contexto.entorno, archivos: await sondearArchivos(clientify, idEmpresa, idContacto) });
  }

  const catalogos = {};
  for (const [nombre, rutas] of Object.entries(CATALOGOS)) catalogos[nombre] = await probar(clientify, rutas);

  const { lista: listaContactos = [], ...contactos } = await muestra(clientify, '/contacts/?page_size=100');
  const { lista: _oportunidades, ...oportunidades } = await muestra(clientify, '/deals/?page_size=100');
  const idContacto = /^\d{1,20}$/.test(String((req.query && req.query.contacto) || '')) ? String(req.query.contacto) : null;
  contactos.tipo = await campoTipo(clientify, listaContactos, idContacto);

  const { data: eventos } = await supabase.from('webhook_eventos')
    .select('payload, entidad, accion, recibido_at').not('entidad', 'is', null).order('recibido_at', { ascending: false }).limit(3);
  const webhooks = (eventos || []).map((e) => ({
    recibido_at: e.recibido_at, entidad: e.entidad, accion: e.accion,
    interpretado: (({ entidad, accion }) => ({ entidad, accion }))(interpretarWebhook(e.payload)),
    estructura: estructura(e.payload)
  }));

  return res.status(200).json({ entorno: contexto.entorno, catalogos, contactos, oportunidades, webhooks });
}
