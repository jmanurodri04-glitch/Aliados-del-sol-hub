// Pestaña «Cotizador» del panel (CLAUDE.md §7.5): las cotizaciones de los aliados en el Cotizador Solar.
//
// Se descargan en CSV (una tabla por tipo de proyecto, con el código del aliado y sus respuestas a las preguntas antes
// del PDF) y después se pueden borrar (decisión del equipo). Lee las tablas cotizador_* con la sesión del admin (RLS)
// y borra con POST /api/admin { accion: 'borrar_cotizaciones' } (admin_cotizador_borrar), que solo borra las de más
// de 12 meses, nunca las propuestas que aún no llegan a Clientify, y queda en la Auditoría. «Uso por aliado»
// (v_admin_cotizador_aliados) sirve para ver un uso exagerado y descontar puntos si hace falta. Fechas de Bogotá.

import { resumenMeddpicc } from './cotizador-meddpicc.js';

export const SEGMENTOS = [['industrial', 'Industrial'], ['comercial', 'Comercial'], ['residencial', 'Residencial']];
const ALMACENAMIENTO = { none: 'Sin baterías', respaldo: 'Respaldo', autonomia: 'Autonomía nocturna', extendida: 'Autonomía extendida' };
const SYNC = { pendiente: 'Pendiente', ok: 'Enviada', error: 'Con error' };

// Columnas del CSV: [encabezado, columna o función]. Las de la persona solo en su tipo de proyecto.
const COMUNES = [
  ['Aliado', (f) => (f.aliados && f.aliados.codigo_aliado) || ''],
  ['Fecha (Bogotá)', (f) => fechaHora(f.created_at)], ['Última edición', (f) => fechaHora(f.actualizada_at)], ['Teléfono', 'telefono'], ['Correo', 'correo'], ['Ciudad', 'ciudad'],
  ['Departamento', 'departamento'], ['Región', 'region'], ['Escribió el consumo en', (f) => (f.unidad === 'cop' ? 'Pesos' : 'kWh')],
  ['Consumo (kWh/mes)', 'consumo_kwh_mes'], ['Valor factura (COP/mes)', 'valor_factura_cop'],
  ['Conectado a la red', (f) => (f.conectado_red ? 'Sí' : 'No')], ['Almacenamiento', (f) => ALMACENAMIENTO[f.almacenamiento] || f.almacenamiento],
  ['Potencia (kWp)', 'potencia_kwp'], ['Módulos', 'modulos'], ['Inversores', 'inversores'], ['Generación (kWh/mes)', 'generacion_kwh_mes'],
  ['Cobertura (%)', 'cobertura_pct'], ['Ahorro anual (COP)', 'ahorro_anual_cop'], ['Retorno (años)', 'payback_anios'], ['CO₂ evitado (t/año)', 'co2_t_anio'],
  ['Almacenamiento (kWh)', 'almacenamiento_kwh'], ['Área mínima (m²)', 'area_minima_m2'], ['Inversión total + IVA (COP)', 'inversion_total_cop'],
  ['Pidió propuesta', (f) => (f.propuesta_solicitada_at ? fechaHora(f.propuesta_solicitada_at) : 'No')],
  ['Clientify', (f) => (f.clientify_sync_estado ? SYNC[f.clientify_sync_estado] || f.clientify_sync_estado : '')],
  ['Política de datos', 'politica_datos_version'],
  ['Preguntas antes del PDF', (f) => resumenMeddpicc(f.meddpicc, f.segmento).join(' | ')]
];
export const COLUMNAS = {
  residencial: [['Nombre', 'nombre'], ...COMUNES],
  comercial: [['Empresa', 'empresa'], ['Contacto', 'contacto'], ['Subsector', 'subsector'], ...COMUNES],
  industrial: [['Empresa', 'empresa'], ['Contacto', 'contacto'], ['Subsector', 'subsector'], ...COMUNES]
};
const TEXTO_LIBRE = new Set(['nombre', 'empresa', 'contacto', 'correo']);

