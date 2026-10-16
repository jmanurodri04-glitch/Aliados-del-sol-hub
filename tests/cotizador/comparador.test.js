// Tests del Comparador de propuestas (js/comparador-calculo.js) y de las preguntas antes del PDF (js/cotizador-meddpicc.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CITIES } from '../../js/cotizador-calculo.js';
import {
  CAMPOS, CIUDADES_COSTERAS, DEPENDE, PENDIENTE, calculados, inversoresOnGrid, leerNumero, mejores, mostrar, propuestaDesdeCotizacion, propuestaManual
} from '../../js/comparador-calculo.js';
import { PREGUNTAS, preguntasPara, resumenMeddpicc, validarMeddpicc } from '../../js/cotizador-meddpicc.js';

test('las ciudades costeras existen en la lista del cotizador', () => {
  const ids = new Set(CITIES.map((c) => c.id));
  for (const c of CIUDADES_COSTERAS) assert.ok(ids.has(c), c);
});

test('el comparador no tiene «Marca estructura» ni «Forma de pago»', () => {
  const ids = CAMPOS.map((c) => c.id);
  assert.ok(!ids.some((id) => /marca_estructura|forma_pago/.test(id)));
  assert.equal(new Set(ids).size, ids.length);
});

test('números en formato colombiano', () => {
  assert.equal(leerNumero('100.000.000'), 100000000);
  assert.equal(leerNumero('20,35'), 20.35);
  assert.equal(leerNumero('1.234,5'), 1234.5);
  assert.equal(leerNumero('20.35'), 20.35);
  assert.equal(leerNumero('$ 3.500.000'), 3500000);
  assert.equal(leerNumero(''), null);
  assert.equal(leerNumero('abc'), null);
});

test('inversores ON GRID: kWp ÷ 1,3 con la regla del punto medio', () => {
  const u = (kwp) => inversoresOnGrid(kwp).unidades;
  assert.deepEqual(u(5.2), [4]);          // 4 kW
  assert.deepEqual(u(9.1), [4, 3]);       // 7 kW: el punto medio da 6 (14 % abajo) → 4 + 3
  assert.deepEqual(u(19.5), [10, 5]);     // 15 kW → 10 + 5
  assert.deepEqual(u(39), [30]);          // 30 kW
  assert.deepEqual(u(110.7), [80]);       // 85,2 kW: 80 queda a 6 %
  assert.deepEqual(u(195), [150]);        // 150 kW
  assert.deepEqual(u(400), [150, 150]);   // 307,7 kW: el resto (7,7) es menos del 5 %
  assert.deepEqual(u(520), [150, 150, 100]); // 400 kW
  assert.equal(inversoresOnGrid(0), null);
});

const COT = { id: 'c1', segmento: 'industrial', nombre: 'Plásticos del Caribe', ciudad: 'Barranquilla', departamento: 'Atlántico',
  conectado_red: true, almacenamiento: 'none', consumo_kwh_mes: 14492.8, potencia_kwp: 110.7, modulos: 180, generacion_kwh_mes: 11657, inversion_total_cop: 377266000 };

test('propuesta desde el cotizador: reglas del equipo', () => {
  const { valores: v } = propuestaDesdeCotizacion(COT);
  assert.equal(v.inversion, 377266000);
  assert.equal(v.potencia, 110.7);
  assert.equal(v.consumo_anual, 14492.8 * 12);
  assert.equal(v.generacion_anual, 11657 * 12);
  assert.deepEqual([v.marca_panel, v.potencia_panel, v.marca_inversor, v.num_paneles], ['JA Solar', 615, 'Inversor Huawei', 180]);
  assert.deepEqual(v.potencia_inversor, { unidades: [80], total: 80 });
  assert.equal(v.num_inversores, 1);
  assert.equal(v.estructura, 'Aluminio', 'Barranquilla es costera');
  assert.equal(propuestaDesdeCotizacion({ ...COT, ciudad: 'Medellín', departamento: 'Antioquia' }).valores.estructura, 'Acero');
  assert.deepEqual([v.garantia_paneles.plazo, v.garantia_inversores.plazo, v.garantia_estructura.plazo], [30, 5, 25]);
  assert.deepEqual([v.retie, v.operador_red, v.comercializador, v.upme].map((x) => x.estado), ['Incluida', 'Incluida', 'Incluida', 'Incluida']);
  assert.deepEqual([v.anclaje.estado, v.polizas.estado, v.modalidad], ['No', 'Sí', 'EPC']);
  assert.deepEqual([v.mantenimiento.anios, v.monitoreo.anios], [1, 1]);
  const c = calculados(v);
  assert.equal(c.generacion_mensual, 11657);
  assert.ok(Math.abs(c.suplencia - (11657 / 14492.8) * 100) < 1e-9);
  assert.equal(c.costo_kwp, 377266000 / 110.7);
  assert.equal(mostrar('potencia_inversor', v), '80 kW');
  assert.equal(mostrar('potencia_inversor', { potencia_inversor: { unidades: [10, 5], total: 15 } }), '10 + 5 kW (15 kW en total)');
});

