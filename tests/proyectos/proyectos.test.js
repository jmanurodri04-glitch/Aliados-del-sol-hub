// Tests de «Casos y proyectos» (js/proyectos.js): lectura de los proyectos de WordPress y su normalización.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numero, textoPlano, normalizarProyecto, idsDeMedios, cargarProyectos, WP_API } from '../../js/proyectos.js';

const medio = (id, url) => ({ id, source_url: url, media_details: { sizes: { large: { source_url: url.replace('.webp', '-1024.webp') } } } });

const CHARANEK = {
  id: 23241, date: '2026-06-22T22:48:35', link: 'https://geenera.com/cpt-proyectos/charanek/', featured_media: 23242,
  title: { rendered: 'Sistema fotovoltaico Charanek 132 paneles solares' },
  meta: { 'c-logo-proyecto': '', 'c-descripcion-del-proyecto': '<p>Mayorista de textiles &amp; hogar.</p>', 'c-ubicacion-del-proyecto': 'CARRERA 13 59 66   Girón Santander ',
    'c-codigo-qr': '', 'c-tamano-del-sistema': '74,58', 'c-paneles-instalados': '132', 'c-c02-ahorrados': '30731,206', 'c-ahorros-generados': '76044183',
    'c-cantidad-de-arboles': '4806', 'c-imagenes-del-proyecto': ['23242'], 'c-texto-testimonio': '', 'c-video-testimonio': '' }
};
const AMASA = {
  id: 23213, date: '2026-06-01T10:00:00', link: 'https://geenera.com/cpt-proyectos/amasa/', featured_media: 0,
  title: { rendered: 'Sistema fotovoltaico Amasa Artesanal G3 HOLDING: 47 paneles solares' },
  meta: { 'c-logo-proyecto': '23206', 'c-ubicacion-del-proyecto': 'Bucaramanga, Santander', 'c-codigo-qr': '23237', 'c-tamano-del-sistema': '28.91',
    'c-paneles-instalados': '47', 'c-ahorros-generados': '35239253', 'c-imagenes-del-proyecto': ['23230', '23231'], 'c-video-testimonio': 'https://youtu.be/abc' }
};

test('numero: coma o punto decimal, miles en campos enteros y valores vacíos', () => {
  assert.equal(numero('74,58'), 74.58);
  assert.equal(numero('28.83'), 28.83);
  assert.equal(numero('30731,206'), 30731.206);
  assert.equal(numero('76044183', true), 76044183);
  assert.equal(numero('1.035', true), 1035);
  assert.equal(numero('1.234.567,8'), 1234567.8);
  assert.equal(numero('1,234,567.8'), 1234567.8);
  assert.equal(numero('$ 76.044.183', true), 76044183);
  assert.equal(numero(''), null);
  assert.equal(numero(null), null);
  assert.equal(numero('sin dato'), null);
});

test('textoPlano: quita etiquetas y decodifica entidades de WordPress', () => {
  assert.equal(textoPlano('Jugos &#038; Frutas &#8211; S.A.S'), 'Jugos & Frutas – S.A.S');
  assert.equal(textoPlano('<p>Uno</p><p>Dos<br>tres</p>'), 'Uno\n\nDos\ntres');
  assert.equal(textoPlano(undefined), '');
});

test('normalizarProyecto: cifras, fotos y sin QR cuando no está cargado', () => {
  const p = normalizarProyecto(CHARANEK, new Map([[23242, medio(23242, 'https://geenera.com/storage/charanek.webp')]]));
  assert.equal(p.titulo, 'Sistema fotovoltaico Charanek 132 paneles solares');
  assert.equal(p.ubicacion, 'CARRERA 13 59 66 Girón Santander');
  assert.equal(p.descripcion, 'Mayorista de textiles & hogar.');
  assert.deepEqual([p.kwp, p.paneles, p.co2Kg, p.ahorroCop, p.arboles], [74.58, 132, 30731.206, 76044183, 4806]);
  assert.deepEqual(p.fotos, ['https://geenera.com/storage/charanek-1024.webp']);
  assert.equal(p.portada, p.fotos[0]);
  assert.equal(p.logo, null);
  assert.equal(p.qr, null);
  assert.equal(p.video, null);
});

test('normalizarProyecto: el QR y el logo salen de la biblioteca de medios; un medio que no llegó no rompe', () => {
  const medios = new Map([[23206, medio(23206, 'https://geenera.com/storage/logo.webp')], [23237, { id: 23237, source_url: 'https://geenera.com/storage/qr.png' }],
    [23230, medio(23230, 'https://geenera.com/storage/a.webp')]]);
  const p = normalizarProyecto(AMASA, medios);
  assert.equal(p.qr, 'https://geenera.com/storage/qr.png');
  assert.equal(p.logo, 'https://geenera.com/storage/logo.webp');
  assert.deepEqual(p.fotos, ['https://geenera.com/storage/a-1024.webp']);
  assert.equal(p.video, 'https://youtu.be/abc');
  assert.equal(p.co2Kg, null);
});

test('idsDeMedios: junta foto destacada, galería, logo y QR sin repetir', () => {
  assert.deepEqual(idsDeMedios([CHARANEK, AMASA]).sort(), [23206, 23230, 23231, 23237, 23242]);
});

test('cargarProyectos: pagina la API y pide los medios en un solo lote', async () => {
  const pedidos = [];
  const respuesta = (cuerpo, paginas = 1) => ({ ok: true, status: 200, json: async () => cuerpo, headers: { get: (h) => h === 'x-wp-totalpages' ? String(paginas) : null } });
  const f = async (url) => {
    pedidos.push(url);
    if (url.startsWith(WP_API + '/cpt-proyectos')) return respuesta([CHARANEK, AMASA]);
    if (url.startsWith(WP_API + '/media')) return respuesta([medio(23242, 'https://geenera.com/storage/charanek.webp'), { id: 23237, source_url: 'https://geenera.com/storage/qr.png' }]);
    throw new Error('url inesperada ' + url);
  };
  const lista = await cargarProyectos(f);
  assert.equal(lista.length, 2);
  assert.equal(lista[1].qr, 'https://geenera.com/storage/qr.png');
  assert.equal(pedidos.length, 2);
  assert.match(pedidos[1], /\/media\?include=[\d,]+&/);
});

test('cargarProyectos: un error de WordPress se propaga para mostrar «Reintentar»', async () => {
  const f = async () => ({ ok: false, status: 503, json: async () => ({}), headers: { get: () => null } });
  await assert.rejects(cargarProyectos(f), /wordpress_503/);
});