function fechaHora(v) {
  if (!v) return '';
  return new Date(v).toLocaleString('es-CO', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Inicio de un día de Bogotá (UTC−5, sin horario de verano) en ISO; `+1` da el día siguiente. */
export function inicioDelDia(fechaIso, mas = 0) {
  const d = new Date(fechaIso + 'T00:00:00-05:00');
  d.setUTCDate(d.getUTCDate() + mas);
  return d.toISOString();
}

/**
 * Celda del CSV: decimales con coma (Excel en español), comillas si hace falta y, en el texto que escribió la
 * persona, un apóstrofo delante de = + - @ para que Excel no lo tome como fórmula.
 */
export function celda(v, columna) {
  if (v == null) return '';
  let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  if (TEXTO_LIBRE.has(columna) && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** CSV con separador «;» y BOM, para que Excel lo abra con tildes y columnas. */
export function aCsv(segmento, filas) {
  const cols = COLUMNAS[segmento];
  const lineas = [cols.map(([h]) => celda(h)).join(';')];
  for (const f of filas) {
    lineas.push(cols.map(([, c]) => (typeof c === 'function' ? celda(c(f)) : celda(f[c] == null ? null : (typeof f[c] === 'string' && /^-?\d+(\.\d+)?$/.test(f[c]) ? Number(f[c]) : f[c]), c))).join(';'));
  }
  return '﻿' + lineas.join('\r\n') + '\r\n';
}

export function crearCotizador({ cliente, llamarAdmin, leer, esc, aviso, numero, pedir, $ }) {
  let descargado = null; // { segmento, desde, hasta, filas }: lo último descargado, que es lo que se puede borrar

  const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const haceUnAno = () => { const d = new Date(hoy() + 'T12:00:00-05:00'); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); };

  async function cargar() {
    const filas = await leer(cliente().from('v_admin_cotizador').select('*'));
    const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', year: 'numeric' }) : '—');
    $('cot-resumen').innerHTML = `<table><thead><tr><th>Tipo</th><th>Simulaciones</th><th>Pidieron propuesta</th><th>Sin llegar a Clientify</th><th>Primera</th><th>Última</th></tr></thead><tbody>${
      filas.map((r) => `<tr><td>${esc((SEGMENTOS.find(([id]) => id === r.segmento) || [, r.segmento])[1])}</td><td>${numero(r.simulaciones)}</td><td>${numero(r.propuestas)}</td>`
        + `<td>${r.sin_enviar > 0 ? `<span class="chip bad">${numero(r.sin_enviar)}</span>` : '0'}</td><td>${esc(fecha(r.primera))}</td><td>${esc(fecha(r.ultima))}</td></tr>`).join('')
    }</tbody></table>`;
    const usos = await leer(cliente().from('v_admin_cotizador_aliados').select('*').limit(200));
    $('cot-aliados').innerHTML = usos.length
      ? `<table><thead><tr><th>Aliado</th><th>Nombre</th><th>Cotizaciones (7 días)</th><th>Cotizaciones (30 días)</th><th>Total</th><th>Propuestas pedidas (30 días)</th><th>Total pedidas</th><th>Puntos del cotizador</th><th>Última</th></tr></thead><tbody>${
        usos.map((u) => `<tr><td>${esc(u.codigo_aliado)}</td><td>${esc(u.nombre_completo)}</td><td>${numero(u.cotizaciones_7d)}</td><td>${numero(u.cotizaciones_30d)}</td><td>${numero(u.cotizaciones)}</td>`
          + `<td>${numero(u.solicitudes_30d)}</td><td>${numero(u.solicitudes)}</td><td>${numero(u.puntos_cotizador)}</td><td>${esc(fecha(u.ultima))}</td></tr>`).join('')
      }</tbody></table>`
      : '<p class="nota">Ningún aliado ha usado el cotizador todavía.</p>';
    if (!$('cot-desde').value) $('cot-desde').value = haceUnAno();
    if (!$('cot-hasta').value) $('cot-hasta').value = hoy();
    pintarBorrar();
  }

  function rango() {
    const segmento = $('cot-segmento').value, desde = $('cot-desde').value, hasta = $('cot-hasta').value;
    if (!desde || !hasta || hasta < desde) throw new Error('Revisa las fechas: «Hasta» no puede ser antes de «Desde».');
    return { segmento, desde, hasta };
  }

  function pintarBorrar() {
    const b = $('cot-borrar');
    b.disabled = !descargado;
    $('cot-borrar-nota').textContent = descargado
      ? `Descargaste ${numero(descargado.filas)} cotizaciones de tipo ${descargado.segmento}, del ${descargado.desde} al ${descargado.hasta}. Solo se borran las de más de 12 meses.`
      : 'Primero descarga el CSV: solo se borra lo que ya descargaste, y solo lo de más de 12 meses.';
  }

  async function descargar() {
    const r = rango();
    const tabla = 'cotizador_' + r.segmento;
    const filas = [];
    for (let i = 0; ; i += 1000) {
      const pagina = await leer(cliente().from(tabla).select('*, aliados(codigo_aliado)').gte('created_at', inicioDelDia(r.desde)).lt('created_at', inicioDelDia(r.hasta, 1))
        .order('created_at').order('id').range(i, i + 999));
      filas.push(...pagina);
      if (pagina.length < 1000) break;
    }
    filas.forEach((f) => { f.segmento = r.segmento; });
    if (!filas.length) { aviso('No hay cotizaciones en ese rango.'); descargado = null; pintarBorrar(); return; }
    const url = URL.createObjectURL(new Blob([aCsv(r.segmento, filas)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `cotizador-${r.segmento}-${r.desde}-a-${r.hasta}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    descargado = Object.assign({ filas: filas.length }, r);
    pintarBorrar();
    aviso(`Descargadas ${numero(filas.length)} cotizaciones.`);
  }

  function borrar() {
    if (!descargado) return;
    const d = descargado;
    pedir({
      titulo: 'Borrar cotizaciones descargadas',
      texto: `Se borran las cotizaciones de tipo ${d.segmento} del ${d.desde} al ${d.hasta} que tengan más de 12 meses. No se pueden recuperar. Las más recientes y las propuestas que todavía no llegan a Clientify no se borran.`,
      campos: [{ id: 'guardado', etiqueta: 'Ya guardé el archivo descargado en un lugar seguro', tipo: 'casilla' }],
      confirmar: 'Borrar', peligro: true,
      accion: async (v) => {
        if (!v.guardado) throw new Error('Marca la casilla para confirmar que guardaste el archivo.');
        const r = await llamarAdmin('borrar_cotizaciones', { segmento: d.segmento, desde: inicioDelDia(d.desde), hasta: inicioDelDia(d.hasta, 1) });
        descargado = null;
        await cargar();
        return `Borradas ${numero(r.borradas)} cotizaciones.`
          + (r.recientes ? ` Se conservan ${numero(r.recientes)} de los últimos 12 meses.` : '')
          + (r.sin_enviar ? ` Quedan ${numero(r.sin_enviar)} propuestas por llegar a Clientify.` : '');
      }
    });
  }

  /** Clics de la pestaña; devuelve true si eran suyos. */
  function clic(b) {
    const accion = b.dataset.accion;
    if (accion === 'cot_descargar') { descargar().catch((e) => aviso(e.message)); return true; }
    if (accion === 'cot_borrar') { borrar(); return true; }
    return false;
  }

  // Cambiar el tipo o las fechas obliga a descargar otra vez antes de borrar.
  document.addEventListener('change', (ev) => { if (['cot-segmento', 'cot-desde', 'cot-hasta'].includes(ev.target.id) && descargado) { descargado = null; pintarBorrar(); } });

  return { cargar, clic };
}
