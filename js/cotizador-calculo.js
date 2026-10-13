// Motor de cálculo del Cotizador Solar (diseño «Cotizador Aliados del Sol v5», oct 2026).
//
// Es el ÚNICO lugar con las fórmulas y las listas del cotizador. Lo usan:
//   - el navegador: js/cotizador.js lo publica en window.ADS_COTIZADOR para el componente ADSCotizador.dc.html;
//   - el servidor: /api/cotizador vuelve a calcular con estas mismas funciones antes de guardar la simulación,
//     para que las tablas de análisis no reciban cifras alteradas desde el navegador.
// Las fórmulas, tarifas, precios, ciudades y subsectores son los del diseño, sin cambios: el resultado depende de
// la ciudad (región) y del subsector, por eso las listas se dejan como están (decisión del equipo).
// Funciones puras: no tocan el DOM ni la red.

export const HSP = 4.5, PANEL_WP = 615, PR = 0.78, CO2 = 0.164, MOD_W = 2.28, MOD_D = 1.13;
export const TARIFA = { hogar: 870, industria: 690 };
export const REG = { C: { n: 'Costa', pw: 3408, pwRes: 6200 }, N: { n: 'Centro', pw: 3451, pwRes: 6300 }, O: { n: 'Oriente', pw: 3545, pwRes: 6000 } };
export const BAT_PRICE = 6e6;

/** Límites del consumo (decisión del equipo): mínimo 40 kWh/mes o una factura de $27.600/mes. */
export const MINIMO_KWH = 40;
export const MINIMO_COP = 27600;
// Topes de cordura para no guardar cifras absurdas (no son reglas comerciales).
export const MAXIMO_KWH = 10000000;
export const MAXIMO_COP = 10000000000;

