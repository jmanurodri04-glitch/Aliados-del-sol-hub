// Panel de administración (CLAUDE.md §3, §4.8, §4.10, §5, §5.1, §10; fases 9, 10 y 11).
//
// Lee con la sesión del admin las vistas v_admin_* (security_invoker + es_admin(): un aliado no ve filas) y
// hace cada acción con POST /api/admin, que toma al admin del token y deja la acción auditada.
// Los aliados se identifican siempre por codigo_aliado; el panel nunca ve aliados.id (§2).
// Todo texto que viene de la base se escapa antes de insertarlo en la página.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';

const TIPOS = { emi: 'EMI', linker: 'Linker', cliente_embajador: 'Cliente Embajador', financiero: 'Financiero', agremiaciones: 'Agremiaciones' };
const NIVELES = { bronce: 'Bronce', plata: 'Plata', oro: 'Oro', platino: 'Platino', diamante: 'Diamante', circulo_solar: 'Círculo Solar' };
const ESTADOS = { activo: ['Activo', 'ok'], pendiente: ['Pendiente', 'w'], suspendido: ['Suspendido', 'bad'], rechazado: ['Rechazado', 'bad'],
  validado: ['Validado', 'ok'], confirmado: ['Confirmado', 'ok'], anulado: ['Anulado', 'bad'], excluido: ['Excluido', ''] };
const ACCIONES = { aprobar_aliado: 'Aprobó la solicitud', rechazar_aliado: 'Rechazó la solicitud', suspender_aliado: 'Suspendió la cuenta',
  reactivar_aliado: 'Reactivó la cuenta', ajuste_puntos: 'Ajuste de puntos', baja_calidad: 'Baja calidad reiterada (−20)',
  validar_evento: 'Validó un evento (+100)', rechazar_evento: 'Rechazó un evento', resolver_conflicto: 'Resolvió un conflicto',
  anular_canje: 'Anuló un canje', guardar_recompensa: 'Guardó una recompensa', invitar_operador: 'Invitó un operador',
  estado_operador: 'Cambió el estado de un operador' };
const VARIABLES = { calificado: 'Calificado', perfecto: 'Referido perfecto', fuera_perfil: 'Fuera del perfil', oportunidad_tecnica: 'Evaluación técnica',
  propuesta_comercial: 'Propuesta comercial', negocio_cerrado: 'Negocio cerrado', informacion_falsa: 'Información falsa', integridad_informacion: 'Integridad' };
const PESTANAS = [['resumen', 'Resumen'], ['solicitudes', 'Solicitudes'], ['aliados', 'Aliados'], ['eventos', 'Eventos'], ['conflictos', 'Conflictos'],
  ['canjes', 'Canjes'], ['recompensas', 'Recompensas'], ['operadores', 'Operadores'], ['auditoria', 'Auditoría']];

const $ = (id) => document.getElementById(id);
let supabase = null;
let pestana = 'resumen';
let aliados = [];
let resumen = null;
let canjes = [];
let recompensas = [];
let operadores = [];

// Utilidades ----------------------------------------------------------------------------------------------------

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const numero = (v) => Number(v || 0).toLocaleString('es-CO');
const millones = (cop) => '$ ' + (Math.round(Number(cop || 0) / 1e5) / 10).toLocaleString('es-CO') + ' MM';
function fecha(v, conHora) {
  if (!v) return '—';
  const opciones = { timeZone: 'America/Bogota', day: 'numeric', month: 'short', year: 'numeric' };
  if (conHora) Object.assign(opciones, { hour: '2-digit', minute: '2-digit' });
  return new Date(v.length === 10 ? v + 'T12:00:00-05:00' : v).toLocaleString('es-CO', opciones);
}
const chip = (estado, etiqueta) => { const e = ESTADOS[estado] || [estado, '']; return `<span class="chip ${e[1]}">${esc(etiqueta || e[0])}</span>`; };
const SYNC = { ok: 'activo', error: 'suspendido', pendiente: 'pendiente', excluido: 'excluido' };
function aviso(texto) {
  const t = $('toast'); t.textContent = texto; t.hidden = false;
  clearTimeout(aviso.t); aviso.t = setTimeout(() => { t.hidden = true; }, 3600);
}
function vista(id) {
  ['vista-cargando', 'vista-login', 'vista-sin-acceso', 'vista-panel'].forEach((v) => { $(v).hidden = v !== id; });
}

async function llamarAdmin(accion, datos) {
  const { data } = await supabase.auth.getSession();
  const token = data.session && data.session.access_token;
  if (!token) throw new Error('Tu sesión expiró. Vuelve a entrar.');
  const r = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify(Object.assign({ accion }, datos))
  });
  let cuerpo = {};
  try { cuerpo = await r.json(); } catch (e) { /* sin cuerpo */ }
  if (!r.ok) throw new Error(cuerpo.error || 'No se pudo completar la acción.');
  return cuerpo;
}

async function leer(consulta) {
  const { data, error } = await consulta;
  if (error) throw new Error('No pudimos cargar los datos. Intenta de nuevo.');
  return data || [];
}

