// Tests del envío del Cotizador Solar a Clientify (lib/clientify/cotizador.js) con un cliente simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorClientify } from '../../lib/clientify/cliente.js';
import {
  CAMPOS_COTIZADOR, ETIQUETA_COTIZADOR, ORIGEN_COTIZADOR, TIPO_OFF_GRID, TIPO_ON_GRID, actualizacionDeExistente, construirContactoCotizacion, enviarCotizacion, procesarCotizaciones
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
  assert.equal(valor(c, CAMPOS_COTIZADOR.payback), '4', 'Payback es entero en Clientify');
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

function clientifyFalso({ existente = null, rechazar = 0, ficha = {}, rechazarActualizar = 0 } = {}) {
  const llamadas = [];
  return {
    llamadas,
    buscarContactoPorCorreo: async () => existente,
    obtenerContacto: async (id) => ({ id, ...ficha }),
    crearContacto: async (d) => {
      llamadas.push(['crear', d]);
      if (llamadas.filter((l) => l[0] === 'crear').length <= rechazar) throw new ErrorClientify('400', { status: 400, reintentable: false });
      return { id: 77 };
    },
    actualizarContacto: async (id, d) => {
      llamadas.push(['actualizar', id, d]);
      if (llamadas.filter((l) => l[0] === 'actualizar').length <= rechazarActualizar) throw new ErrorClientify('400', { status: 400, reintentable: false });
      return {};
    },
    agregarEtiqueta: async (id, e) => { llamadas.push(['etiqueta', id, e]); return {}; }
  };
}

test('envío: crea el contacto nuevo con sus etiquetas', async () => {
  const cl = clientifyFalso();
  assert.deepEqual(await enviarCotizacion(IND, { clientify: cl, entorno: 'preview' }), { contactId: '77', accion: 'creado' });
  assert.deepEqual(cl.llamadas[0][1].tags, [ETIQUETA_COTIZADOR, 'PRUEBA HUB']);
});

test('envío: un contacto existente se actualiza con los datos del cotizador', async () => {
  const cl = clientifyFalso({ existente: { id: 5 }, ficha: { first_name: 'Otro', phone: '+573009999999', company_name: 'Otra', addresses: [{ city: 'Cali' }],
    email: IND.correo, description: 'Nota previa', contact_type: 'Prospecto Autoconsumo ON GRID', contact_source: 'Contacto Directo' } });
  assert.deepEqual(await enviarCotizacion(IND, { clientify: cl, entorno: 'production' }), { contactId: '5', accion: 'actualizado' });
  const act = cl.llamadas.find((l) => l[0] === 'actualizar')[2];
  assert.deepEqual([act.first_name, act.last_name, act.phone, act.company], ['Ana María', 'Pérez Gómez', '+573001234567', 'Plásticos del Caribe']);
  assert.deepEqual([act.contact_type, act.contact_source, act.contact_sector], [TIPO_ON_GRID, ORIGEN_COTIZADOR, 'Industrial']);
  assert.deepEqual(act.addresses, [{ city: 'Barranquilla', country: 'co' }]);
  assert.match(act.description, /^Nota previa\n\nCotizador Solar/);
  assert.equal(valor(act, CAMPOS_COTIZADOR.payback), '4');
  assert.deepEqual(cl.llamadas.filter((l) => l[0] === 'etiqueta').map((l) => l[2]), [ETIQUETA_COTIZADOR]);
});

test('envío: no repite el resumen en la descripción', () => {
  const datos = construirContactoCotizacion(IND, 'production');
  assert.equal('description' in actualizacionDeExistente({ description: 'x\n\n' + datos.description }, datos).cambios, false);
});

test('sin ID_aliado; la descripción dice qué aliado cotizó y lleva las preguntas si se respondieron', () => {
  const datos = construirContactoCotizacion({ ...IND, codigo_aliado: 'FIJJPL7K4MQ9TX',
    meddpicc: { v: 1, respuestas: { necesidad: { o: ['factura'] }, competencia: { o: ['1_2'] } } } }, 'production');
  assert.equal(valor(datos, 'ID_aliado'), undefined);
  assert.match(datos.description, /Cotizado en el Hub por el aliado FIJJPL7K4MQ9TX\./);
  assert.match(datos.description, /- ¿Por qué quiere el cliente un sistema solar ahora\? Bajar la factura de energía/);
  assert.match(datos.description, /- ¿Con quién más lo está comparando\? Con 1 o 2 proveedores más/);
  const sin = construirContactoCotizacion(IND, 'production');
  assert.doesNotMatch(sin.description, /Preguntas del aliado/);
  const conId = actualizacionDeExistente({ custom_fields: [{ field: 'ID_aliado', value: 'FIPRIMERO2345' }] }, datos).cambios;
  assert.equal(valor(conId, 'ID_aliado'), undefined, 'el ID_aliado de «Referir empresa» no se toca');
});

test('envío: el contacto de un aliado (Tipo Aliados Estratégicos) solo recibe los campos y el resumen', async () => {
  const datos = construirContactoCotizacion(IND, 'production');
  const { cambios, protegido } = actualizacionDeExistente({ first_name: 'Ana', contact_type: 'Aliados Estratégicos', contact_source: 'AdS EMI' }, datos);
  assert.equal(protegido, true);
  assert.deepEqual(Object.keys(cambios).sort(), ['custom_fields', 'description']);
  const cl = clientifyFalso({ existente: { id: 9 }, ficha: { contact_type: 'Aliados Estratégicos' } });
  assert.equal((await enviarCotizacion(IND, { clientify: cl, entorno: 'production' })).accion, 'actualizado_contacto_aliado');
});

test('envío: si Clientify rechaza la actualización completa, reintenta sin los opcionales', async () => {
  const cl = clientifyFalso({ existente: { id: 5 }, rechazarActualizar: 1 });
  assert.equal((await enviarCotizacion(IND, { clientify: cl, entorno: 'production' })).accion, 'actualizado_parcial');
  const [primera, segunda] = cl.llamadas.filter((l) => l[0] === 'actualizar').map((l) => l[2]);
  assert.ok(primera.addresses && !segunda.addresses && segunda.custom_fields && segunda.contact_type);
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

test('flujo C: un contacto del cotizador con ID_aliado se registra como referido del aliado (con puntos)', async () => {
  const { procesarContacto } = await import('../../lib/clientify/webhook.js');
  const rpcs = [];
  const supabase = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    rpc: async (n, a) => { rpcs.push([n, a]); return { data: n === 'clientify_registrar_lead' ? { empresa_id: 'e1' } : {}, error: null }; }
  };
  const ficha = { id: 1, email: 'ana+prueba@empresa.test', tags: [{ name: 'cotizador hub' }], custom_fields: [{ field: 'ID_aliado', value: 'EMABCD2345XY' }] };
  const r = await procesarContacto('1', { supabase, clientify: { obtenerContacto: async () => ficha }, entorno: 'preview' });
  assert.notEqual(r.resultado, 'ignorado');
  const lead = rpcs.find(([n]) => n === 'clientify_registrar_lead');
  assert.ok(lead, 'se registra como lead del aliado');
  assert.equal(lead[1].p_codigo_aliado, 'EMABCD2345XY');
});

test('precotización en PDF: los valores salen del mismo cálculo del servidor', async () => {
  const { infoPrecotizacion } = await import('../../js/cotizador-pdf.js');
  const info = infoPrecotizacion({ segmento: 'industrial', datos: { empresa: 'Plásticos del Caribe', contacto: 'Ana', subsector: 'Plásticos', ciudad: 'Barranquilla|Atlántico' },
    unidad: 'cop', valor: '10.000.000', aislado: false, bateria: 'none' }, new Date('2026-10-14T15:00:00Z'));
  assert.equal(info.archivo, 'precotizacion-solar-geenera-2026-10-14.pdf');
  assert.deepEqual(info.diseno[0], ['Potencia instalada', '110,7 kWp']);
  assert.equal(info.inversion, '$377.266.000 + IVA');
  assert.ok(info.beneficios.some(([k]) => k === 'Retorno de la inversión'));
  const aislado = infoPrecotizacion({ segmento: 'residencial', datos: { nombre: 'Juan', ciudad: 'Medellín|Antioquia' }, unidad: 'kwh', valor: '450', aislado: true, bateria: 'autonomia' });
  assert.ok(!aislado.beneficios.some(([k]) => k === 'Ahorro estimado'), 'un sistema aislado no tiene ahorro ni retorno');
  assert.equal(infoPrecotizacion({ segmento: 'industrial', datos: {}, unidad: 'kwh', valor: '' }), null);
});
