// Comparador de propuestas (Herramientas del Hub, con sesión; decisión del equipo, 16 oct 2026; CLAUDE.md §7.6).
//
// Es el ÚNICO lugar con los campos del comparador (los del Excel «Cuadro comparativo de propuestas», sin «Marca
// estructura solar» ni «Forma de pago»), sus ayudas para el llenado manual (diccionario del comparador) y las reglas
// con que se llena una propuesta traída del Cotizador Solar. Lo usa ADSComparador.dc.html (por window.ADS_COMPARADOR,
// que publica js/cotizador.js) y lo prueban los tests de Node. Funciones puras: no tocan el DOM ni la red.
//
// Una propuesta es { origen: 'manual' | 'cotizador', valores: { [campo]: valor } }. Los valores de los campos
// numéricos son números (o null = «Pendiente por definir»: nunca se usa cero para un dato que falta); los de
// opción, el texto de la opción; los de garantía y servicio, objetos (ver CAMPOS). Las comparaciones no se guardan.

export const MAX_PROPUESTAS = 4;
export const DC_AC = 1.3; // relación DC/AC de un sistema ON GRID (decisión del equipo: 1,2 a 1,3; se divide entre 1,3)
export const INVERSORES_HUAWEI = [2, 3, 4, 5, 6, 8, 10, 20, 30, 36, 40, 50, 80, 100, 150]; // kW AC por unidad
export const DEPENDE = 'Depende del usuario';
export const PENDIENTE = 'Pendiente por definir';

/**
 * Ciudades costeras del cotizador (estructura de aluminio; las demás, acero). Lista aprobada por el equipo el 16 oct
 * 2026: la región «Costa» de los precios no sirve porque incluye ciudades lejos del mar. Clave «Ciudad|Departamento»,
 * la misma de CITIES en js/cotizador-calculo.js.
 */
export const CIUDADES_COSTERAS = new Set([
  'Barranquilla|Atlántico', 'Puerto Colombia|Atlántico', 'Soledad|Atlántico', 'Malambo|Atlántico', 'Galapa|Atlántico',
  'Cartagena|Bolívar', 'Turbaco|Bolívar', 'Santa Marta|Magdalena', 'Ciénaga|Magdalena',
  'Riohacha|La Guajira', 'Manaure|La Guajira', 'Uribia|La Guajira', 'Maicao|La Guajira',
  'Santiago de Tolú|Sucre', 'Coveñas|Sucre', 'San Andrés|San Andrés y Providencia', 'Providencia|San Andrés y Providencia',
  'Turbo|Antioquia', 'Necoclí|Antioquia', 'Apartadó|Antioquia', 'Carepa|Antioquia', 'Bahía Solano|Chocó',
  'Buenaventura|Valle del Cauca', 'Tumaco|Nariño'
]);
export const esCiudadCostera = (ciudad, departamento) => CIUDADES_COSTERAS.has(String(ciudad || '') + '|' + String(departamento || ''));

const SERVICIO = ['Sí, incluido', 'No incluido', 'Opcional con costo', PENDIENTE, 'No aplica'];
const GARANTIA = ['Sí', 'No', PENDIENTE];

/**
 * Campos en el orden del Excel. tipo:
 *   texto · numero (unidad fija; inversión con moneda) · calculado · opcion (lista; «Otro» abre un texto) ·
 *   garantia ({ estado: Sí | No | Pendiente, plazo, unidad: años | meses }) · servicio ({ estado, anios? }).
 * ej y ayuda: lo que muestra el llenado manual (diccionario del comparador).
 */