const CITY_SRC = [
  ['C', 'Atlántico', 'Barranquilla,Soledad,Malambo,Sabanalarga,Puerto Colombia,Galapa,Baranoa,Santo Tomás'],
  ['C', 'Bolívar', 'Cartagena,Magangué,Turbaco,El Carmen de Bolívar,Arjona,Mompox,San Juan Nepomuceno'],
  ['C', 'Magdalena', 'Santa Marta,Ciénaga,Fundación,El Banco,Plato,Aracataca'],
  ['C', 'Cesar', 'Valledupar,Aguachica,Agustín Codazzi,Bosconia,La Jagua de Ibirico,Curumaní'],
  ['C', 'La Guajira', 'Riohacha,Maicao,Uribia,San Juan del Cesar,Fonseca,Manaure,Villanueva'],
  ['C', 'Córdoba', 'Montería,Cereté,Lorica,Sahagún,Planeta Rica,Montelíbano,Tierralta'],
  ['C', 'Sucre', 'Sincelejo,Corozal,San Marcos,Santiago de Tolú,Sampués,Coveñas'],
  ['C', 'San Andrés y Providencia', 'San Andrés,Providencia'],
  ['C', 'Chocó', 'Quibdó,Istmina,Bahía Solano'],
  ['C', 'Antioquia', 'Apartadó,Turbo,Necoclí,Carepa,Chigorodó'],
  ['N', 'Bogotá D.C.', 'Bogotá'],
  ['N', 'Cundinamarca', 'Soacha,Zipaquirá,Facatativá,Chía,Fusagasugá,Girardot,Mosquera,Madrid,Funza,Cajicá,Tocancipá,Sopó,La Calera,Cota,Villeta,Ubaté,Tenjo,Gachancipá'],
  ['N', 'Antioquia', 'Medellín,Bello,Itagüí,Envigado,Sabaneta,Rionegro,La Estrella,Caldas,Copacabana,Girardota,Marinilla,La Ceja,El Carmen de Viboral,Guarne,Caucasia,Puerto Berrío,Santa Fe de Antioquia,Yarumal'],
  ['N', 'Caldas', 'Manizales,La Dorada,Chinchiná,Villamaría,Riosucio,Anserma'],
  ['N', 'Risaralda', 'Pereira,Dosquebradas,Santa Rosa de Cabal,La Virginia'],
  ['N', 'Quindío', 'Armenia,Calarcá,Montenegro,La Tebaida,Quimbaya,Circasia'],
  ['N', 'Tolima', 'Ibagué,Espinal,Honda,Melgar,Mariquita,Chaparral,Líbano,Flandes'],
  ['N', 'Huila', 'Neiva,Pitalito,Garzón,La Plata,Campoalegre'],
  ['N', 'Valle del Cauca', 'Cali,Palmira,Buenaventura,Tuluá,Cartago,Buga,Jamundí,Yumbo,Candelaria,Florida,Sevilla,Zarzal,Roldanillo,El Cerrito'],
  ['N', 'Cauca', 'Popayán,Santander de Quilichao,Puerto Tejada,Patía,Piendamó'],
  ['N', 'Nariño', 'Pasto,Tumaco,Ipiales,Túquerres,La Unión'],
  ['N', 'Putumayo', 'Mocoa,Puerto Asís,Orito,Villagarzón'],
  ['N', 'Caquetá', 'Florencia,San Vicente del Caguán'],
  ['N', 'Amazonas', 'Leticia'],
  ['O', 'Santander', 'Bucaramanga,Floridablanca,Girón,Piedecuesta,Barrancabermeja,San Gil,Socorro,Barbosa,Sabana de Torres,Lebrija,Málaga,Puerto Wilches'],
  ['O', 'Norte de Santander', 'Cúcuta,Ocaña,Villa del Rosario,Los Patios,Pamplona,Tibú,El Zulia'],
  ['O', 'Boyacá', 'Tunja,Duitama,Sogamoso,Chiquinquirá,Puerto Boyacá,Paipa,Villa de Leyva,Nobsa,Garagoa,Moniquirá'],
  ['O', 'Meta', 'Villavicencio,Acacías,Granada,Puerto López,Puerto Gaitán,San Martín,Cumaral'],
  ['O', 'Casanare', 'Yopal,Aguazul,Villanueva,Paz de Ariporo,Tauramena,Monterrey'],
  ['O', 'Arauca', 'Arauca,Saravena,Tame,Arauquita'],
  ['O', 'Vichada', 'Puerto Carreño'], ['O', 'Guaviare', 'San José del Guaviare'], ['O', 'Guainía', 'Inírida'], ['O', 'Vaupés', 'Mitú']
];
/** Ciudades del cotizador: id = «Ciudad|Departamento», r = región de precios (C Costa, N Centro, O Oriente). */
export const CITIES = CITY_SRC.flatMap(([r, dep, list]) => list.split(',').map(n => ({ id: n + '|' + dep, label: n, name: n, dep, r })))
  .filter((c, i, a) => a.findIndex(o => o.name === c.name) === i)
  .sort((a, b) => a.label.localeCompare(b.label, 'es'));
export const cityOf = id => CITIES.find(c => c.id === id) || null;

export const SEGMENTOS = [
  { id: 'industrial', eyebrow: 'Empresarial', title: 'Industrial', desc: 'Plantas y bodegas.' },
  { id: 'comercial', eyebrow: 'Empresarial', title: 'Comercial', desc: 'Locales, oficinas y centros comerciales.' },
  { id: 'residencial', eyebrow: 'Hogar', title: 'Residencial', desc: 'Casa con cubierta propia.' }
];
/** Residencial calcula como hogar; comercial e industrial, como industria. */
export const tipoDeSegmento = seg => (seg === 'residencial' ? 'hogar' : seg === 'comercial' || seg === 'industrial' ? 'industria' : null);

