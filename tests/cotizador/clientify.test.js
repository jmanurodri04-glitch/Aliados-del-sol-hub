// Tests del envío del Cotizador Solar a Clientify (lib/clientify/cotizador.js) con un cliente simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorClientify } from '../../lib/clientify/cliente.js';
import {
  CAMPOS_COTIZADOR, ETIQUETA_COTIZADOR, ORIGEN_COTIZADOR, TIPO_OFF_GRID, TIPO_ON_GRID, construirContactoCotizacion, enviarCotizacion, procesarCotizaciones
} from '../../lib/clientify/cotizador.js';

const IND = {
  segmento: 'industrial', id: 'c1', created_at: '2026-10-13T20:00:00Z', empresa: 'Plásticos del Caribe', contacto: 'Ana María Pérez Gómez',
  subsector: 'Plásticos', telefono: '+573001234567', correo: 'ana+prueba@empresa.test', ciudad: 'Barranquilla', departamento: 'Atlántico',
  region: 'Costa', unidad: 'cop', consumo_kwh_mes: 14492.8, valor_factura_cop: 10000000, conectado_red: true, almacenamiento: 'none',
  potencia_kwp: 110.7, modulos: 180, inversores: 2, generacion_kwh_mes: 11657, cobertura_pct: 80, ahorro_anual_cop: 96517559,
  payback_anios: 3.9, co2_t_anio: 22.94, almacenamiento_kwh: 0, area_minima_m2: 649, inversion_total_cop: 377266000
};
const RES = { ...IND, segmento: 'residencial', empresa: undefined, contacto: undefined, subsector: undefined, nombre: 'Juan Gómez',
  conectado_red: false, almacenamiento: 'autonomia', almacenamiento_kwh: 10, ahorro_anual_cop: null, payback_anios: null };

const valor = (c, campo) => (c.custom_fields.find((f) => f.field === campo) || {}).value;

test('contacto industrial: empresa, sector, origen, Tipo ON GRID y campos acordados', () => {
  const c = construirContactoCotizacion(IND, 'production');
  assert.deepEqual([c.first_name, c.last_name], ['Ana María', 'Pérez Gómez']);
  assert.equal(c.company, 'Plásticos del Caribe');
  assert.equal(c.contact_sector, 'Industrial');
  assert.equal(c.contact_source, ORIGEN_COTIZADOR);
  assert.equal(c.contact_type, TIPO_ON_GRID);
  assert.deepEqual(c.tags, [ETIQUETA_COTIZADOR], 'en Production solo la etiqueta del cotizador');
  assert.deepEqual(c.addresses, [{ city: 'Barranquilla', country: 'co' }]);
  assert.equal(valor(c, CAMPOS_COTIZADOR.consumo), '14493');
  assert.equal(valor(c, CAMPOS_COTIZADOR.valorFactura), '10000000');
  assert.equal(valor(c, CAMPOS_COTIZADOR.potencia), '110.7');
  assert.equal(valor(c, CAMPOS_COTIZADOR.paneles), '180');
  assert.equal(valor(c, CAMPOS_COTIZADOR.payback), '3.9');
  assert.equal(valor(c, CAMPOS_COTIZADOR.inversion), '377266000');
  assert.equal(valor(c, 'Subsector Economico'), 'Plásticos');
  assert.ok(!c.custom_fields.some((f) => f.field === 'ID_aliado'), 'sin ID_aliado');
  assert.ok(!JSON.stringify(c).match(/11657|22,94|22.94/), 'la generación, la cobertura y el CO₂ no van a Clientify');
});