// Diálogo de confirmación con campos ------------------------------------------------------------------------------
// campos: [{ id, etiqueta, tipo: 'texto' | 'area' | 'numero' | 'casilla' | 'lista', obligatorio, minimo, ayuda, valor, opciones }]
function pedir({ titulo, texto, campos = [], confirmar = 'Confirmar', peligro = false, accion }) {
  const d = $('dialogo');
  $('dialogo-titulo').textContent = titulo;
  $('dialogo-texto').textContent = texto || '';
  $('dialogo-mensaje').textContent = '';
  $('dialogo-ok').textContent = confirmar;
  $('dialogo-ok').className = 'btn ' + (peligro ? 'peligro' : 'primario');
  $('dialogo-campos').innerHTML = campos.map((c) => {
    if (c.tipo === 'casilla') return `<label class="casilla"><input type="checkbox" id="campo-${c.id}" ${c.valor ? 'checked' : ''}> ${esc(c.etiqueta)}</label>`;
    const valor = c.valor == null ? '' : c.valor;
    const control = c.tipo === 'area'
      ? `<textarea id="campo-${c.id}" rows="3" maxlength="1000">${esc(valor)}</textarea>`
      : c.tipo === 'lista'
        ? `<select id="campo-${c.id}">${c.opciones.map(([v, t]) => `<option value="${esc(v)}" ${v === valor ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`
        : `<input id="campo-${c.id}" ${c.tipo === 'numero' ? 'type="number" step="1"' : 'type="text" maxlength="1000"'} value="${esc(valor)}" ${c.soloLectura ? 'readonly' : ''}>`;
    return `<label>${esc(c.etiqueta)}${c.ayuda ? `<span class="sub">${esc(c.ayuda)}</span>` : ''}${control}</label>`;
  }).join('');
  d.showModal();
  const primero = d.querySelector('input:not([readonly]), textarea'); if (primero) primero.focus();

  $('dialogo-cancelar').onclick = () => d.close();
  $('dialogo-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const valores = {};
    for (const c of campos) {
      const el = $('campo-' + c.id);
      valores[c.id] = c.tipo === 'casilla' ? el.checked : el.value.trim();
      if (c.obligatorio && String(valores[c.id]).length < (c.minimo || 1)) {
        $('dialogo-mensaje').textContent = `${c.etiqueta}: mínimo ${c.minimo || 1} caracteres.`;
        return;
      }
    }
    const boton = $('dialogo-ok'); boton.disabled = true;
    try {
      const mensaje = await accion(valores);
      d.close();
      if (mensaje) aviso(mensaje);
    } catch (e) {
      $('dialogo-mensaje').textContent = e.message;
    } finally {
      boton.disabled = false;
    }
  };
}

// Pestañas --------------------------------------------------------------------------------------------------------

function pintarPestanas() {
  const cuentas = resumen ? { solicitudes: resumen.aliados_pendientes, eventos: resumen.eventos_pendientes, conflictos: resumen.conflictos_abiertos } : {};
  $('pestanas').innerHTML = PESTANAS.map(([id, nombre]) =>
    `<button data-ir="${id}" ${id === pestana ? 'aria-current="page"' : ''}>${nombre}${cuentas[id] ? `<span class="contador">${cuentas[id]}</span>` : ''}</button>`).join('');
}
async function irA(id) {
  pestana = id;
  document.querySelectorAll('[data-pestana]').forEach((s) => { s.hidden = s.dataset.pestana !== id; });
  pintarPestanas();
  try { await CARGAR[id](); } catch (e) { aviso(e.message); }
}
async function recargar() {
  await cargarResumen();
  await CARGAR[pestana]();
}

// Resumen ---------------------------------------------------------------------------------------------------------

async function cargarResumen() {
  const filas = await leer(supabase.from('v_admin_resumen').select('*'));
  resumen = filas[0] || null;
  pintarPestanas();
  if (!resumen) return;
  const r = resumen;
  const kpis = [
    ['Aliados activos', numero(r.aliados_activos)], ['Solicitudes pendientes', numero(r.aliados_pendientes), r.aliados_pendientes > 0],
    ['Suspendidos', numero(r.aliados_suspendidos)], ['Referidos', numero(r.referidos_total)], ['Calificados', numero(r.referidos_calificados)],
    ['Con propuesta', numero(r.referidos_propuesta)], ['Negocios cerrados', numero(r.referidos_cerrados)], ['Valor cotizado', millones(r.valor_cotizado)],
    ['Pipeline originado', millones(r.pipeline_originado)], ['Potencia (kWp)', numero(r.potencia_kwp)],
    ['Calidad promedio', r.calidad_promedio == null ? '—' : Math.round(r.calidad_promedio) + ' %'], ['Puntos otorgados este mes', numero(r.puntos_otorgados_mes)],
    ['Rachas 4x4 completas', numero(r.rachas_completas)], ['Eventos por revisar', numero(r.eventos_pendientes), r.eventos_pendientes > 0],
    ['Conflictos abiertos', numero(r.conflictos_abiertos), r.conflictos_abiertos > 0],
    ['Canjes este mes', numero(r.canjes_mes)], ['Puntos redimidos este mes', numero(r.puntos_redimidos_mes)], ['Recompensas activas', numero(r.recompensas_activas)]
  ];
  const porTipo = Object.entries(r.activos_por_tipo || {}).map(([t, n]) => `${esc(TIPOS[t] || t)}: ${numero(n)}`).join(' · ');
  $('resumen').innerHTML = kpis.map(([k, v, alerta]) => `<div class="tarjeta kpi ${alerta ? 'alerta' : ''}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')
    + `<div class="tarjeta kpi" style="grid-column:1 / -1"><span>Activos por tipo</span><div>${porTipo || '—'}</div></div>`;
}

// Solicitudes -------------------------------------------------------------------------------------------------------

function perfilDe(a) {
  return a.organizacion ? `${esc(a.organizacion)} · ${esc(a.cargo || '')}` : esc(a.como_llega_empresas || '—');
}
async function cargarSolicitudes() {
  const filas = await leer(supabase.from('v_admin_aliados').select('*').in('estado', ['pendiente', 'rechazado']).order('created_at', { ascending: false }));
  $('solicitudes').innerHTML = filas.length ? `<table><thead><tr><th>Solicitud</th><th>Tipo y perfil</th><th>Contacto</th><th>Fecha</th><th>Estado</th><th></th></tr></thead><tbody>${
    filas.map((a) => `<tr>
      <td><b>${esc(a.nombre_completo)}</b><span class="codigo">${esc(a.codigo_aliado)}</span></td>
      <td>${esc(TIPOS[a.tipo_aliado] || a.tipo_aliado)}<span class="sub">${perfilDe(a)}</span></td>
      <td>${esc(a.correo)}<span class="sub">${esc(a.celular)}${a.regional ? ' · ' + esc(a.regional) : ''}</span></td>
      <td>${fecha(a.created_at)}</td><td>${chip(a.estado)}</td>
      <td><div class="acciones">
        <button class="btn primario" data-accion="aprobar" data-codigo="${esc(a.codigo_aliado)}" data-nombre="${esc(a.nombre_completo)}">Aprobar</button>
        ${a.estado === 'pendiente' ? `<button class="btn peligro" data-accion="rechazar" data-codigo="${esc(a.codigo_aliado)}" data-nombre="${esc(a.nombre_completo)}">Rechazar</button>` : ''}
      </div></td></tr>`).join('')}</tbody></table>` : '<p class="vacio">No hay solicitudes pendientes.</p>';
}

// Aliados -------------------------------------------------------------------------------------------------------------

async function cargarAliados() {
  aliados = await leer(supabase.from('v_admin_aliados').select('*').order('created_at', { ascending: false }).limit(2000));
  pintarAliados();
}
function pintarAliados() {
  const q = $('buscar-aliado').value.trim().toLowerCase();
  const estado = $('filtro-estado').value;
  const lista = aliados.filter((a) => (!estado || a.estado === estado)
    && (!q || [a.nombre_completo, a.correo, a.codigo_aliado].some((v) => String(v || '').toLowerCase().includes(q)))).slice(0, 200);
  $('aliados').innerHTML = lista.length ? `<table><thead><tr><th>Aliado</th><th>Tipo</th><th>Estado</th><th>Nivel</th><th>Puntos</th><th>Calidad</th><th>Referidos</th><th>Clientify</th></tr></thead><tbody>${
    lista.map((a) => `<tr class="fila-click" data-abrir="${esc(a.codigo_aliado)}" tabindex="0">
      <td><b>${esc(a.nombre_completo)}</b>${a.rol === 'admin' ? ' <span class="chip w">Admin</span>' : ''}<span class="codigo">${esc(a.codigo_aliado)}</span></td>
      <td>${esc(TIPOS[a.tipo_aliado] || a.tipo_aliado)}</td><td>${chip(a.estado)}</td><td>${esc(NIVELES[a.nivel] || a.nivel)}</td>
      <td>${numero(a.puntos_disponibles)}<span class="sub">nivel ${numero(a.puntos_nivel)}</span></td>
      <td>${a.calidad_referidos == null ? '—' : Math.round(a.calidad_referidos) + ' %'}</td>
      <td>${numero(a.referidos_total)}<span class="sub">${numero(a.referidos_calificados)} calificados</span></td>
      <td>${chip(SYNC[a.clientify_sync_estado] || 'pendiente', a.clientify_sync_estado)}</td>
    </tr>`).join('')}</tbody></table>` : '<p class="vacio">No hay aliados con ese filtro.</p>';
}
async function abrirAliado(codigo) {
  const a = aliados.find((x) => x.codigo_aliado === codigo);
  if (!a) return;
  const movs = await leer(supabase.from('v_admin_movimientos').select('*').eq('codigo_aliado', codigo)
    .order('fecha', { ascending: false }).order('secuencia', { ascending: false }).limit(100));
  const racha = [a.racha_semana_1, a.racha_semana_2, a.racha_semana_3, a.racha_semana_4].filter(Boolean).length;
  $('aliado-detalle').innerHTML = `<div class="detalle">
    <div class="tarjeta">
      <h2 style="margin:0 0 4px">${esc(a.nombre_completo)} ${chip(a.estado)}</h2><span class="codigo">${esc(a.codigo_aliado)}</span>
      <div class="campos" style="margin-top:14px">
        <div><span>Tipo</span>${esc(TIPOS[a.tipo_aliado] || a.tipo_aliado)}</div><div><span>Perfil</span>${perfilDe(a)}</div>
        <div><span>Correo</span>${esc(a.correo)}</div><div><span>Celular</span>${esc(a.celular)}</div>
        <div><span>Regional</span>${esc(a.regional || '—')}</div><div><span>Nivel</span>${esc(NIVELES[a.nivel] || a.nivel)}</div>
        <div><span>Puntos disponibles</span>${numero(a.puntos_disponibles)}</div><div><span>Puntos de nivel</span>${numero(a.puntos_nivel)}</div>
        <div><span>Calidad</span>${a.calidad_referidos == null ? '—' : Math.round(a.calidad_referidos) + ' %'}</div><div><span>Racha</span>${racha} de 4</div>
        <div><span>Retenidos</span>${numero(a.movimientos_retenidos)}</div><div><span>Aprobado</span>${fecha(a.aprobado_at)}${a.aprobado_por ? `<span class="sub">por ${esc(a.aprobado_por)}</span>` : ''}</div>
        ${a.clientify_sync_error ? `<div style="grid-column:1 / -1"><span>Error de Clientify</span>${esc(a.clientify_sync_error)}</div>` : ''}
      </div>
      <div class="acciones" style="margin-top:16px">
        <button class="btn primario" data-accion="ajuste" data-codigo="${esc(a.codigo_aliado)}" data-nombre="${esc(a.nombre_completo)}">Ajustar puntos</button>
        <button class="btn" data-accion="baja_calidad" data-codigo="${esc(a.codigo_aliado)}" data-nombre="${esc(a.nombre_completo)}">Baja calidad reiterada</button>
        ${a.estado === 'activo' && a.rol !== 'admin' ? `<button class="btn peligro" data-accion="suspender" data-codigo="${esc(a.codigo_aliado)}" data-nombre="${esc(a.nombre_completo)}">Suspender</button>` : ''}
        ${a.estado === 'suspendido' ? `<button class="btn" data-accion="reactivar" data-codigo="${esc(a.codigo_aliado)}" data-nombre="${esc(a.nombre_completo)}">Reactivar</button>` : ''}
        ${['pendiente', 'rechazado'].includes(a.estado) ? `<button class="btn primario" data-accion="aprobar" data-codigo="${esc(a.codigo_aliado)}" data-nombre="${esc(a.nombre_completo)}">Aprobar</button>` : ''}
      </div>
    </div>
    <div class="tarjeta tabla">
      <h2 style="margin:0 0 10px;font-size:17px">Historial de puntos</h2>
      ${movs.length ? `<table><thead><tr><th>Fecha</th><th>Movimiento</th><th>Puntos</th><th>Por</th></tr></thead><tbody>${movs.map((m) => {
        const signo = m.tipo === 'ganado' ? '+' : '−';
        const parcial = m.tipo === 'perdido' && m.puntos_aplicados < m.puntos ? `<span class="sub">se descontaron ${numero(m.puntos_aplicados)}</span>` : '';
        return `<tr><td>${fecha(m.fecha)}</td><td>${esc(m.descripcion)}${m.empresa ? `<span class="sub">${esc(m.empresa)}</span>` : ''}${m.nota ? `<span class="sub">${esc(m.nota)}</span>` : ''}</td>
          <td><b style="color:${m.tipo === 'ganado' ? 'var(--g)' : 'var(--bad)'}">${signo}${numero(m.puntos)}</b>${parcial}</td><td class="codigo">${esc(m.creado_por)}</td></tr>`;
      }).join('')}</tbody></table>` : '<p class="vacio">Sin movimientos.</p>'}
    </div></div>`;
  $('aliado-detalle').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Eventos -------------------------------------------------------------------------------------------------------------

async function cargarEventos() {
  let q = supabase.from('v_admin_eventos').select('*').order('created_at', { ascending: false }).limit(300);
  if ($('filtro-eventos').value) q = q.eq('estado', $('filtro-eventos').value);
  const filas = await leer(q);
  $('eventos').innerHTML = filas.length ? `<table><thead><tr><th>Evento</th><th>Aliado</th><th>Condiciones</th><th>Estado</th><th></th></tr></thead><tbody>${
    filas.map((e) => {
      const cond = [[e.geenera_involucrada, 'GEENERA involucrada'], [e.registro_asistentes, 'Registro de asistentes'],
        [e.empresas_perfil_count >= 5, `${numero(e.empresas_perfil_count)} empresas en el perfil`]]
        .map(([ok, t]) => `<span class="sub" style="color:${ok ? 'var(--g)' : 'var(--bad)'}">${ok ? '✓' : '✕'} ${esc(t)}</span>`).join('');
      return `<tr>
        <td><b>${esc(e.nombre_evento)}</b><span class="sub">${fecha(e.fecha)}${e.tipo_evento ? ' · ' + esc(e.tipo_evento) : ''}</span>${e.descripcion ? `<span class="sub">${esc(e.descripcion)}</span>` : ''}</td>
        <td>${esc(e.nombre_completo)}<span class="codigo">${esc(e.codigo_aliado)}</span></td>
        <td>${cond}</td>
        <td>${chip(e.estado)}${e.revision_nota ? `<span class="sub">${esc(e.revision_nota)}</span>` : ''}${e.revisado_por ? `<span class="sub">por ${esc(e.revisado_por)}</span>` : ''}</td>
        <td><div class="acciones">
          ${e.tiene_archivo ? `<button class="btn" data-accion="archivo" data-evento="${esc(e.evento_id)}">Ver asistentes</button>` : ''}
          ${e.estado === 'pendiente' ? `<button class="btn primario" data-accion="validar" data-evento="${esc(e.evento_id)}" data-nombre="${esc(e.nombre_evento)}" ${e.cumple_condiciones ? '' : 'disabled title="No cumple las condiciones"'}>Validar +100</button>
            <button class="btn peligro" data-accion="rechazar_evento" data-evento="${esc(e.evento_id)}" data-nombre="${esc(e.nombre_evento)}">Rechazar</button>` : ''}
        </div></td></tr>`;
    }).join('')}</tbody></table>` : '<p class="vacio">No hay eventos con ese filtro.</p>';
}

// Conflictos ----------------------------------------------------------------------------------------------------------

async function cargarConflictos() {
  let q = supabase.from('v_admin_conflictos').select('*').order('detectado_at', { ascending: false }).limit(300);
  if (!$('ver-resueltos').checked) q = q.is('resuelto_at', null);
  const filas = await leer(q);
  const valor = (v) => v === 'si' ? 'Sí' : v === 'no' ? 'No' : 'En revisión';
  $('conflictos').innerHTML = filas.length ? `<table><thead><tr><th>Empresa</th><th>Aliado</th><th>Variable</th><th>Hub → Clientify</th><th>Detectado</th><th></th></tr></thead><tbody>${
    filas.map((c) => `<tr>
      <td><b>${esc(c.empresa || 'Sin nombre')}</b></td><td>${esc(c.nombre_completo)}<span class="codigo">${esc(c.codigo_aliado)}</span></td>
      <td>${esc(VARIABLES[c.variable] || c.variable)}</td><td>${valor(c.valor_hub)} → <b>${valor(c.valor_clientify)}</b></td><td>${fecha(c.detectado_at)}</td>
      <td>${c.resuelto_at ? `${chip('validado', 'Resuelto')}<span class="sub">${esc(c.nota || '')}</span><span class="sub">por ${esc(c.resuelto_por || '—')}</span>`
        : `<button class="btn primario" data-accion="resolver" data-conflicto="${esc(c.conflicto_id)}" data-nombre="${esc(c.empresa || '')}" data-variable="${esc(VARIABLES[c.variable] || c.variable)}">Resolver</button>`}</td>
    </tr>`).join('')}</tbody></table>` : '<p class="vacio">No hay conflictos abiertos.</p>';
}

// Auditoría -----------------------------------------------------------------------------------------------------------

async function cargarAuditoria() {
  const filas = await leer(supabase.from('v_admin_acciones').select('*').order('created_at', { ascending: false }).limit(200));
  const detalle = (d) => [d.motivo, d.nota, d.puntos != null && d.aplicados !== undefined ? `${d.puntos > 0 ? '+' : ''}${d.puntos} (aplicados ${d.aplicados})` : null,
    d.nombre_evento, d.variable ? VARIABLES[d.variable] || d.variable : null,
    d.recompensa ? `${d.recompensa} (${d.puntos} puntos devueltos)` : null,
    d.nombre && d.nueva !== undefined ? `${d.nueva ? 'Nueva: ' : ''}${d.nombre} · ${d.puntos} puntos${d.activa === false ? ' · inactiva' : ''}` : null].filter(Boolean).map(esc).join(' · ');
  $('auditoria').innerHTML = filas.length ? `<table><thead><tr><th>Fecha</th><th>Admin</th><th>Acción</th><th>Aliado</th><th>Detalle</th></tr></thead><tbody>${
    filas.map((x) => `<tr><td>${fecha(x.created_at, true)}</td><td class="codigo">${esc(x.admin_codigo)}</td><td>${esc(ACCIONES[x.accion] || x.accion)}</td>
      <td class="codigo">${esc(x.aliado_codigo || (x.objetivo || '—'))}</td><td>${detalle(x.detalle || {})}</td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Aún no hay acciones registradas.</p>';
}

// Canjes y recompensas (fase 10) -----------------------------------------------------------------------------------------

async function cargarCanjes() {
  canjes = await leer(supabase.from('v_admin_canjes').select('*').order('fecha', { ascending: false }).limit(1000));
  pintarCanjes();
}
function pintarCanjes() {
  const q = $('buscar-canje').value.trim().toLowerCase();
  const estado = $('filtro-canjes').value;
  const lista = canjes.filter((c) => (!estado || c.estado === estado)
    && (!q || [c.codigo_aliado, c.nombre_completo, c.recompensa, c.recompensa_codigo, c.referencia_externa, c.proveedor, c.registrado_por]
      .some((v) => String(v || '').toLowerCase().includes(q)))).slice(0, 300);
  $('canjes').innerHTML = lista.length ? `<table><thead><tr><th>Fecha</th><th>Aliado</th><th>Recompensa</th><th>Puntos</th><th>Proveedor</th><th>Estado</th><th></th></tr></thead><tbody>${
    lista.map((c) => `<tr>
      <td>${fecha(c.fecha, true)}</td>
      <td>${esc(c.nombre_completo)}<span class="codigo">${esc(c.codigo_aliado)}</span></td>
      <td><b>${esc(c.recompensa)}</b>${c.recompensa_codigo ? `<span class="sub">${esc(c.recompensa_codigo)}${c.nivel_requerido ? ' · nivel ' + esc(NIVELES[c.nivel_requerido] || c.nivel_requerido) : ''}</span>` : ''}</td>
      <td><b>${numero(c.puntos)}</b></td>
      <td>${esc(c.proveedor)}<span class="sub">${c.origen === 'qr' ? `QR · ${esc(c.registrado_por || 'operador eliminado')}` : `API · ref. ${esc(c.referencia_externa)}`}</span></td>
      <td>${chip(c.estado)}${c.anulacion_motivo ? `<span class="sub">${esc(c.anulacion_motivo)}</span>` : ''}${c.anulado_por ? `<span class="sub">por ${esc(c.anulado_por)} · ${fecha(c.anulado_at)}</span>` : ''}</td>
      <td>${c.estado === 'confirmado' ? `<button class="btn peligro" data-accion="anular_canje" data-canje="${esc(c.canje_id)}" data-nombre="${esc(c.recompensa)}" data-puntos="${esc(c.puntos)}" data-codigo-canje="${esc(c.codigo_aliado)}">Anular</button>` : ''}</td>
    </tr>`).join('')}</tbody></table>` : '<p class="vacio">No hay canjes con ese filtro.</p>';
}

async function cargarRecompensas() {
  recompensas = await leer(supabase.from('v_admin_recompensas').select('*').order('activa', { ascending: false }).order('puntos'));
  $('recompensas').innerHTML = recompensas.length ? `<table><thead><tr><th>Recompensa</th><th>Puntos</th><th>Nivel mínimo</th><th>Proveedor</th><th>Canjes</th><th>Estado</th><th></th></tr></thead><tbody>${
    recompensas.map((r) => `<tr>
      <td><b>${esc(r.nombre)}</b><span class="codigo">${esc(r.codigo)}</span>${r.categoria ? `<span class="sub">${esc(r.categoria)}</span>` : ''}${r.descripcion ? `<span class="sub">${esc(r.descripcion)}</span>` : ''}</td>
      <td><b>${numero(r.puntos)}</b></td><td>${esc(NIVELES[r.nivel_minimo] || r.nivel_minimo)}</td>
      <td>${esc(r.proveedor || 'Todos')}</td>
      <td>${numero(r.canjes_confirmados)}<span class="sub">${numero(r.puntos_redimidos)} puntos</span></td>
      <td>${r.activa ? chip('activo', 'Activa') : chip('', 'Inactiva')}</td>
      <td><button class="btn" data-accion="editar_recompensa" data-recompensa="${esc(r.recompensa_id)}">Editar</button></td>
    </tr>`).join('')}</tbody></table>` : '<p class="vacio">Aún no hay recompensas. Crea la primera con «Nueva recompensa».</p>';
}

function formularioRecompensa(r) {
  const nueva = !r;
  pedir({
    titulo: nueva ? 'Nueva recompensa' : 'Editar recompensa',
    texto: nueva ? 'El código lo usa el proveedor para canjear y no se puede cambiar después.' : 'Los cambios solo afectan los canjes futuros.',
    campos: [
      { id: 'codigo', etiqueta: 'Código', tipo: 'texto', obligatorio: true, minimo: 2, valor: r ? r.codigo : '', soloLectura: !nueva, ayuda: nueva ? 'Minúsculas, números, guion y guion bajo (p. ej. bono-cafe).' : '' },
      { id: 'nombre', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true, minimo: 3, valor: r ? r.nombre : '' },
      { id: 'puntos', etiqueta: 'Puntos', tipo: 'numero', obligatorio: true, valor: r ? r.puntos : '' },
      { id: 'nivel_minimo', etiqueta: 'Nivel mínimo', tipo: 'lista', valor: r ? r.nivel_minimo : 'bronce', opciones: Object.entries(NIVELES) },
      { id: 'categoria', etiqueta: 'Categoría (opcional)', tipo: 'texto', valor: r ? r.categoria : '' },
      { id: 'proveedor', etiqueta: 'Proveedor (opcional)', tipo: 'texto', valor: r ? r.proveedor : '', ayuda: 'Vacío: cualquier proveedor puede canjearla.' },
      { id: 'descripcion', etiqueta: 'Descripción (opcional)', tipo: 'area', valor: r ? r.descripcion : '' },
      { id: 'activa', etiqueta: 'Activa (se puede canjear)', tipo: 'casilla', valor: r ? r.activa : true }
    ],
    confirmar: nueva ? 'Crear' : 'Guardar',
    accion: async (v) => {
      const datos = { codigo: v.codigo.toLowerCase(), nombre: v.nombre, puntos: Number(v.puntos), nivel_minimo: v.nivel_minimo,
        categoria: v.categoria, proveedor: v.proveedor.toLowerCase(), descripcion: v.descripcion, activa: v.activa };
      await llamarAdmin('guardar_recompensa', { recompensa_id: r ? r.recompensa_id : null, datos });
      await recargar();
      return nueva ? 'Recompensa creada.' : 'Recompensa guardada.';
    }
  });
}

// Operadores (fase 11) -------------------------------------------------------------------------------------------------

async function cargarOperadores() {
  operadores = await leer(supabase.from('v_admin_operadores').select('*').order('activo', { ascending: false }).order('nombre'));
  $('operadores').innerHTML = operadores.length ? `<table><thead><tr><th>Operador</th><th>Proveedor</th><th>Cuenta</th><th>Canjes</th><th>Estado</th><th></th></tr></thead><tbody>${
    operadores.map((o) => `<tr>
      <td><b>${esc(o.nombre)}</b><span class="sub">${esc(o.correo)}</span><span class="sub">invitado por ${esc(o.invitado_por || '—')} · ${fecha(o.created_at)}</span></td>
      <td>${esc(o.proveedor)}</td>
      <td>${o.cuenta_creada ? chip('activo', 'Creada') : chip('pendiente', 'Sin crear')}</td>
      <td>${numero(o.canjes_registrados)}${o.ultimo_canje ? `<span class="sub">último ${fecha(o.ultimo_canje)}</span>` : ''}</td>
      <td>${o.activo ? chip('activo') : chip('suspendido', 'Inactivo')}</td>
      <td class="acciones">${o.activo
        ? `<button class="btn" data-accion="reinvitar_operador" data-operador="${esc(o.operador_id)}">Nuevo enlace</button>
           <button class="btn peligro" data-accion="desactivar_operador" data-operador="${esc(o.operador_id)}" data-nombre="${esc(o.nombre)}">Desactivar</button>`
        : `<button class="btn" data-accion="reactivar_operador" data-operador="${esc(o.operador_id)}" data-nombre="${esc(o.nombre)}">Reactivar</button>`}</td>
    </tr>`).join('')}</tbody></table>` : '<p class="vacio">Aún no hay operadores. Invita al primero con «Invitar operador».</p>';
}

// Muestra el enlace de invitación para copiarlo (no se envía por correo: el panel no depende del SMTP).
function mostrarEnlace(r) {
  if (!r.enlace) {
    aviso(`${r.correo} ya tiene cuenta en el Hub: entra a canje.html con su contraseña de siempre.`);
    return;
  }
  pedir({
    titulo: 'Enlace para el operador',
    texto: `Envíale este enlace a ${r.correo} por WhatsApp o correo. Al abrirlo crea su contraseña y queda en canje.html. Es personal: no lo compartas con nadie más.`,
    campos: [{ id: 'enlace', etiqueta: 'Enlace', tipo: 'texto', valor: r.enlace, soloLectura: true }],
    confirmar: 'Copiar enlace',
    accion: async () => {
      await navigator.clipboard.writeText(r.enlace);
      return 'Enlace copiado.';
    }
  });
}

function formularioOperador(o) {
  pedir({
    titulo: o ? 'Nuevo enlace' : 'Invitar operador',
    texto: o ? 'Si aún no creó su contraseña, genera un enlace nuevo.' : 'Quien escanea el QR y registra los canjes. Solo podrá canjear las recompensas de su proveedor (o de todos).',
    campos: [
      { id: 'correo', etiqueta: 'Correo', tipo: 'texto', obligatorio: true, minimo: 5, valor: o ? o.correo : '', soloLectura: !!o },
      { id: 'nombre', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true, minimo: 3, valor: o ? o.nombre : '' },
      { id: 'proveedor', etiqueta: 'Proveedor', tipo: 'texto', obligatorio: true, minimo: 2, valor: o ? o.proveedor : 'geenera',
        ayuda: '«geenera» para el equipo propio; si no, el mismo código de proveedor que usan las recompensas.' }
    ],
    confirmar: o ? 'Generar enlace' : 'Invitar',
    accion: async (v) => {
      const r = await llamarAdmin('invitar_operador', { correo: v.correo.toLowerCase(), nombre: v.nombre, proveedor: v.proveedor.toLowerCase() });
      await recargar();
      setTimeout(() => mostrarEnlace(r), 0);
      return '';
    }
  });
}

const CARGAR = { resumen: async () => {}, solicitudes: cargarSolicitudes, aliados: cargarAliados, eventos: cargarEventos, conflictos: cargarConflictos,
  canjes: cargarCanjes, recompensas: cargarRecompensas, operadores: cargarOperadores, auditoria: cargarAuditoria };

// Acciones --------------------------------------------------------------------------------------------------------------

const MOTIVO = { id: 'motivo', etiqueta: 'Motivo', tipo: 'area', obligatorio: true, minimo: 5, ayuda: 'Queda en la auditoría.' };

async function alHacerClic(ev) {
  const b = ev.target.closest('[data-accion]');
  const fila = ev.target.closest('[data-abrir]');
  const ir = ev.target.closest('[data-ir]');
  if (ir) return irA(ir.dataset.ir);
  if (!b) { if (fila) abrirAliado(fila.dataset.abrir).catch((e) => aviso(e.message)); return; }
  const { accion, codigo, nombre, evento, conflicto, variable, canje, puntos, recompensa } = b.dataset;
  const tras = async (msg) => { await recargar(); if (pestana === 'aliados' && codigo) await abrirAliado(codigo); return msg; };

  if (accion === 'aprobar') pedir({ titulo: 'Aprobar solicitud', texto: `${nombre} podrá entrar al Hub y se creará su contacto en Clientify.`, confirmar: 'Aprobar',
    accion: async () => { await llamarAdmin('aprobar', { codigo }); return tras('Solicitud aprobada.'); } });
  if (accion === 'rechazar') pedir({ titulo: 'Rechazar solicitud', texto: `${nombre} no podrá entrar al Hub. Puedes aprobarla después.`, campos: [MOTIVO], confirmar: 'Rechazar', peligro: true,
    accion: async (v) => { await llamarAdmin('rechazar', { codigo, motivo: v.motivo }); return tras('Solicitud rechazada.'); } });
  if (accion === 'suspender') pedir({ titulo: 'Suspender cuenta', texto: `${nombre} no podrá entrar al Hub. Sus puntos nuevos quedan retenidos hasta que la reactives.`, campos: [MOTIVO], confirmar: 'Suspender', peligro: true,
    accion: async (v) => { await llamarAdmin('suspender', { codigo, motivo: v.motivo }); return tras('Cuenta suspendida.'); } });
  if (accion === 'reactivar') pedir({ titulo: 'Reactivar cuenta', texto: `Los puntos retenidos de ${nombre} se acreditan al reactivar.`, campos: [MOTIVO], confirmar: 'Reactivar',
    accion: async (v) => { await llamarAdmin('reactivar', { codigo, motivo: v.motivo }); return tras('Cuenta reactivada.'); } });
  if (accion === 'ajuste') {
    const clave = crypto.randomUUID(); // un doble clic no duplica el ajuste
    pedir({ titulo: 'Ajustar puntos', texto: `${nombre}. Usa un número negativo para descontar; el saldo nunca queda por debajo de 0.`,
      campos: [{ id: 'puntos', etiqueta: 'Puntos (±)', tipo: 'numero', obligatorio: true }, { id: 'nota', etiqueta: 'Justificación', tipo: 'area', obligatorio: true, minimo: 10, ayuda: 'El aliado la ve en su historial.' }],
      confirmar: 'Registrar ajuste',
      accion: async (v) => {
        const r = await llamarAdmin('ajuste', { codigo, puntos: Number(v.puntos), nota: v.nota, clave });
        return tras(r.duplicado ? 'Ese ajuste ya estaba registrado.' : `Ajuste registrado: ${r.puntos > 0 ? '+' : ''}${r.puntos} (aplicados ${r.puntos_aplicados}).`);
      } });
  }
  if (accion === 'baja_calidad') pedir({ titulo: 'Baja calidad reiterada (−20)', texto: `Solo después de haber dado retroalimentación a ${nombre}. Máximo una por día.`,
    campos: [{ id: 'nota', etiqueta: 'Retroalimentación previa', tipo: 'area', obligatorio: true, minimo: 10, ayuda: 'Cuándo y cómo se dio la retroalimentación.' }], confirmar: 'Registrar −20', peligro: true,
    accion: async (v) => { const r = await llamarAdmin('baja_calidad', { codigo, nota: v.nota }); return tras(r.retenido ? 'Registrado: queda retenido hasta que la cuenta esté activa.' : 'Baja calidad registrada (−20).'); } });
  if (accion === 'archivo') {
    try { const r = await llamarAdmin('archivo_evento', { evento_id: evento }); window.open(r.url, '_blank', 'noopener'); } catch (e) { aviso(e.message); }
  }
  if (accion === 'validar') pedir({ titulo: 'Validar evento', texto: `«${nombre}» suma +100 Puntos Sol al aliado.`, confirmar: 'Validar +100',
    campos: [{ id: 'nota', etiqueta: 'Nota (opcional)', tipo: 'area', ayuda: 'El aliado la ve en sus eventos.' }],
    accion: async (v) => { await llamarAdmin('validar_evento', { evento_id: evento, nota: v.nota }); return tras('Evento validado: +100.'); } });
  if (accion === 'rechazar_evento') pedir({ titulo: 'Rechazar evento', texto: `«${nombre}» no sumará puntos. El aliado verá el motivo.`, campos: [MOTIVO], confirmar: 'Rechazar', peligro: true,
    accion: async (v) => { await llamarAdmin('rechazar_evento', { evento_id: evento, motivo: v.motivo }); return tras('Evento rechazado.'); } });
  if (accion === 'anular_canje') pedir({ titulo: 'Anular canje', texto: `«${nombre}» de ${b.dataset.codigoCanje}: se devuelven ${puntos} puntos disponibles. El aliado verá el motivo.`,
    campos: [{ id: 'motivo', etiqueta: 'Motivo', tipo: 'area', obligatorio: true, minimo: 10, ayuda: 'Por qué no se entregó la recompensa.' }], confirmar: 'Anular y devolver puntos', peligro: true,
    accion: async (v) => { const r = await llamarAdmin('anular_canje', { canje_id: canje, motivo: v.motivo }); await recargar(); return `Canje anulado: se devolvieron ${r.puntos_devueltos} puntos.`; } });
  if (accion === 'invitar_operador') formularioOperador(null);
  if (accion === 'reinvitar_operador') formularioOperador(operadores.find((o) => o.operador_id === b.dataset.operador));
  if (accion === 'desactivar_operador') pedir({ titulo: 'Desactivar operador', texto: `${nombre} ya no podrá registrar canjes. Los canjes que registró se conservan.`, campos: [MOTIVO],
    confirmar: 'Desactivar', peligro: true,
    accion: async (v) => { await llamarAdmin('estado_operador', { operador_id: b.dataset.operador, activo: false, motivo: v.motivo }); await recargar(); return 'Operador desactivado.'; } });
  if (accion === 'reactivar_operador') pedir({ titulo: 'Reactivar operador', texto: `${nombre} podrá volver a registrar canjes.`, confirmar: 'Reactivar',
    accion: async () => { await llamarAdmin('estado_operador', { operador_id: b.dataset.operador, activo: true }); await recargar(); return 'Operador reactivado.'; } });
  if (accion === 'nueva_recompensa') formularioRecompensa(null);
  if (accion === 'editar_recompensa') formularioRecompensa(recompensas.find((r) => r.recompensa_id === recompensa));
  if (accion === 'resolver') {
    const clave = crypto.randomUUID();
    pedir({ titulo: 'Resolver conflicto', texto: `${nombre} · ${variable}.`,
      campos: [{ id: 'nota', etiqueta: 'Nota', tipo: 'area', obligatorio: true, minimo: 5 },
        { id: 'aceptar', etiqueta: 'Aceptar el valor de Clientify (cambia la calidad, no los puntos)', tipo: 'casilla' },
        { id: 'ajuste', etiqueta: 'Ajuste de puntos (opcional, ±)', tipo: 'numero' }],
      confirmar: 'Resolver',
      accion: async (v) => {
        const r = await llamarAdmin('resolver_conflicto', { conflicto_id: conflicto, nota: v.nota, aceptar_valor: v.aceptar, ajuste: v.ajuste === '' ? null : Number(v.ajuste), clave });
        return tras(r.puntos_aplicados != null ? `Conflicto resuelto con ajuste (aplicados ${r.puntos_aplicados}).` : 'Conflicto resuelto.');
      } });
  }
}

// Inicio y sesión ---------------------------------------------------------------------------------------------------

async function entrarAlPanel() {
  // Un admin puede leer todas las filas de `aliados` (RLS): se filtra por el usuario de la sesión.
  const { data: sesion } = await supabase.auth.getSession();
  const usuario = sesion && sesion.session && sesion.session.user;
  if (!usuario) return vista('vista-login');
  const { data: yo, error } = await supabase.from('aliados').select('nombre_completo, codigo_aliado, rol, estado').eq('id', usuario.id).maybeSingle();
  if (error || !yo || yo.rol !== 'admin' || yo.estado !== 'activo') return vista('vista-sin-acceso');
  $('quien').hidden = false;
  $('quien-nombre').textContent = `${yo.nombre_completo} · ${yo.codigo_aliado}`;
  vista('vista-panel');
  await cargarResumen();
  await irA(pestana);
}

async function iniciar() {
  try {
    const r = await fetch('/api/config', { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('config');
    const c = await r.json();
    supabase = createClient(c.supabaseUrl, c.supabasePublishableKey, { auth: { persistSession: true, autoRefreshToken: true } });
  } catch (e) {
    $('vista-cargando').innerHTML = '<p class="nota">No pudimos conectarnos. Recarga la página.</p>';
    return;
  }
  document.addEventListener('click', alHacerClic);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.abrir) abrirAliado(ev.target.dataset.abrir); });
  $('buscar-aliado').addEventListener('input', pintarAliados);
  $('filtro-estado').addEventListener('change', pintarAliados);
  $('filtro-eventos').addEventListener('change', () => cargarEventos().catch((e) => aviso(e.message)));
  $('ver-resueltos').addEventListener('change', () => cargarConflictos().catch((e) => aviso(e.message)));
  $('buscar-canje').addEventListener('input', pintarCanjes);
  $('filtro-canjes').addEventListener('change', pintarCanjes);
  $('salir').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });
  $('form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('login-boton').disabled = true; $('login-mensaje').textContent = '';
    const { error } = await supabase.auth.signInWithPassword({ email: $('login-correo').value.trim(), password: $('login-clave').value });
    $('login-boton').disabled = false;
    if (error) { $('login-mensaje').textContent = 'Correo o contraseña incorrectos, o correo sin confirmar.'; return; }
    $('login-clave').value = '';
    entrarAlPanel().catch((e) => aviso(e.message));
  });

  const { data } = await supabase.auth.getSession();
  if (!data.session) return vista('vista-login');
  entrarAlPanel().catch((e) => aviso(e.message));
}

iniciar();
