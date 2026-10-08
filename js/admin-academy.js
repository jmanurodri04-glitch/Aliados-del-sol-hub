// Pestaña «Academy» del panel (CLAUDE.md §4.9): minicursos con sus 6 pasos, certificaciones y herramientas.
//
// Lee las vistas v_admin_academy_* con la sesión del admin y guarda con POST /api/admin (guardar_curso,
// guardar_certificacion, guardar_herramienta, subir_archivo_herramienta). La base valida cada campo y deja cada cambio en
// la Auditoría. Los cursos no se borran: se ocultan (activo = false), así se conserva quién los completó.
// Todo texto que viene de la base se escapa antes de insertarlo en la página.

export const ESCUELAS = [['relaciones', 'Relaciones & Ventas'], ['ia', 'IA & Automatización'], ['negocios', 'Negocios & Competitividad'],
  ['finanzas', 'Finanzas'], ['energia', 'Energía & Sostenibilidad'], ['marca', 'Marca & Crecimiento Profesional'], ['ads', 'Aliados del Sol']];
export const FORMATOS = [['flash', 'Flash (3–7 min)'], ['micro', 'Microcurso (10–20 min)'], ['curso', 'Curso (30–45 min)'], ['masterclass', 'Masterclass (45–90 min)']];
const NIVELES = ['Principiante', 'Intermedio', 'Avanzado'];
const ALIADOS = [['todos', 'Todos'], ['financiero', 'Financieros'], ['referidor', 'Referidores / EMI'], ['gremio', 'Gremios']];
const RUTAS = [['', 'Ninguno'], ['e1', 'Energía · Nivel 1'], ['e2', 'Energía · Nivel 2'], ['e3', 'Energía · Nivel 3'], ['e4', 'Energía · Nivel 4']];
const ICONOS = [['book', 'Libro'], ['check', 'Lista'], ['calc', 'Calculadora'], ['ask', 'Preguntas'], ['cal', 'Calendario'], ['grid', 'Tabla'],
  ['scan', 'Lupa'], ['map', 'Mapa'], ['energia', 'Energía'], ['finanzas', 'Finanzas'], ['ia', 'IA'], ['marca', 'Marca'], ['relaciones', 'Relaciones'],
  ['negocios', 'Negocios'], ['ads', 'Sol']];
const TIPOS_ARCHIVO = ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];

/** Código a partir de un título (igual que el Hub): minúsculas, sin tildes, palabras unidas por guiones. */
export function codigoDe(texto, max = 80) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '').slice(0, max).replace(/-$/, '');
}

/** Datos del formulario de un curso → cuerpo de admin_guardar_curso. Quita lo vacío de las listas. */
export function datosDelCurso(m, nuevo) {
  const lineas = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
  return {
    nuevo, codigo: m.codigo, titulo: m.titulo.trim(), descripcion: m.descripcion.trim(), escuela: m.escuela, formato: m.formato,
    minutos: Number(m.minutos), nivel: m.nivel, aliados: m.aliados.length ? m.aliados : ['todos'], acceso: m.acceso,
    puntos: Number(m.puntos), ruta: m.ruta || null, destacado: !!m.destacado, nuevo_tag: !!m.nuevo, popular: !!m.popular,
    rapido: !!m.rapido, activo: !!m.activo, herramienta: m.herramienta,
    contenido: {
      aprenderas: lineas(m.aprenderas), contexto: m.contexto.trim(),
      lecciones: m.lecciones.map((l) => ({ titulo: l.titulo.trim(), texto: l.texto.trim() })).filter((l) => l.titulo || l.texto),
      ejercicio: m.ejercicio.trim(), pasos: lineas(m.pasos),
      quiz: m.quiz.map((q) => {
        const opciones = []; let correcta = -1;
        q.opciones.forEach((o, i) => { if (o.trim()) { if (i === q.correcta) correcta = opciones.length; opciones.push(o.trim()); } });
        return { pregunta: q.pregunta.trim(), opciones, correcta };
      }).filter((q) => q.pregunta || q.opciones.length),
      accion: m.accion.trim()
    }
  };
}

