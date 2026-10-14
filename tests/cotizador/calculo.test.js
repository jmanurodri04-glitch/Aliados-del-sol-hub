// Tests del motor del Cotizador Solar (js/cotizador-calculo.js): límites del consumo, resultados que se guardan y
// teléfono con las mismas reglas del Hub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CITIES, SUBSECTORES, bateriaDe, calc, cityOf, errorDeConsumo, errorDeTelefono, fmtTelefono, kwhOf, pesosOf, resultadosDe, telefonoE164, tipoDeSegmento
} from '../../js/cotizador-calculo.js';

const IND = { tipo: 'industria', unidad: 'cop', valor: '10.000.000', aislado: false, bateria: 'none', ciudad: 'Barranquilla|Atlántico', subsector: 'Plásticos' };

test('consumo: mínimo 40 kWh/mes o $27.600/mes según la unidad', () => {
  assert.equal(errorDeConsumo({ unidad: 'kwh', valor: '39' }), 'El consumo mínimo es 40 kWh al mes.');
  assert.equal(errorDeConsumo({ unidad: 'kwh', valor: '40' }), null);
  assert.equal(errorDeConsumo({ unidad: 'cop', valor: '27.599' }), 'El valor mínimo de la factura es $27.600 al mes.');
  assert.equal(errorDeConsumo({ unidad: 'cop', valor: '27.600' }), null);
  assert.equal(errorDeConsumo({ unidad: 'cop', valor: '200' }), 'El valor mínimo de la factura es $27.600 al mes.', '«200» son $200, no 200 millones');
  assert.equal(errorDeConsumo({ unidad: 'cop', valor: '1' }), 'El valor mínimo de la factura es $27.600 al mes.');
  assert.equal(errorDeConsumo({ unidad: 'cop', valor: '27.600' }), null);
  assert.equal(pesosOf({ unidad: 'cop', valor: '3.500.000' }), 3500000);
  assert.equal(errorDeConsumo({ unidad: 'kwh', valor: '' }), 'Ingresa el consumo o el valor de la factura.');
  assert.equal(errorDeConsumo({ unidad: 'kwh', valor: 'abc' }), 'Ingresa el consumo o el valor de la factura.');
});

test('el valor llega como lo escribió la persona: los puntos son miles', () => {
  assert.equal(kwhOf({ tipo: 'hogar', unidad: 'kwh', valor: '1.200' }), 1200);
  assert.equal(Math.round(kwhOf({ tipo: 'industria', unidad: 'cop', valor: '6.900.000' })), 10000);
});

test('resultados industriales conectados a la red', () => {
  const r = resultadosDe(IND);
  assert.equal(r.valor_factura_cop, 10000000);
  assert.equal(r.modulos, 180);
  assert.equal(r.potencia_kwp, 110.7);
  assert.equal(r.inversores, 2);
  assert.equal(r.cobertura_pct, 80);
  assert.equal(r.almacenamiento_kwh, 0);
  assert.ok(r.ahorro_anual_cop > 0 && r.payback_anios > 0);
  assert.equal(r.inversion_total_cop % 1000, 0, 'la inversión se redondea a miles, como en pantalla');
});

test('la región de la ciudad cambia el precio', () => {
  const costa = resultadosDe(IND).inversion_total_cop;
  const oriente = resultadosDe({ ...IND, ciudad: 'Bucaramanga|Santander' }).inversion_total_cop;
  assert.ok(oriente > costa);
});

test('un sistema aislado no tiene ahorro ni retorno y exige baterías', () => {
  const st = { tipo: 'hogar', unidad: 'kwh', valor: '450', aislado: true, bateria: 'autonomia', ciudad: 'Medellín|Antioquia' };
  const r = resultadosDe(st);
  assert.equal(r.ahorro_anual_cop, null);
  assert.equal(r.payback_anios, null);
  assert.ok(r.almacenamiento_kwh > 0);
  assert.equal(bateriaDe(true, 'none'), null, 'sin baterías no existe en un sistema aislado');
  assert.equal(bateriaDe(false, 'extendida'), null, 'la autonomía extendida es solo para aislados');
  assert.ok(bateriaDe(false, 'respaldo'));
});

test('sin consumo válido no hay resultados', () => {
  assert.equal(resultadosDe({ ...IND, valor: '' }), null);
  assert.equal(calc({ ...IND, valor: '' }).C, null);
});

test('listas del diseño: ciudades con región y subsectores', () => {
  assert.ok(CITIES.length > 200);
  assert.equal(new Set(CITIES.map((c) => c.name)).size, CITIES.length, 'cada ciudad aparece una vez');
  assert.deepEqual(cityOf('Bogotá|Bogotá D.C.'), { id: 'Bogotá|Bogotá D.C.', label: 'Bogotá', name: 'Bogotá', dep: 'Bogotá D.C.', r: 'N' });
  assert.equal(cityOf('Inventada|X'), null);
  assert.ok(SUBSECTORES.includes('Plásticos') && SUBSECTORES.length === 32);
  assert.equal(tipoDeSegmento('residencial'), 'hogar');
  assert.equal(tipoDeSegmento('comercial'), 'industria');
  assert.equal(tipoDeSegmento('otro'), null);
});

test('teléfono: mismas reglas del Hub y formato internacional', () => {
  assert.equal(fmtTelefono('+57 300-123-4567', 'CO'), '300 123 4567');
  assert.equal(telefonoE164('300 123 4567', 'CO'), '+573001234567');
  assert.equal(errorDeTelefono('200 123 4567', 'CO'), 'En Colombia el celular empieza por 3.');
  assert.equal(errorDeTelefono('300 123', 'CO'), 'Al teléfono le faltan 4 dígitos.');
  assert.equal(telefonoE164('55 1234 5678', 'MX'), '+525512345678');
  assert.equal(telefonoE164('', 'CO'), null);
});