export const SECCIONES = [
  { id: 'inversion', titulo: 'Inversión', campos: [
    { id: 'oferente', label: 'Oferente', tipo: 'texto', ej: 'Ej.: GEENERA', ayuda: 'Empresa que presenta la propuesta.' },
    { id: 'inversion', label: 'Inversión IVA incluido', tipo: 'numero', unidad: 'COP', moneda: true, ej: 'Ej.: 100.000.000', ayuda: 'Valor total ofertado, con el IVA que corresponda. Las exclusiones van en Notas.' }
  ] },
  { id: 'tecnicas', titulo: 'Características técnicas', campos: [
    { id: 'potencia', label: 'Total potencia instalada', tipo: 'numero', unidad: 'kWp', decimales: 2, ej: 'Ej.: 20,35', ayuda: 'Potencia pico total de los paneles (DC).' },
    { id: 'consumo_anual', label: 'Consumo anual', tipo: 'numero', unidad: 'kWh/año', ej: 'Ej.: 36.000', ayuda: 'Usa el mismo consumo en todas las propuestas.' },
    { id: 'generacion_anual', label: 'Generación anual del sistema', tipo: 'numero', unidad: 'kWh/año', ej: 'Ej.: 30.000', ayuda: 'Generación estimada en un año.' },
    { id: 'generacion_mensual', label: 'Generación mensual del sistema', tipo: 'calculado', unidad: 'kWh/mes', ayuda: 'Generación anual ÷ 12. Es un promedio; cada mes varía.' },
    { id: 'suplencia', label: 'Porcentaje de suplencia del sistema solar', tipo: 'calculado', unidad: '%', ayuda: 'Generación anual ÷ consumo anual × 100. Puede pasar de 100 % y no es el ahorro en la factura.' }
  ] },
  { id: 'economica', titulo: 'Evaluación económica', campos: [
    { id: 'costo_kwp', label: 'Costo por kWp instalado', tipo: 'calculado', unidad: '/kWp', ayuda: 'Inversión ÷ potencia instalada. Solo se compara entre propuestas de la misma moneda.' }
  ] },
  { id: 'tecnologia', titulo: 'Evaluación de la tecnología', campos: [
    { id: 'marca_panel', label: 'Marca panel solar', tipo: 'opcion', opciones: ['JA Solar', 'Autosolar', 'Otro'], ayuda: 'Fabricante (y modelo, si lo conoces).' },
    { id: 'potencia_panel', label: 'Potencia panel solar', tipo: 'numero', unidad: 'Wp', ej: 'Ej.: 550', ayuda: 'Potencia nominal de la ficha técnica.' },
    { id: 'marca_inversor', label: 'Marca inversor o microinversor', tipo: 'opcion', opciones: ['Huawei', 'Growatt', 'Sungrow', 'Otro'] },
    { id: 'potencia_inversor', label: 'Potencia inversor solar', tipo: 'numero', unidad: 'kW AC', decimales: 1, ej: 'Ej.: 10', ayuda: 'Potencia de salida AC de una unidad.' },
    { id: 'num_paneles', label: 'Número de paneles solares', tipo: 'numero', unidad: 'unidades', entero: true, ej: 'Ej.: 40' },
    { id: 'num_inversores', label: 'Número de inversores', tipo: 'numero', unidad: 'unidades', entero: true, ej: 'Ej.: 2', ayuda: 'Unidades físicas, incluidos los microinversores.' },
    { id: 'estructura', label: 'Tipo de estructura solar', tipo: 'opcion', opciones: ['Aluminio', 'Acero', 'Acero galvanizado', 'Mixto', 'Otro'], ayuda: 'Material de la estructura.' },
    { id: 'garantia_paneles', label: 'Garantía paneles solares', tipo: 'garantia', ayuda: 'Distingue la garantía del producto de la de desempeño (potencia).' },
    { id: 'garantia_inversores', label: 'Garantía inversores', tipo: 'garantia', ayuda: 'La incluida en el precio; las extensiones opcionales van en Notas.' },
    { id: 'garantia_estructura', label: 'Garantía estructura solar', tipo: 'garantia' }
  ] },
  { id: 'general', titulo: 'Evaluación general de las propuestas', campos: [
    { id: 'retie', label: 'Certificación RETIE', tipo: 'servicio', ayuda: '«Incluida» no significa que ya esté aprobada.' },
    { id: 'operador_red', label: 'Legalización ante el operador de red', tipo: 'servicio' },
    { id: 'comercializador', label: 'Legalización ante el comercializador de energía', tipo: 'servicio' },
    { id: 'upme', label: 'Trámite de beneficios tributarios UPME', tipo: 'servicio', ayuda: 'El acompañamiento al trámite no garantiza la aprobación del beneficio.' },
    { id: 'anclaje', label: 'Puntos de anclaje sobre cubiertas', tipo: 'servicio' },
    { id: 'polizas', label: 'Pólizas de cumplimiento', tipo: 'servicio' },
    { id: 'modalidad', label: 'Modalidad de la propuesta', tipo: 'opcion', opciones: ['EPC', 'Solo suministro', 'Otra'] },
    { id: 'mantenimiento', label: 'Mantenimiento', tipo: 'servicio', duracion: true },
    { id: 'monitoreo', label: 'Monitoreo remoto', tipo: 'servicio', duracion: true },
    { id: 'notas', label: 'Notas', tipo: 'texto', largo: true, ej: 'Exclusiones, forma de pago u otras condiciones' }
  ] }
];
export const CAMPOS = SECCIONES.flatMap((s) => s.campos);
export const campo = (id) => CAMPOS.find((c) => c.id === id) || null;
export const OPCIONES_SERVICIO = SERVICIO;
export const OPCIONES_GARANTIA = GARANTIA;

