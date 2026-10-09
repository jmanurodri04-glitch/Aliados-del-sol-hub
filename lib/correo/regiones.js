// Buzón que recibe el MEDDPICC de un referido según su ciudad (decisión del equipo, oct 2026; CLAUDE.md §7).
//
// Se usa solo la ciudad que se escribió al referir la empresa (nunca la regional del aliado). Primero se busca la
// ciudad; si no se reconoce, el departamento. Si no se reconoce ninguno o es de otra zona, va al buzón general.
//
// ESTA LISTA SE PUEDE AMPLIAR: agrega ciudades o departamentos en minúscula y sin tildes. Para cambiar un buzón,
// cambia `buzon`. Las pruebas están en tests/correo/correo.test.js.

export const BUZON_GENERAL = 'c.lizarazo@geenera.com';

export const REGIONES = [
  {
    id: 'costa',
    nombre: 'Costa',
    buzon: 'd.ariza@geenera.com',
    departamentos: ['atlantico', 'bolivar', 'magdalena', 'cesar', 'la guajira', 'guajira', 'cordoba', 'sucre',
      'san andres', 'archipielago de san andres'],
    ciudades: ['barranquilla', 'soledad', 'malambo', 'puerto colombia', 'sabanalarga', 'galapa', 'baranoa',
      'cartagena', 'turbaco', 'arjona', 'magangue', 'santa marta', 'cienaga', 'fundacion', 'valledupar', 'aguachica',
      'riohacha', 'maicao', 'monteria', 'cerete', 'lorica', 'sahagun', 'sincelejo', 'corozal', 'tolu']
  },
  {
    id: 'oriente',
    nombre: 'Oriente',
    buzon: 'h.zambrano@geenera.com',
    departamentos: ['santander', 'norte de santander'],
    ciudades: ['bucaramanga', 'floridablanca', 'giron', 'piedecuesta', 'barrancabermeja', 'san gil', 'socorro',
      'cucuta', 'villa del rosario', 'los patios', 'pamplona', 'ocana']
  },
  {
    id: 'centro',
    nombre: 'Centro',
    buzon: 'c.buitrago@geenera.com',
    departamentos: ['bogota', 'cundinamarca', 'boyaca', 'tolima', 'meta', 'huila'],
    ciudades: ['bogota', 'soacha', 'chia', 'zipaquira', 'facatativa', 'fusagasuga', 'mosquera', 'madrid', 'funza',
      'cajica', 'cota', 'tocancipa', 'sopo', 'la calera', 'girardot', 'tunja', 'duitama', 'sogamoso', 'paipa',
      'chiquinquira', 'ibague', 'espinal', 'melgar', 'honda', 'villavicencio', 'acacias', 'puerto lopez',
      'neiva', 'pitalito', 'garzon', 'la plata']
  }
];

/** Minúsculas, sin tildes y solo letras separadas por un espacio. */
export function normalizarLugar(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z]+/g, ' ').trim();
}

// Busca el nombre más largo que aparezca como palabras completas (así «norte de santander» gana a «santander»).
function buscar(texto, campo) {
  const t = ` ${texto} `;
  let mejor = null;
  for (const region of REGIONES) {
    for (const nombre of region[campo]) {
      if (t.includes(` ${nombre} `) && (!mejor || nombre.length > mejor.nombre.length)) mejor = { region, nombre };
    }
  }
  return mejor && mejor.region;
}

/**
 * Regional y buzón del MEDDPICC para la ciudad escrita al referir.
 * @returns {{ region: 'costa'|'oriente'|'centro'|null, nombre: string, buzon: string }}
 */
export function buzonMeddpicc(ciudad) {
  const texto = normalizarLugar(ciudad);
  const region = texto ? (buscar(texto, 'ciudades') || buscar(texto, 'departamentos')) : null;
  return region
    ? { region: region.id, nombre: region.nombre, buzon: region.buzon }
    : { region: null, nombre: 'Otra', buzon: BUZON_GENERAL };
}