/** Curso de la vista (o vacío) → modelo del formulario. */
export function modeloDelCurso(c) {
  const k = (c && c.contenido) || {};
  return {
    codigo: c ? c.codigo : '', titulo: c ? c.titulo : '', descripcion: c ? c.descripcion || '' : '', escuela: c ? c.escuela : 'ads',
    formato: c ? c.formato : 'micro', minutos: c ? c.minutos : 15, nivel: c ? c.nivel : 'Principiante',
    aliados: c ? (c.aliados || ['todos']).slice() : ['todos'], acceso: c ? c.acceso : 'aliado', puntos: c ? c.puntos : 5,
    ruta: c ? c.ruta || '' : '', destacado: c ? c.destacado : false, nuevo: c ? c.nuevo : true, popular: c ? c.popular : false,
    rapido: c ? c.rapido : false, activo: c ? c.activo : true, herramienta: c ? c.herramienta : '',
    aprenderas: (k.aprenderas || []).join('\n'), contexto: k.contexto || '',
    lecciones: (k.lecciones || [{ titulo: '', texto: '' }]).map((l) => ({ titulo: l.titulo || '', texto: l.texto || '' })),
    ejercicio: k.ejercicio || '', pasos: (k.pasos || []).join('\n'),
    quiz: (k.quiz || [{ pregunta: '', opciones: ['', '', ''], correcta: 0 }]).map((q) => {
      const o = (q.opciones || []).slice(0, 4); while (o.length < 3) o.push('');
      return { pregunta: q.pregunta || '', opciones: o, correcta: q.correcta || 0 };
    }),
    accion: k.accion || ''
  };
}