const finito = (v) => typeof v === 'number' && isFinite(v);
const nf = (n, d = 0) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(n);

/**
 * Número escrito a mano, o null si está vacío o no es válido. Formato colombiano: punto de miles y coma decimal
 * («100.000.000», «20,35»). Sin coma, un punto seguido de 1, 2 o más de 3 cifras se toma como decimal («20.35»).
 */
export function leerNumero(texto) {
  const s = String(texto == null ? '' : texto).trim().replace(/[\s$'’]/g, '');
  if (!s || !/^[\d.,]+$/.test(s)) return null;
  let limpio;
  if (s.includes(',')) limpio = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) limpio = s.replace(/\./g, '');
  else limpio = s;
  const n = Number(limpio);
  return isFinite(n) && n >= 0 ? n : null;
}

// Regla del punto medio: entre dos tamaños, si supera la mitad se toma el mayor; si no, el menor.
function tamanoPorPuntoMedio(p) {
  const S = INVERSORES_HUAWEI;
  if (p <= S[0]) return S[0];
  if (p >= S[S.length - 1]) return S[S.length - 1];
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1];
    if (p > a && p <= b) return p > (a + b) / 2 ? b : a;
  }
  return S[S.length - 1];
}

/**
 * Inversores Huawei para un sistema ON GRID (decisión del equipo, 16 oct 2026):
 *   1. potencia objetivo AC = kWp de paneles ÷ 1,3;
 *   2. hasta 150 kW: un inversor por la regla del punto medio; si queda a más del 10 % del objetivo, se prueba con
 *      dos inversores cuya suma quede más cerca (15 → 10 + 5);
 *   3. más de 150 kW: tantos de 150 como quepan y, si el resto es al menos el 5 % del total, uno más por el punto medio.
 * Devuelve { unidades: [kW, …] (de mayor a menor), total, objetivo } o null si no hay potencia.
 */
export function inversoresOnGrid(kwp) {
  if (!finito(kwp) || kwp <= 0) return null;
  const objetivo = kwp / DC_AC, S = INVERSORES_HUAWEI, max = S[S.length - 1];
  let unidades;
  if (objetivo <= max) {
    const uno = tamanoPorPuntoMedio(objetivo);
    unidades = [uno];
    if (Math.abs(uno - objetivo) / objetivo > 0.1) {
      let mejor = null;
      for (const a of S) for (const b of S) {
        if (b > a) continue;
        const e = Math.abs(a + b - objetivo);
        if (!mejor || e < mejor.e - 1e-9) mejor = { a, b, e };
      }
      if (mejor && mejor.e < Math.abs(uno - objetivo)) unidades = [mejor.a, mejor.b];
    }
  } else {
    const n = Math.floor(objetivo / max), resto = objetivo - n * max;
    unidades = Array(n).fill(max);
    if (resto / objetivo >= 0.05) unidades.push(tamanoPorPuntoMedio(resto));
  }
  unidades.sort((x, y) => y - x);
  return { unidades, total: unidades.reduce((s, u) => s + u, 0), objetivo };
}

