/* ADS Academy · datos listos para migrar a base de datos / CMS.
   Cada curso sigue el esquema: id, title, slug, shortDescription, longDescription, school, learningPath,
   allyType, level, duration, format, xp, thumbnail, featured, new, popular, progress, lessons, resources,
   tools, quiz, certificate, author, publishDate. Los componentes solo leen esta estructura. */
(function () {
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
    { k: 'Masterclass', xp: 100 }, { k: 'Evaluación', xp: 50 }, { k: 'Certificación', xp: 300 }
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

  /* [título, escuela, formato, minutos, nivel, aliados, flags, descripción corta] */
  const RAW = [
    // Financieros · Asesor Empresarial 360
    ['Conversaciones empresariales más allá del crédito', 'relaciones', 'micro', 16, 0, 'financiero', 'p', 'Pasa de ofrecer productos a entender la agenda del gerente.'],
    ['Finanzas corporativas aplicadas al cliente empresarial', 'finanzas', 'curso', 40, 1, 'financiero', '', 'Lee estados financieros para anticipar necesidades, no solo riesgos.'],
    ['Cómo detectar oportunidades de financiación', 'finanzas', 'micro', 18, 1, 'financiero', 'p', 'Señales en la operación del cliente que anticipan una inversión.'],
    ['Cómo convertir datos en conversaciones ejecutivas', 'negocios', 'micro', 15, 1, 'financiero', '', 'Tres cifras bien elegidas valen más que un informe de 20 páginas.'],
    ['IA para ejecutivos financieros', 'ia', 'curso', 35, 0, 'financiero', 'n', 'Casos de uso reales para análisis, preparación y seguimiento.'],
    ['Cómo preparar una reunión empresarial con IA', 'ia', 'micro', 14, 0, 'financiero,referidor', 'p', 'Investiga la empresa, arma hipótesis y prepara preguntas en 15 minutos.'],
    ['Sostenibilidad en lenguaje financiero', 'energia', 'micro', 16, 1, 'financiero', '', 'ESG, bonos verdes y líneas sostenibles explicados con números.'],
    ['Cómo analizar una inversión solar', 'finanzas', 'curso', 38, 1, 'financiero', '', 'CAPEX, ahorro, payback y TIR de un proyecto real.'],
    ['Energía como conversación de banca empresarial', 'energia', 'micro', 12, 0, 'financiero', '', 'La factura de energía como puerta de entrada a una relación de largo plazo.'],
    ['Radar de oportunidades', 'ads', 'flash', 6, 0, 'financiero', '', 'Qué mirar en tu cartera para encontrar la próxima oportunidad.'],
    // Referidores · Conector de Negocios
    ['Convierte tu red en oportunidades', 'relaciones', 'micro', 18, 0, 'referidor', 'f,p', 'Mapea tu red y descubre dónde hay conversaciones pendientes.'],
    ['Cómo identificar oportunidades sin vender', 'relaciones', 'micro', 14, 0, 'referidor', 'p', 'Escucha activa y preguntas que revelan necesidades reales.'],
    ['Venta consultiva para personas que no son vendedores', 'relaciones', 'curso', 36, 0, 'referidor', 'f', 'Un método simple para ayudar sin sentirte vendedor.'],
    ['Cómo hacer una introducción de alto valor', 'relaciones', 'flash', 6, 0, 'referidor', '', 'La estructura de un correo o WhatsApp que abre puertas.'],
    ['Cómo proteger tu reputación al referir', 'relaciones', 'flash', 7, 0, 'referidor', '', 'Refiere con criterio para que cada introducción sume confianza.'],
    ['Networking estratégico', 'relaciones', 'curso', 32, 1, 'referidor,gremio', 'p', 'Menos tarjetas, más relaciones que generan oportunidades.'],
    ['LinkedIn para generar oportunidades', 'marca', 'micro', 18, 0, 'referidor,financiero', 'p', 'Perfil, red y conversaciones que atraen al cliente correcto.'],
    ['Marca personal para consultores', 'marca', 'micro', 16, 1, 'referidor', '', 'Cómo ser recordado por lo que resuelves.'],
    ['IA para profesionales independientes', 'ia', 'curso', 34, 0, 'referidor', 'n', 'Tu asistente para propuestas, correos, investigación y seguimiento.'],
    ['Automatiza tus seguimientos', 'ia', 'micro', 15, 1, 'referidor', '', 'Recordatorios y mensajes que no dependen de tu memoria.'],
    ['Negociación y manejo de objeciones', 'relaciones', 'curso', 40, 1, 'referidor,financiero', '', 'Responde con preguntas, no con argumentos.'],
    ['Cómo identificar una oportunidad solar en 5 minutos', 'ads', 'flash', 5, 0, 'referidor,financiero,gremio', 'f,p', 'Cinco señales que indican que una empresa vale la pena.'],
    ['De contacto a Referido Perfecto', 'ads', 'micro', 12, 0, 'referidor', 'p', 'Qué datos reunir para que tu referido avance rápido.'],
    ['Qué ocurre después de referir', 'ads', 'flash', 5, 0, 'referidor,financiero,gremio', '', 'Las siete etapas del proceso comercial explicadas.'],
    // Gremios · Community & Business Leader
    ['Contenidos que los empresarios sí quieran consumir', 'marca', 'micro', 16, 0, 'gremio', 'p', 'Formatos y temas que tus afiliados abren, leen y comparten.'],
    ['Cómo construir una agenda empresarial relevante', 'negocios', 'micro', 18, 1, 'gremio', '', 'Prioriza temas con datos de tus afiliados.'],
    ['IA para equipos gremiales', 'ia', 'curso', 34, 0, 'gremio', 'n', 'Informes, boletines y análisis en una fracción del tiempo.'],
    ['Cómo crear un evento empresarial de alto valor', 'negocios', 'curso', 38, 1, 'gremio', 'f', 'Del objetivo a la experiencia: diseña eventos que la gente recomienda.'],
    ['Eventos que generan comunidad', 'negocios', 'micro', 15, 1, 'gremio', '', 'Lo que ocurre antes y después del evento importa más.'],
    ['Cómo aumentar participación de afiliados', 'negocios', 'micro', 16, 1, 'gremio', 'p', 'Tácticas para pasar de base de datos a comunidad activa.'],
    ['Cómo medir el impacto de un evento', 'negocios', 'flash', 7, 1, 'gremio', '', 'Indicadores simples que convencen a tu junta.'],
    ['Cómo convertir datos en contenido gremial', 'marca', 'micro', 14, 1, 'gremio', '', 'Encuestas y cifras que se vuelven titulares.'],
    ['IA para construir informes y benchmarks', 'ia', 'micro', 18, 1, 'gremio', 'n', 'Estructura, redacta y visualiza informes sectoriales con IA.'],
    ['Competitividad energética empresarial', 'energia', 'micro', 16, 0, 'gremio', '', 'Cómo el costo de energía afecta la competitividad de un sector.'],
    ['Cómo construir alianzas empresa–gremio', 'relaciones', 'micro', 15, 1, 'gremio', '', 'Alianzas con propósito que benefician a los afiliados.'],
    ['Tendencias empresariales 2027', 'negocios', 'masterclass', 60, 0, 'gremio,financiero,referidor', 'n', 'Lo que viene para las empresas colombianas el próximo año.'],
    // IA & Automatización (protagonista) y transversales
    ['IA generativa desde cero', 'ia', 'micro', 16, 0, 'todos', 'f,p', 'Qué es, qué no es y cómo empezar a usarla hoy.'],
    ['Prompting para profesionales', 'ia', 'micro', 18, 0, 'todos', 'f,p', 'Aprende a obtener mejores respuestas de la IA usando contexto, objetivos, restricciones y ejemplos.'],
    ['ChatGPT y Claude para trabajar más rápido', 'ia', 'curso', 35, 0, 'todos', 'p', 'Flujos concretos para correo, documentos y análisis.'],
    ['IA para reuniones', 'ia', 'micro', 14, 0, 'todos', 'n', 'Prepara, toma notas y resume acuerdos automáticamente.'],
    ['IA para analizar información', 'ia', 'micro', 18, 1, 'todos', '', 'Hojas de cálculo, PDFs y reportes: preguntas que ahorran horas.'],
    ['Crea tu primer asistente de IA', 'ia', 'curso', 40, 1, 'todos', 'n', 'Un asistente configurado con tu contexto de trabajo.'],
    ['Automatizaciones sin programar', 'ia', 'curso', 38, 1, 'todos', '', 'Conecta tus herramientas y elimina tareas repetitivas.'],
    ['IA responsable', 'ia', 'flash', 7, 0, 'todos', '', 'Privacidad, sesgos y verificación: reglas de uso profesional.'],
    ['Cómo recuperar 5 horas de trabajo cada semana', 'ia', 'micro', 15, 0, 'todos', 'p', 'Audita tu semana y automatiza lo que no requiere criterio.'],
    ['Inbox Zero para ejecutivos', 'negocios', 'flash', 7, 0, 'todos', '', 'Un método para que el correo deje de controlar tu día.'],
    ['El sistema personal de seguimiento', 'negocios', 'micro', 12, 0, 'todos', '', 'Nunca más una oportunidad perdida por olvido.'],
    ['Automatiza tu trabajo sin ser programador', 'ia', 'micro', 18, 1, 'todos', '', 'Plantillas, reglas y flujos para el día a día.'],
    ['Finanzas empresariales para no financieros', 'finanzas', 'curso', 36, 0, 'todos', 'p', 'Ingresos, márgenes, caja y endeudamiento sin tecnicismos.'],
    ['ROI, TIR y Payback sin complicaciones', 'finanzas', 'micro', 15, 0, 'todos', 'p', 'Tres indicadores para hablar de cualquier inversión.'],
    ['CAPEX vs. OPEX', 'finanzas', 'flash', 6, 0, 'todos', '', 'Comprar o pagar por uso: cuándo conviene cada uno.'],
    ['Cómo presentar una inversión ante gerencia', 'finanzas', 'micro', 16, 1, 'todos', '', 'Estructura de una presentación que obtiene un sí.'],
    ['Cómo leer un negocio en 15 minutos', 'negocios', 'micro', 15, 0, 'todos', 'f', 'Modelo, clientes, costos y riesgos: una lectura rápida y útil.'],
    ['Networking que realmente genera oportunidades', 'relaciones', 'micro', 16, 0, 'todos', 'p', 'Qué hacer antes, durante y después de cada encuentro.'],
    ['Cómo pedir un referido sin incomodar', 'relaciones', 'flash', 6, 0, 'todos', '', 'Frases y momentos que hacen natural la petición.'],
    ['Cómo construir relaciones con tomadores de decisión', 'relaciones', 'curso', 34, 1, 'todos', '', 'Acceso, credibilidad y continuidad con la alta dirección.'],
    ['LinkedIn que genera conversaciones', 'marca', 'micro', 14, 0, 'todos', '', 'Publicaciones y mensajes que abren diálogos, no solo likes.'],
    ['Cómo publicar sin convertirte en influencer', 'marca', 'flash', 7, 0, 'todos', 'n', 'Una rutina simple y auténtica para mostrar tu criterio.'],
    ['IA para crear contenido profesional', 'marca', 'micro', 16, 0, 'todos', '', 'De la idea al post en tu propia voz.'],
    ['Social Selling B2B', 'marca', 'curso', 36, 1, 'todos', '', 'Construye pipeline desde las redes profesionales.'],
    // Aprende en 5 minutos (flash)
    ['5 prompts que te ahorrarán tiempo esta semana', 'ia', 'flash', 5, 0, 'todos', 'q,p', ''],
    ['Cómo investigar una empresa antes de una reunión', 'negocios', 'flash', 4, 0, 'todos', 'q', ''],
    ['ROI vs. Payback', 'finanzas', 'flash', 5, 0, 'todos', 'q', ''],
    ['Cómo pedir una introducción sin incomodar', 'relaciones', 'flash', 4, 0, 'todos', 'q', ''],
    ['Cómo escribir un WhatsApp profesional', 'marca', 'flash', 3, 0, 'todos', 'q,n', ''],
    ['3 señales de una oportunidad comercial', 'relaciones', 'flash', 5, 0, 'todos', 'q', ''],
    ['Cómo resumir un PDF con IA', 'ia', 'flash', 4, 0, 'todos', 'q', ''],
    ['Cómo preparar una reunión con un CEO', 'relaciones', 'flash', 5, 1, 'todos', 'q', ''],
    ['5 errores comunes haciendo networking', 'relaciones', 'flash', 5, 0, 'todos', 'q', ''],
    ['Cómo saber si una empresa podría aprovechar energía solar', 'energia', 'flash', 5, 0, 'todos', 'q', '']
  ];

  /* Escuela Energía & Sostenibilidad · cuatro niveles */
  const ENERGY_LEVELS = [
    { id: 'e1', n: 1, name: 'Energía para empresarios', items: ['Cómo funciona una factura de energía', 'Mercado energético colombiano explicado fácil', 'Por qué cambia el precio de la energía', 'kW, kWh y demanda', 'Energía como costo empresarial', 'Introducción a la autogeneración'] },
    { id: 'e2', n: 2, name: 'Solar para no ingenieros', items: ['Cómo funciona un sistema fotovoltaico', 'Sistemas On-Grid', 'Sistemas Off-Grid', 'Sistemas híbridos', 'Componentes principales', 'Vida útil', 'Mantenimiento', 'Riesgos'] },
    { id: 'e3', n: 3, name: 'Solar como inversión', items: ['CAPEX', 'Ahorro', 'Payback', 'TIR', 'Flujo de caja', 'Financiación', 'Incentivos', 'Riesgo'] },
    { id: 'e4', n: 4, name: 'Detectar oportunidades', items: ['Qué empresas son atractivas', 'Consumo', 'Operación', 'Cubierta', 'Ubicación', 'Factura', 'Preguntas de diagnóstico'] }
  ];
  ENERGY_LEVELS.forEach(L => L.items.forEach((t, i) => {
    const title = L.n === 1 ? t : (L.name.split(' ')[0] === 'Solar' ? t + (L.n === 3 ? ' en proyectos solares' : '') : t);
    RAW.push([L.n === 4 ? 'Detectar oportunidades · ' + t : (L.n === 2 ? 'Solar · ' + t : (L.n === 3 ? 'Inversión solar · ' + t : title)), 'energia', L.n === 1 ? 'micro' : 'flash', L.n === 1 ? 12 + (i % 3) * 2 : 5 + (i % 3), L.n >= 3 ? 1 : 0, 'todos', '', '', L.id]);
  }));

  const slug = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const FMT = {}; FORMATS.forEach(f => { FMT[f.id] = f; });

  const COURSES = [];
  const bySlug = {};
  RAW.forEach((r, i) => {
    const [title, school, format, minutes, lvl, ally, flags, sd, energyLevel] = r;
    const id = slug(title);
    if (bySlug[id]) { // mismo curso en otra ruta: sumar tipo de aliado
      ally.split(',').forEach(a => { if (bySlug[id].allyType.indexOf(a) < 0) bySlug[id].allyType.push(a); });
      return;
    }
    const sch = SCHOOLS.find(s => s.id === school);
    const c = {
      id, slug: id, title,
      shortDescription: sd || ('Un contenido práctico de ' + sch.name + ' para aplicar esta misma semana.'),
      longDescription: '',
      school, learningPath: energyLevel || null,
      allyType: ally.split(','),
      level: LEVELS[lvl], duration: minutes, format, xp: FMT[format].xp,
      thumbnail: null,
      featured: flags.indexOf('f') >= 0, new: flags.indexOf('n') >= 0, popular: flags.indexOf('p') >= 0, quick: flags.indexOf('q') >= 0,
      progress: 0, lessons: [], resources: [], tools: [], quiz: [], certificate: null,
      author: 'Equipo GEENERA', publishDate: '2026-0' + (1 + (i % 9)) + '-' + String(1 + (i * 7) % 27).padStart(2, '0'),
      popularity: 100 - (i % 37) * 2 + (flags.indexOf('p') >= 0 ? 60 : 0)
    };
    COURSES.push(c); bySlug[id] = c;
  });

  /* Rutas personalizadas por tipo de aliado */
  const PATHS = [
    { id: 'asesor-360', ally: 'financiero', name: 'Asesor Empresarial 360', desc: 'Convierte conversaciones financieras en conversaciones estratégicas de negocio.', cert: 'business-finance',
      courses: ['Conversaciones empresariales más allá del crédito', 'Finanzas corporativas aplicadas al cliente empresarial', 'Cómo detectar oportunidades de financiación', 'Cómo convertir datos en conversaciones ejecutivas', 'IA para ejecutivos financieros', 'Cómo preparar una reunión empresarial con IA', 'Sostenibilidad en lenguaje financiero', 'Cómo analizar una inversión solar', 'Energía como conversación de banca empresarial', 'Radar de oportunidades'] },
    { id: 'conector', ally: 'referidor', name: 'Conector de Negocios', desc: 'Convierte relaciones, conocimiento y confianza en nuevas oportunidades.', cert: 'business-connector',
      courses: ['Convierte tu red en oportunidades', 'Cómo identificar oportunidades sin vender', 'Venta consultiva para personas que no son vendedores', 'Cómo hacer una introducción de alto valor', 'Cómo proteger tu reputación al referir', 'Networking estratégico', 'LinkedIn para generar oportunidades', 'Marca personal para consultores', 'IA para profesionales independientes', 'Automatiza tus seguimientos', 'Negociación y manejo de objeciones', 'Cómo identificar una oportunidad solar en 5 minutos', 'De contacto a Referido Perfecto', 'Qué ocurre después de referir'] },
    { id: 'community-leader', ally: 'gremio', name: 'Community & Business Leader', desc: 'Diseña contenidos, experiencias y comunidades que generen verdadero valor empresarial.', cert: 'community-builder',
      courses: ['Contenidos que los empresarios sí quieran consumir', 'Cómo construir una agenda empresarial relevante', 'IA para equipos gremiales', 'Cómo crear un evento empresarial de alto valor', 'Eventos que generan comunidad', 'Cómo aumentar participación de afiliados', 'Cómo medir el impacto de un evento', 'Cómo convertir datos en contenido gremial', 'IA para construir informes y benchmarks', 'Competitividad energética empresarial', 'Cómo construir alianzas empresa–gremio', 'Tendencias empresariales 2027'] }
  ].map(p => Object.assign(p, { courses: p.courses.map(slug) }));
  PATHS.forEach(p => p.courses.forEach(id => { const c = bySlug[id]; if (c && !c.learningPath) c.learningPath = p.id; }));

  const AI_FEATURED = ['IA generativa desde cero', 'Prompting para profesionales', 'ChatGPT y Claude para trabajar más rápido', 'IA para reuniones', 'IA para analizar información', 'Crea tu primer asistente de IA', 'Automatizaciones sin programar', 'IA responsable'].map(slug);

  const CERTS = [
    { id: 'business-connector', name: 'ADS Business Connector', desc: 'Networking, venta consultiva y generación de oportunidades.', school: 'relaciones', mark: 'BC' },
    { id: 'ai-professional', name: 'AI Powered Professional', desc: 'IA, prompting, automatización y productividad.', school: 'ia', mark: 'AI' },
    { id: 'business-finance', name: 'Business Finance Essentials', desc: 'ROI, flujo de caja, CAPEX, OPEX y análisis de inversión.', school: 'finanzas', mark: 'BF' },
    { id: 'energy-advisor', name: 'Energy Business Advisor', desc: 'Energía empresarial, energía solar y oportunidades de inversión.', school: 'energia', mark: 'EA' },
    { id: 'community-builder', name: 'Community Builder', desc: 'Contenido, eventos, comunidades y alianzas.', school: 'negocios', mark: 'CB' }
  ];
  CERTS[1].courses = AI_FEATURED;
  CERTS[0].courses = PATHS[1].courses.slice(0, 8);
  CERTS[2].courses = ['finanzas-empresariales-para-no-financieros', 'roi-tir-y-payback-sin-complicaciones', 'capex-vs-opex', 'como-presentar-una-inversion-ante-gerencia', 'como-analizar-una-inversion-solar'];
  CERTS[3].courses = COURSES.filter(c => c.school === 'energia' && c.learningPath && c.learningPath[0] === 'e').map(c => c.id);
  CERTS[4].courses = PATHS[2].courses;

  const TOOLS = [
    { id: 't-perfecto', name: 'Checklist Referido Perfecto', cat: 'Aliados del Sol', icon: ICONS.check, kind: 'Ver y descargar', desc: 'Los datos, el semáforo de calidad y los guiones para que un referido avance sin fricción.' },
    { id: 't-solar', name: 'Opportunity Checker Solar', cat: 'Energía', icon: ICONS.scan, kind: 'Ver y descargar', desc: 'Hoja de puntuación de cinco señales para saber si una empresa es buena candidata.' },
    { id: 't-factura', name: 'Guía para leer una factura de energía', cat: 'Energía', icon: ICONS.energia, kind: 'Ver y descargar', desc: 'Las seis cifras clave, cómo traducirlas y un cálculo exprés del potencial solar.' },
    { id: 't-roi', name: 'Hoja de trabajo ROI · Payback · TIR', cat: 'Finanzas', icon: ICONS.calc, kind: 'Ver y descargar', desc: 'Fórmulas, ejemplo resuelto de 100 kWp y guía de sensibilidad para presentar una inversión.' },
    { id: 't-diag', name: 'Guía de Preguntas de Diagnóstico', cat: 'Relaciones', icon: ICONS.ask, kind: 'Ver y descargar', desc: 'Preguntas por momento y por interlocutor que revelan necesidades sin sonar a venta.' },
    { id: 't-reunion', name: 'Template de preparación de reuniones', cat: 'Negocios', icon: ICONS.cal, kind: 'Ver y descargar', desc: 'Objetivo, investigación, hipótesis, estructura y seguimiento en una página.' },
    { id: 't-event', name: 'Event Canvas', cat: 'Negocios', icon: ICONS.grid, kind: 'Ver y descargar', desc: 'Diseña un evento empresarial de alto valor: propósito, audiencia, experiencia y medición.' },
    { id: 't-prompts', name: 'Librería de Prompts', cat: 'IA', icon: ICONS.book, kind: 'Ver y descargar', desc: '24 prompts probados para reuniones, análisis, correos, contenido y productividad.' },
    { id: 't-red', name: 'Mapa de Red Estratégica', cat: 'Relaciones', icon: ICONS.map, kind: 'Ver y descargar', desc: 'Ordena tu red por confianza, acceso y potencial, y decide con quién hablar primero.' },
    { id: 't-linkedin', name: 'Kit LinkedIn para aliados', cat: 'Marca', icon: ICONS.marca, kind: 'Ver y descargar', desc: 'Perfil, fórmulas de titular, plan de publicaciones y mensajes que abren conversaciones.' },
    { id: 't-propuestas', name: 'Comparador de propuestas solares', cat: 'Energía', icon: ICONS.grid, kind: 'Ver y descargar', desc: 'Normaliza el alcance de dos o tres ofertas, compara producción, garantías y costo por kWh, y detecta lo que falta.' },
    { id: 't-financiacion', name: 'Guía de modalidades de financiación', cat: 'Finanzas', icon: ICONS.finanzas, kind: 'Ver y descargar', desc: 'Compra, crédito, leasing y pago por energía comparados, con preguntas de diagnóstico y frases seguras.' },
    { id: 't-objeciones', name: 'Banco de objeciones y respuestas', cat: 'Relaciones', icon: ICONS.ask, kind: 'Ver y descargar', desc: 'Las objeciones más frecuentes en proyectos solares con el interés detrás, la pregunta y la respuesta.' },
    { id: 't-automatiza', name: 'Auditoría de semana y mapa de automatización', cat: 'IA', icon: ICONS.ia, kind: 'Ver y descargar', desc: 'Registra tu tiempo, clasifica tareas y diseña automatizaciones y rutinas que recuperan horas.' },
    { id: 't-contenido', name: 'Calendario editorial y kit de datos', cat: 'Marca', icon: ICONS.cal, kind: 'Ver y descargar', desc: 'Planea un trimestre de contenido, diseña una encuesta que produzca titulares y convierte cifras en historias.' },
  ];

  const MASTERCLASSES = [
    { id: 'm1', title: 'IA aplicada al trabajo diario', speaker: 'Laura Méndez · Líder de Transformación Digital', date: '15 oct 2026 · 7:30 a. m.', duration: 60, school: 'ia', upcoming: true, seats: 38 },
    { id: 'm2', title: 'Cómo se decide una inversión en una junta directiva', speaker: 'Andrés Castillo · CFO invitado', date: '29 oct 2026 · 7:30 a. m.', duration: 75, school: 'finanzas', upcoming: true, seats: 52 },
    { id: 'm3', title: 'Networking con tomadores de decisión', speaker: 'Diana López · GEENERA', date: '18 sep 2026', duration: 55, school: 'relaciones', upcoming: false },
    { id: 'm4', title: 'Transición energética para empresarios', speaker: 'Equipo técnico GEENERA', date: '28 ago 2026', duration: 70, school: 'energia', upcoming: false }
  ];

  /* Metodología consistente para todos los cursos */
  const METHOD = [
    { id: 'contexto', name: 'Contexto', q: '¿Por qué esto importa?' },
    { id: 'aprende', name: 'Aprende', q: '3–5 microlecciones' },
    { id: 'aplica', name: 'Aplica', q: 'Ejercicio guiado' },
    { id: 'descarga', name: 'Descarga', q: 'Material descargable' },
    { id: 'comprueba', name: 'Comprueba', q: 'Quiz corto' },
    { id: 'activa', name: 'Activa', q: 'Una acción concreta' }
  ];

  /* Contenido detallado (el resto de cursos usa la plantilla por escuela hasta que el CMS lo complete) */
  const CONTENT = {
    'prompting-para-profesionales': {
      learn: ['Estructurar un prompt con contexto, objetivo, restricciones y ejemplos', 'Iterar una respuesta en lugar de empezar de cero', 'Pedir formatos útiles: tablas, correos, resúmenes', 'Evitar los errores que producen respuestas genéricas'],
      contexto: 'La diferencia entre una respuesta genérica y una útil casi nunca es la herramienta: es la instrucción. Un buen prompt te ahorra idas y vueltas y convierte la IA en un colega que entiende tu trabajo.',
      lessons: [
        { t: 'Contexto: quién eres y para quién es', b: 'Empieza diciendo tu rol, tu cliente y la situación. “Soy consultor y preparo una reunión con el gerente de una planta de alimentos” cambia por completo el resultado.' },
        { t: 'Objetivo: qué necesitas exactamente', b: 'Pide un resultado verificable: “tres preguntas de diagnóstico”, “un correo de 120 palabras”, “una tabla con riesgos y mitigaciones”.' },
        { t: 'Restricciones: lo que no debe pasar', b: 'Tono, extensión, idioma, qué evitar. Las restricciones son las que hacen que la respuesta suene a ti.' },
        { t: 'Ejemplos: muestra, no expliques', b: 'Pega un ejemplo de lo que te gusta. La IA imita estructura y tono mejor de lo que sigue descripciones.' }
      ],
      aplica: 'Toma una tarea que harás esta semana y escribe el prompt con los cuatro bloques: contexto, objetivo, restricciones y ejemplo. Compara el resultado con tu versión anterior.',
      quiz: [
        { q: '¿Qué bloque del prompt hace que la respuesta suene a ti?', o: ['El objetivo', 'Las restricciones', 'La longitud'], a: 1 },
        { q: '¿Qué hacer si la primera respuesta no sirve?', o: ['Empezar un chat nuevo', 'Iterar indicando qué ajustar', 'Cambiar de herramienta'], a: 1 },
        { q: 'Mostrar un ejemplo de lo que quieres…', o: ['Confunde a la IA', 'Suele mejorar el resultado', 'Solo sirve para imágenes'], a: 1 }
      ],
      activa: 'Guarda en tu Librería de Prompts los tres prompts que más usarás esta semana.',
      tool: 't-prompts'
    },
    'como-identificar-una-oportunidad-solar-en-5-minutos': {
      learn: ['Reconocer las cinco señales de una buena oportunidad', 'Hacer las preguntas justas sin sonar técnico', 'Saber cuándo una empresa no es candidata', 'Pasar de conversación a Referido Perfecto'],
      contexto: 'No necesitas ser ingeniero para detectar una oportunidad. Con cinco señales puedes saber, en una conversación corta, si vale la pena conectar a una empresa con GEENERA.',
      lessons: [
        { t: 'Consumo', b: 'Facturas mensuales altas son la primera señal. La operación diurna aumenta el potencial de ahorro.' },
        { t: 'Cubierta y espacio', b: 'Techos amplios, bodegas o parqueaderos disponibles permiten instalar un sistema sin afectar la operación.' },
        { t: 'Propiedad y decisión', b: 'Si la sede es propia y hablas con quien decide, la oportunidad avanza más rápido.' },
        { t: 'Momento de la empresa', b: 'Expansiones, metas de sostenibilidad o presión de costos abren la conversación.' }
      ],
      aplica: 'Piensa en tres empresas de tu red y marca cuántas señales cumple cada una. Elige la que más cumple.',
      quiz: [
        { q: '¿Qué operación favorece más el ahorro solar?', o: ['Nocturna', 'Diurna', 'Fines de semana'], a: 1 },
        { q: '¿Qué hace más lenta una oportunidad?', o: ['Sede arrendada sin autorización', 'Factura alta', 'Cubierta amplia'], a: 0 }
      ],
      activa: 'Refiere esta semana la empresa que más señales cumplió, con los datos del Referido Perfecto.',
      tool: 't-solar'
    }
  };

  const TEMPLATE = {
    relaciones: { tool: 't-diag', activa: 'Identifica tres personas de tu red con quienes podrías retomar una conversación esta semana.' },
    ia: { tool: 't-prompts', activa: 'Elige una tarea repetitiva de esta semana y hazla con IA usando lo aprendido.' },
    negocios: { tool: 't-reunion', activa: 'Aplica el método en tu próxima reunión y anota qué cambió.' },
    finanzas: { tool: 't-roi', activa: 'Calcula el ROI y el payback de una inversión real de un cliente o de tu empresa.' },
    energia: { tool: 't-factura', activa: 'Revisa la factura de energía de una empresa cercana con lo que aprendiste.' },
    marca: { tool: 't-linkedin', activa: 'Publica o envía un mensaje esta semana aplicando una idea del curso.' },
    ads: { tool: 't-perfecto', activa: 'Revisa tus referidos en curso y completa los datos que falten.' }
  };

  function contentFor(c) {
    if (CONTENT[c.id]) return CONTENT[c.id];
    const T = TEMPLATE[c.school];
    const n = c.format === 'flash' ? 3 : (c.format === 'micro' ? 4 : 5);
    const parts = ['La idea central', 'Cómo se ve en la práctica', 'Errores frecuentes', 'Un método paso a paso', 'Cómo medir si funcionó'];
    return {
      learn: [c.shortDescription.replace(/\.$/, ''), 'Aplicarlo con un método simple y repetible', 'Evitar los errores más comunes', 'Convertirlo en una acción esta semana'],
      contexto: c.shortDescription + ' En este contenido verás por qué importa y cómo aplicarlo sin complicaciones.',
      lessons: parts.slice(0, n).map(t => ({ t, b: 'Contenido en preparación para «' + c.title + '». Esta microlección se administra desde el CMS de ADS Academy.' })),
      aplica: 'Aplica lo aprendido a una situación real de tu trabajo y anota el resultado.',
      quiz: [{ q: '¿Cuál es el mejor momento para aplicar lo aprendido?', o: ['Algún día', 'Esta misma semana', 'Cuando tenga tiempo libre'], a: 1 }],
      activa: T.activa, tool: T.tool
    };
  }
  /* Contenido externo (academy-content-*.js): formato compacto por título → esquema del curso */
  function fromCompact(c, x) {
    return {
      learn: x.l, contexto: x.c, aplica: x.a, pasos: x.p || [], activa: x.k, tool: x.t || TEMPLATE[c.school].tool,
      lessons: x.s.map(p => ({ t: p[0], b: p[1] })),
      quiz: x.q.map(p => ({ q: p[0], o: p[1], a: p[2] }))
    };
  }
  function applyContent() {
    const EXT = window.ADS_CONTENT || {};
    COURSES.forEach(c => {
      const x = EXT[c.title];
      const k = x ? fromCompact(c, x) : (CONTENT[c.id] || contentFor(c));
      if (x && x.d && !c._sd) { c.shortDescription = x.d; c._sd = true; }
      c.lessons = k.lessons; c.quiz = k.quiz; c.tools = [k.tool]; c.content = k; c.longDescription = k.contexto;
      c.ready = !!(CONTENT[c.id] || x);
    });
  }

  /* Acceso · versión abierta (visitantes) vs. aliados registrados.
     Lo más básico de cada escuela y el primer paso de cada ruta es gratuito; el resto requiere cuenta de aliado. */
  const FREE = [
    'Cómo identificar una oportunidad solar en 5 minutos', 'Qué ocurre después de referir',
    'IA generativa desde cero', '5 prompts que te ahorrarán tiempo esta semana',
    'Networking que realmente genera oportunidades', 'Cómo pedir una introducción sin incomodar',
    'Cómo leer un negocio en 15 minutos', 'Cómo investigar una empresa antes de una reunión',
    'ROI vs. Payback', 'CAPEX vs. OPEX',
    'Cómo funciona una factura de energía', 'kW, kWh y demanda', 'Cómo saber si una empresa podría aprovechar energía solar',
    'LinkedIn que genera conversaciones', 'Cómo escribir un WhatsApp profesional'
  ].map(slug);
  PATHS.forEach(p => { if (FREE.indexOf(p.courses[0]) < 0) FREE.push(p.courses[0]); });
  COURSES.forEach(c => { c.access = FREE.indexOf(c.id) >= 0 ? 'free' : 'aliado'; });
  const FREE_TOOLS = ['t-perfecto', 't-solar', 't-factura'];
  TOOLS.forEach(t => { t.access = FREE_TOOLS.indexOf(t.id) >= 0 ? 'free' : 'aliado'; });
  const ACCESS = {
    free: { label: 'Gratis', desc: 'Disponible en la versión abierta del Hub.' },
    aliado: { label: 'Aliados', desc: 'Exclusivo para aliados registrados en el Hub.' },
    perks: ['Todos los cursos, rutas y masterclasses', 'Herramientas descargables', 'Progreso, XP y certificaciones', 'Reserva de cupos en masterclasses en vivo']
  };

  applyContent();
  window.ADS_ACADEMY = { ICONS, SCHOOLS, FORMATS, XP_RULES, XP_LEVELS, LEVELS, ALLY_TYPES, COURSES, PATHS, ENERGY_LEVELS, AI_FEATURED, CERTS, TOOLS, MASTERCLASSES, METHOD, ACCESS, slug, applyContent };
})();
