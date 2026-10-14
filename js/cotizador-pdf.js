// Precotización en PDF del Cotizador Solar (paso 5, «Descargar precotización»), CLAUDE.md §7.5.
//
// Se arma en el navegador con jsPDF (lo carga js/cotizador.js) y no pasa por ningún servidor. Los valores salen del
// mismo cálculo que guarda el servidor (resultadosDe en js/cotizador-calculo.js). La financiación no va.
// construirPrecotizacion recibe la clase jsPDF para poder probarse en Node.

import { REG, SEGMENTOS, bateriaDe, cityOf, resultadosDe, tipoDeSegmento } from './cotizador-calculo.js';

const AMARILLO = [255, 202, 5];
const TINTA = [20, 18, 16];
const GRIS = [110, 106, 100];
const LINEA = [225, 222, 216];

const nf = (n, d = 0) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
const pesos = (n) => '$' + nf(Math.round(n));

/**
 * Datos de la precotización a partir de lo que escribió la persona (la misma forma que «Conectar al inversor»).
 * Devuelve null si el diseño está incompleto.
 */
export function infoPrecotizacion({ segmento, datos = {}, unidad, valor, aislado, bateria }, fecha = new Date()) {
  const seg = SEGMENTOS.find((x) => x.id === segmento);
  const ciudad = cityOf(String(datos.ciudad || ''));
  if (!seg || !ciudad) return null;
  const st = { tipo: tipoDeSegmento(segmento), unidad, valor, aislado: !!aislado, bateria, ciudad: ciudad.id, subsector: datos.subsector };
  const bat = bateriaDe(!!aislado, bateria);
  const r = resultadosDe(st);
  if (!r || !bat) return null;
  const empresa = segmento !== 'residencial';
  return {
    fecha: fecha.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric' }),
    archivo: 'precotizacion-solar-geenera-' + fecha.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) + '.pdf',
    proyecto: seg.title,
    cliente: [
      ...(empresa ? [['Empresa', datos.empresa], ['Contacto', datos.contacto], ['Subsector', datos.subsector]] : [['Nombre', datos.nombre]]),
      ['Ciudad', ciudad.name + ' (' + ciudad.dep + ', región ' + REG[ciudad.r].n + ')']
    ].filter(([, v]) => v),
    consumo: [
      ['Consumo de energía', nf(r.consumo_kwh_mes) + ' kWh/mes'],
      ['Valor de la factura', pesos(r.valor_factura_cop) + ' al mes'],
      ['Conexión', aislado ? 'Sistema aislado (sin conexión a la red)' : 'Conectado a la red'],
      ['Almacenamiento', bat.t + (r.almacenamiento_kwh > 0 ? ' · ' + nf(r.almacenamiento_kwh) + ' kWh' : '')]
    ],
    diseno: [
      ['Potencia instalada', nf(r.potencia_kwp, 1) + ' kWp'],
      ['Módulos solares', nf(r.modulos) + ' de 615 Wp'],
      ['Inversores', nf(r.inversores)],
      ['Generación estimada', nf(r.generacion_kwh_mes) + ' kWh/mes'],
      ['Cobertura del consumo', nf(r.cobertura_pct) + ' %'],
      ['Área mínima requerida', nf(r.area_minima_m2) + ' m²']
    ],
    beneficios: [
      ...(r.ahorro_anual_cop != null ? [['Ahorro estimado', pesos(r.ahorro_anual_cop) + ' al año']] : []),
      ...(r.payback_anios != null ? [['Retorno de la inversión', nf(r.payback_anios, 1) + ' años']] : []),
      ['CO2 evitado', nf(r.co2_t_anio, r.co2_t_anio < 10 ? 1 : 0) + ' toneladas al año']
    ],
    inversion: pesos(r.inversion_total_cop) + ' + IVA'
  };
}

/** Arma el PDF (A4 vertical). `JsPDF` es la clase jsPDF; devuelve el documento listo para .save(). */
export function construirPrecotizacion(JsPDF, info) {
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const ancho = doc.internal.pageSize.getWidth();
  const margen = 18;
  let y = 0;

  // Encabezado
  doc.setFillColor(...TINTA);
  doc.rect(0, 0, ancho, 38, 'F');
  doc.setFillColor(...AMARILLO);
  doc.rect(0, 38, ancho, 2, 'F');
  doc.setTextColor(...AMARILLO);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('GEENERA · ALIADOS DEL SOL', margen, 14);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.text('Precotización solar', margen, 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Proyecto ' + info.proyecto.toLowerCase() + ' · ' + info.fecha, margen, 33);
  y = 52;

  const seccion = (titulo, filas) => {
    doc.setTextColor(...GRIS);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(titulo.toUpperCase(), margen, y);
    y += 3;
    doc.setDrawColor(...LINEA);
    doc.line(margen, y, ancho - margen, y);
    y += 6;
    for (const [k, v] of filas) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      doc.setTextColor(...GRIS);
      doc.text(k, margen, y);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...TINTA);
      const lineas = doc.splitTextToSize(String(v), ancho - margen * 2 - 62);
      doc.text(lineas, margen + 62, y);
      y += 6.5 * lineas.length;
    }
    y += 5;
  };

  seccion('Datos', info.cliente);
  seccion('Tu consumo', info.consumo);
  seccion('Diseño propuesto', info.diseno);
  seccion('Beneficios estimados', info.beneficios);

  // Inversión total
  doc.setFillColor(255, 246, 204);
  doc.setDrawColor(...AMARILLO);
  doc.roundedRect(margen, y, ancho - margen * 2, 24, 3, 3, 'FD');
  doc.setTextColor(...GRIS);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('INVERSIÓN TOTAL ESTIMADA', margen + 6, y + 8);
  doc.setTextColor(...TINTA);
  doc.setFontSize(18);
  doc.text(info.inversion, margen + 6, y + 18);
  y += 34;

  // Nota
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GRIS);
  const nota = 'Valores aproximados calculados con el Cotizador Solar de GEENERA a partir del consumo informado. ' +
    'No es una oferta comercial: el equipo GEENERA valida el diseño, la inversión y el ahorro con la factura real y una ' +
    'visita técnica. Para recibir la propuesta técnica y financiera, usa «Solicitar propuesta» en el cotizador.';
  doc.text(doc.splitTextToSize(nota, ancho - margen * 2), margen, y);

  doc.setFontSize(8.5);
  doc.text('geenera.com', margen, doc.internal.pageSize.getHeight() - 12);
  return doc;
}