/**
 * Propuesta llena con una cotización del Cotizador Solar (la fila que devuelve /api/cotizador accion
 * 'mis_cotizaciones'). Reglas del equipo (16 oct 2026): equipos JA Solar 615 Wp e inversor Huawei, estructura por
 * ciudad, garantías 30/5/25 años, trámites incluidos, sin anclajes, con pólizas, EPC y 1 año de mantenimiento y
 * monitoreo. Un sistema OFF GRID (no conectado a la red) deja la potencia y el número de inversores en «Depende del
 * usuario»; uno conectado a la red con baterías usa la regla ON GRID.
 */
export function propuestaDesdeCotizacion(cot) {
  if (!cot || typeof cot !== 'object') return null;
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const potencia = num(cot.potencia_kwp), consumoMes = num(cot.consumo_kwh_mes), genMes = num(cot.generacion_kwh_mes);
  const ongrid = cot.conectado_red !== false;
  const inv = ongrid ? inversoresOnGrid(potencia) : null;
  const incluida = { estado: 'Incluida' };
  return {
    origen: 'cotizador',
    cotizacion: { id: cot.id, segmento: cot.segmento, nombre: cot.nombre },
    valores: {
      oferente: 'GEENERA',
      inversion: num(cot.inversion_total_cop), moneda: 'COP',
      potencia,
      consumo_anual: finito(consumoMes) ? consumoMes * 12 : null,
      generacion_anual: finito(genMes) ? genMes * 12 : null,
      marca_panel: 'JA Solar',
      potencia_panel: 615,
      marca_inversor: 'Inversor Huawei',
      potencia_inversor: inv ? { unidades: inv.unidades, total: inv.total } : (ongrid ? null : DEPENDE),
      num_paneles: num(cot.modulos),
      num_inversores: inv ? inv.unidades.length : (ongrid ? null : DEPENDE),
      estructura: esCiudadCostera(cot.ciudad, cot.departamento) ? 'Aluminio' : 'Acero',
      garantia_paneles: { estado: 'Sí', plazo: 30, unidad: 'años', nota: 'de potencia' },
      garantia_inversores: { estado: 'Sí', plazo: 5, unidad: 'años' },
      garantia_estructura: { estado: 'Sí', plazo: 25, unidad: 'años' },
      retie: incluida, operador_red: incluida, comercializador: incluida, upme: incluida,
      anclaje: { estado: 'No' },
      polizas: { estado: 'Sí' },
      modalidad: 'EPC',
      mantenimiento: { estado: 'Sí, incluido', anios: 1 },
      monitoreo: { estado: 'Sí, incluido', anios: 1 },
      notas: ''
    }
  };
}

/** Propuesta manual vacía (todo «Pendiente por definir» hasta que se llene). */
export const propuestaManual = () => ({ origen: 'manual', valores: { moneda: 'COP' } });

/** Campos calculados de una propuesta: { generacion_mensual, suplencia, costo_kwp } (null si falta un dato). */
export function calculados(valores = {}) {
  const gen = valores.generacion_anual, consumo = valores.consumo_anual, inv = valores.inversion, kwp = valores.potencia;
  return {
    generacion_mensual: finito(gen) ? gen / 12 : null,
    suplencia: finito(gen) && finito(consumo) && consumo > 0 ? (gen / consumo) * 100 : null,
    costo_kwp: finito(inv) && finito(kwp) && kwp > 0 ? inv / kwp : null
  };
}

