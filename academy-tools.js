/* ADS Academy · Kit de herramientas descargables (material completo de cada paso "Descarga").
   Cada herramienta: title, sub, intro, when[], sections[{h, type, note, items|cols+rows}], close.
   type: check (lista de verificación) · list ([título, detalle]) · table (cols + rows) · fields (campos para llenar) · script ([situación, texto]).
   ADS_TOOLKIT.download(id) genera un documento con la marca Aliados del Sol; ADS_TOOLKIT.print(id) lo abre listo para PDF. */
(function () {
  const K = {
    't-perfecto': {
      title: 'Checklist Referido Perfecto', sub: 'Aliados del Sol · Guía operativa', pages: '2 páginas',
      intro: 'Un referido completo avanza en días; uno incompleto puede esperar semanas. Esta lista reúne la información mínima que el equipo comercial de GEENERA necesita para llamar, diagnosticar y presentar una propuesta sin pedirte nada más. Úsala antes de registrar cada oportunidad en el Hub.',
      when: ['Antes de registrar un referido en el Hub', 'Cuando un contacto te dice “sí, que me llamen”', 'Al revisar oportunidades estancadas en etapa de contacto'],
      sections: [
        { h: '1 · Datos de la empresa', type: 'check', items: ['Razón social y NIT (o al menos el nombre comercial exacto)', 'Sector y subsector (ej.: manufactura · plásticos; comercio · supermercado)', 'Ciudad y dirección de la sede donde estaría el sistema', 'Si la sede es propia o arrendada (y si el propietario autorizaría obras en cubierta)', 'Horario de operación: días por semana y franja horaria principal'] },
        { h: '2 · Contacto que decide', type: 'check', items: ['Nombre completo y cargo (gerente general, financiero, de planta o de operaciones)', 'Teléfono móvil verificado y correo corporativo', 'Mejor horario y canal para contactarle', 'Si no es quien decide: nombre y cargo de quien sí decide, y cómo llegar a esa persona', 'Confirmación explícita de que acepta ser contactado por GEENERA'] },
        { h: '3 · Información energética', type: 'check', items: ['Valor aproximado de la factura mensual (COP)', 'Factura reciente adjunta (ideal: las últimas 3 a 6)', 'Operador de red o comercializador (Air-e, EPM, Enel, Essa, Celsia, etc.)', 'Si hay planes de ampliación, nuevos equipos o cambios de sede en los próximos 18 meses', 'Área aproximada de cubierta disponible o espacios alternos (parqueaderos, lotes)'] },
        { h: '4 · Contexto de la oportunidad', type: 'fields', items: ['¿Por qué crees que esta empresa es buena candidata?', '¿Qué dolor mencionó el contacto? (costo, volatilidad, sostenibilidad, cortes)', '¿Qué expectativa tiene sobre tiempos y presupuesto?', 'Relación contigo: ¿cliente, conocido, familiar, contacto de gremio?'] },
        { h: 'Semáforo de calidad', type: 'table', note: 'Antes de enviar, ubica tu referido en el semáforo. Los verdes avanzan primero.', cols: ['Nivel', 'Qué tiene', 'Qué pasa después'], rows: [
          ['Verde', 'Decisor identificado + factura + autorización de contacto', 'Contacto en 48 horas y diagnóstico inmediato'],
          ['Amarillo', 'Decisor y datos de contacto, sin factura', 'Contacto en 48 horas; se solicita la factura para diagnosticar'],
          ['Rojo', 'Solo nombre de empresa o contacto sin poder de decisión', 'Queda en espera hasta completar datos; no suma Puntos Sol']] },
        { h: 'Cómo pedir la factura sin incomodar', type: 'script', items: [
          ['En persona', '“Para que te den una cifra real de ahorro, y no un estimado genérico, el equipo necesita una factura reciente. ¿Me la compartes y yo se la hago llegar?”'],
          ['Por WhatsApp', '“Hola, [nombre]. Como hablamos, te conecto con el equipo de GEENERA. Si me envías una foto de la última factura de energía, en la primera llamada ya te muestran cuánto podrías ahorrar.”'],
          ['Si duda', '“La factura solo se usa para dimensionar el sistema; no compromete nada. Si prefieres, envíala directamente a la consultora cuando te llame.”']] },
        { h: 'Errores que restan puntos', type: 'list', items: [
          ['Datos sin verificar', 'Un teléfono equivocado o un correo genérico hace perder días. Confirma con el contacto antes de enviar.'],
          ['Referir sin permiso', 'Nunca registres a alguien que no sabe que será contactado. Afecta tu reputación y la del programa.'],
          ['Duplicados', 'Revisa en el Hub si la empresa ya fue referida por otro aliado; el sistema reconoce al primero con datos completos.'],
          ['Empresas no candidatas', 'Operación exclusivamente nocturna, factura muy baja o sede sin posibilidad de obra reducen la probabilidad de cierre.']] }
      ],
      close: 'Cuando tengas los cuatro bloques completos, registra el referido en el Hub y adjunta la factura. Tu consultora te avisará cada cambio de etapa.'
    },

    't-solar': {
      title: 'Opportunity Checker Solar', sub: 'Energía · Hoja de puntuación', pages: '2 páginas',
      intro: 'Una hoja de puntuación para decidir, en una conversación de cinco minutos, si una empresa merece un diagnóstico solar. Evalúa cinco señales, suma el puntaje y obtén una recomendación clara: referir ahora, completar información o descartar por el momento.',
      when: ['Después de una primera conversación con un empresario', 'Al revisar tu cartera o base de afiliados', 'Antes de registrar un referido, para priorizar'],
      sections: [
        { h: 'Las cinco señales', type: 'table', note: 'Marca el puntaje que mejor describe a la empresa. Máximo: 25 puntos.', cols: ['Señal', '1 punto', '3 puntos', '5 puntos'], rows: [
          ['Factura mensual', 'Menos de $3 millones', '$3 a $15 millones', 'Más de $15 millones'],
          ['Horario de consumo', 'Principalmente nocturno', 'Mixto', 'Principalmente diurno (6 a. m.–6 p. m.)'],
          ['Cubierta o espacio', 'Sin espacio o cubierta en mal estado', 'Espacio parcial o compartido', 'Cubierta amplia, propia y en buen estado'],
          ['Propiedad y decisión', 'Arrendada sin autorización / sin acceso al decisor', 'Arrendada con autorización posible', 'Sede propia y contacto directo con quien decide'],
          ['Momento de la empresa', 'Sin presión de costos ni planes', 'Interés general en ahorro', 'Expansión, metas ESG o presión fuerte de costos']] },
        { h: 'Interpretación', type: 'table', cols: ['Puntaje', 'Recomendación'], rows: [
          ['20 – 25', 'Refiérela esta semana con datos completos y factura. Es una oportunidad prioritaria.'],
          ['13 – 19', 'Buena candidata. Completa la señal más débil (normalmente factura o decisor) antes de referir.'],
          ['5 – 12', 'Guárdala en seguimiento. Retoma la conversación si cambia el momento de la empresa.']] },
        { h: 'Preguntas para cada señal', type: 'list', items: [
          ['Factura', '“¿Cuánto representa la energía dentro de sus costos operativos? ¿Ha cambiado en el último año?”'],
          ['Horario', '“¿En qué horario trabaja la planta o el local? ¿Hay turnos nocturnos?”'],
          ['Cubierta', '“¿Las bodegas o el edificio son de techo plano o en teja? ¿Cuándo fue la última intervención?”'],
          ['Decisión', '“Si apareciera una inversión que se paga sola, ¿quién la aprobaría?”'],
          ['Momento', '“¿Tienen proyectos de ampliación, nuevos equipos o metas de sostenibilidad este año?”']] },
        { h: 'Sectores que suelen puntuar alto', type: 'check', items: ['Manufactura con operación diurna (plásticos, alimentos, metalmecánica, textiles)', 'Cadenas de frío, frigoríficos y bodegas refrigeradas', 'Supermercados, centros comerciales y grandes superficies', 'Clínicas, hoteles y colegios con sede propia', 'Agroindustria con riego, beneficio o procesamiento', 'Estaciones de servicio y concesionarios con cubiertas amplias'] },
        { h: 'Registro de evaluaciones', type: 'fields', items: ['Empresa 1 · Puntaje · Señal más débil · Próximo paso', 'Empresa 2 · Puntaje · Señal más débil · Próximo paso', 'Empresa 3 · Puntaje · Señal más débil · Próximo paso'] }
      ],
      close: 'El puntaje no reemplaza el diagnóstico técnico: es un filtro para invertir tu tiempo donde hay mayor probabilidad de proyecto.'
    },

    't-factura': {
      title: 'Guía para leer una factura de energía', sub: 'Energía · Guía de lectura', pages: '3 páginas',
      intro: 'La factura es el documento más valioso de una conversación energética: muestra cuánto consume la empresa, a qué precio y cómo evoluciona. Esta guía te enseña a ubicar las cifras clave en menos de tres minutos y a traducirlas a lenguaje de gerente.',
      when: ['Cuando un contacto te comparte su factura', 'Antes de una reunión con un cliente industrial o comercial', 'Para explicar por qué la factura sube sin consumir más'],
      sections: [
        { h: 'Las seis cifras que debes ubicar', type: 'list', items: [
          ['Consumo del periodo (kWh)', 'La energía usada en el mes. Busca el histórico de 6 a 12 meses que casi todas las facturas incluyen en un gráfico de barras: revela estacionalidad y estabilidad.'],
          ['Costo unitario (COP/kWh)', 'El precio de cada kWh. En la regulación colombiana resulta de sumar generación (G), transmisión (T), distribución (D), comercialización (Cv), pérdidas (PR) y restricciones (R).'],
          ['Valor total a pagar', 'Incluye energía, contribución y cargos de terceros. Úsalo para dimensionar el peso de la energía en los costos de la empresa.'],
          ['Contribución de solidaridad', 'Los usuarios comerciales y algunos industriales pagan un recargo del 20% sobre el valor del consumo. Ciertas actividades industriales pueden solicitar la exención ante el comercializador.'],
          ['Nivel de tensión y tipo de usuario', 'Nivel 1 (baja tensión) suele tener tarifa más alta que niveles 2 y 3. Indica también si es usuario regulado o no regulado.'],
          ['Energía reactiva y demanda', 'Si aparecen cobros por reactiva, hay oportunidades de eficiencia adicionales (bancos de condensadores) que el equipo técnico puede revisar.']] },
        { h: 'Lectura rápida: cómo traducirla', type: 'table', cols: ['Si ves…', 'Significa…', 'Cómo decirlo al gerente'], rows: [
          ['Consumo estable durante el año', 'Demanda predecible, fácil de dimensionar', '“Su consumo es muy constante; eso hace más preciso calcular el ahorro.”'],
          ['Costo unitario creciente', 'Tarifa indexada o exposición a precios de bolsa', '“Usted paga hoy más por cada kWh que hace un año, sin consumir más.”'],
          ['Contribución del 20%', 'Usuario comercial con recargo', '“Cada kWh que genere usted mismo también evita ese 20% de contribución.”'],
          ['Picos en meses secos', 'Sensibilidad a la hidrología del sistema', '“Generar su propia energía le da un costo fijo frente a la volatilidad.”']] },
        { h: 'Cálculo exprés del potencial', type: 'list', note: 'Cifras orientativas para conversación; el dimensionamiento final lo hace el equipo técnico.', items: [
          ['Paso 1 · Consumo diurno', 'Si la operación es diurna, asume que entre 60% y 80% del consumo ocurre con sol.'],
          ['Paso 2 · Tamaño aproximado', 'Divide el consumo mensual que quieres cubrir entre 120. Ejemplo: 12.000 kWh × 50% ÷ 120 ≈ 50 kWp.'],
          ['Paso 3 · Ahorro mensual', 'Multiplica los kWh generados por el costo unitario. 50 kWp × 120 kWh ≈ 6.000 kWh × $800 ≈ $4,8 millones al mes.'],
          ['Paso 4 · Área', 'Cada kWp requiere entre 5 y 7 m² de cubierta. 50 kWp ≈ 250 a 350 m².']] },
        { h: 'Antes de cerrar la conversación', type: 'check', items: ['Pide las últimas 3 a 6 facturas o el histórico del gráfico', 'Confirma si la empresa tiene más de una sede o medidor', 'Pregunta si han recibido otras propuestas solares', 'Anota el operador de red y el nivel de tensión'] }
      ],
      close: 'Con estas seis cifras ya puedes registrar un referido de alta calidad. Adjunta la factura en el Hub y el equipo técnico hará el dimensionamiento.'
    },

    't-roi': {
      title: 'Hoja de trabajo ROI · Payback · TIR', sub: 'Finanzas · Plantilla de cálculo', pages: '3 páginas',
      intro: 'Una hoja de trabajo para analizar cualquier inversión —solar, maquinaria o tecnología— con los tres indicadores que usan las juntas directivas. Incluye fórmulas, un ejemplo resuelto con un proyecto solar comercial y una guía para presentar los resultados.',
      when: ['Antes de recomendar o presentar una inversión', 'Para comparar alternativas (comprar, arrendar, PPA)', 'Al preparar una conversación con un gerente financiero'],
      sections: [
        { h: 'Datos de entrada', type: 'fields', items: ['Inversión inicial (CAPEX), COP', 'Ahorro o ingreso anual del primer año, COP', 'Costos anuales de operación y mantenimiento (OPEX), COP', 'Incremento anual esperado del ahorro (ej.: inflación de tarifa), %', 'Vida útil del proyecto, años', 'Tasa de descuento o costo de capital de la empresa, %', 'Beneficios tributarios aplicables, COP'] },
        { h: 'Fórmulas', type: 'list', items: [
          ['Flujo neto anual', 'Ahorro anual − OPEX anual. Es el dinero que la inversión libera cada año.'],
          ['Payback simple', 'CAPEX ÷ flujo neto anual. Responde “¿en cuántos años recupero lo invertido?”. No considera el valor del dinero en el tiempo.'],
          ['ROI acumulado', '(Suma de flujos netos de la vida útil − CAPEX) ÷ CAPEX. Muestra cuántas veces se recupera la inversión.'],
          ['VPN (valor presente neto)', 'Suma de cada flujo dividido por (1 + tasa)^año, menos el CAPEX. Si es positivo, la inversión crea valor frente al costo de capital.'],
          ['TIR', 'La tasa de descuento que hace el VPN igual a cero. Compárala con el costo de capital o con la rentabilidad de otras alternativas.']] },
        { h: 'Ejemplo resuelto · sistema solar de 100 kWp', type: 'table', note: 'Cifras ilustrativas para un comercio con operación diurna. Valida siempre con la propuesta técnica.', cols: ['Concepto', 'Valor', 'Cómo se obtiene'], rows: [
          ['CAPEX', '$330.000.000', '100 kWp × $3,3 millones por kWp instalado'],
          ['Generación anual', '144.000 kWh', '100 kWp × 120 kWh/mes × 12'],
          ['Ahorro año 1', '$112.300.000', '144.000 kWh × $780 por kWh'],
          ['OPEX anual', '$3.300.000', '≈ 1% del CAPEX (limpieza y mantenimiento)'],
          ['Flujo neto año 1', '$109.000.000', 'Ahorro − OPEX'],
          ['Payback simple', '≈ 3,0 años', '$330 M ÷ $109 M'],
          ['Beneficio Ley 1715', 'hasta $165.000.000', 'Deducción en renta de hasta el 50% de la inversión, en un plazo de hasta 15 años']] },
        { h: 'Cómo interpretar los resultados', type: 'table', cols: ['Indicador', 'Señal favorable', 'Pregunta que debes hacerte'], rows: [
          ['Payback', 'Menor a la mitad de la vida útil', '¿La empresa estará en esta sede durante ese periodo?'],
          ['TIR', 'Mayor que el costo de capital', '¿Qué otras inversiones compiten por el mismo dinero?'],
          ['VPN', 'Positivo', '¿Qué pasa si el ahorro es 15% menor al estimado?'],
          ['Flujo de caja', 'Cuota de financiación < ahorro mensual', '¿La inversión se paga sola desde el primer mes?']] },
        { h: 'Análisis de sensibilidad', type: 'check', items: ['Recalcula con un ahorro 15% menor (escenario conservador)', 'Recalcula con tarifa estable, sin incremento anual', 'Incluye el reemplazo del inversor hacia el año 12–15', 'Considera la degradación de paneles (≈ 0,5% anual)', 'Compara compra con recursos propios, crédito y modelo de pago por energía (PPA)'] },
        { h: 'Para presentarlo en una página', type: 'list', items: [
          ['La decisión', 'Una frase: qué se propone y cuánto cuesta.'],
          ['Los tres números', 'Payback, TIR y ahorro acumulado. Nada más en la parte superior.'],
          ['El riesgo', 'El escenario conservador y qué lo mitiga.'],
          ['La alternativa', 'Qué pasa si no se hace: costo de la inacción en cinco años.']] }
      ],
      close: 'El payback convence a gerencia; la TIR convence a finanzas; el flujo de caja mensual convence a quien firma. Prepara los tres.'
    },

    't-diag': {
      title: 'Guía de Preguntas de Diagnóstico', sub: 'Relaciones & Ventas · Banco de preguntas', pages: '3 páginas',
      intro: 'Las personas confían más en quien pregunta bien que en quien explica mucho. Esta guía reúne preguntas probadas para entender la situación de una empresa, descubrir necesidades reales y abrir la conversación sin sonar a venta. Está organizada en cuatro momentos de la conversación, siguiendo la lógica de la venta consultiva.',
      when: ['Antes de una reunión con un empresario o gerente', 'Cuando quieres pasar de conversación social a conversación de negocio', 'Para preparar a tu equipo antes de visitas comerciales'],
      sections: [
        { h: 'Momento 1 · Situación', type: 'list', note: 'Entiende el contexto. Máximo tres preguntas: el cliente no quiere un interrogatorio.', items: [
          ['Prioridades', '“¿Cuáles son las tres prioridades de la empresa para este año?”'],
          ['Cambios recientes', '“¿Qué ha cambiado en su operación en los últimos 12 meses?”'],
          ['Estructura de costos', '“¿Cuáles son los costos que más le preocupan hoy?”']] },
        { h: 'Momento 2 · Problema', type: 'list', note: 'Identifica tensiones reales. Escucha el lenguaje exacto que usa la persona.', items: [
          ['Fricción', '“¿Qué es lo que más le quita tiempo o dinero en este momento?”'],
          ['Intentos previos', '“¿Qué han intentado para resolverlo? ¿Qué funcionó y qué no?”'],
          ['Volatilidad', '“¿Qué tan predecibles son sus costos de energía, materias primas o financiación?”']] },
        { h: 'Momento 3 · Implicación', type: 'list', note: 'Ayuda a dimensionar el costo de no actuar. Aquí la persona se convence sola.', items: [
          ['Impacto', '“Si eso sigue igual dos años más, ¿qué efecto tendría en sus márgenes?”'],
          ['Competencia', '“¿Sus competidores enfrentan el mismo problema? ¿Alguno ya lo resolvió?”'],
          ['Personas', '“¿A quién más dentro de la empresa le afecta esto?”']] },
        { h: 'Momento 4 · Necesidad y siguiente paso', type: 'list', note: 'La persona describe el valor de la solución con sus propias palabras.', items: [
          ['Valor', '“Si pudiera fijar ese costo durante 20 años, ¿qué haría con ese ahorro?”'],
          ['Criterios', '“¿Qué tendría que cumplir una solución para que valga la pena evaluarla?”'],
          ['Decisión', '“¿Cómo toman normalmente este tipo de decisiones y quién participa?”'],
          ['Siguiente paso', '“¿Le parecería útil que un especialista revise su caso, sin compromiso?”']] },
        { h: 'Preguntas por tipo de interlocutor', type: 'table', cols: ['Interlocutor', 'Qué protege', 'Pregunta clave'], rows: [
          ['Gerente general', 'Crecimiento y competitividad', '“¿Qué necesitaría la empresa para crecer sin que los costos crezcan al mismo ritmo?”'],
          ['Gerente financiero', 'Caja, riesgo y retorno', '“¿Qué retorno mínimo exige la junta a una inversión de este tamaño?”'],
          ['Gerente de planta', 'Continuidad operativa', '“¿Qué tanto le afectan los cortes o la calidad de la energía?”'],
          ['Líder de sostenibilidad', 'Metas e informes', '“¿Qué metas de emisiones o de reporte tienen para los próximos años?”']] },
        { h: 'Reglas de oro', type: 'check', items: ['Pregunta una cosa a la vez y espera la respuesta completa', 'Habla menos del 30% del tiempo de la conversación', 'Repite con tus palabras lo que entendiste antes de proponer', 'Anota las frases textuales del cliente: son tu mejor argumento después', 'Cierra siempre con un siguiente paso concreto y una fecha'] }
      ],
      close: 'Elige tres preguntas, una por momento, para tu próxima reunión. La calidad de las preguntas define la calidad de la oportunidad.'
    },

    't-reunion': {
      title: 'Template de preparación de reuniones', sub: 'Negocios & Competitividad · Plantilla de una página', pages: '1 página + guía',
      intro: 'Quince minutos de preparación cambian el resultado de una reunión de una hora. Esta plantilla te obliga a definir el objetivo, investigar a la empresa, formular hipótesis y preparar el cierre antes de entrar. Imprímela o llénala en pantalla.',
      when: ['Antes de cualquier reunión con un tomador de decisión', 'Para preparar una introducción o una visita conjunta con GEENERA', 'Como registro posterior de acuerdos y compromisos'],
      sections: [
        { h: 'Antes · Objetivo', type: 'fields', items: ['Empresa, persona y cargo', 'Objetivo de la reunión en una frase (qué debe pasar al final)', 'Resultado mínimo aceptable', 'Por qué la persona aceptó reunirse (qué gana ella)'] },
        { h: 'Antes · Investigación en 10 minutos', type: 'check', items: ['Sitio web: qué venden, a quién y desde cuándo', 'Noticias recientes: expansión, premios, cambios de dirección', 'Perfil de LinkedIn de la persona: trayectoria, publicaciones e intereses', 'Sector: tendencia de costos y competidores principales', 'Relación previa: quién de tu red la conoce'] },
        { h: 'Antes · Hipótesis', type: 'fields', items: ['Hipótesis 1: un problema que probablemente tiene', 'Hipótesis 2: una oportunidad que probablemente no está aprovechando', 'Tres preguntas para validar o descartar las hipótesis'] },
        { h: 'Durante · Estructura sugerida (30 minutos)', type: 'table', cols: ['Minutos', 'Bloque', 'Qué hacer'], rows: [
          ['0 – 3', 'Apertura', 'Agradece, confirma el tiempo disponible y propone la agenda.'],
          ['3 – 18', 'Diagnóstico', 'Preguntas de situación, problema e implicación. Escucha y anota.'],
          ['18 – 25', 'Perspectiva', 'Comparte un dato, un caso o una idea relevante para lo que escuchaste.'],
          ['25 – 30', 'Cierre', 'Resume lo entendido y acuerda un siguiente paso con fecha y responsable.']] },
        { h: 'Después · Registro', type: 'fields', items: ['Tres cosas que aprendí', 'Frase textual más importante del cliente', 'Acuerdos: qué, quién y cuándo', 'Mensaje de seguimiento enviado (fecha)'] },
        { h: 'Mensaje de seguimiento (24 horas)', type: 'script', items: [['Plantilla', '“Hola, [nombre]. Gracias por el tiempo de hoy. Me quedo con [idea clave que mencionó]. Como acordamos, [siguiente paso] antes del [fecha]. Quedo atento.”']] }
      ],
      close: 'Una reunión sin siguiente paso acordado es una conversación agradable, no una oportunidad.'
    },

    't-event': {
      title: 'Event Canvas', sub: 'Negocios & Competitividad · Lienzo de diseño', pages: '2 páginas',
      intro: 'Un lienzo para diseñar eventos empresariales que la gente recomienda. Parte del cambio que quieres provocar en los asistentes y termina en cómo medirlo. Funciona igual para un desayuno de 20 personas que para un foro de 300.',
      when: ['Al planear un evento gremial, comercial o de comunidad', 'Para alinear a un equipo organizador en una sola página', 'Al evaluar por qué un evento anterior no generó resultados'],
      sections: [
        { h: '1 · Propósito', type: 'fields', items: ['¿Qué debe cambiar en los asistentes al salir? (saber, sentir, hacer)', '¿Por qué este evento y por qué ahora?', 'Indicador de éxito principal'] },
        { h: '2 · Audiencia', type: 'fields', items: ['¿Quién debe estar? Cargo, sector, tamaño de empresa', '¿Qué le preocupa hoy a esa persona?', '¿Qué la haría cancelar su agenda para venir?'] },
        { h: '3 · Experiencia', type: 'table', cols: ['Momento', 'Pregunta de diseño', 'Ideas'], rows: [
          ['Antes', '¿Cómo llega preparado y con expectativa?', 'Encuesta previa, lista de asistentes, pregunta para pensar'],
          ['Llegada', '¿Qué siente en los primeros 10 minutos?', 'Recibimiento por nombre, conexiones sugeridas'],
          ['Contenido', '¿Qué aprende que no encuentra en internet?', 'Datos del sector, caso local, panel con desacuerdo'],
          ['Conexión', '¿A quién conoce que vale la pena?', 'Mesas temáticas, matchmaking, dinámicas guiadas'],
          ['Después', '¿Qué se lleva y qué hace al día siguiente?', 'Resumen con datos, herramienta, invitación al siguiente paso']] },
        { h: '4 · Formato y logística', type: 'check', items: ['Duración que respeta la agenda ejecutiva (desayunos de 90 a 120 minutos funcionan bien)', 'Lugar accesible y coherente con el mensaje', 'Máximo 40% del tiempo en presentaciones; el resto en conversación', 'Moderador que hace preguntas difíciles', 'Plan B para conectividad, sonido y tiempos'] },
        { h: '5 · Medición', type: 'table', cols: ['Indicador', 'Cómo medirlo', 'Meta sugerida'], rows: [
          ['Asistencia efectiva', 'Asistentes ÷ confirmados', 'Mayor a 70%'],
          ['Calidad de audiencia', '% de asistentes con el perfil objetivo', 'Mayor a 60%'],
          ['Recomendación', 'Pregunta NPS al cierre (0 a 10)', 'Mayor a 50'],
          ['Conversaciones generadas', 'Reuniones agendadas en los 30 días siguientes', 'Definir según objetivo'],
          ['Contenido reutilizado', 'Piezas derivadas (resumen, carrusel, video)', 'Al menos 3']] },
        { h: '6 · Presupuesto y aliados', type: 'fields', items: ['Presupuesto total y fuentes (cuotas, patrocinio, aliados)', 'Aliados que suman contenido, audiencia o recursos', 'Qué recibe cada aliado a cambio'] }
      ],
      close: 'El evento empieza con la invitación y termina con el seguimiento. Diseña ambos con la misma atención que el contenido.'
    },

    't-prompts': {
      title: 'Librería de Prompts', sub: 'IA & Automatización · 24 prompts probados', pages: '4 páginas',
      intro: 'Prompts listos para copiar, organizados por tarea. Todos siguen la estructura de cuatro bloques —contexto, objetivo, restricciones y formato— y tienen espacios entre corchetes para tu información. Funcionan en ChatGPT, Claude, Gemini o Copilot.',
      when: ['Para preparar reuniones, correos y propuestas', 'Al analizar documentos, hojas de cálculo o reportes', 'Para crear contenido profesional con tu propia voz'],
      sections: [
        { h: 'La estructura base', type: 'list', items: [
          ['Contexto', 'Quién eres, para quién es y en qué situación. “Soy ejecutivo de banca empresarial y preparo…”'],
          ['Objetivo', 'Qué resultado concreto necesitas. “Dame tres preguntas de diagnóstico…”'],
          ['Restricciones', 'Tono, extensión, qué evitar. “Máximo 120 palabras, sin tecnicismos.”'],
          ['Formato', 'Cómo quieres la respuesta. “En una tabla con columnas X, Y, Z.”']] },
        { h: 'Preparar reuniones', type: 'script', items: [
          ['Investigar una empresa', 'Actúa como analista de negocios. Voy a reunirme con [cargo] de [empresa], del sector [sector] en [ciudad]. Con base en información pública, resume en una tabla: modelo de negocio, clientes principales, retos probables del sector en 2026 y tres preguntas inteligentes para abrir la conversación. Marca lo que sea suposición.'],
          ['Hipótesis de necesidad', 'Soy [tu rol]. Esta empresa [describe lo que sabes]. Formula tres hipótesis sobre problemas que probablemente enfrenta y, para cada una, una pregunta que me permita validarla sin sonar a venta.'],
          ['Agenda de 30 minutos', 'Diseña la agenda de una reunión de 30 minutos con [persona] cuyo objetivo es [objetivo]. Incluye tiempos, preguntas clave y una propuesta de siguiente paso.']] },
        { h: 'Escribir y comunicar', type: 'script', items: [
          ['Correo de primer contacto', 'Escribe un correo de máximo 120 palabras a [cargo] de [empresa] para proponer una conversación de 20 minutos sobre [tema]. Menciona [conexión o motivo]. Tono cercano, profesional, sin adjetivos exagerados. Dame dos versiones de asunto.'],
          ['WhatsApp de seguimiento', 'Redacta un WhatsApp breve (máximo 3 líneas) para retomar la conversación con [nombre] sobre [tema], sin presionar. Incluye una pregunta fácil de responder.'],
          ['Responder una objeción', 'Un cliente me dijo: “[objeción]”. Dame tres formas de responder que empiecen con una pregunta, reconozcan su punto y aporten un dato o perspectiva nueva.'],
          ['Resumen ejecutivo', 'Convierte este texto en un resumen ejecutivo de 5 líneas para un gerente general: decisión requerida, contexto, números clave, riesgo y siguiente paso. Texto: [pega aquí]']] },
        { h: 'Analizar información', type: 'script', items: [
          ['Resumir un PDF', 'Resume este documento en: 1) tres ideas principales, 2) cifras relevantes con su página, 3) implicaciones para [tu contexto], 4) preguntas que quedan abiertas. No inventes datos que no estén en el documento.'],
          ['Leer una hoja de cálculo', 'Analiza esta tabla de [describe]. Identifica tendencias, valores atípicos y tres conclusiones accionables. Indica qué cálculos hiciste para llegar a cada conclusión.'],
          ['Comparar opciones', 'Compara [opción A] y [opción B] para [objetivo] en una tabla con: costo, tiempo, riesgo, ventajas y desventajas. Termina con una recomendación y bajo qué condición cambiaría.'],
          ['Análisis de una inversión', 'Con estos datos: CAPEX [valor], ahorro anual [valor], OPEX [valor], vida útil [años], tasa [porcentaje], calcula payback, VPN y TIR paso a paso, y explica el resultado en lenguaje de gerente.']] },
        { h: 'Contenido y marca personal', type: 'script', items: [
          ['Post de LinkedIn', 'Escribe un post de LinkedIn de máximo 150 palabras sobre [idea], con base en esta experiencia: [describe]. Empieza con una frase que genere curiosidad, sin emojis ni hashtags genéricos, y termina con una pregunta abierta. Usa mi tono: [pega un post tuyo].'],
          ['Ideas de contenido', 'Soy [rol] y mi audiencia son [perfil]. Dame 10 ideas de publicaciones basadas en preguntas reales que esa audiencia se hace, con un ángulo propio para cada una.'],
          ['Editar en tu voz', 'Revisa este texto para que suene natural y directo, como lo diría [rol] en una conversación. Elimina relleno y frases de cliché. Mantén la longitud. Texto: [pega aquí]']] },
        { h: 'Productividad', type: 'script', items: [
          ['Auditar tu semana', 'Esta es mi lista de tareas de la semana: [pega]. Clasifícalas en: requiere mi criterio, se puede delegar, se puede automatizar, se puede eliminar. Para las automatizables, sugiere cómo.'],
          ['Acta de reunión', 'Con estas notas desordenadas de una reunión: [pega], escribe un acta con decisiones, compromisos (responsable y fecha) y temas pendientes.'],
          ['Plan de la semana', 'Con mis prioridades [lista] y mis reuniones [lista], propón un plan semanal con bloques de trabajo profundo y tiempo para seguimiento.']] },
        { h: 'Uso responsable', type: 'check', items: ['No pegues datos personales, financieros o confidenciales de clientes en herramientas sin acuerdo corporativo', 'Verifica cifras, nombres y normas antes de usarlas', 'Pide a la IA que marque lo que es suposición', 'La IA redacta; tú decides y firmas'] }
      ],
      close: 'Guarda tus tres prompts más usados con tu propio contexto ya escrito. La segunda vez toma 30 segundos.'
    },

    't-red': {
      title: 'Mapa de Red Estratégica', sub: 'Relaciones · Plantilla de mapeo', pages: '2 páginas',
      intro: 'La mayoría de las oportunidades no están en contactos nuevos, sino en relaciones existentes que no has activado. Este mapa te ayuda a ordenar tu red por sector, confianza y potencial, y a decidir con quién conversar primero. Se basa en un principio estudiado desde los años setenta: los lazos débiles —conocidos, excolegas, contactos ocasionales— suelen traer más información nueva que el círculo cercano.',
      when: ['Al comenzar en Aliados del Sol', 'Cada trimestre, para revisar a quién retomar', 'Antes de un evento, para decidir con quién hablar'],
      sections: [
        { h: '1 · Lista inicial (30 nombres)', type: 'list', note: 'Escribe sin filtrar. Recorre estas fuentes:', items: [
          ['Trabajo actual y anterior', 'Clientes, proveedores, excolegas y exjefes.'],
          ['Gremios y asociaciones', 'Juntas, comités y eventos en los que participas.'],
          ['Formación', 'Compañeros de universidad, posgrado y cursos.'],
          ['Comunidad', 'Club, colegio de los hijos, vecinos, deporte.'],
          ['Digital', 'Contactos de LinkedIn con quienes has interactuado en el último año.']] },
        { h: '2 · Calificación', type: 'table', note: 'Califica cada contacto de 1 a 3 en cada criterio.', cols: ['Criterio', '1', '2', '3'], rows: [
          ['Confianza', 'Me recuerda vagamente', 'Hemos trabajado o compartido', 'Me atiende el teléfono hoy'],
          ['Acceso', 'No decide ni conoce a quien decide', 'Conoce a quien decide', 'Decide o es socio'],
          ['Potencial', 'Empresa pequeña o sin señales', 'Algunas señales', 'Varias señales de oportunidad']] },
        { h: '3 · Mapa', type: 'fields', items: ['Nombre · Empresa · Sector · Confianza · Acceso · Potencial · Total', 'Nombre · Empresa · Sector · Confianza · Acceso · Potencial · Total', 'Nombre · Empresa · Sector · Confianza · Acceso · Potencial · Total', 'Nombre · Empresa · Sector · Confianza · Acceso · Potencial · Total', 'Nombre · Empresa · Sector · Confianza · Acceso · Potencial · Total'] },
        { h: '4 · Cuadrantes de acción', type: 'table', cols: ['Cuadrante', 'Perfil', 'Qué hacer'], rows: [
          ['Activar', 'Alta confianza + alto potencial', 'Conversación esta semana con una pregunta útil, no con una oferta.'],
          ['Construir', 'Baja confianza + alto potencial', 'Aporta valor primero: un dato, una introducción, un contenido.'],
          ['Pedir puentes', 'Alta confianza + bajo potencial', 'Pregunta a quién conocen que enfrente costos altos de energía.'],
          ['Mantener', 'Baja confianza + bajo potencial', 'Contacto ocasional; no inviertas tiempo de prospección.']] },
        { h: 'Ritmo sugerido', type: 'check', items: ['Dos conversaciones de “Activar” por semana', 'Un aporte de valor a un contacto de “Construir” por semana', 'Una petición de puente cada quince días', 'Revisión completa del mapa cada trimestre'] }
      ],
      close: 'No necesitas una red más grande, sino una red mejor ordenada. Empieza por los tres nombres con mayor puntaje.'
    },

    't-linkedin': {
      title: 'Kit LinkedIn para aliados', sub: 'Marca & Crecimiento · Perfil, publicaciones y mensajes', pages: '3 páginas',
      intro: 'LinkedIn es la principal red profesional para conversaciones B2B en Colombia y la región. Este kit reúne lo necesario para que tu perfil comunique qué resuelves, publiques con criterio sin volverte influencer y conviertas interacciones en conversaciones reales.',
      when: ['Al actualizar tu perfil profesional', 'Para planear un mes de publicaciones', 'Antes de escribir a un contacto nuevo'],
      sections: [
        { h: 'Perfil · Lista de revisión', type: 'check', items: ['Foto profesional, rostro visible, fondo neutro', 'Titular que dice a quién ayudas y en qué (no solo tu cargo)', 'Imagen de portada coherente con tu tema', 'Sección “Acerca de” en tres párrafos: qué haces, para quién, cómo contactarte', 'Experiencia con logros concretos, no listas de funciones', 'Sección Destacados con uno o dos contenidos que muestren tu criterio', 'URL personalizada'] },
        { h: 'Fórmulas de titular', type: 'list', items: [
          ['Rol + resultado', '“Ejecutivo de banca empresarial · Ayudo a PyMEs a financiar su crecimiento con flujo de caja sano”'],
          ['Problema + audiencia', '“Conecto empresas industriales con soluciones para reducir su costo de energía”'],
          ['Especialidad + sector', '“Consultor en eficiencia operativa para el sector alimentos en Santander”']] },
        { h: 'Siete formatos de publicación', type: 'list', items: [
          ['El dato con opinión', 'Una cifra relevante y lo que significa para tu audiencia.'],
          ['La pregunta frecuente', 'Lo que te preguntan los clientes y tu respuesta.'],
          ['El error común', 'Algo que ves repetirse y cómo evitarlo.'],
          ['El caso breve', 'Situación, decisión y resultado, sin nombres si no tienes permiso.'],
          ['La lista práctica', 'Tres a cinco pasos o señales aplicables.'],
          ['El aprendizaje', 'Lo que cambió tu forma de pensar este mes.'],
          ['El reconocimiento', 'Destaca el trabajo de un cliente, colega o aliado.']] },
        { h: 'Plan de un mes (2 publicaciones por semana)', type: 'table', cols: ['Semana', 'Publicación 1', 'Publicación 2'], rows: [
          ['1', 'Dato con opinión sobre tu sector', 'Pregunta frecuente de clientes'],
          ['2', 'Error común y cómo evitarlo', 'Reconocimiento a un aliado'],
          ['3', 'Caso breve', 'Lista práctica'],
          ['4', 'Aprendizaje del mes', 'Pregunta abierta a tu red']] },
        { h: 'Mensajes que abren conversaciones', type: 'script', items: [
          ['Invitación a conectar', '“Hola, [nombre]. Vi tu comentario sobre [tema] y coincido en [punto]. Me gustaría seguir tu trabajo.”'],
          ['Después de una interacción', '“Gracias por comentar mi publicación sobre [tema]. ¿Cómo lo están viviendo en [empresa]?”'],
          ['Proponer una conversación', '“[Nombre], estoy hablando con varios gerentes de [sector] sobre [tema]. ¿Te parecería útil una conversación de 15 minutos para comparar experiencias?”']] },
        { h: 'Rutina semanal de 30 minutos', type: 'check', items: ['10 min · Comentar con criterio en 5 publicaciones de tu audiencia', '10 min · Publicar o preparar tu siguiente publicación', '5 min · Responder comentarios y mensajes', '5 min · Enviar dos mensajes a contactos que interactuaron contigo'] }
      ],
      close: 'La constancia vale más que la viralidad. Dos publicaciones útiles por semana durante tres meses construyen más reputación que una publicación exitosa.'
    },

    't-propuestas': {
      title: 'Comparador de propuestas solares', sub: 'Energía · Hoja de comparación', pages: '3 páginas',
      intro: 'Dos propuestas solares pueden diferir 20% o más en precio sin que ninguna esté mal cotizada: casi siempre la diferencia está en el alcance, la calidad de los equipos o las garantías. Esta hoja ayuda al cliente —y a ti— a comparar ofertas en igualdad de condiciones, pasando del costo por kWp al costo por kWh producido durante la vida útil.',
      when: ['Cuando un cliente recibió dos o más ofertas', 'Antes de que el cliente decida solo por precio', 'Para preparar preguntas al proveedor'],
      sections: [
        { h: 'Paso 1 · Normaliza el alcance', type: 'table', note: 'Marca con ✓ lo que incluye cada propuesta. Lo que falta debe cotizarse aparte para comparar.', cols: ['Elemento', 'Propuesta A', 'Propuesta B', 'Propuesta C'], rows: [
          ['Módulos (marca, potencia, garantía de producto y producción)', '', '', ''],
          ['Inversores (marca, garantía, soporte local)', '', '', ''],
          ['Estructura y fijación que preserva la impermeabilidad', '', '', ''],
          ['Estudio estructural de la cubierta', '', '', ''],
          ['Estudio de sombras y diseño eléctrico de detalle', '', '', ''],
          ['Obra eléctrica hasta el punto de conexión', '', '', ''],
          ['Certificación RETIE', '', '', ''],
          ['Trámite de conexión ante el operador de red', '', '', ''],
          ['Gestión de incentivos Ley 1715 (certificación)', '', '', ''],
          ['Monitoreo en línea', '', '', ''],
          ['Plan de mantenimiento incluido (años)', '', '', ''],
          ['Garantía de instalación (años)', '', '', '']] },
        { h: 'Paso 2 · Compara los números clave', type: 'fields', items: ['Potencia instalada (kWp) · A / B / C', 'CAPEX total (COP) · A / B / C', 'Costo por kWp (CAPEX ÷ kWp) · A / B / C', 'Producción estimada año 1 (kWh) · A / B / C', 'Rendimiento específico (kWh/kWp/año) · A / B / C', 'Porcentaje del consumo cubierto · A / B / C'] },
        { h: 'Paso 3 · Costo por kWh en la vida útil', type: 'list', note: 'La métrica más justa para comparar calidad: el costo nivelado de energía (LCOE) simplificado.', items: [
          ['Costo total', 'CAPEX + (costo anual de operación × 25 años) + reemplazo de inversores.'],
          ['Energía total', 'Producción año 1 × 25 años × factor de degradación promedio (≈ 0,94).'],
          ['LCOE simplificado', 'Costo total ÷ energía total. Compáralo con el costo unitario actual de la factura del cliente.'],
          ['Lectura', 'Una oferta más barata que produce menos o se degrada más rápido puede tener un costo por kWh mayor.']] },
        { h: 'Señales de alerta', type: 'check', items: ['Producción por kWp muy superior al promedio de la zona sin explicación técnica', 'Equipos sin marca, sin ficha técnica o sin garantía escrita', 'Trámites, estudios o RETIE “por definir” o excluidos', 'Sin plan de mantenimiento ni monitoreo', 'Payback que no considera costos de operación ni reemplazo de inversor', 'Promesas de incentivos tributarios sin mencionar la certificación previa'] },
        { h: 'Preguntas para el proveedor', type: 'list', items: [
          ['Producción', '“¿Con qué base de datos de irradiación y qué pérdidas calcularon la producción?”'],
          ['Cubierta', '“¿Incluye estudio estructural? ¿Cómo garantizan la impermeabilidad?”'],
          ['Garantías', '“¿Quién responde por una falla del inversor en el año 6 y en cuánto tiempo?”'],
          ['Trámites', '“¿Quién gestiona la conexión con el operador de red y la certificación RETIE?”'],
          ['Operación', '“¿Qué incluye el mantenimiento y cómo me entero si el sistema produce menos?”']] }
      ],
      close: 'No se trata de elegir la oferta más cara, sino la que entrega más energía confiable por cada peso durante 25 años.'
    },

    't-financiacion': {
      title: 'Guía de modalidades de financiación', sub: 'Finanzas · Guía comparativa', pages: '2 páginas',
      intro: 'Muchas empresas quieren el ahorro solar pero no quieren comprometer caja. Esta guía compara las cuatro formas de pagar un sistema, las preguntas para saber cuál conviene a cada cliente y las frases seguras para presentar la financiación sin prometer tasas ni aprobaciones, que siempre define cada entidad.',
      when: ['Cuando el cliente dice “me interesa, pero no tengo la plata”', 'Al preparar una reunión con un gerente financiero', 'Para conectar a un cliente con aliados financieros'],
      sections: [
        { h: 'Las cuatro modalidades', type: 'table', cols: ['Modalidad', 'Quién es dueño', 'Ventaja principal', 'A tener en cuenta'], rows: [
          ['Recursos propios', 'La empresa', 'Máximo ahorro e incentivos completos', 'Compromete caja que podría usarse en el negocio'],
          ['Crédito de inversión / verde', 'La empresa', 'Propiedad e incentivos; la cuota puede ser menor que el ahorro', 'Aumenta el endeudamiento; condiciones según la entidad'],
          ['Leasing financiero', 'La entidad durante el plazo; opción de compra al final', 'Preserva líneas de crédito tradicionales', 'Validar tratamiento tributario e incentivos con el contador'],
          ['Pago por energía (PPA / renting)', 'Un inversionista', 'Cero inversión y cero operación; ahorro desde el mes 1', 'Menor ahorro total; incentivos para el inversionista; contrato largo']] },
        { h: 'Preguntas de diagnóstico', type: 'list', items: [
          ['Prioridad', '“¿Qué le importa más: maximizar el ahorro, proteger la caja o no tener el activo en su balance?”'],
          ['Caja', '“¿Tiene otras inversiones previstas este año que compitan por el mismo dinero?”'],
          ['Endeudamiento', '“¿Cómo está su capacidad de crédito hoy?”'],
          ['Impuestos', '“¿La empresa tiene renta suficiente para aprovechar la deducción de la Ley 1715?”'],
          ['Operación', '“¿Prefiere que su equipo se ocupe del mantenimiento o que lo haga un tercero?”']] },
        { h: 'Árbol de decisión rápido', type: 'table', cols: ['Si el cliente…', 'Considera primero'], rows: [
          ['Tiene caja y renta para aprovechar incentivos', 'Recursos propios o crédito'],
          ['Quiere ser dueño pero proteger la caja', 'Crédito de largo plazo o leasing'],
          ['No quiere invertir ni operar activos', 'Pago por energía (PPA)'],
          ['Tiene varias sedes o un grupo empresarial', 'Conversación con el aliado financiero de su banco principal']] },
        { h: 'Frases seguras', type: 'script', items: [
          ['Presentar la opción', '“Existen alternativas para que el proyecto se pague con su propio ahorro. El equipo de GEENERA puede presentarle opciones con nuestros aliados financieros.”'],
          ['Si pregunta la tasa', '“Cada entidad define sus condiciones según el perfil de la empresa. Lo que sí podemos hacer es conectarlo para que reciba una propuesta formal.”'],
          ['Cuota vs. ahorro', '“El objetivo es que la cuota sea igual o menor que lo que deja de pagar en energía, para que el flujo sea positivo desde el inicio.”']] },
        { h: 'Lo que nunca debes prometer', type: 'check', items: ['Tasas, plazos o cuotas específicas', 'Aprobación de crédito o tiempos de desembolso', 'Que la empresa aplicará con seguridad un incentivo tributario', 'Ahorros exactos sin la propuesta técnica'] }
      ],
      close: 'Tu papel es mostrar que la financiación existe y conectar al cliente con quien puede estructurarla. Las condiciones las define cada entidad.'
    },

    't-objeciones': {
      title: 'Banco de objeciones y respuestas', sub: 'Relaciones & Ventas · Guía de conversación', pages: '3 páginas',
      intro: 'Una objeción no es un rechazo: es interés acompañado de una duda. Esta guía reúne las objeciones más frecuentes en conversaciones sobre energía solar empresarial, el interés que suele haber detrás de cada una y una respuesta que empieza con una pregunta, siguiendo el método de cuatro pasos: escuchar, reconocer, preguntar y responder.',
      when: ['Antes de una reunión donde esperas resistencia', 'Para entrenar a tu equipo', 'Después de una conversación que no avanzó'],
      sections: [
        { h: 'El método de cuatro pasos', type: 'list', items: [
          ['1 · Escucha completa', 'Deja que la persona termine sin interrumpir. Anota sus palabras exactas.'],
          ['2 · Reconoce', '“Entiendo, es una decisión importante.” Reconocer no es estar de acuerdo.'],
          ['3 · Pregunta', 'Descubre el interés detrás de la posición antes de responder.'],
          ['4 · Responde', 'Con un dato, un caso o una opción que atienda el interés real.']] },
        { h: 'Objeciones frecuentes', type: 'table', cols: ['Objeción', 'Interés probable', 'Pregunta', 'Respuesta'], rows: [
          ['“Es muy caro”', 'Caja, prioridad o duda sobre el retorno', '“¿Le preocupa más el monto o el tiempo de recuperación?”', 'Financiación con cuota menor al ahorro; payback y años de ahorro posteriores'],
          ['“No creo que ahorre tanto”', 'Desconfianza en las cifras', '“¿Qué le haría confiar en el cálculo?”', 'Cálculo con su propia factura, escenario conservador y monitoreo en línea'],
          ['“¿Y si daña la cubierta?”', 'Riesgo operativo', '“¿Ha tenido problemas con la cubierta antes?”', 'Estudio estructural, fijaciones que preservan la impermeabilidad y garantía de instalación'],
          ['“¿Quién lo mantiene?”', 'Carga operativa', '“¿Quién maneja hoy el mantenimiento de sus equipos?”', 'Plan de mantenimiento, monitoreo y garantías de fabricante'],
          ['“La tarifa podría bajar”', 'Riesgo de mercado', '“¿Cómo se ha comportado su tarifa en los últimos tres años?”', 'Escenario con tarifa estable; la energía propia fija el costo durante décadas'],
          ['“No es el momento”', 'Otra prioridad o falta de urgencia', '“¿Qué tendría que pasar para que lo fuera?”', 'Acordar una fecha para retomar y enviar información útil mientras tanto'],
          ['“Tengo que consultarlo”', 'Decisión compartida', '“¿Con quién? ¿Qué le preguntará?”', 'Ofrecer una reunión con el decisor y un resumen de una página'],
          ['“Ya tengo otra oferta”', 'Comparación', '“¿Qué fue lo que más le gustó de esa propuesta?”', 'Comparador de propuestas: alcance, producción, garantías y costo por kWh']] },
        { h: 'Frases de reconocimiento', type: 'script', items: [
          ['Inversión', '“Tiene sentido pensarlo con cuidado; es una inversión de largo plazo.”'],
          ['Duda técnica', '“Es una pregunta muy común y es bueno resolverla antes de avanzar.”'],
          ['Tiempo', '“Entiendo que hay otras prioridades; no queremos presionar la decisión.”']] },
        { h: 'Errores que empeoran la objeción', type: 'check', items: ['Responder antes de que la persona termine', 'Discutir o corregir con tono de superioridad', 'Prometer cifras exactas para cerrar la discusión', 'Hablar mal de otros proveedores', 'Ignorar la objeción y seguir con la presentación'] },
        { h: 'Registro de objeciones', type: 'fields', items: ['Objeción textual · Cliente · Fecha', 'Interés que descubrí', 'Respuesta que funcionó (o no)', 'Siguiente paso acordado'] }
      ],
      close: 'Comparte las objeciones nuevas con tu consultora de GEENERA: así el equipo prepara mejores respuestas para todos los aliados.'
    },

    't-automatiza': {
      title: 'Auditoría de semana y mapa de automatización', sub: 'IA & Automatización · Plantilla de trabajo', pages: '3 páginas',
      intro: 'Recuperar cinco horas a la semana equivale a más de 200 horas al año. Esta plantilla te guía en cuatro pasos: registrar tu tiempo, clasificar tus tareas, diseñar automatizaciones y proteger el tiempo recuperado con un sistema de seguimiento y una revisión semanal.',
      when: ['Cuando sientes que la semana no alcanza', 'Antes de montar tus primeras automatizaciones', 'Cada trimestre, para revisar tu forma de trabajar'],
      sections: [
        { h: 'Paso 1 · Registro de tiempo (5 días)', type: 'table', note: 'Anota cada bloque de 30 minutos con la tarea real. Al final, suma por tipo.', cols: ['Tipo de tarea', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Total h'], rows: [
          ['Correo', '', '', '', '', '', ''], ['Reuniones', '', '', '', '', '', ''], ['Preparación de reuniones', '', '', '', '', '', ''], ['Seguimiento a contactos', '', '', '', '', '', ''], ['Reportes y documentos', '', '', '', '', '', ''], ['Búsqueda de información', '', '', '', '', '', ''], ['Trabajo de fondo / clientes clave', '', '', '', '', '', '']] },
        { h: 'Paso 2 · Clasificación', type: 'table', cols: ['Pregunta', 'Si la respuesta es sí…'], rows: [
          ['¿Qué pasaría si no la hiciera? (nada)', 'Eliminar'],
          ['¿Otra persona puede hacerla igual de bien?', 'Delegar'],
          ['¿Sigue siempre los mismos pasos y no requiere juicio?', 'Automatizar'],
          ['¿Implica redactar, resumir o analizar?', 'Acelerar con IA'],
          ['¿Requiere mi criterio o mi relación?', 'Hacer y proteger en el calendario']] },
        { h: 'Paso 3 · Diseña tus automatizaciones', type: 'fields', note: 'Escribe cada una como “Cuando pasa X, haz Y”.', items: ['Automatización 1 · Disparador · Acciones · Herramienta · Tiempo ahorrado/semana', 'Automatización 2 · Disparador · Acciones · Herramienta · Tiempo ahorrado/semana', 'Automatización 3 · Disparador · Acciones · Herramienta · Tiempo ahorrado/semana'] },
        { h: 'Ideas probadas', type: 'list', items: [
          ['Seguimiento', 'Si un contacto no responde en 5 días, crear una tarea de seguimiento.'],
          ['Facturas', 'Guardar automáticamente en una carpeta los adjuntos con “factura” en el asunto.'],
          ['Formularios', 'Agregar cada formulario recibido a la hoja de contactos y enviar bienvenida.'],
          ['Resumen semanal', 'Cada viernes, recibir la lista de tareas pendientes de la semana siguiente.'],
          ['Fechas clave', 'Alerta una semana antes de vencimientos de contratos o renovaciones.'],
          ['Correo', 'Reglas para mover boletines y notificaciones fuera de la bandeja principal.']] },
        { h: 'Paso 4 · Sistema de seguimiento', type: 'table', note: 'Un solo lugar para todo lo pendiente. Cada fila con próxima acción y fecha.', cols: ['Contacto', 'Empresa', 'Estado', 'Próxima acción', 'Fecha', 'Notas'], rows: [['', '', '', '', '', ''], ['', '', '', '', '', ''], ['', '', '', '', '', '']] },
        { h: 'Revisión semanal (30 minutos, viernes)', type: 'check', items: ['Procesar bandeja de entrada y notas sueltas', 'Actualizar estado y próxima acción de cada pendiente', 'Revisar los referidos en el Hub y su etapa', 'Bloquear en el calendario el trabajo de fondo de la semana siguiente', 'Verificar que las automatizaciones siguen funcionando'] }
      ],
      close: 'Automatiza lo repetitivo para dedicar más tiempo a lo que ninguna herramienta hace por ti: las relaciones.'
    },

    't-contenido': {
      title: 'Calendario editorial y kit de datos', sub: 'Marca & Crecimiento · Plantilla de planeación', pages: '3 páginas',
      intro: 'El contenido que los empresarios leen resuelve un problema concreto con información que no encuentran en otro lugar. Esta plantilla te ayuda a planear un trimestre de contenido a partir de lo que preocupa a tu audiencia, diseñar una encuesta que produzca datos propios y convertir cifras en historias que se citan.',
      when: ['Al planear el trimestre de un gremio, una cámara o tu marca personal', 'Antes de lanzar una encuesta a afiliados o clientes', 'Para preparar un informe sectorial o un evento de resultados'],
      sections: [
        { h: '1 · Preocupaciones de la audiencia', type: 'fields', items: ['Audiencia (cargo, sector, tamaño, región)', 'Las cinco preocupaciones principales (de encuestas, consultas o conversaciones)', 'Preguntas que más se repiten'] },
        { h: '2 · Calendario de un trimestre', type: 'table', cols: ['Semana', 'Tema (preocupación)', 'Formato', 'Canal', 'Fuente / experto'], rows: [['1', '', '', '', ''], ['2', '', '', '', ''], ['3', '', '', '', ''], ['4', '', '', '', ''], ['5', '', '', '', ''], ['6', '', '', '', ''], ['7', '', '', '', ''], ['8', '', '', '', ''], ['9', '', '', '', ''], ['10', '', '', '', ''], ['11', '', '', '', ''], ['12', '', '', '', '']] },
        { h: 'Formatos según canal', type: 'list', items: [
          ['Boletín por correo', 'Tres noticias del sector comentadas en dos líneas cada una.'],
          ['LinkedIn', 'Carrusel con cinco datos o publicación dato–opinión–pregunta.'],
          ['WhatsApp', 'Video de dos minutos o resumen de una imagen.'],
          ['Informe trimestral', 'Pieza principal de 8–12 páginas que se divide en piezas pequeñas.'],
          ['Evento', 'Desayuno de presentación de resultados con aliados que aportan soluciones.']] },
        { h: '3 · Encuesta que produce titulares', type: 'check', note: 'Diseña primero los titulares que quieres poder publicar; luego las preguntas.', items: ['Escribe tres titulares objetivo', 'Cinco a diez preguntas, mayoritariamente cerradas', 'Una o dos preguntas abiertas para citas', 'Variables de segmentación: sector, tamaño, ciudad', 'Fecha de cierre y meta de respuestas', 'Plan de piezas derivadas definido antes de enviar'] },
        { h: 'Preguntas modelo sobre energía', type: 'list', items: [
          ['Costo', '¿Cuánto paga su empresa de energía al mes? (rangos)'],
          ['Peso', '¿Qué porcentaje de sus costos operativos representa la energía? (rangos)'],
          ['Tendencia', '¿Cómo cambió su factura en los últimos 12 meses? (bajó / igual / subió hasta 20% / más de 20%)'],
          ['Acciones', '¿Qué ha hecho para gestionar el costo? (eficiencia / autogeneración / nada / otro)'],
          ['Interés', '¿Le interesaría un diagnóstico de autogeneración sin costo? (sí / no / más información)']] },
        { h: '4 · De la cifra a la historia', type: 'table', cols: ['Elemento', 'Ejemplo'], rows: [
          ['Hallazgo', 'Siete de cada diez empresas de alimentos de la región ubican la energía entre sus tres principales costos.'],
          ['Comparación', 'En manufactura, la proporción es de seis de cada diez.'],
          ['Contexto', 'La mayoría vio subir su factura en el último año sin aumentar su consumo.'],
          ['Implicación', 'Gestionar la energía se volvió una decisión de competitividad, no solo de ahorro.']] },
        { h: 'Indicadores', type: 'check', items: ['Apertura y clics por boletín', 'Comentarios y mensajes privados por publicación', 'Respuestas a la encuesta frente a la meta', 'Menciones en medios o reenvíos', 'Conversaciones o diagnósticos generados'] }
      ],
      close: 'Un dato propio, bien contado, vale más que diez estadísticas nacionales. Planea las piezas antes de recoger los datos.'
    }
  };

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function docHtml(id) {
    const t = K[id]; if (!t) return '';
    const logo = new URL('assets/logo-aliados.png', document.baseURI).href;
    const sec = (s, i) => {
      let body = '';
      if (s.type === 'check') body = '<ul class="ck">' + s.items.map(x => '<li><span class="box"></span>' + esc(x) + '</li>').join('') + '</ul>';
      if (s.type === 'list') body = '<ol class="ls">' + s.items.map((x, j) => '<li><span class="n">' + (j + 1) + '</span><div><b>' + esc(x[0]) + '</b><p>' + esc(x[1]) + '</p></div></li>').join('') + '</ol>';
      if (s.type === 'fields') body = '<div class="fl">' + s.items.map(x => '<div><span>' + esc(x) + '</span><i></i><i></i></div>').join('') + '</div>';
      if (s.type === 'script') body = '<div class="sc">' + s.items.map(x => '<div><span>' + esc(x[0]) + '</span><p>' + esc(x[1]) + '</p></div>').join('') + '</div>';
      if (s.type === 'table') body = '<table><thead><tr>' + s.cols.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' + s.rows.map(r => '<tr>' + r.map((c, j) => j === 0 ? '<td><b>' + esc(c) + '</b></td>' : '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
      return '<section><h2><span class="k">' + String(i + 1).padStart(2, '0') + '</span>' + esc(s.h) + '</h2>' + (s.note ? '<p class="note">' + esc(s.note) + '</p>' : '') + body + '</section>';
    };
    return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(t.title) + ' · ADS Academy</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Titillium+Web:wght@300;400;600;700&display=swap" rel="stylesheet"><style>' +
      '*{box-sizing:border-box}body{margin:0;background:#F4F2EE;color:#1B1A17;font-family:"Titillium Web",system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.pg{max-width:820px;margin:0 auto;background:#fff}header{position:relative;padding:34px 44px 30px;background:#0B0B0E;color:#F2F0EC;overflow:hidden}' +
      'header:after{content:"";position:absolute;right:-90px;top:-90px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(255,202,5,.55),rgba(243,121,32,.15) 60%,transparent 70%)}' +
      'header img{width:132px;display:block}.eyebrow{margin-top:26px;font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#FFCA05}' +
      'h1{margin:6px 0 0;font-size:34px;line-height:1.05;font-weight:700;letter-spacing:-.02em;text-transform:uppercase;max-width:22ch}.meta{margin-top:12px;font-size:12px;font-weight:300;color:#B9B5AE}' +
      '.bar{height:6px;background:linear-gradient(90deg,#FFCA05,#F9A51A,#F37920)}main{padding:34px 44px 18px}.intro{margin:0;font-size:16px;line-height:1.6;color:#33312C}' +
      '.when{margin:20px 0 6px;padding:16px 18px;border:1.5px dashed #F9A51A;border-radius:14px}.when b{display:block;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#B4630F;margin-bottom:6px}.when li{font-size:14px;line-height:1.5}' +
      'section{margin-top:28px;break-inside:avoid-page}h2{display:flex;align-items:center;gap:12px;margin:0 0 10px;font-size:18px;font-weight:700;letter-spacing:-.01em}' +
      '.k{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#FFCA05;color:#1A1200;font-size:12px;font-weight:700;flex:none}.note{margin:0 0 10px;font-size:13.5px;font-weight:300;color:#5E5A53}' +
      '.ck{list-style:none;margin:0;padding:0}.ck li{display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #ECE8E1;font-size:14.5px;line-height:1.45}.box{flex:none;width:16px;height:16px;margin-top:3px;border:1.6px solid #F37920;border-radius:4px}' +
      '.ls{list-style:none;margin:0;padding:0}.ls li{display:flex;gap:14px;padding:10px 0;border-bottom:1px solid #ECE8E1}.n{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;border:1.6px solid #F9A51A;color:#B4630F;font-size:11px;font-weight:700}.ls b{font-size:14.5px}.ls p{margin:2px 0 0;font-size:14px;line-height:1.5;color:#45423C}' +
      '.fl div{padding:10px 0}.fl span{font-size:13.5px;font-weight:600}.fl i{display:block;height:24px;border-bottom:1px solid #CFC9BF}' +
      '.sc div{margin-bottom:10px;padding:14px 16px;border-radius:12px;background:#FFF7DA}.sc span{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#B4630F}.sc p{margin:4px 0 0;font-size:14.5px;line-height:1.55}' +
      'table{width:100%;border-collapse:collapse;font-size:13.5px;line-height:1.45}th{padding:9px 10px;background:#1B1A17;color:#FFCA05;text-align:left;font-size:11px;letter-spacing:.12em;text-transform:uppercase}td{padding:9px 10px;border-bottom:1px solid #ECE8E1;vertical-align:top}tr:nth-child(even) td{background:#FAF8F4}' +
      '.close{margin:30px 0 0;padding:20px 22px;border-radius:14px;background:linear-gradient(135deg,#FFCA05,#F37920);color:#1A1200;font-size:15.5px;font-weight:600;line-height:1.5}' +
      'footer{display:flex;justify-content:space-between;gap:12px;padding:20px 44px 30px;font-size:11.5px;font-weight:300;color:#7C7873}' +
      '@media print{body{background:#fff}.pg{max-width:none}@page{margin:12mm}}</style></head><body><div class="pg"><header><img src="' + logo + '" alt="Aliados del Sol"><div class="eyebrow">ADS Academy · ' + esc(t.sub) + '</div><h1>' + esc(t.title) + '</h1><div class="meta">Equipo GEENERA · Versión 2026 · ' + esc(t.pages) + '</div></header><div class="bar"></div>' +
      '<main><p class="intro">' + esc(t.intro) + '</p><div class="when"><b>Cuándo usarla</b><ul>' + t.when.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul></div>' + t.sections.map(sec).join('') +
      '<p class="close">' + esc(t.close) + '</p></main><footer><span>Aliados del Sol by GEENERA · Las grandes transformaciones comienzan con grandes aliados.</span><span>Material de uso exclusivo para aliados.</span></footer></div></body></html>';
  }
  const fileName = id => 'ADS-' + K[id].title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '.html';
  function download(id) {
    const html = docHtml(id); if (!html) return false;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' })); a.download = fileName(id);
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); return true;
  }
  function print(id) {
    const w = window.open('', '_blank'); if (!w) return false;
    w.document.open(); w.document.write(docHtml(id).replace('</body>', '<script>window.onload=function(){setTimeout(function(){window.print()},500)}<\/script></body>')); w.document.close(); return true;
  }
  window.ADS_TOOLKIT = { TOOLS: K, docHtml, download, print };
})();