test('contacto residencial aislado: Tipo Off Grid, sin empresa ni ahorro, con PRUEBA HUB fuera de Production', () => {
  const c = construirContactoCotizacion(RES, 'preview');
  assert.deepEqual([c.first_name, c.last_name], ['Juan', 'Gómez']);
  assert.equal(c.company, undefined);
  assert.equal(c.contact_sector, 'Residencial');
  assert.equal(c.contact_type, TIPO_OFF_GRID);
  assert.deepEqual(c.tags, [ETIQUETA_COTIZADOR, 'PRUEBA HUB']);
  assert.equal(valor(c, CAMPOS_COTIZADOR.ahorroAnual), undefined);
  assert.equal(valor(c, CAMPOS_COTIZADOR.payback), undefined);
  assert.equal(valor(c, 'Subsector Economico'), undefined);
  assert.match(c.description, /No conectado a la red/);
});

function clientifyFalso({ existente = null, rechazar = 0 } = {}) {
  const llamadas = [];
  return {
    llamadas,
    buscarContactoPorCorreo: async () => existente,
    crearContacto: async (d) => {
      llamadas.push(['crear', d]);
      if (llamadas.filter((l) => l[0] === 'crear').length <= rechazar) throw new ErrorClientify('400', { status: 400, reintentable: false });
      return { id: 77 };
    },
    actualizarContacto: async (id, d) => { llamadas.push(['actualizar', id, d]); return {}; },
    agregarEtiqueta: async (id, e) => { llamadas.push(['etiqueta', id, e]); return {}; }
  };
}

test('envío: crea el contacto nuevo con sus etiquetas', async () => {
  const cl = clientifyFalso();
  assert.deepEqual(await enviarCotizacion(IND, { clientify: cl, entorno: 'preview' }), { contactId: '77', accion: 'creado' });
  assert.deepEqual(cl.llamadas[0][1].tags, [ETIQUETA_COTIZADOR, 'PRUEBA HUB']);
});

test('envío: un contacto existente no cambia de nombre, Tipo ni origen', async () => {
  const cl = clientifyFalso({ existente: { id: 5 } });
  assert.deepEqual(await enviarCotizacion(IND, { clientify: cl, entorno: 'production' }), { contactId: '5', accion: 'actualizado' });
  const act = cl.llamadas.find((l) => l[0] === 'actualizar');
  assert.deepEqual(Object.keys(act[2]), ['custom_fields']);
  assert.deepEqual(cl.llamadas.filter((l) => l[0] === 'etiqueta').map((l) => l[2]), [ETIQUETA_COTIZADOR]);
});

test('envío: si Clientify rechaza los campos, el contacto se crea sin ellos (quedan en la descripción)', async () => {
  const cl = clientifyFalso({ rechazar: 2 });
  assert.deepEqual(await enviarCotizacion(IND, { clientify: cl, entorno: 'production' }), { contactId: '77', accion: 'creado_sin_campos' });
  const ultimo = cl.llamadas.filter((l) => l[0] === 'crear').pop()[1];
  assert.equal(ultimo.custom_fields, undefined);
  assert.match(ultimo.description, /Inversión total: \$377\.266\.000/);
});

test('envío: fuera de Production solo correos con +prueba', async () => {
  await assert.rejects(enviarCotizacion({ ...IND, correo: 'ana@empresa.test' }, { clientify: clientifyFalso(), entorno: 'preview' }), /\+prueba/);
});

test('cola: registra el éxito y el error sin datos personales', async () => {
  const llamadas = [];
  const supabase = { rpc: async (n, a) => { llamadas.push([n, a]); return n === 'cotizador_reclamar_propuestas' ? { data: [IND, { ...IND, id: 'c2', correo: 'sin-prueba@x.test' }], error: null } : { error: null }; } };
  const r = await procesarCotizaciones({ supabase, clientify: clientifyFalso(), entorno: 'preview' });
  assert.deepEqual([r.ok, r.errores], [1, 1]);
  const resultados = llamadas.filter(([n]) => n === 'cotizador_resultado_propuesta').map(([, a]) => a);
  assert.deepEqual(resultados[0], { p_segmento: 'industrial', p_id: 'c1', p_contact_id: '77', p_error: null });
  assert.equal(resultados[1].p_contact_id, null);
  assert.ok(!JSON.stringify(r).includes('@'), 'el resumen no lleva correos');
});