const plazoTxt = (p, u) => nf(p) + ' ' + (u === 'meses' ? (p === 1 ? 'mes' : 'meses') : (p === 1 ? 'año' : 'años'));

/** Texto que muestra la tabla para un campo de una propuesta. */
export function mostrar(id, valores = {}) {
  const c = campo(id);
  if (!c) return '';
  const calc = calculados(valores);
  const v = c.tipo === 'calculado' ? calc[id] : valores[id];
  if (v === DEPENDE) return DEPENDE;
  if (c.tipo === 'calculado') {
    if (!finito(v)) return 'Pendiente de cálculo';
    if (id === 'suplencia') return nf(v, 1) + ' %';
    if (id === 'costo_kwp') return '$' + nf(Math.round(v)) + ' ' + (valores.moneda || 'COP') + '/kWp';
    return nf(Math.round(v)) + ' ' + c.unidad;
  }
  if (c.tipo === 'numero') {
    if (id === 'potencia_inversor' && v && typeof v === 'object') {
      return v.unidades.length > 1 ? v.unidades.join(' + ') + ' kW (' + nf(v.total) + ' kW en total)' : nf(v.unidades[0]) + ' kW';
    }
    if (!finito(v)) return PENDIENTE;
    if (c.moneda) return '$' + nf(Math.round(v)) + ' ' + (valores.moneda || 'COP');
    return nf(v, c.entero ? 0 : (c.decimales || 0)) + ' ' + (c.unidad === 'unidades' && v === 1 ? 'unidad' : c.unidad);
  }
  if (c.tipo === 'opcion') {
    if (!v) return PENDIENTE;
    return (v === 'Otro' || v === 'Otra') && valores[id + '_otro'] ? valores[id + '_otro'] : v;
  }
  if (c.tipo === 'garantia') {
    if (!v || !v.estado || v.estado === PENDIENTE) return PENDIENTE;
    if (v.estado !== 'Sí') return v.estado;
    if (!finito(v.plazo)) return 'Garantía ofrecida; detalle pendiente';
    return plazoTxt(v.plazo, v.unidad) + (v.nota ? ' (' + v.nota + ')' : '');
  }
  if (c.tipo === 'servicio') {
    if (!v || !v.estado) return PENDIENTE;
    if (c.duracion && finito(v.anios) && v.estado !== 'No incluido' && v.estado !== 'No aplica') return plazoTxt(v.anios, 'años');
    return v.estado;
  }
  return v ? String(v) : (c.largo ? '' : PENDIENTE);
}

/**
 * Columnas (índices) con el mejor valor de cada fila comparable: menor costo por kWp (misma moneda), mayor suplencia y
 * garantías más largas. Solo cuando hay al menos dos propuestas con el dato. { [campo]: Set de índices }.
 */
export function mejores(propuestas = []) {
  const out = {};
  const marcar = (id, valor, mayor) => {
    const datos = propuestas.map((p, i) => [i, valor(p ? p.valores || {} : {})]).filter(([, x]) => finito(x));
    if (datos.length < 2) return;
    const meta = mayor ? Math.max(...datos.map(([, x]) => x)) : Math.min(...datos.map(([, x]) => x));
    if (datos.every(([, x]) => x === meta)) return;
    out[id] = new Set(datos.filter(([, x]) => x === meta).map(([i]) => i));
  };
  const monedas = new Set(propuestas.filter(Boolean).map((p) => (p.valores && p.valores.moneda) || 'COP'));
  if (monedas.size === 1) marcar('costo_kwp', (v) => calculados(v).costo_kwp, false);
  marcar('suplencia', (v) => calculados(v).suplencia, true);
  const meses = (g) => (g && g.estado === 'Sí' && finito(g.plazo) ? g.plazo * (g.unidad === 'meses' ? 1 : 12) : null);
  for (const id of ['garantia_paneles', 'garantia_inversores', 'garantia_estructura']) marcar(id, (v) => meses(v[id]), true);
  return out;
}
