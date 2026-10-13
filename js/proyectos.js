// «Casos y proyectos» (Herramientas): lee los proyectos que el equipo carga en WordPress (geenera.com) y los entrega
// a la página con el formato del Hub. WordPress sigue siendo el dueño del contenido: el Hub solo lee su API pública
// (tipo de contenido `cpt-proyectos` de JetEngine, con sus campos publicados en la API) y no guarda nada.
// La página pide los datos con `ads:proyectos-cargar` y los recibe en `ads:proyectos { ok, proyectos, mensaje? }`.
// Google Maps solo se ofrece en los proyectos que tienen QR o coordenadas cargados (el cliente lo autorizó); la
// dirección se muestra siempre (decisiones del equipo, oct 2026). Maps abre en vista satélite: con el campo `c-coordenadas`
// («lat, lng») el enlace centra el mapa en el proyecto, que también respeta el satélite en la app del celular; sin él,
// busca la dirección. Un proyecto es residencial si su título tiene la palabra «Casa».

export const WP_API = 'https://geenera.com/wp-json/wp/v2';
const POR_PAGINA = 100;
const MAX_PAGINAS = 10;
const CACHE_CLAVE = 'ads-proyectos-v2';
const CACHE_MS = 10 * 60 * 1000;

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };

// Texto plano a partir del HTML que entrega WordPress (títulos y descripciones).
export function textoPlano(html) {
  return String(html == null ? '' : html)
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Las cifras llegan escritas a mano: «74,58», «28.83», «30731,206», «76044183», «1.035». Devuelve un número o null.
// Con punto y coma, el último es el decimal. Un solo separador seguido de exactamente 3 dígitos en un campo entero
// es de miles; en los demás casos, la coma y el punto son decimales.
export function numero(valor, entero = false) {
  let t = String(valor == null ? '' : valor).replace(/[^\d.,-]/g, '');
  if (!/\d/.test(t)) return null;
  const coma = t.lastIndexOf(','), punto = t.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) {
    const dec = coma > punto ? ',' : '.';
    t = t.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (coma >= 0 || punto >= 0) {
    const sep = coma >= 0 ? ',' : '.';
    const partes = t.split(sep);
    const miles = partes.length > 2 || (entero && partes[partes.length - 1].length === 3);
    t = miles ? partes.join('') : partes.slice(0, -1).join('') + '.' + partes[partes.length - 1];
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const ids = (v) => (Array.isArray(v) ? v : String(v == null ? '' : v).split(','))
  .map(x => parseInt(typeof x === 'object' && x ? x.id : x, 10)).filter(n => n > 0);

function urlDe(media, tamano) {
  if (!media) return null;
  const s = media.media_details && media.media_details.sizes;
  const t = s && (tamano.map(k => s[k]).find(Boolean));
  return (t && t.source_url) || media.source_url || null;
}

// «4.8133, -75.6961», «4,8133; -75,6961» o un enlace de Google Maps con «@lat,lng». Devuelve { lat, lng } o null.
export function coordenadas(valor) {
  const t = String(valor == null ? '' : valor).trim();
  const m = t.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) || t.match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1].replace(',', '.')), lng = Number(m[2].replace(',', '.'));
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export const esResidencial = (titulo) => /(^|[^a-z0-9áéíóúñü])casa([^a-z0-9áéíóúñü]|$)/i.test(String(titulo || ''));

// Enlace de Google Maps en vista satélite.
export function enlaceMaps(coords, ubicacion) {
  if (coords) return 'https://www.google.com/maps/@?api=1&map_action=map&center=' + coords.lat + ',' + coords.lng + '&zoom=19&basemap=satellite';
  return ubicacion ? 'https://maps.google.com/maps?t=k&q=' + encodeURIComponent(ubicacion) : null;
}

// Convierte un proyecto de la API y su biblioteca de medios (Map id → media) a la forma que usa la página.
export function normalizarProyecto(p, medios = new Map()) {
  const m = p.meta || {};
  const grande = ['large', 'medium_large', '1536x1536', 'full'];
  const fotos = ids(m['c-imagenes-del-proyecto']).concat(ids(p.featured_media))
    .filter((id, i, a) => a.indexOf(id) === i).map(id => urlDe(medios.get(id), grande)).filter(Boolean);
  const qrId = ids(m['c-codigo-qr'])[0];
  const video = String(m['c-video-testimonio'] || '').trim();
  const videoId = /^\d+$/.test(video) ? parseInt(video, 10) : 0;
  const titulo = textoPlano(p.title && p.title.rendered);
  const ubicacion = textoPlano(m['c-ubicacion-del-proyecto']).replace(/\s+/g, ' ');
  const coords = coordenadas(m['c-coordenadas']);
  return {
    id: p.id,
    titulo,
    residencial: esResidencial(titulo),
    enlace: p.link || null,
    fecha: p.date || null,
    descripcion: textoPlano(m['c-descripcion-del-proyecto']),
    ubicacion,
    coordenadas: coords,
    maps: enlaceMaps(coords, ubicacion),
    kwp: numero(m['c-tamano-del-sistema']),
    paneles: numero(m['c-paneles-instalados'], true),
    co2Kg: numero(m['c-c02-ahorrados']),
    ahorroCop: numero(m['c-ahorros-generados'], true),
    arboles: numero(m['c-cantidad-de-arboles'], true),
    portada: fotos[0] || null,
    fotos,
    logo: urlDe(medios.get(ids(m['c-logo-proyecto'])[0]), ['medium', 'full']),
    qr: qrId ? urlDe(medios.get(qrId), ['medium_large', 'large', 'full']) : null,
    testimonio: textoPlano(m['c-texto-testimonio']),
    video: videoId ? urlDe(medios.get(videoId), []) : (/^https?:\/\//i.test(video) ? video : null)
  };
}

// Ids de medios que necesita cada proyecto (foto destacada, galería, logo, QR y video subido).
export function idsDeMedios(proyectos) {
  const todos = new Set();
  for (const p of proyectos) {
    const m = p.meta || {};
    [p.featured_media, m['c-imagenes-del-proyecto'], m['c-logo-proyecto'], m['c-codigo-qr']].forEach(v => ids(v).forEach(id => todos.add(id)));
    if (/^\d+$/.test(String(m['c-video-testimonio'] || '').trim())) todos.add(parseInt(m['c-video-testimonio'], 10));
  }
  return [...todos];
}

async function leerTodo(url, f) {
  const lista = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const r = await f(url + (url.includes('?') ? '&' : '?') + 'per_page=' + POR_PAGINA + '&page=' + pagina, { headers: { accept: 'application/json' } });
    if (r.status === 400 && pagina > 1) break; // WordPress responde 400 al pedir una página que no existe
    if (!r.ok) throw new Error('wordpress_' + r.status);
    const datos = await r.json();
    if (!Array.isArray(datos)) throw new Error('wordpress_formato');
    lista.push(...datos);
    const total = parseInt(r.headers.get('x-wp-totalpages') || '0', 10);
    if (datos.length < POR_PAGINA || (total && pagina >= total)) break;
  }
  return lista;
}

export async function cargarProyectos(f = fetch) {
  const crudos = await leerTodo(WP_API + '/cpt-proyectos?status=publish&_fields=id,date,link,title,featured_media,meta', f);
  const pedir = idsDeMedios(crudos);
  const medios = new Map();
  for (let i = 0; i < pedir.length; i += POR_PAGINA) {
    const lote = pedir.slice(i, i + POR_PAGINA);
    (await leerTodo(WP_API + '/media?include=' + lote.join(',') + '&_fields=id,source_url,media_details', f)).forEach(x => medios.set(x.id, x));
  }
  return crudos.map(p => normalizarProyecto(p, medios)).filter(p => p.titulo);
}

if (typeof window !== 'undefined') {
  let enCurso = null;
  const cache = () => { try { const c = JSON.parse(sessionStorage.getItem(CACHE_CLAVE) || 'null'); return c && Date.now() - c.at < CACHE_MS ? c.proyectos : null; } catch { return null; } };
  const responder = (detail) => window.dispatchEvent(new CustomEvent('ads:proyectos', { detail }));
  window.addEventListener('ads:proyectos-cargar', () => {
    const guardados = cache();
    if (guardados) return responder({ ok: true, proyectos: guardados });
    if (!enCurso) enCurso = cargarProyectos().then(proyectos => {
      try { sessionStorage.setItem(CACHE_CLAVE, JSON.stringify({ at: Date.now(), proyectos })); } catch { /* sin almacenamiento */ }
      responder({ ok: true, proyectos });
    }).catch(() => responder({ ok: false, mensaje: 'No pudimos cargar los proyectos. Intenta de nuevo en unos minutos.' }))
      .finally(() => { enCurso = null; });
  });
}