export const SUBSECTORES = ['Agroindustria', 'Alimentos y bebidas', 'Autopartes y automotriz', 'Avícola', 'Porcícola', 'Cadena de frío y refrigeración', 'Cemento y materiales de construcción', 'Centros comerciales y retail', 'Centros de datos y tecnología', 'Cerámica y vidrio', 'Construcción', 'Cosméticos y productos de aseo', 'Cuero y calzado', 'Educación', 'Empaques y envases', 'Farmacéutica', 'Floricultura', 'Hotelería y turismo', 'Imprenta y artes gráficas', 'Lácteos', 'Logística y bodegaje', 'Madera y muebles', 'Metalmecánica', 'Minería', 'Oficinas y servicios', 'Papel y cartón', 'Plásticos', 'Química', 'Salud: clínicas y hospitales', 'Siderúrgica', 'Textil y confección', 'Tratamiento de agua'].sort((a, b) => a.localeCompare(b, 'es'));

export const BATS = {
  red: [
    { id: 'none', t: 'Sin baterías', sub: 'Inyectas excedentes a la red y compras en la noche', f: { hogar: 0, industria: 0 } },
    { id: 'respaldo', t: 'Respaldo', sub: 'Cubre cargas críticas durante cortes de energía', f: { hogar: 0.35, industria: 0.12 } },
    { id: 'autonomia', t: 'Autonomía nocturna', sub: 'La energía del día alimenta la noche', f: { hogar: 0.8, industria: 0.35 } }
  ],
  aislado: [
    { id: 'none', t: 'Sin baterías', sub: 'No disponible en sistemas aislados', f: { hogar: 0, industria: 0 }, off: true },
    { id: 'autonomia', t: 'Autonomía de una noche', sub: 'Cubre el consumo desde el atardecer hasta el amanecer', f: { hogar: 0.75, industria: 0.55 } },
    { id: 'extendida', t: 'Autonomía extendida', sub: 'Día y medio de consumo para días nublados', f: { hogar: 1.5, industria: 1.5 } }
  ]
};
/** Opción de almacenamiento elegida (null si no existe o no aplica a la conexión). */
export const bateriaDe = (aislado, id) => (aislado ? BATS.aislado : BATS.red).find(o => o.id === id && !o.off) || null;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const parseNum = v => { const s = String(v || '').replace(/[\s'’]/g, '').replace(/\./g, '').replace(',', '.'); const n = parseFloat(s); return isFinite(n) ? n : null; };

function gridSlots(out, x0, x1, z0, z1, y, px, pz) {
  const nx = Math.floor((x1 - x0 - MOD_W) / px) + 1, nz = Math.floor((z1 - z0 - MOD_D) / pz) + 1;
  if (nx < 1 || nz < 1) return;
  const ox = (x0 + x1) / 2 - (nx - 1) * px / 2, oz = (z0 + z1) / 2 - (nz - 1) * pz / 2;
  for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) out.push([ox + c * px, y, oz + r * pz]);
}

const BACK = { 'Avícola': 'galpones', 'Porcícola': 'corrales', 'Educación': 'cancha', 'Floricultura': 'invernaderos', 'Agroindustria': 'invernaderos', 'Cemento y materiales de construcción': 'silos', 'Minería': 'silos', 'Química': 'tanques', 'Tratamiento de agua': 'tanques', 'Lácteos': 'tanques', 'Alimentos y bebidas': 'tanques' };
/** Edificación del modelo 3D (casa o bodega) y los puestos de módulos en su cubierta. */
export function siteSpec(tipo, kwh, need, sub) {
  const slots = [];
  if (tipo === 'hogar') {
    const m2 = Math.round(clamp(180 + (kwh || 450) * 0.2, 200, 640) / 20) * 20;
    const s = Math.sqrt(m2 / 240);
    const W = 15 * s, D = 10 * s, H1 = 3.3, W2 = 10.5 * s, D2 = 8.6 * s, H2 = 3.1;
    const ux = -(W - W2) / 2 + 0.6, uz = -0.4 * s, top = H1 + 0.3 + H2 + 0.3;
    gridSlots(slots, ux - W2 / 2 + 0.6, ux + W2 / 2 - 0.6, uz - D2 / 2 + 0.6, uz + D2 / 2 - 0.6, top + 0.35, 2.34, 1.5);
    gridSlots(slots, ux + W2 / 2 + 0.7, W / 2 - 0.5, -D / 2 + 0.6, D / 2 - 0.6, H1 + 0.65, 2.34, 1.5);
    const pool = m2 >= 260, wing = m2 >= 420;
    const x0 = -W / 2 - (wing ? 13 : 7), x1 = W / 2 + 9, z0 = -D / 2 - 6, z1 = D / 2 + (pool ? 13 : 9);
    return { tipo, key: 'h' + m2, m2, s, W, D, H1, W2, D2, H2, ux, uz, top, pool, wing, slots, tilt: 10, x0, x1, z0, z1 };
  }
  const area = clamp((need || 200) * 2.32 * 2.6 * 1.3, 1200, 40000);
  const w = Math.max(35, Math.round(Math.sqrt(area * 1.6) / 5) * 5), d = Math.max(25, Math.round(area / w / 5) * 5);
  const h = Math.round(clamp(9 + area / 2500, 9, 15));
  gridSlots(slots, -w / 2 + 2.5, w / 2 - 2.5, -d / 2 + 2.5, d / 2 - 2.5, h + 1.35, 2.32, 2.6);
  const back = BACK[sub] || null, bd = back ? (back === 'cancha' ? 52 : 46) : 10;
  return { tipo, key: 'i' + w + 'x' + d + (sub || ''), sub: sub || '', back, w, d, h, m2: w * d, slots, tilt: 12, x0: -w / 2 - 10, x1: w / 2 + 28, z0: -d / 2 - bd, z1: d / 2 + 30 };
}

/** Un valor en pesos menor a 1.000 se lee en millones («3,5» = $3.500.000), como en el diseño. */
export function copOf(n) { return n < 1000 ? n * 1e6 : n; }
export function kwhOf(st) {
  const n = parseNum(st.valor); if (n == null || n <= 0 || !st.tipo) return null;
  return st.unidad === 'cop' ? copOf(n) / TARIFA[st.tipo] : n;
}
export function pesosOf(st) {
  const n = parseNum(st.valor); return n == null || n <= 0 ? null : copOf(n);
}

/**
 * Error del consumo para mostrar al usuario, o null si es válido. Mínimo 40 kWh/mes o $27.600/mes según la unidad
 * en que lo escribe (decisión del equipo).
 */
export function errorDeConsumo(st) {
  const n = parseNum(st.valor);
  if (n == null || n <= 0) return 'Ingresa el consumo o el valor de la factura.';
  if (st.unidad === 'cop') {
    const cop = copOf(n);
    if (cop < MINIMO_COP) return 'El valor mínimo de la factura es $27.600 al mes.';
    if (cop > MAXIMO_COP) return 'Revisa el valor de la factura.';
    return null;
  }
  if (n < MINIMO_KWH) return 'El consumo mínimo es 40 kWh al mes.';
  if (n > MAXIMO_KWH) return 'Revisa el consumo.';
  return null;
}

/** Diseño del sistema a partir del estado del cotizador ({ tipo, unidad, valor, aislado, bateria, ciudad, subsector }). */
export function calc(st) {
  const tipo = st.tipo || 'industria', raw = st.tipo ? kwhOf(st) : null;
  const valid = raw != null && raw > 0;
  const C = valid ? raw : null;
  const cov = st.aislado ? 1.15 : tipo === 'hogar' ? 0.95 : 0.8;
  const need = C ? Math.ceil(C * cov / (HSP * 30 * PR) * 1000 / PANEL_WP) : 0;
  const spec = siteSpec(tipo, C || (tipo === 'hogar' ? 450 : 18000), need || null, st.subsector);
  const mods = Math.min(need, spec.slots.length);
  const kwp = need * PANEL_WP / 1000, gen = kwp * HSP * 30 * PR, daily = C ? C / 30 : 0;
  const list = st.aislado ? BATS.aislado : BATS.red;
  const b = list.find(o => o.id === st.bateria && !o.off);
  const unit = 5, maxF = kwp <= 2000 ? 1 : kwp <= 5000 ? 0.5 : 0;
  const batReview = !!(b && b.f[tipo] && C && !maxF);
  const units = b && b.f[tipo] && C && maxF ? Math.max(1, Math.ceil(daily * Math.min(b.f[tipo], maxF) / unit)) : 0;
  const bkwh = units * unit;
  const inv = tipo === 'hogar' ? (kwp > 12 ? 2 : 1) : clamp(Math.ceil(kwp / 110), 1, 10);
  const ahorroMes = C ? Math.min(gen, C) * TARIFA[tipo] : 0;
  const city = cityOf(st.ciudad), reg = city ? REG[city.r] : REG.N;
  const capex = (tipo === 'industria' ? kwp * 1000 * reg.pw : kwp * 1000 * reg.pwRes) + units * BAT_PRICE;
  const areaMin = need * MOD_W * MOD_D * (tipo === 'hogar' ? 1.25 : 1.4);
  const crit = daily / 24 * (tipo === 'hogar' ? 0.6 : 0.5);
  return {
    tipo, raw, valid, C, spec, need, mods, reg, areaMin, batReview, maxF, kwp, gen, daily, units, visUnits: Math.min(units, 10), unit, bkwh, inv, ahorroMes, capex,
    payback: ahorroMes ? capex / (ahorroMes * 12) : 0, co2: gen * 12 * CO2 / 1000, cobertura: C ? gen / C : 0,
    capped: need > spec.slots.length, backup: bkwh && crit ? bkwh * 0.9 / crit : 0, aislado: !!st.aislado
  };
}

const redondear = (v, d = 0) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/**
 * Resultados que se guardan de una simulación: los mismos que ve el usuario al conectar el inversor.
 * En un sistema aislado no se muestran el ahorro ni el retorno de la inversión, así que quedan en null.
 */
export function resultadosDe(st) {
  const c = calc(st);
  if (!c.C) return null;
  const pesos = st.unidad === 'cop' ? pesosOf(st) : c.C * TARIFA[c.tipo];
  return {
    consumo_kwh_mes: redondear(c.C, 1),
    valor_factura_cop: redondear(pesos),
    potencia_kwp: redondear(c.kwp, 2),
    modulos: c.need,
    inversores: c.inv,
    generacion_kwh_mes: redondear(c.gen),
    cobertura_pct: redondear(Math.min(1.2, c.cobertura) * 100),
    ahorro_anual_cop: c.aislado ? null : redondear(c.ahorroMes * 12),
    payback_anios: c.aislado ? null : redondear(c.payback, 1),
    co2_t_anio: redondear(c.co2, 2),
    almacenamiento_kwh: c.bkwh,
    area_minima_m2: redondear(c.areaMin),
    inversion_total_cop: redondear(Math.round(c.capex / 1000) * 1000)
  };
}

/* Teléfono: el mismo selector de país y las mismas reglas de los formularios del Hub (PHONE_COUNTRIES y fmtPhone en
   src/Aliados del Sol Hub.dc.html; si cambian allá, se cambian aquí). len = dígitos [mín, máx]; start = primer dígito válido. */
export const PAISES_TELEFONO = [
  { id: 'CO', name: 'Colombia', dial: '57', len: [10, 10], start: '3', groups: [3, 3, 4] },
  { id: 'MX', name: 'México', dial: '52', len: [10, 10], groups: [3, 3, 4] },
  { id: 'US', name: 'EE. UU. / Canadá', dial: '1', len: [10, 10], groups: [3, 3, 4] },
  { id: 'ES', name: 'España', dial: '34', len: [9, 9], start: '67', groups: [3, 3, 3] },
  { id: 'PE', name: 'Perú', dial: '51', len: [9, 9], start: '9', groups: [3, 3, 3] },
  { id: 'EC', name: 'Ecuador', dial: '593', len: [9, 9], start: '9', groups: [2, 3, 4] },
  { id: 'CL', name: 'Chile', dial: '56', len: [9, 9], start: '9', groups: [1, 4, 4] },
  { id: 'AR', name: 'Argentina', dial: '54', len: [10, 11], groups: [3, 3, 5] },
  { id: 'BR', name: 'Brasil', dial: '55', len: [10, 11], groups: [2, 5, 4] },
  { id: 'PA', name: 'Panamá', dial: '507', len: [8, 8], start: '6', groups: [4, 4] },
  { id: 'CR', name: 'Costa Rica', dial: '506', len: [8, 8], groups: [4, 4] },
  { id: 'GT', name: 'Guatemala', dial: '502', len: [8, 8], groups: [4, 4] },
  { id: 'HN', name: 'Honduras', dial: '504', len: [8, 8], start: '389', groups: [4, 4] },
  { id: 'SV', name: 'El Salvador', dial: '503', len: [8, 8], start: '67', groups: [4, 4] },
  { id: 'NI', name: 'Nicaragua', dial: '505', len: [8, 8], start: '578', groups: [4, 4] },
  { id: 'BZ', name: 'Belice', dial: '501', len: [7, 7], start: '6', groups: [3, 4] },
  { id: 'DO', name: 'Rep. Dominicana', dial: '1', len: [10, 10], groups: [3, 3, 4] },
  { id: 'VE', name: 'Venezuela', dial: '58', len: [10, 10], groups: [3, 3, 4] },
  { id: 'BO', name: 'Bolivia', dial: '591', len: [8, 8], groups: [4, 4] },
  { id: 'PY', name: 'Paraguay', dial: '595', len: [9, 9], groups: [3, 3, 3] },
  { id: 'UY', name: 'Uruguay', dial: '598', len: [8, 9], groups: [3, 3, 3] },
  { id: 'PT', name: 'Portugal', dial: '351', len: [9, 9], groups: [3, 3, 3] },
  { id: 'DE', name: 'Alemania', dial: '49', len: [10, 11], groups: [4, 7] },
  { id: 'FR', name: 'Francia', dial: '33', len: [9, 9], groups: [1, 2, 2, 2, 2] },
  { id: 'IT', name: 'Italia', dial: '39', len: [9, 10], groups: [3, 3, 4] },
  { id: 'GB', name: 'Reino Unido', dial: '44', len: [10, 10], groups: [4, 6] }
];
export const paisTelefono = id => PAISES_TELEFONO.find(c => c.id === id) || PAISES_TELEFONO[0];
/** Solo dígitos; si pegan el indicativo (+57…, 0057…) se quita; formato visual según el país. */
export function fmtTelefono(raw, pais) {
  const c = paisTelefono(pais); let n = String(raw || '').replace(/\D/g, '').replace(/^00/, '');
  if (n.length > c.len[1] && n.indexOf(c.dial) === 0) n = n.slice(c.dial.length);
  n = n.slice(0, c.len[1]);
  const out = []; let i = 0;
  c.groups.forEach((g, k) => { const part = k === c.groups.length - 1 ? n.slice(i) : n.slice(i, i + g); if (part) out.push(part); i += g; });
  return out.join(' ');
}
/** Mensaje de error del teléfono (los mismos textos del Hub), o null si es válido. */
export function errorDeTelefono(raw, pais) {
  const c = paisTelefono(pais), d = String(raw || '').replace(/\D/g, '');
  if (!d) return 'Escribe el teléfono para continuar.';
  if (c.start && c.start.indexOf(d[0]) < 0) return 'En ' + c.name + ' el celular empieza por ' + c.start.split('').join(' o ') + '.';
  if (d.length < c.len[0]) return 'Al teléfono le faltan ' + (c.len[0] - d.length) + ' dígitos.';
  if (d.length > c.len[1]) return 'El teléfono tiene dígitos de más.';
  return null;
}
/** Teléfono en formato internacional (+57…), o null si no es válido. */
export function telefonoE164(raw, pais) {
  if (errorDeTelefono(raw, pais)) return null;
  return '+' + paisTelefono(pais).dial + String(raw || '').replace(/\D/g, '');
}
export const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