export function crearAcademy({ cliente, llamarAdmin, leer, esc, aviso, numero, chip, $ }) {
  let vistaSub = 'cursos';
  let cursos = [];
  let certs = [];
  let herramientas = [];
  let q = '';
  let editor = null; // { tipo: 'curso' | 'cert' | 'herramienta', nuevo, m }
  const escuela = (id) => (ESCUELAS.find((e) => e[0] === id) || [id, id])[1];
  const opciones = (lista, valor) => lista.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(valor) ? 'selected' : ''}>${esc(t)}</option>`).join('');

  async function cargar() {
    const s = cliente();
    [cursos, certs, herramientas] = await Promise.all([
      leer(s.from('v_admin_academy_cursos').select('*').order('orden')),
      leer(s.from('v_admin_academy_certificaciones').select('*').order('orden')),
      leer(s.from('v_admin_academy_herramientas').select('*').order('orden'))
    ]);
    pintar();
  }

  function pintar() {
    $('aca-sub').innerHTML = [['cursos', `Minicursos (${cursos.length})`], ['certs', `Certificaciones (${certs.length})`], ['herramientas', `Herramientas (${herramientas.length})`]]
      .map(([id, t]) => `<button class="btn ${vistaSub === id && !editor ? 'primario' : ''}" data-accion="aca_sub" data-sub="${id}">${esc(t)}</button>`).join('')
      + `<span style="flex:1"></span>` + (editor ? '' : `<button class="btn primario" data-accion="aca_nuevo">${vistaSub === 'cursos' ? 'Nuevo minicurso' : vistaSub === 'certs' ? 'Nueva certificación' : 'Nueva herramienta'}</button>`);
    $('aca-lista').hidden = !!editor;
    $('aca-editor').hidden = !editor;
    if (editor) return pintarEditor();
    if (vistaSub === 'cursos') pintarCursos();
    if (vistaSub === 'certs') pintarCerts();
    if (vistaSub === 'herramientas') pintarHerramientas();
  }

  function pintarCursos() {
    const t = q.trim().toLowerCase();
    const lista = cursos.filter((c) => !t || (c.titulo + ' ' + c.codigo + ' ' + escuela(c.escuela)).toLowerCase().includes(t));
    $('aca-lista').innerHTML = `<div class="barra" style="padding:12px 12px 0"><input id="aca-buscar" placeholder="Buscar por título, código o escuela" value="${esc(q)}" style="max-width:360px"></div>`
      + (lista.length ? `<table><thead><tr><th>Minicurso</th><th>Escuela</th><th>Formato</th><th>Acceso</th><th>Puntos Sol</th><th>Completados</th><th>Estado</th><th></th></tr></thead><tbody>${lista.map((c) => `<tr>
        <td><b>${esc(c.titulo)}</b><span class="codigo">${esc(c.codigo)}</span><span class="sub">${esc(c.descripcion)}</span></td>
        <td>${esc(escuela(c.escuela))}</td>
        <td>${esc((FORMATOS.find((f) => f[0] === c.formato) || [, c.formato])[1].split(' (')[0])}<span class="sub">${numero(c.minutos)} min · ${esc(c.nivel)}</span></td>
        <td>${c.acceso === 'free' ? 'Gratis' : 'Solo aliados'}</td>
        <td>${c.puntos ? '+' + numero(c.puntos) : 'Sin puntos'}</td>
        <td>${numero(c.completados)}</td>
        <td>${c.activo ? chip('activo', 'Visible') : chip('', 'Oculto')}</td>
        <td><button class="btn" data-accion="aca_editar_curso" data-aca="${esc(c.codigo)}">Editar</button></td>
      </tr>`).join('')}</tbody></table>` : '<p class="vacio">No hay minicursos con esa búsqueda.</p>');
  }

  function pintarCerts() {
    const titulo = (id) => (cursos.find((c) => c.codigo === id) || { titulo: id }).titulo;
    $('aca-lista').innerHTML = certs.length ? `<table><thead><tr><th>Certificación</th><th>Escuela</th><th>Minicursos</th><th>Estado</th><th></th></tr></thead><tbody>${certs.map((c) => `<tr>
      <td><b>${esc(c.nombre)}</b><span class="codigo">${esc(c.sigla)} · ${esc(c.codigo)}</span><span class="sub">${esc(c.descripcion)}</span></td>
      <td>${esc(escuela(c.escuela))}</td>
      <td>${numero(c.cursos.length)}<span class="sub">${esc(c.cursos.slice(0, 3).map(titulo).join(' · '))}${c.cursos.length > 3 ? '…' : ''}</span></td>
      <td>${c.activa ? chip('activo', 'Visible') : chip('', 'Oculta')}</td>
      <td><button class="btn" data-accion="aca_editar_cert" data-aca="${esc(c.codigo)}">Editar</button></td>
    </tr>`).join('')}</tbody></table>` : '<p class="vacio">Aún no hay certificaciones.</p>';
  }

  function pintarHerramientas() {
    $('aca-lista').innerHTML = herramientas.length ? `<table><thead><tr><th>Herramienta</th><th>Categoría</th><th>Material</th><th>Acceso</th><th>Cursos</th><th>Estado</th><th></th></tr></thead><tbody>${herramientas.map((h) => `<tr>
      <td><b>${esc(h.nombre)}</b><span class="codigo">${esc(h.codigo)}</span><span class="sub">${esc(h.descripcion)}</span></td>
      <td>${esc(h.categoria)}</td>
      <td>${h.archivo_path ? `Archivo subido<span class="sub">${esc(h.archivo_nombre)}</span>` : 'Incorporado en el Hub'}</td>
      <td>${h.acceso === 'free' ? 'Gratis' : 'Solo aliados'}</td>
      <td>${numero(h.cursos)}</td>
      <td>${h.activa ? chip('activo', 'Visible') : chip('', 'Oculta')}</td>
      <td><button class="btn" data-accion="aca_editar_herramienta" data-aca="${esc(h.codigo)}">Editar</button></td>
    </tr>`).join('')}</tbody></table>` : '<p class="vacio">Aún no hay herramientas.</p>';
  }

  // Editores -------------------------------------------------------------------------------------------------------

  const campo = (etiqueta, html, ayuda) => `<label class="aca-campo"><span>${esc(etiqueta)}</span>${html}${ayuda ? `<small>${esc(ayuda)}</small>` : ''}</label>`;
  const txt = (k, v, extra = '') => `<input data-k="${k}" value="${esc(v)}" ${extra}>`;
  const area = (k, v, filas = 4, extra = '') => `<textarea data-k="${k}" rows="${filas}" ${extra}>${esc(v)}</textarea>`;
  const sel = (k, lista, v) => `<select data-k="${k}">${opciones(lista, v)}</select>`;
  const casilla = (k, v, t) => `<label class="aca-casilla"><input type="checkbox" data-k="${k}" ${v ? 'checked' : ''}> ${esc(t)}</label>`;
  const paso = (n, nombre, ayuda, cuerpo) => `<fieldset class="aca-paso"><legend><b>${n}</b> ${esc(nombre)}</legend>${ayuda ? `<p class="nota">${esc(ayuda)}</p>` : ''}${cuerpo}</fieldset>`;

  function pintarEditor() {
    const { tipo, nuevo, m } = editor;
    let html = '';
    if (tipo === 'curso') {
      html = `<h2>${nuevo ? 'Nuevo minicurso' : 'Editar minicurso'}</h2>
      <p class="nota">Todos los minicursos siguen los mismos 6 pasos. Al completarlos, el aliado suma +5 Puntos Sol (máximo 20 al mes) y los XP de su formato.</p>
      <div class="aca-grilla">
        ${campo('Título', txt('titulo', m.titulo, 'maxlength="120"'))}
        ${campo('Código', txt('codigo', m.codigo, nuevo ? 'maxlength="80"' : 'readonly'), nuevo ? 'Se arma con el título. No se puede cambiar después.' : 'No cambia.')}
        ${campo('Escuela', sel('escuela', ESCUELAS, m.escuela))}
        ${campo('Formato', sel('formato', FORMATOS, m.formato), 'Define los XP: Flash 10, Microcurso 30, Curso 75, Masterclass 100.')}
        ${campo('Duración (minutos)', txt('minutos', m.minutos, 'type="number" min="1" max="240"'))}
        ${campo('Nivel', sel('nivel', NIVELES.map((n) => [n, n]), m.nivel))}
        ${campo('Acceso', sel('acceso', [['aliado', 'Solo aliados'], ['free', 'Gratis (también sin sesión)']], m.acceso))}
        ${campo('Puntos Sol', sel('puntos', [['5', '+5 al completarlo'], ['0', 'Sin puntos']], String(m.puntos)))}
        ${campo('Nivel de la escuela Energía', sel('ruta', RUTAS, m.ruta), 'Solo para los cursos de Energía por niveles.')}
      </div>
      ${campo('Descripción corta', area('descripcion', m.descripcion, 2, 'maxlength="300"'), 'Se ve en las tarjetas del catálogo (máx. 300 caracteres).')}
      <div class="aca-fila"><span>Para</span>${ALIADOS.map(([v, t]) => `<label class="aca-casilla"><input type="checkbox" data-aliado="${v}" ${m.aliados.includes(v) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>
      <div class="aca-fila"><span>Etiquetas</span>${casilla('destacado', m.destacado, 'Destacado')}${casilla('nuevo', m.nuevo, 'Nuevo')}${casilla('popular', m.popular, 'Popular')}${casilla('rapido', m.rapido, '«Aprende en 5 minutos»')}${casilla('activo', m.activo, 'Visible en la Academy')}</div>
      ${paso(1, 'Contexto', '¿Por qué esto importa? Separa los párrafos con una línea en blanco.', area('contexto', m.contexto, 6))}
      ${paso(2, 'Aprende', 'Lo que aprenderás y de 1 a 8 microlecciones.', campo('Lo que aprenderás (un punto por línea)', area('aprenderas', m.aprenderas, 4))
        + m.lecciones.map((l, i) => `<div class="aca-item"><div class="aca-item-cab"><b>Microlección ${i + 1}</b>${botones('leccion', i, m.lecciones.length)}</div>
          <input data-l="${i}" data-f="titulo" value="${esc(l.titulo)}" placeholder="Título" maxlength="160">
          <textarea data-l="${i}" data-f="texto" rows="5" placeholder="Texto (párrafos separados por una línea en blanco)">${esc(l.texto)}</textarea></div>`).join('')
        + (m.lecciones.length < 8 ? `<button class="btn" data-accion="aca_agregar" data-lista="leccion">+ Microlección</button>` : ''))}
      ${paso(3, 'Aplica', 'El ejercicio guiado y, si quieres, sus pasos.', campo('Ejercicio', area('ejercicio', m.ejercicio, 3)) + campo('Pasos del ejercicio (uno por línea, opcional)', area('pasos', m.pasos, 4)))}
      ${paso(4, 'Descarga', 'La herramienta que se descarga en este paso.', campo('Herramienta', `<select data-k="herramienta">${opciones([['', 'Elige una herramienta']].concat(herramientas.map((h) => [h.codigo, h.nombre + (h.activa ? '' : ' (oculta)')])), m.herramienta)}</select>`))}
      ${paso(5, 'Comprueba', 'De 1 a 5 preguntas, cada una con 2 a 4 opciones. Marca la correcta.', m.quiz.map((pq, i) => `<div class="aca-item"><div class="aca-item-cab"><b>Pregunta ${i + 1}</b>${botones('pregunta', i, m.quiz.length)}</div>
          <input data-q="${i}" data-f="pregunta" value="${esc(pq.pregunta)}" placeholder="Pregunta" maxlength="300">
          ${[0, 1, 2, 3].map((o) => `<label class="aca-opcion"><input type="radio" name="aca-q${i}" data-q="${i}" data-f="correcta" value="${o}" ${pq.correcta === o ? 'checked' : ''} title="Respuesta correcta">
            <input data-q="${i}" data-f="o${o}" value="${esc(pq.opciones[o] || '')}" placeholder="Opción ${String.fromCharCode(65 + o)}${o > 1 ? ' (opcional)' : ''}" maxlength="200"></label>`).join('')}</div>`).join('')
        + (m.quiz.length < 5 ? `<button class="btn" data-accion="aca_agregar" data-lista="pregunta">+ Pregunta</button>` : ''))}
      ${paso(6, 'Activa', 'Una acción concreta para esta semana.', area('accion', m.accion, 2))}`;
    }
    if (tipo === 'cert') {
      const titulo = (id) => (cursos.find((c) => c.codigo === id) || { titulo: id + ' (no existe)' }).titulo;
      const libres = cursos.filter((c) => !m.cursos.includes(c.codigo));
      html = `<h2>${nuevo ? 'Nueva certificación' : 'Editar certificación'}</h2>
      <p class="nota">El aliado la obtiene al completar todos sus minicursos (+300 XP). Al tocarla en la Academy ve estos minicursos en este orden.</p>
      <div class="aca-grilla">
        ${campo('Nombre', txt('nombre', m.nombre, 'maxlength="80"'))}
        ${campo('Código', txt('codigo', m.codigo, nuevo ? 'maxlength="60"' : 'readonly'), nuevo ? 'Se arma con el nombre. No se puede cambiar después.' : 'No cambia.')}
        ${campo('Escuela', sel('escuela', ESCUELAS, m.escuela))}
        ${campo('Sigla del sello', txt('sigla', m.sigla, 'maxlength="3" style="text-transform:uppercase"'), 'De 1 a 3 letras, p. ej. AI.')}
      </div>
      ${campo('Descripción', area('descripcion', m.descripcion, 2, 'maxlength="300"'))}
      <div class="aca-fila">${casilla('activa', m.activa, 'Visible en la Academy')}</div>
      <fieldset class="aca-paso"><legend>Minicursos (${m.cursos.length})</legend>
        ${m.cursos.map((id, i) => `<div class="aca-item aca-item-fila"><span><b>${i + 1}.</b> ${esc(titulo(id))}</span>${botones('curso', i, m.cursos.length)}</div>`).join('') || '<p class="nota">Agrega al menos un minicurso.</p>'}
        <div class="aca-fila"><select id="aca-cert-agregar">${opciones([['', 'Agregar un minicurso…']].concat(libres.map((c) => [c.codigo, escuela(c.escuela).split(' ')[0] + ' · ' + c.titulo])), '')}</select></div>
      </fieldset>`;
    }
    if (tipo === 'herramienta') {
      html = `<h2>${nuevo ? 'Nueva herramienta' : 'Editar herramienta'}</h2>
      <p class="nota">Se ve en «ADS Tools» y en el paso «Descarga» de los cursos que la usen. ${nuevo ? 'Sube el archivo que se descarga.' : m.archivo_path ? '' : 'Esta herramienta trae su material incorporado en el Hub; si subes un archivo, se descargará el archivo en su lugar.'}</p>
      <div class="aca-grilla">
        ${campo('Nombre', txt('nombre', m.nombre, 'maxlength="80"'))}
        ${campo('Código', txt('codigo', m.codigo, nuevo ? 'maxlength="42"' : 'readonly'), nuevo ? 'Empieza por t-. No se puede cambiar después.' : 'No cambia.')}
        ${campo('Categoría', txt('categoria', m.categoria, 'maxlength="40"'), 'P. ej. Energía, Finanzas, IA.')}
        ${campo('Ícono', sel('icono', ICONOS, m.icono))}
        ${campo('Acceso', sel('acceso', [['aliado', 'Solo aliados'], ['free', 'Gratis (también sin sesión)']], m.acceso))}
      </div>
      ${campo('Descripción', area('descripcion', m.descripcion, 2, 'maxlength="300"'))}
      ${campo('Archivo (PDF, Excel, Word o PowerPoint, máx. 10 MB)', `<input type="file" id="aca-archivo" accept=".pdf,.xlsx,.docx,.pptx">`,
        m.archivo ? 'Nuevo archivo: ' + m.archivo.name : m.archivo_path ? 'Archivo actual: ' + (m.archivo_nombre || 'archivo subido') : '')}
      <div class="aca-fila">${casilla('activa', m.activa, 'Visible en la Academy')}</div>`;
    }
    $('aca-editor').innerHTML = html + `<div class="barra" style="margin-top:18px"><button class="btn primario" data-accion="aca_guardar">Guardar</button><button class="btn" data-accion="aca_cancelar">Cancelar</button><span class="nota" id="aca-error" style="color:#C97B6E"></span></div>`;
  }

  function botones(lista, i, total) {
    return `<span class="acciones">${i > 0 ? `<button class="btn" data-accion="aca_mover" data-lista="${lista}" data-i="${i}" data-d="-1" title="Subir">↑</button>` : ''}${i < total - 1 ? `<button class="btn" data-accion="aca_mover" data-lista="${lista}" data-i="${i}" data-d="1" title="Bajar">↓</button>` : ''}${total > 1 || lista === 'curso' ? `<button class="btn peligro" data-accion="aca_quitar" data-lista="${lista}" data-i="${i}">Quitar</button>` : ''}</span>`;
  }
  const lista = (nombre) => editor.m[{ leccion: 'lecciones', pregunta: 'quiz', curso: 'cursos' }[nombre]];

  // Lee lo escrito en el formulario (sin volver a pintar, para no perder el foco).
  function alEscribir(ev) {
    if (!editor) return;
    const el = ev.target; const m = editor.m;
    // Casillas, opciones, listas y archivos se leen solo en «change» (también disparan «input»).
    const deCambio = el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT' || el.type === 'file';
    if (deCambio !== (ev.type === 'change')) return;
    if (el.dataset.k) {
      const k = el.dataset.k;
      m[k] = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'sigla') m.sigla = el.value.toUpperCase();
      // El código sigue al título mientras sea nuevo.
      if (editor.nuevo && (k === 'titulo' || k === 'nombre')) {
        m.codigo = editor.tipo === 'herramienta' ? 't-' + codigoDe(el.value, 40) : codigoDe(el.value, editor.tipo === 'cert' ? 60 : 80);
        const c = document.querySelector('#aca-editor [data-k="codigo"]'); if (c) c.value = m.codigo;
      }
    }
    if (el.dataset.aliado) {
      const v = el.dataset.aliado;
      m.aliados = el.checked ? (v === 'todos' ? ['todos'] : m.aliados.filter((a) => a !== 'todos').concat(v)) : m.aliados.filter((a) => a !== v);
      if (v === 'todos' || (el.checked && m.aliados.length)) pintarEditor();
    }
    if (el.dataset.l) m.lecciones[+el.dataset.l][el.dataset.f] = el.value;
    if (el.dataset.q) {
      const pq = m.quiz[+el.dataset.q];
      if (el.dataset.f === 'pregunta') pq.pregunta = el.value;
      else if (el.dataset.f === 'correcta') pq.correcta = +el.value;
      else pq.opciones[+el.dataset.f.slice(1)] = el.value;
    }
    if (el.id === 'aca-cert-agregar' && el.value) { m.cursos.push(el.value); pintarEditor(); }
    if (el.id === 'aca-archivo') {
      const a = el.files && el.files[0];
      if (a && (!TIPOS_ARCHIVO.includes(a.type) || a.size > 10 * 1024 * 1024)) { el.value = ''; aviso('El archivo debe ser PDF, Excel, Word o PowerPoint de máximo 10 MB.'); return; }
      m.archivo = a || null; pintarEditor();
    }
  }

  async function guardar() {
    const { tipo, nuevo, m } = editor;
    const err = $('aca-error'); err.textContent = '';
    try {
      if (tipo === 'curso') {
        const d = datosDelCurso(m, nuevo);
        if (d.contenido.quiz.some((x) => x.correcta < 0)) throw new Error('Marca la respuesta correcta de cada pregunta (debe ser una opción con texto).');
        await llamarAdmin('guardar_curso', { datos: d });
      }
      if (tipo === 'cert') {
        await llamarAdmin('guardar_certificacion', { datos: { nuevo, codigo: m.codigo, nombre: m.nombre.trim(), descripcion: m.descripcion.trim(), escuela: m.escuela, sigla: m.sigla.trim().toUpperCase(), cursos: m.cursos, activa: !!m.activa } });
      }
      if (tipo === 'herramienta') {
        const datos = { nuevo, codigo: m.codigo, nombre: m.nombre.trim(), categoria: m.categoria.trim(), icono: m.icono, descripcion: m.descripcion.trim(), acceso: m.acceso, activa: !!m.activa };
        if (m.archivo) {
          const a = m.archivo;
          const { ruta, token } = await llamarAdmin('subir_archivo_herramienta', { tipo: a.type, tamano: a.size });
          const { error } = await cliente().storage.from('academy').uploadToSignedUrl(ruta, token, a, { contentType: a.type });
          if (error) throw new Error('No pudimos subir el archivo. Intenta de nuevo.');
          datos.archivo_path = ruta; datos.archivo_nombre = a.name.slice(0, 120);
        }
        await llamarAdmin('guardar_herramienta', { datos });
      }
      editor = null;
      await cargar();
      aviso(nuevo ? 'Creado. Ya se ve en la Academy.' : 'Guardado. Los aliados lo ven al recargar el Hub.');
    } catch (e) {
      err.textContent = e.message;
      aviso(e.message);
    }
  }

  function abrir(tipo, codigo) {
    if (tipo === 'curso') {
      const c = codigo ? cursos.find((x) => x.codigo === codigo) : null;
      const m = modeloDelCurso(c);
      if (!c) m.herramienta = (herramientas[0] || {}).codigo || '';
      editor = { tipo, nuevo: !c, m };
    }
    if (tipo === 'cert') {
      const c = codigo ? certs.find((x) => x.codigo === codigo) : null;
      editor = { tipo, nuevo: !c, m: c ? { codigo: c.codigo, nombre: c.nombre, descripcion: c.descripcion, escuela: c.escuela, sigla: c.sigla, activa: c.activa, cursos: c.cursos.slice() }
        : { codigo: '', nombre: '', descripcion: '', escuela: 'ads', sigla: '', activa: true, cursos: [] } };
    }
    if (tipo === 'herramienta') {
      const h = codigo ? herramientas.find((x) => x.codigo === codigo) : null;
      editor = { tipo, nuevo: !h, m: h ? Object.assign({}, h, { archivo: null }) : { codigo: 't-', nombre: '', categoria: '', icono: 'book', descripcion: '', acceso: 'aliado', activa: true, archivo: null } };
    }
    pintar();
    window.scrollTo(0, 0);
  }

  // Botones de la pestaña. Devuelve true si la acción era de la Academy.
  function clic(b) {
    const { accion } = b.dataset;
    if (!accion || !accion.startsWith('aca_')) return false;
    if (accion === 'aca_sub') { vistaSub = b.dataset.sub; editor = null; pintar(); }
    if (accion === 'aca_nuevo') abrir(vistaSub === 'cursos' ? 'curso' : vistaSub === 'certs' ? 'cert' : 'herramienta');
    if (accion === 'aca_editar_curso') abrir('curso', b.dataset.aca);
    if (accion === 'aca_editar_cert') abrir('cert', b.dataset.aca);
    if (accion === 'aca_editar_herramienta') abrir('herramienta', b.dataset.aca);
    if (accion === 'aca_cancelar') { editor = null; pintar(); }
    if (accion === 'aca_guardar') { b.disabled = true; guardar().finally(() => { b.disabled = false; }); }
    if (accion === 'aca_agregar') {
      if (b.dataset.lista === 'leccion') editor.m.lecciones.push({ titulo: '', texto: '' });
      if (b.dataset.lista === 'pregunta') editor.m.quiz.push({ pregunta: '', opciones: ['', '', ''], correcta: 0 });
      pintarEditor();
    }
    if (accion === 'aca_quitar') { lista(b.dataset.lista).splice(+b.dataset.i, 1); pintarEditor(); }
    if (accion === 'aca_mover') {
      const l = lista(b.dataset.lista); const i = +b.dataset.i; const j = i + +b.dataset.d;
      [l[i], l[j]] = [l[j], l[i]]; pintarEditor();
    }
    return true;
  }

  document.addEventListener('input', alEscribir);
  document.addEventListener('change', alEscribir);
  document.addEventListener('input', (ev) => { if (!editor && ev.target.id === 'aca-buscar') { q = ev.target.value; pintarCursos(); const s = $('aca-buscar'); s.focus(); s.setSelectionRange(q.length, q.length); } });

  return { cargar, clic };
}
