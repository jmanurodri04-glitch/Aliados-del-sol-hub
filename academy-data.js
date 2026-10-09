/* ADS Academy · datos fijos del Hub y armado del catálogo (CLAUDE.md §4.9).
   Los minicursos, las certificaciones y las herramientas viven en la base y se administran desde el panel: js/supabase.js
   llama a public.academy_catalogo() y deja el resultado en window.ADS_ACADEMY_CATALOGO (evento ads:academy-catalogo).
   Aquí quedan las escuelas, los formatos, la tabla de XP, las rutas por tipo de aliado y los 6 pasos de cada curso; con el
   catálogo se arma window.ADS_ACADEMY (esquema que lee ADSAcademy.dc.html) y se avisa con el evento ads:academy.
   Los XP son solo de la Academy: no se convierten en Puntos Sol. */
(function () {
  const slug = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const ICONS = {
    relaciones: 'M10 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0M3 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M11 6.8L6 16.3M13 6.8l5 9.5M7 18h10',
    ia: 'M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0zM20 3v4M22 5h-4',
    negocios: 'M22 7l-8.5 8.5-5-5L2 17M16 7h6v6',
    finanzas: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M15.5 8.5h-5a2 2 0 1 0 0 4h3a2 2 0 1 1 0 4h-5M12 18.5v-13',
    energia: 'M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
    marca: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2zM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5',
    ads: 'M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 3v1M12 20v1M3 12h1M20 12h1M18.36 5.64l-.7.7M6.34 17.66l-.7.7M5.64 5.64l.7.7M17.66 17.66l.7.7',
    map: 'M5 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M15 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M10 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M9 6h6M8 7.5l3 9M16 7.5l-3 9',
    check: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
    book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5V21h16',
    calc: 'M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01',
    ask: 'M7.9 20A9 9 0 1 0 4 16.1L2 22zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
    cal: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M8 2v4M16 2v4',
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    scan: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M21 21l-4.3-4.3M8.5 11l2 2 3.5-3.5'
  };

  const SCHOOLS = [
    { id: 'relaciones', name: 'Relaciones & Ventas', short: 'Relaciones', icon: ICONS.relaciones, tone: '#F9A51A', desc: 'Aprende networking, venta consultiva, negociación, prospección y generación de oportunidades.' },
    { id: 'ia', name: 'IA & Automatización', short: 'IA', icon: ICONS.ia, tone: '#FFCA05', desc: 'Usa inteligencia artificial y automatización para trabajar mejor, ahorrar tiempo y multiplicar tu capacidad profesional.' },
    { id: 'negocios', name: 'Negocios & Competitividad', short: 'Negocios', icon: ICONS.negocios, tone: '#E8B45A', desc: 'Estrategia, crecimiento, innovación, tendencias y herramientas para tomar mejores decisiones empresariales.' },
    { id: 'finanzas', name: 'Finanzas para Negocios', short: 'Finanzas', icon: ICONS.finanzas, tone: '#D9C08A', desc: 'Aprende a entender ROI, flujo de caja, CAPEX, OPEX, financiación y decisiones de inversión.' },
    { id: 'energia', name: 'Energía & Sostenibilidad', short: 'Energía', icon: ICONS.energia, tone: '#F37920', desc: 'Comprende energía, sostenibilidad y transición energética desde una perspectiva empresarial.' },
    { id: 'marca', name: 'Marca & Crecimiento Profesional', short: 'Marca', icon: ICONS.marca, tone: '#C9A46A', desc: 'LinkedIn, comunicación, liderazgo, marca personal y posicionamiento profesional.' },
    { id: 'ads', name: 'Aliados del Sol', short: 'Aliados del Sol', icon: ICONS.ads, tone: '#FFCA05', desc: 'Todo lo necesario para identificar oportunidades, referir empresas y aprovechar el ecosistema Aliados del Sol.' }
  ];

  const FORMATS = [
    { id: 'flash', name: 'Flash', range: '3–7 min', xp: 10 },
    { id: 'micro', name: 'Microcurso', range: '10–20 min', xp: 30 },
    { id: 'curso', name: 'Curso', range: '30–45 min', xp: 75 },
    { id: 'masterclass', name: 'Masterclass', range: '45–90 min', xp: 100 },
    { id: 'tool', name: 'Tool', range: '', xp: 0 },
    { id: 'cert', name: 'Certificación', range: '', xp: 300 }
  ];
  const XP_RULES = [
    { k: 'Flash', xp: 10 }, { k: 'Microcurso', xp: 30 }, { k: 'Curso', xp: 75 },
    { k: 'Masterclass', xp: 100 }, { k: 'Certificación', xp: 300 }
  ];
  const XP_LEVELS = [
    { n: 1, name: 'Explorador', min: 0 }, { n: 2, name: 'Aprendiz', min: 150 }, { n: 3, name: 'Practicante', min: 400 },
    { n: 4, name: 'Profesional', min: 800 }, { n: 5, name: 'Experto', min: 1400 }, { n: 6, name: 'Referente', min: 2200 }
  ];
  const LEVELS = ['Principiante', 'Intermedio', 'Avanzado'];
  const ALLY_TYPES = [
    { id: 'todos', name: 'Todos' }, { id: 'financiero', name: 'Financieros' },
    { id: 'referidor', name: 'Referidores / EMI' }, { id: 'gremio', name: 'Gremios' }
  ];


  const ENERGY_LEVELS = [
    { id: 'e1', n: 1, name: 'Energía para empresarios', items: ['Cómo funciona una factura de energía', 'Mercado energético colombiano explicado fácil', 'Por qué cambia el precio de la energía', 'kW, kWh y demanda', 'Energía como costo empresarial', 'Introducción a la autogeneración'] },
    { id: 'e2', n: 2, name: 'Solar para no ingenieros', items: ['Cómo funciona un sistema fotovoltaico', 'Sistemas On-Grid', 'Sistemas Off-Grid', 'Sistemas híbridos', 'Componentes principales', 'Vida útil', 'Mantenimiento', 'Riesgos'] },
    { id: 'e3', n: 3, name: 'Solar como inversión', items: ['CAPEX', 'Ahorro', 'Payback', 'TIR', 'Flujo de caja', 'Financiación', 'Incentivos', 'Riesgo'] },
    { id: 'e4', n: 4, name: 'Detectar oportunidades', items: ['Qué empresas son atractivas', 'Consumo', 'Operación', 'Cubierta', 'Ubicación', 'Factura', 'Preguntas de diagnóstico'] }
  ];

  /* Rutas por tipo de aliado: títulos originales de los cursos (su código es el slug del título y no cambia). */
  const PATHS = [
    { id: 'asesor-360', ally: 'financiero', name: 'Asesor Empresarial 360', desc: 'Convierte conversaciones financieras en conversaciones estratégicas de negocio.', cert: 'business-finance',
      courses: ['Conversaciones empresariales más allá del crédito', 'Finanzas corporativas aplicadas al cliente empresarial', 'Cómo detectar oportunidades de financiación', 'Cómo convertir datos en conversaciones ejecutivas', 'IA para ejecutivos financieros', 'Cómo preparar una reunión empresarial con IA', 'Sostenibilidad en lenguaje financiero', 'Cómo analizar una inversión solar', 'Energía como conversación de banca empresarial', 'Radar de oportunidades'] },
    { id: 'conector', ally: 'referidor', name: 'Conector de Negocios', desc: 'Convierte relaciones, conocimiento y confianza en nuevas oportunidades.', cert: 'business-connector',
      courses: ['Convierte tu red en oportunidades', 'Cómo identificar oportunidades sin vender', 'Venta consultiva para personas que no son vendedores', 'Cómo hacer una introducción de alto valor', 'Cómo proteger tu reputación al referir', 'Networking estratégico', 'LinkedIn para generar oportunidades', 'Marca personal para consultores', 'IA para profesionales independientes', 'Automatiza tus seguimientos', 'Negociación y manejo de objeciones', 'Cómo identificar una oportunidad solar en 5 minutos', 'De contacto a Referido Perfecto', 'Qué ocurre después de referir'] },
    { id: 'community-leader', ally: 'gremio', name: 'Community & Business Leader', desc: 'Diseña contenidos, experiencias y comunidades que generen verdadero valor empresarial.', cert: 'community-builder',
      courses: ['Contenidos que los empresarios sí quieran consumir', 'Cómo construir una agenda empresarial relevante', 'IA para equipos gremiales', 'Cómo crear un evento empresarial de alto valor', 'Eventos que generan comunidad', 'Cómo aumentar participación de afiliados', 'Cómo medir el impacto de un evento', 'Cómo convertir datos en contenido gremial', 'IA para construir informes y benchmarks', 'Competitividad energética empresarial', 'Cómo construir alianzas empresa–gremio', 'Tendencias empresariales 2027'] }
  ].map(p => Object.assign(p, { courses: p.courses.map(slug) }));

  const AI_FEATURED = ['IA generativa desde cero', 'Prompting para profesionales', 'ChatGPT y Claude para trabajar más rápido', 'IA para reuniones', 'IA para analizar información', 'Crea tu primer asistente de IA', 'Automatizaciones sin programar', 'IA responsable'].map(slug);

  /* Metodología consistente para todos los cursos */
  const METHOD = [
    { id: 'contexto', name: 'Contexto', q: '¿Por qué esto importa?' },
    { id: 'aprende', name: 'Aprende', q: '3–5 microlecciones' },
    { id: 'aplica', name: 'Aplica', q: 'Ejercicio guiado' },
    { id: 'descarga', name: 'Descarga', q: 'Material descargable' },
    { id: 'comprueba', name: 'Comprueba', q: 'Quiz corto' },
    { id: 'activa', name: 'Activa', q: 'Una acción concreta' }
  ];


  const ACCESS = {
    free: { label: 'Gratis', desc: 'Disponible en la versión abierta del Hub.' },
    aliado: { label: 'Aliados', desc: 'Exclusivo para aliados registrados en el Hub.' },
    perks: ['Todos los cursos y rutas', 'Herramientas descargables', 'Progreso, XP y certificaciones', '+5 Puntos Sol por minicurso, +10 la masterclass (máximo 40 al mes) y +15 por certificación']
  };

  const FMT = {}; FORMATS.forEach(f => { FMT[f.id] = f; });

  /* Catálogo de la base → esquema del componente. */
  function build(cat) {
    const COURSES = (cat.cursos || []).filter(x => FMT[x.formato] && SCHOOLS.some(s => s.id === x.escuela)).map(x => {
      const k = x.contenido || {};
      const lessons = (k.lecciones || []).map(l => ({ t: l.titulo || '', b: l.texto || '' }));
      const content = {
        learn: k.aprenderas || [], contexto: k.contexto || '', aplica: k.ejercicio || '', pasos: k.pasos || [], activa: k.accion || '', tool: x.herramienta
      };
      return {
        id: x.codigo, slug: x.codigo, title: x.titulo, shortDescription: x.descripcion || '', longDescription: content.contexto,
        school: x.escuela, learningPath: x.ruta || null, allyType: (x.aliados || ['todos']).slice(),
        level: x.nivel, duration: x.minutos, format: x.formato, xp: FMT[x.formato].xp, points: x.puntos || 0,
        thumbnail: null, featured: !!x.destacado, new: !!x.nuevo, popular: !!x.popular, quick: !!x.rapido,
        progress: 0, lessons, resources: [], tools: [x.herramienta], content,
        quiz: (k.quiz || []).map(q => ({ q: q.pregunta, o: q.opciones || [], a: q.correcta })),
        certificate: null, author: 'Equipo GEENERA', publishDate: x.publicado || '', popularity: x.popularidad || 0,
        access: x.acceso === 'free' ? 'free' : 'aliado', full: !!x.completo, ready: true
      };
    });
    const ids = {}; COURSES.forEach(c => { ids[c.id] = c; });
    const P = PATHS.map(p => Object.assign({}, p, { courses: p.courses.filter(id => ids[id]) }));
    P.forEach(p => p.courses.forEach(id => { if (!ids[id].learningPath) ids[id].learningPath = p.id; }));
    const CERTS = (cat.certificaciones || []).map(c => ({ id: c.codigo, name: c.nombre, desc: c.descripcion, school: c.escuela, mark: c.sigla, courses: (c.cursos || []).filter(id => ids[id]) }));
    const base = (window.ADS_ACADEMY_BASE_URL || '');
    const TOOLS = (cat.herramientas || []).map(t => ({
      id: t.codigo, name: t.nombre, cat: t.categoria, icon: ICONS[t.icono] || ICONS.book, desc: t.descripcion,
      access: t.acceso === 'free' ? 'free' : 'aliado', kind: t.archivo_path ? 'Descargar' : 'Ver y descargar',
      file: t.archivo_path ? { url: base + '/storage/v1/object/public/academy/' + t.archivo_path, name: t.archivo_nombre || t.nombre } : null
    }));
    return { ICONS, SCHOOLS, FORMATS, XP_RULES, XP_LEVELS, LEVELS, ALLY_TYPES, COURSES, PATHS: P, ENERGY_LEVELS, AI_FEATURED: AI_FEATURED.filter(id => ids[id]), CERTS, TOOLS, MASTERCLASSES: [], METHOD, ACCESS, slug };
  }

  function publicar() {
    const cat = window.ADS_ACADEMY_CATALOGO;
    if (!cat) return;
    window.ADS_ACADEMY = build(cat);
    window.dispatchEvent(new CustomEvent('ads:academy'));
  }
  window.ADS_ACADEMY_BUILD = build;
  window.addEventListener('ads:academy-catalogo', publicar);
  publicar();
})();