test('OFF GRID: inversores «Depende del usuario»; ON GRID con baterías usa la regla ON GRID', () => {
  const off = propuestaDesdeCotizacion({ ...COT, conectado_red: false, almacenamiento: 'autonomia' }).valores;
  assert.equal(off.potencia_inversor, DEPENDE);
  assert.equal(mostrar('num_inversores', off), DEPENDE);
  const bat = propuestaDesdeCotizacion({ ...COT, almacenamiento: 'respaldo' }).valores;
  assert.deepEqual(bat.potencia_inversor.unidades, [80]);
});

test('manual: lo que falta queda pendiente; los calculados esperan sus datos', () => {
  const v = propuestaManual().valores;
  assert.equal(mostrar('inversion', v), PENDIENTE);
  assert.equal(mostrar('suplencia', v), 'Pendiente de cálculo');
  assert.equal(mostrar('garantia_paneles', v), PENDIENTE);
  assert.equal(mostrar('garantia_paneles', { garantia_paneles: { estado: 'Sí', plazo: 12, unidad: 'meses' } }), '12 meses');
  assert.equal(mostrar('mantenimiento', { mantenimiento: { estado: 'Sí, incluido', anios: 2 } }), '2 años');
  assert.equal(mostrar('estructura', { estructura: 'Otro', estructura_otro: 'Madera' }), 'Madera');
});

test('mejor valor: menor costo por kWp (misma moneda), mayor suplencia y garantía más larga', () => {
  const a = { valores: { moneda: 'COP', inversion: 100, potencia: 10, consumo_anual: 100, generacion_anual: 80, garantia_paneles: { estado: 'Sí', plazo: 25, unidad: 'años' } } };
  const b = { valores: { moneda: 'COP', inversion: 90, potencia: 10, consumo_anual: 100, generacion_anual: 90, garantia_paneles: { estado: 'Sí', plazo: 30, unidad: 'años' } } };
  const m = mejores([a, b]);
  assert.deepEqual([...m.costo_kwp], [1]);
  assert.deepEqual([...m.suplencia], [1]);
  assert.deepEqual([...m.garantia_paneles], [1]);
  assert.equal(mejores([a, { valores: { ...b.valores, moneda: 'USD' } }]).costo_kwp, undefined, 'monedas distintas no se comparan');
  assert.deepEqual(mejores([a]), {}, 'con una sola no se marca nada');
});

test('preguntas: 7 como máximo, con «Aún no lo sé» en cada una', () => {
  assert.ok(PREGUNTAS.length <= 7);
  for (const p of PREGUNTAS) assert.ok(p.opciones.some((o) => o.id === 'no_se'), p.id);
  const res = preguntasPara('residencial');
  assert.ok(!res.find((p) => p.id === 'autoridad').opciones.some((o) => o.id === 'gerencia'));
  assert.equal(res.find((p) => p.id === 'autoridad').opciones[0].t, 'El propietario o la familia');
});

test('preguntas: validación y resumen', () => {
  const todas = Object.fromEntries(PREGUNTAS.map((p) => [p.id, { o: 'no_se' }]));
  const v = validarMeddpicc(todas, 'industrial');
  assert.equal(v.ok, true);
  assert.equal(validarMeddpicc({ ...todas, criterios: { o: ['precio', 'no_se'] } }, 'industrial').ok, false, '«Aún no lo sé» no se combina');
  assert.equal(validarMeddpicc({ ...todas, criterios: { o: ['precio', 'ahorro', 'tiempo', 'tramites'] } }, 'industrial').ok, false, 'máximo 3');
  assert.equal(validarMeddpicc({ ...todas, cuando: { o: ['mes', '1_3'] } }, 'industrial').ok, false, 'una sola');
  assert.equal(validarMeddpicc({ ...todas, necesidad: { o: 'otra', otro: 'x'.repeat(300) } }, 'industrial').valor.respuestas.necesidad.otro.length, 100);
  assert.equal(validarMeddpicc({ ...todas, necesidad: { o: 'factura', otro: 'se ignora' } }, 'industrial').valor.respuestas.necesidad.otro, undefined);
  assert.equal(resumenMeddpicc(v.valor, 'industrial').length, 7);
  assert.deepEqual(resumenMeddpicc(null, 'industrial'), []);
});
