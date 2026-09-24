# HANDOFF — ALIADOS DEL SOL HUB

Documento vivo. Se actualiza en cada iteración. Fuente de verdad visual: *Design System / Manual de Marca Aliados del Sol* (`uploads/Design_System_Aliados_del_Sol.md`).

---

## A. ESTADO DEL PRODUCTO

**Versión actual:** v6 — Registro de aliados, 4 tipos de aliado, organizaciones e invitaciones, sistema definitivo de medición (Puntos Sol, Quality Score, niveles, KPIs, Partner Health Score), corrección Acciones rápidas / Racha
**Fecha:** 16 de septiembre de 2026

### Archivos

| Archivo | Rol |
|---|---|
| `Aliados del Sol Hub.dc.html` | Sitio público + Hub autenticado + dashboards por rol. Toda la configuración de negocio al tope de la clase de lógica. |
| `SolarBuildSequence.dc.html` | Signature motion: instalación fotovoltaica que se construye con el scroll. v5: 320 vh desktop / 260 vh mobile (antes 700/520), `headerOffset` (sticky bajo el header), textos protegidos con veladura y z-index, coreografía texto ↔ construcción (cada escena lleva su paso de "Cómo referir"). |
| `GProgress.dc.html` | v2. Progreso sobre la G oficial con la cifra integrada: `variant="gap"` (porcentaje en el corte de la G, Opción A), `variant="editorial"` (G + cifra y contexto a la derecha, Opción C), `variant="mark"` (solo forma). Anima 0→pct en ≤ 900 ms al entrar en viewport. |
| `CommercialJourney.dc.html` | Journey Comercial: 7 etapas como recorrido con línea de energía, foco en 1 etapa (2–3 con protagonismo), estados completado/actual/siguiente, cierre positivo y "No viable" como estado secundario. Horizontal en desktop, vertical < 760 px. Mismo componente en público (conceptual, autoplay por scroll + hover) y en el detalle (herramienta real: `current`, `closed`, `noViable`). |
| `HANDOFF.md` | Este documento |
| `assets/` | Logo maestro, G de GEENERA (máscara normalizada), 5 logos bancarios, fotografías de marca, `foto-luz-solar.jpg` (referencia de luz para Círculo Solar) |

### Terminado
Home público (11 secciones), Oportunidades público, Beneficios público, Herramientas público, Academy público, Aliados/Ecosistema, Soporte + FAQ, Login/onboarding, Hub: Inicio, Oportunidades (4 estados), Detalle + timeline, Nueva oportunidad (3 pasos + confirmación), Beneficios (catálogo con 5 estados), Herramientas, Academy + certificación, Mi Perfil, Mis Comisiones, microexperiencia “Nuevo nivel desbloqueado”, vista mobile (3 frames), footer, botón de ayuda global.

### En revisión
- Solar Build Sequence usa capas CSS como **placeholder**: la experiencia, el timing y el copy están; los renders reales se producen con el ASSET BRIEF (sección G).
- Light mode: revisar contraste de fotografías con veladura clara (hero, comunidad, Círculo Solar).
- Tratamiento del logo wall una vez lleguen los archivos oficiales de gremios y clientes.

### Rendimiento del scrollytelling (v2.1)
Medido con sonda de rAF haciendo scroll de 26 px por frame: hero 55 fps, escena temprana 46 fps, construcción de paneles 55 fps (antes: 7 fps).
Reglas aplicadas, respetar en futuras ediciones de `SolarJourney.dc.html`:
1. Sin `mask-image` sobre capas a pantalla completa dentro del sticky: el degradado de borde es un overlay estático encima de la retícula.
2. Capas de fondo promovidas con `transform:translateZ(0)` para que no se re-rastericen por frame.
3. El haz de luz se anima con `scaleY()` y `transform-origin:top`, nunca con `height` (evita layout por frame).
4. `paint()` cachea el último valor por propiedad y elemento (`el.__v`): solo escribe cuando el valor cambia.
5. Sin `transform-style:preserve-3d` ni `box-shadow` por panel: un solo `perspective()` en el contenedor rotado.
6. El stage sticky usa `contain:paint` e `isolation:isolate`.
7. **Sin `requestAnimationFrame`:** sus callbacks no se ejecutan desde la clase lógica de un DC. El progreso se muestrea con `setInterval` de 32 ms y un gate `this._p`; los eventos `scroll` se conservan solo como refuerzo para navegador real.
8. **Sin `componentWillUnmount`:** la instancia se reutiliza entre montajes, así que limpiar ahí mata la suscripción del montaje entrante. Inicializador idempotente desde `renderVals()` y `document.contains(el)` antes de cada escritura.

### Pendiente
- Embed real de Clientify (bloqueado por preview de terceros).
- Cotizador Solar funcional (motor de cálculo).
- Case Finder con datos reales de proyectos.
- Financiación Solar: ruta de contacto aprobada por entidad (hoy solo lectura).
- Certificados descargables / compartir a LinkedIn.
- Contenido real de Academy (video, materiales).
- Textos legales (términos, privacidad).

---

## B. ARQUITECTURA

### Rutas públicas (sin autenticación)
| Ruta | Pantalla |
|---|---|
| `home` | Home con scrollytelling y formulario de referido |
| `p-oportunidades` | Cómo funciona una oportunidad + estados + referir |
| `p-beneficios` | Niveles, ejemplos del catálogo, cómo ganar puntos |
| `p-herramientas` | 4 herramientas; abiertas vs. solo aliados |
| `p-academy` | Rutas; primeras lecciones abiertas |
| `p-aliados` | Ecosistema financiero y gremial, perfiles de aliado |
| `p-soporte` | Buscador de ayuda, FAQ, canales |
| `login` | Acceso + onboarding en tres pasos |

### Rutas privadas (requieren sesión)
`inicio` (role-based: aliado o dashboard de gestión), `oportunidades`, `detalle`, `puntos`, `beneficios` (solo roles con `seeBenefits`), `herramientas`, `financiacion`, `academy` (rutas → cursos → lección), `perfil`, `comisiones` (solo `seeCommission`), `mobile`.

### Tipos de aliado, registro y organizaciones (v6)
| Tipo (`ALLY_TYPE_CONFIG`) | Quiénes | Flujo | Comisión |
|---|---|---|---|
| Aliado Financiero | Bancos, ejecutivos financieros, leasing | **Organización** (convenio) | no |
| Aliado Gremial | Gremios, cámaras, asociaciones, clústeres | **Organización** (convenio) | no |
| Aliado Referidor | EMIs, Linkers, consultores, redes empresariales | **Independiente** (solicitud) | sí |
| Cliente Embajador | Clientes actuales de GEENERA | **Independiente** (solicitud) | no |

- **Flujo independiente:** solicitud breve → validación GEENERA → invitación → activación (magic link u OTP por correo; contraseña opcional) → perfil, código y enlace único → Hub.
- **Flujo organización:** GEENERA crea `organization` + `organization_admin` → invita al administrador → el administrador activa su cuenta → invita miembros → cada miembro recibe perfil individual y dashboard según rol.
- **Perfil (`ORGANIZATION_CONFIG.profileFields`):** user_id, name, email, phone, ally_type, organization_id, organization_type, regional, role, ally_code, referral_link, commission_eligible, status, created_at.
- **Enlace único:** `aliadosdelsol.com/r/<CODE>` captura ally_id, organization_id, ally_type, source y regional; nunca se le pide al referido "quién te refirió". Se sincroniza con Clientify (PENDIENTE DE INTEGRACIÓN).
- **Referir sin login sigue abierto.** Tras enviar, en contexto público aparece la invitación opcional "¿Quieres seguir el avance…? → Quiero ser Aliado del Sol".
- Ruta pública `join` (pantalla "Registro de aliados"); CTA "Quiero ser aliado" en header, menú compacto y página Aliados, siempre separado de "Referir empresa".

### Sistema definitivo de medición (v6)
- **POINTS_CONFIG:** registro +10 · Referido Perfecto +20 · calificada +30 · información energética +20 · evaluación técnica (DTP) +30 · propuesta +50 · cierre +150 · Academy +5 (máx. 20/mes) · Misión Solar +20 · Racha 4x4 +75 · **Evento aliado validado +100** (evento realizado, GEENERA involucrada, registro de asistentes, ≥ 5 empresas en perfil; no sustituye los puntos de las oportunidades). Penalizaciones −10 / −15 / −30 / −20; sin penalización por duplicado, inviabilidad, financiación, no compra o no cierre.
- **QUALITY_CONFIG (fórmula inicial definitiva):** QualityScore = 40 % calificación + 30 % Referido Perfecto + 20 % avance a evaluación técnica + 10 % integridad de la información · 0–100.
- **LEVEL_CONFIG (definitivo):** Bronce 0–99 · Plata 100–249 (≥ 50 %) · Oro 250–449 (≥ 60 %) · Platino 450–699 (≥ 70 %) · Diamante 700–999 (≥ 80 %) · Círculo Solar 1.000+ (≥ 85 % + ≥ 1 oportunidad calificada en 30 días, `recentQualifiedDays/Min`). Ventana 6 meses. **Aliado activo** = ≥ 1 oportunidad calificada en 30 días (`LEVEL_CONFIG.activeAlly`).
- **KPI_CONFIG (interno Alianzas, por regional y periodo):** 80 leads/sem · conversión lead→oportunidad ≥ 45 % · 36 oportunidades/sem · Referidos Perfectos ≥ 60 % · calidad promedio ≥ 70 % · entidades financieras activas ≥ 80 %/mes · referidores activos ≥ 60 %/mes · primer contacto ≤ 1 día hábil. Dimensiones y KPIs del dashboard administrativo listados en `adminDimensions` / `adminKpis`.
- **PARTNER_HEALTH_CONFIG (solo interno, no visible al aliado):** 25 % actividad · 30 % calidad · 20 % conversión · 15 % impacto comercial · 10 % recencia → segmentos alto potencial / activo / en riesgo / inactivo / requiere reactivación.
- **LIFECYCLE_CONFIG:** Onboarding → Activation → Quality → Engagement → Recognition → Reactivation (base para automatizaciones).
- Dashboard administrativo GEENERA: **PENDIENTE DE IMPLEMENTACIÓN** en UI; su contrato de datos queda en KPI_CONFIG y PARTNER_HEALTH_CONFIG.

### Integraciones externas (v5)
| Qué | URL | Dónde | Comportamiento |
|---|---|---|---|
| Casos y proyectos (antes "Case Finder") | https://geenera.com/proyectos/ | Herramientas público, Herramientas Hub, home | `window.open` en pestaña nueva. Sin buscador interno hasta tener base estructurada. `EXTERNAL_LINKS.proyectos`. |
| WhatsApp equipo de Alianzas | https://api.whatsapp.com/send/?phone=573114949705 | Soporte público (2 CTA), Perfil › Soporte, botón Ayuda | Número en `SUPPORT_CONFIG.whatsapp`; mensajes prellenados distintos: `programa` ("Tengo una consulta sobre el programa") y `caso` ("Necesito ayuda con una oportunidad que referí"). |

### Roles y permisos (v4)
| Rol | Org | Scope | Dashboard | Comisión | Forecast desembolsos | Valor de propuesta |
|---|---|---|---|---|---|---|
| `referidor` | individual | own | aliado (Puntos Sol, nivel, racha, impacto) | sí | no | no |
| `ejecutivo_banco` | banco | own | gestión | no | sí | sí |
| `directivo_banco` | banco | org | gestión + distribución | no | sí | sí |
| `gremio` | gremio | org | gestión (sin valores COP) | no | no | no |

Regla: ningún módulo se renderiza si el permiso es falso; no existe acceso cruzado entre organizaciones (`BANK_OPPS` se filtra por `scope`). El selector de rol del sidebar es **demo**; en producción viene del login.

Nuevas en v3: **`puntos`** (Puntos Sol: saldo vs. puntos de nivel, camino de niveles, calidad, matriz de puntos, penalizaciones, historial con filtros) y **`financiacion`** (Financiación Solar, antes Financing Hub).

### Regla de autenticación
Login **solo** para información personal: mis puntos, mis oportunidades, redimir beneficio, guardar progreso de Academy, comisiones, código de aliado. Referir una empresa **nunca** exige cuenta.

---

## C. DESIGN SYSTEM

### Color (del manual)
| Token | Valor | Uso |
|---|---|---|
| `--sun-yellow` | `#FFCA05` | Acento principal, progreso, énfasis numérico |
| `--sun-gold` | `#F9A51A` | Acento medio, iconografía, barras |
| `--sun-orange` | `#F37920` | Cierre de degradado, CTA |
| `--bg-base` | `#07070A` | Fondo global |
| `--surface` | `rgba(255,255,255,.022–.05)` | Cards y superficies |
| `--border` | `rgba(255,255,255,.06–.12)` | Bordes |
| `--text` | `#F2F0EC` | Texto principal |
| `--text-2` | `#9A968F` | Texto secundario |
| `--text-3` | `#6B6762` | Metadatos y labels |
| `--positive` | `#5FBF8B` | Éxito, ganada, desembolsada |
| `--negative` | `#C97B6E` | Error, no viable |

Máximo dos fondos por vista. Sin neón, sin glassmorphism abusivo, sin verde “green tech”.

### Tipografía
Titillium Web (300/400/600/700). Titulares 700 con `letter-spacing` negativo (−.02 a −.045em); labels 600 en mayúsculas con tracking .14–.24em; cuerpo 400. Escalas fluidas con `clamp()`. Mínimo táctil 44 px; mínimo de cuerpo 12,5 px.

### Spacing / radius
Ritmo 4/6/9/12/16/20/26/34/44. Radius: 8–9 controles, 11–13 cards pequeñas, 15–16 cards y paneles, 18–20 bloques destacados, 99 px pills.

### Animation timing (v5)
Micro 150–250 ms · transiciones UI 250–450 ms · reveals 350–700 ms (antes 700/820) · secuencias grandes controladas por scroll con respuesta inmediata · GProgress ≤ 900 ms · `UI_CONFIG.stickyHeaderOffset = 72` para toda sección sticky bajo el header.

### Motion System (v4) — tres niveles
- **Signature:** `SolarBuildSequence` (700 vh desktop / 520 vh mobile / 120 vh reduced motion). Scroll nativo, sondeo a 32 ms con compuertas de cambio, pausa fuera del viewport.
- **Structural:** motor único en la clase raíz (`startMotion`, 40 ms): `data-reveal` (opacity/translate con `transition-delay` escalonado), `data-count` (cifras que cuentan, `data-prefix`/`data-suffix`), `data-scrub` (expone `--p` 0–1 para líneas de energía). Sin listeners de scroll, sin layout continuo.
- **Micro:** hover 160–220 ms, tabs/filtros 160 ms, barras 900 ms (`scaleX`/`scaleY` desde su origen), GProgress 1.400 ms ease-out.
- `prefers-reduced-motion`: todo visible de inmediato; escena a 120 vh; sin marquee.
- Inspiración/infraestructura: patrones de 21st.dev (scroll choreography, sticky reveal, text reveal, animated counters/charts, marquee) adaptados por completo al DS; ningún componente copiado tal cual.

### Motion principles
Curva `cubic-bezier(.22,.61,.36,1)`. Entradas 320–820 ms, hover 160–220 ms. Solo `transform`, `opacity`, `filter`, `background`. Elevación máxima −3 px. Sin rebotes, confeti ni partículas permanentes.

---

## D. INVENTARIO DE COMPONENTES

| Componente | Ubicación | Estado |
|---|---|---|
| PublicHeader | template público | Terminado — nav inline ≥1080 px, menú compacto por debajo |
| PublicMobileMenu | template público | Terminado |
| PublicFooter | template público | Terminado |
| HelpButton (flotante) | público | Terminado |
| Sidebar (AuthenticatedNavigation) | Hub | Terminado |
| TopBar | Hub | Terminado |
| SunInteractive | `SunProgress.dc.html` (`lit=1`) | Terminado |
| SunProgress | `SunProgress.dc.html` | Terminado |
| SolarJourney | `SolarJourney.dc.html` | Terminado — en revisión en pantallas bajas |
| ReferralForm (contenedor Clientify) | Home | Contenedor terminado / embed pendiente |
| QualityTiers (Referido Perfecto) | Home, Oportunidades público | Terminado — matriz Puntos Sol |
| PartnerLogoWall | Home, Aliados | Placeholders identificados |
| SolarStreak4x4 (módulos fotovoltaicos) | Home, Hub Inicio | Terminado |
| LevelCard / LevelBadge | público + Hub | Terminado |
| StatCard | Hub Inicio | Terminado |
| OpportunityRow / OpportunityCard | Hub | Terminado |
| StatusBadge (10 estados) | Hub + público | Terminado — derivado de `OPPORTUNITY_STAGE_CONFIG` |
| OpportunityTimeline | Detalle | Terminado |
| NewOpportunityFlow (3 pasos) | Modal | Terminado |
| BenefitCard (5 estados) | Hub + público | Terminado — textura literal + foto como `background-image`, sin `<img>` |
| BenefitHero | Hub Inicio | Terminado |
| ToolCard | público + Hub | Terminado |
| CourseCard / LearningProgress | Academy | Terminado |
| CertificateCard | Academy | Terminado |
| CommissionRow | Comisiones | Terminado |
| PointsLedger / HistoryFilters | Puntos Sol | Terminado |
| ValueLadder (milestones + potencial) | Detalle de oportunidad | Terminado |
| CommercialProcess (9 etapas) | Detalle + público | Terminado |
| ExecutionTimeline + trámites paralelos | Detalle (tras cierre) | Terminado |
| FinancePartnerSelector | Financiación Solar | Terminado |
| ImpactJourney (Conexión → Oportunidad → Proyecto) | Hub Inicio | Terminado |
| QualityGate ("ya tienes los puntos") | Hub Inicio, Puntos Sol | Terminado |
| **SolarBuildSequence** (SolarRoofScene · SolarStructureAssembly · SolarPanelAssembly · SolarLightActivation) | Home | Terminado con placeholder CSS · PENDIENTE DE ASSET |
| **GProgress** | Home Beneficios, Hub Inicio, Hub Beneficios, mobile, modales | Terminado |
| **LevelJourney** (6 niveles, swipe en mobile) + **PremiumLevelExperience** (Círculo Solar) | Home, Beneficios público | Terminado |
| **MotionHeading** (reveal por palabras / storytelling tipográfico) | Hero, Beneficios | Terminado |
| **AnimatedMetric** (`data-count`) | Comunidad, Hub Inicio, dashboard | Terminado |
| **AnimatedChart** (PipelineChart, QuotedValueChart/KwpChart, distribución) | Dashboard gestión | Terminado |
| **PartnerLogoWall** (marquee lento + grid con reveal) + **ClientPartnerWall** | Home, Aliados | Terminado · logos PENDIENTE DE ASSET |
| **CommercialTimeline** (7 etapas públicas, agrupa "Evaluación en curso") | Oportunidades público, Detalle | Terminado |
| **ExecutionTimeline** (línea de energía `data-scrub`) + **CommissionMilestone** (role-based) | Oportunidades público, Detalle | Terminado |
| **RoleDashboard** · DashboardWidget · DashboardCustomizer | Hub Inicio (bancos, gremios) | Terminado · datos demo |
| **DisbursementForecast** (30/60/90 + tabla con fecha estimada) | Dashboard bancario | Terminado · REQUIERE VALIDACIÓN de copy |
| **GeeneraOwnerCard** | Detalle, tabla Mis referidos | Terminado |
| **AcademyRoute · AcademyCourse · AcademyLesson · AcademyQuiz · CertificateCard** | Hub Academy, Academy público | Terminado · contenido inicial |
| **ThemeToggle** (Oscuro / Claro / Auto) | Header público, sidebar Hub | Terminado |
| **CommercialJourney** (público conceptual + personal en detalle) | Oportunidades público, Detalle | Terminado |
| **GProgress v2** (gap · editorial · mark) | Hub Inicio, Beneficios Hub, Beneficios público, mobile, modales | Terminado |
| **AcademyHome** (hero personalizado, Continuar aprendiendo, Impacto del aprendizaje, Diagnóstico, Mis rutas, Certificaciones, Comunidad) | Hub Academy | Terminado · datos demo |
| **AcademyRouteJourney** (módulos ✓ ● ○ → ★ certificación) | Hub Academy | Terminado |
| **AcademyLesson v2** (video · nivel · duración · quiz · recurso · reto · ruta lateral) | Hub Academy | Terminado |
| **SolarChallenge / Reto Solar** (5 micro-retos: 4 de selección, 1 constructivo "Construye tu primer referido") | Hub Academy | Terminado · no registra oportunidades |
| **LessonComplete** (continuidad: ✓ · +5 · siguiente · Continuar · Ver ruta) | Hub Academy | Terminado |
| **AcademyDiagnostic** (6 preguntas → ruta recomendada) | Hub Academy | Terminado |
| **CommunityLayer** (Próximamente, sin actividad inventada) | Hub Academy | Preparado |
| FAQAccordion | Soporte | Terminado |
| EmptyState / LoadingState / ErrorState | Oportunidades | Terminado |
| Modal / Toast / Switch / Inputs / Filters / Search | transversal | Terminado |
| LevelUpExperience | overlay | Terminado |
| MobileFrames | vista demo | Terminado |

---

## E. ANIMACIONES

| # | Qué hace | Dónde | Trigger | Desktop | Mobile | Reduced motion | Tecnología |
|---|---|---|---|---|---|---|---|
| 1 | Halo del Sol crece y el núcleo aumenta brillo según proximidad del cursor | `SunProgress` | `pointermove` global | proximidad real | pulso ambiental 7 s + respuesta al `touchmove` | halo fijo tenue, sin listeners | CSS transitions, escritura síncrona (sin rAF) |
| 2 | Anillo de progreso según puntos | `SunProgress` | render | igual | igual | igual (sin animar) | `conic-gradient` + máscara |
| 3 | Sombra del disco proporcional al progreso | `SunProgress` | render | igual | igual | igual | `linear-gradient` |
| 4 | Scrollytelling de 5 momentos: haz de luz, empresa, chips de información, construcción panel por panel, iluminación y tarjetas de valor | `SolarJourney` | sondeo de 32 ms sobre track de 460vh, sticky stage (+ listeners `scroll`/`resize`) | scrub real, sin scroll-jacking, 46–55 fps | idéntico (scroll táctil) | track a 120vh, estado final pintado, sin listeners | rAF + `transform`/`opacity` con escrituras cacheadas |
| 5 | Rail de puntos indicando el momento activo | `SolarJourney` | scroll | sí | sí | estático | CSS transition |
| 6 | Entradas `riseIn` / `fadeIn` de secciones y overlays | global | montaje | sí | sí | anuladas por `@media` | `@keyframes` |
| 7 | Skeleton `shimmer` | Oportunidades (loading) | estado | sí | sí | anulada | `@keyframes` |
| 8 | Hover de cards: −2/−3 px + borde ámbar | transversal | hover | sí | sin efecto (no hover) | anulado | CSS transition |
| 9 | Overlay “Nuevo nivel desbloqueado”: Sol al 100% + halo radial | overlay | acción | sí | sí | entrada instantánea | `@keyframes` + gradiente |
| 10 | Toast entrante | global | acción | sí | sí | anulada | `@keyframes` |

Regla global: `@media (prefers-reduced-motion: reduce)` reduce toda duración a ~0 ms; `SunProgress` y `SolarJourney` además no registran listeners de scroll/puntero.

---

### Animaciones v4 (resumen)
| Qué | Dónde | Trigger | Reduced motion |
|---|---|---|---|
| Solar Build: cubierta → referido → estructura → módulos → sistema → sol → CTA | Home | scroll 0–1 sobre 700 vh | escena final estática |
| Hero: reveal por palabras + luz solar en gradiente | Home | carga | visible |
| Logo marquee 72 s + reveal escalonado | Home, Aliados | carga / scroll | sin marquee |
| Líneas de energía (ejecución) | Oportunidades público, Detalle | scroll (`--p`) | llena |
| Contadores | Comunidad, Inicio, dashboard | entra al viewport | valor final |
| Barras y columnas | Dashboard | entra al viewport / cambio de serie | valor final |
| GProgress | Hub, Beneficios | entra al viewport / cambio de puntos | valor final |

---

## F. INTEGRACIONES

### Clientify — SuperForm
- **Formulario:** 139329 / 25015
- **URL:** `https://apps.clientify.net/formbuilderembed/simpleembed/#/forms/embedform/139329/25015`
- **Script oficial (no modificar):**
  ```html
  <script type="text/javascript" src="https://api.clientify.net/web-marketing/superforms/script/139329.js"></script>
  ```
- **Componente:** sección `referRef` del Home. Contenedor `#clientify-form-139329` con `data-clientify-form="139329"`.
- **Estado:** contenedor diseñado y aislado; dentro hay un placeholder visual fiel (mismos campos y orden). El script de terceros no se ejecuta en el entorno de preview.
- **Para producción:** cargar el script en el `<head>` del sitio y reemplazar únicamente el contenido interno de `#clientify-form-139329` por el render de Clientify, conservando el contenedor, tipografías y estilos. El comentario con el snippet exacto está en el propio template.
- **Campos esperados:** empresa, contacto, ciudad, teléfono, correo, consumo mensual, archivo de factura (opcional), observaciones.

---

## G. ASSETS PENDIENTES

**Recibidos:** 5 logos bancarios (en uso), G de GEENERA (`uploads/Recurso 1.png` → `assets/g-geenera.png`, alfa normalizado para usarse como máscara), 3 piezas de Instagram como referencia de dirección de arte (una en uso como textura de luz en Círculo Solar).

**Pendientes (logos, no se inventan ni se redibujan):** Fenalco Santander, Fenalco Barranquilla, Fenalco Santa Marta, Cámara de Comercio de Bucaramanga, Clúster de Energía, Fenavi Costa; logos de empresas clientes (categoría "Aliados del Sol · clientes"). Preferible SVG o PNG ≥ 800 px de ancho, fondo transparente, versión monocromática si el manual lo permite.

### ASSETS PENDIENTES PARA EXPERIENCIA PREMIUM (Asset brief)

| # | Asset | Uso | Formato y resolución | Orientación | Fondo | Perspectiva | Iluminación |
|---|---|---|---|---|---|---|---|
| 1 | **Secuencia de frames · Solar Build** (opción B, preferida): cubierta industrial vacía → estructura/rieles → módulos por grupos (≥ 6 pasos) → sistema completo → sistema iluminado. 60–90 frames | `SolarBuildSequence` escenas 01–06 | WebP/AVIF, 1920×1080 (desktop) + 1080×1350 (mobile), mismo encuadre y cámara fija; frames críticos también en PNG | horizontal + vertical | cielo neutro/oscuro que funde con `#07070A` y con `#F7F3EC` (dos variantes o alfa) | 3/4 elevada, ~35°, cubierta de empresa colombiana real o render fotorrealista | luz cálida lateral; el frame "sol" con luz rasante dorada, sin flare exagerado |
| 2 | **Alternativa 3D ligero** (opción A) solo si supera visualmente los frames: GLB < 4 MB, estructura + 18 módulos como nodos nombrados | idem | GLB + texturas 2K | — | transparente | — | HDRI cálido |
| 3 | Fotografía **cubierta industrial** con sistema instalado, Colombia | hero (fondo), Academy, Círculo Solar | JPG/WebP 2400 px | horizontal | real | dron 3/4 | amanecer/atardecer cálido |
| 4 | Fotografía **instalación sobre piso** (ground-mounted) | Oportunidades público, Academy ruta 3 | JPG/WebP 2400 px | horizontal | real | nivel de ojo bajo | luz natural |
| 5 | Fotografía **personas trabajando** (ingeniería, obra, puesta en marcha) sin poses | Ejecución del proyecto, Academy | JPG/WebP 2000 px | horizontal y vertical | real | editorial | natural |
| 6 | Fotografía **empresarios en planta / bodega** (conversación real, no apretón de manos) | Comunidad, Academy ruta 2 | JPG/WebP 2000 px | horizontal | real | editorial | cálida |
| 7 | **Instalaciones GEENERA** ejecutadas (3–5 casos con kWp) | Case Finder, beneficios, Círculo Solar | JPG/WebP 2400 px | horizontal | real | dron + detalle | natural |
| 8 | **Logos** gremios, cámaras, clientes | logo walls | SVG o PNG ≥ 800 px | — | transparente | — | — |
| 9 | **Iconografía** de etapas de ejecución (6) y trámites (3), trazo 1,5 px | ExecutionTimeline | SVG 24 px | — | transparente | — | — |
| 10 | **Videos de lección** Academy (1–3 min) | AcademyLesson | MP4 H.264 1080p + póster WebP | horizontal | — | — | — |

Reglas: sin banco de imágenes genérico, sin personas señalando paneles, sin hojas verdes ni bombillos. Prioridad: 1 → 3 → 8.

---

## H. DECISIONES DE NEGOCIO CONFIGURABLES

### Configuración central (v4) — `Aliados del Sol Hub.dc.html`, tope de la clase de lógica

Nuevas en v4 (ninguna se repite en componentes):
- **LEVEL_CONFIG** → 6 niveles: Bronce 0–99 · Plata 100–249 (calidad ≥ 60 %) · Oro 250–449 (≥ 70 %) · Platino 450–699 (≥ 75 %) · Diamante 700–999 (≥ 80 %) · Círculo Solar 1.000+ (≥ 85 %, `premium`). Umbrales de calidad DEMO.
- **OPPORTUNITY_STAGE_CONFIG** → `pub:false` + `publicAs:'Evaluación en curso'` en DTP y Estructuración. Siguen alimentando puntos e historial; nunca se exponen.
- **ROLE_CONFIG · PERMISSIONS_CONFIG** → roles, organización, scope y permisos (ver B).
- **COMMISSION_CONFIG** → hitos 50 % / 50 % en etapas 01 y 06 de ejecución; solo `seeCommission`.
- **DASHBOARD_WIDGET_CONFIG** → widgets por rol y visibilidad por defecto; el orden y la selección se guardan en `localStorage` (`ads-widgets-<rol>`).
- **THEME_CONFIG** → Oscuro / Claro / Auto, `localStorage` `ads-theme`; el tema claro vive como variables CSS en el helmet y los valores oscuros como fallback inline.
- **MOTION_CONFIG** → sondeo, umbral de reveal, stagger, duración de contadores.
- **ACADEMY_CONFIG** → 5 rutas (con `level`, `cert`, `tone`), 11 cursos, lecciones (texto, ejemplo, quiz), `points` y `challenge` por curso, 3 certificaciones, `challenges` (Retos Solares), `diagnostic` (preguntas + `routeByWeakest`) y `community`.
- **SUPPORT_CONFIG · EXTERNAL_LINKS · UI_CONFIG** (v5) → WhatsApp + mensajes, URL de proyectos GEENERA, offset del header sticky.
- **EXECUTION_CONFIG.commissionSteps**, **CLIENT_PARTNERS**, **GEENERA_TEAM**, **BANK_OPPS**, **SERIES_DEMO**, **DISB_NOTE** → datos demo del dashboard y textos legales.

### Configuración central (v3)

Ninguna regla de negocio vive dentro de un componente. Todo se lee de estas constantes:

| Constante | Contiene |
|---|---|
| `POINTS_CONFIG` | Milestones de oportunidad (id, label, pts, desc, `autoFrom`), campos del Referido Perfecto, regla de Academy (pts + `monthlyCap`), Misión Solar, penalizaciones (pts + `help` educativo), casos sin penalización |
| `LEVEL_CONFIG` | `windowMonths` (6), nota de ventana móvil y los cinco niveles con `min`, `max`, `minQuality`, `perks` |
| `STREAK_CONFIG` | `weeks` (4), `qualifiedPerWeek` (1), `bonus` (75), regla y nudge |
| `QUALITY_CONFIG` | `minSample`, `periodMonths`, etiquetas de "calidad en construcción", nota de fórmula demo y las 5 métricas con `weight` / `value` / `inverse` |
| `OPPORTUNITY_STAGE_CONFIG` | Las 9 etapas comerciales + "No viable", con `order`, `label`, `short`, `desc`, `tone`, `pub` |
| `EXECUTION_CONFIG` | 6 pasos de ejecución, 3 trámites en paralelo, disclaimer de cronograma y nota de estimación referencial |
| `FINANCE_CONFIG` | Nombre, subtítulo, disclaimer y las 5 entidades financieras con logo/descripción |
| `GUILD_PARTNERS` | 6 gremios/cámaras (`logo: null` = placeholder identificado) |
| `IMPACT_CONFIG` | Métricas de "Tu impacto" agrupadas en Conexión / Oportunidad / Proyecto |
| `HISTORY_DEMO`, `OPP_EXTRA` | Datos demo del historial y estado por oportunidad (etapa vigente, milestones alcanzados, bitácora, paso de ejecución) |

Cambiar un puntaje, un umbral, un porcentaje de calidad o el nombre de una etapa es editar una línea de configuración; ningún componente los duplica.

### Props del componente raíz (panel de Tweaks)

| Prop | Default | Para qué |
|---|---|---|
| `userName` | Juan Rodríguez | Aliado demo |
| `points` | 560 | **Puntos de nivel** (ventana móvil de 6 meses) |
| `pointsBalance` | 560 | **Puntos Sol disponibles** (saldo) — separado del anterior por diseño |
| `quality` | 82 | Calidad de tus referidos (%) |
| `qualitySample` | 14 | Oportunidades evaluadas; por debajo de `minSample` la UI muestra "Calidad en construcción" y nunca 0 % |
| `streakWeeks` | 3 | Semanas de la Racha Solar 4x4 completadas |

### Modelo de puntos: saldo vs. nivel

`cfg()` devuelve ambos valores por separado y la UI los simplifica cuando coinciden. Gastar Puntos Sol en un beneficio reduce `pointsBalance` pero no `points`: el historial de actividad que dio el nivel no se borra. Las penalizaciones sí afectan la puntuación calificable.

### Reglas de negocio implementadas

- **Puntos por oportunidad:** registro +10, Referido Perfecto +20, empresa calificada +30, información/factura disponible +20, DTP +30, propuesta +50, cierre +150.
- **Deduplicación:** el milestone `info` declara `autoFrom: 'perfecto'`; el evento se reconoce una sola vez y nunca se dispara dos veces por duplicación técnica.
- **Academy:** +5 por módulo, tope 20/mes. Misión Solar: +20/mes, diseñada para rotar.
- **Racha Solar 4x4:** 1 empresa **calificada** por semana × 4 semanas = +75.
- **Niveles:** Aliado 0–99 · Aliado Activo 100–249 (60 %) · Aliado Estratégico 250–499 (70 %) · Embajador Solar 500–899 (80 %) · Círculo Solar 900+ (85 %).
- **Ventana móvil:** el nivel solo cuenta actividad de los últimos 6 meses.
- **Puerta de calidad:** con puntos suficientes pero calidad insuficiente la UI dice "Ya tienes los puntos para avanzar" y cuantifica la brecha, en vez de bloquear sin explicación.

---

## I. CHANGELOG

### 2026-09-16 — v6.1 · Corrección de jerarquía en "Quiero ser aliado"

- **Causa:** la sección `join` estaba montada fuera del wrapper público (junto al Login), mientras `join` sí pertenece a `PUB`; por eso el layout renderizaba Header → Footer → contenido.
- **Corrección estructural:** la sección se movió dentro del layout público, antes del footer. El wrapper público es ahora `min-height:100vh; display:flex; flex-direction:column` con un `<main style="flex:1">` que envuelve todas las páginas públicas (Header → main → Footer). Sin márgenes artificiales, sin z-index.
- **Espaciado:** `join` usa el mismo padding de sección que las demás páginas públicas (`clamp(44px,7vh,90px)` arriba); se eliminó el `min-height:100vh` de la sección porque el sticky footer ya lo resuelve.
- Header, navegación, selector de tema, CTA "Referir empresa" y footer: sin cambios.


### 2026-09-16 — v6 · Registro de aliados, tipos de aliado y sistema definitivo de medición

- **Corrección estructural Home autenticado:** el grid de Acciones rápidas tenía `position: fixed` (override de edición directa), por eso flotaba sobre la Racha Solar. Ahora es una franja propia en flujo normal (`position: static`, con etiqueta "Acciones rápidas") y la Racha va debajo en un grid `auto-fit minmax(min(330px,100%),1fr)` con `align-items:start` y altura automática. Sin z-index; sin alturas fijas.
- **Página Aliados:** sección "¿Cómo puedes ser parte de Aliados del Sol?" con los 4 tipos (financiero, gremial, referidor, cliente embajador), + "Haz que tu referido tenga más valor" con los 7 datos del Referido Perfecto, + CTAs "Quiero ser aliado" / "Referir una empresa".
- **Registro de aliados (`join`):** selección de tipo → flujo independiente (solicitud breve + "Cómo sigue" en 6 pasos) o flujo organización (solicitud de conversación + 5 pasos de invitaciones) → confirmación con código/enlace de ejemplo. Magic link / OTP priorizados; contraseña opcional en login.
- **Referidos sin login:** el formulario sigue abierto; invitación opcional a ser aliado tras el envío (solo en contexto público).
- **Configuración nueva:** ALLY_TYPE_CONFIG, ORGANIZATION_CONFIG, KPI_CONFIG, PARTNER_HEALTH_CONFIG, LIFECYCLE_CONFIG; POINTS_CONFIG.event; QUALITY_CONFIG con fórmula 40/30/20/10; LEVEL_CONFIG con umbrales definitivos 50/60/70/80/85, requisito de recencia para Círculo Solar y definición de aliado activo.
- **Estados:** IMPLEMENTADO — corrección, Aliados, registro, configuración. REQUIERE VALIDACIÓN — copy de tipos de aliado (tal cual brief), pasos de "Cómo sigue". PENDIENTE DE IMPLEMENTACIÓN — dashboard administrativo GEENERA (KPIs + Partner Health Score) y panel del `organization_admin` para invitar miembros. PENDIENTE DE INTEGRACIÓN — magic link/OTP, captura de `/r/<code>` y sincronización con Clientify, automatizaciones del lifecycle.


### 2026-09-16 — v5 · Más fluidez, menos repetición, mejor storytelling

- **Journey Comercial** (Imagen 1): la grilla de 7 bloques se reemplaza por `CommercialJourney`: línea de energía continua, una etapa en foco (escala + iluminación), anterior y siguiente con menor protagonismo, número grande y texto que cambia; avanza con el scroll en público y responde a hover/tap. Estados completado (línea iluminada + ✓), actual (máximo contraste), siguiente (menor contraste); "Negocio cerrado" en tratamiento verde; "No viable / no continúa" como estado secundario, no octava etapa. Vertical en mobile.
- **Eliminado** "Los estados por los que pasa tu referido" (Imagen 2): contenedor, pills, explicación y `statusLegend`. Su función vive en el Journey.
- **Proceso público vs. personal**: el detalle de oportunidad usa el mismo componente con estado real (`current`, `closed`, `noViable`) + "Estado actual · Última actualización · Ejecutivo GEENERA".
- **GProgress v2** (Imagen 3): la cifra deja de estar "encima de un gráfico". Variante `gap` pone el porcentaje en el corte de la G con el nombre del siguiente nivel debajo (Hub Inicio, Beneficios, mobile); variante `editorial` (Beneficios público) muestra G + "62 % de camino a Círculo Solar · 620 / 1.000 Puntos Sol"; `mark` para modales/estados vacíos. Animación 0→pct en ≤ 900 ms.
- **Solar Build acelerado**: track 700 vh → 320 vh desktop (260 mobile); ritmo 0–15 empresa · 15–30 información · 30–45 estructura · 45–65 paneles · 65–80 sistema · 80–100 Sol + CTA; transiciones de texto 320/420 ms.
- **Legibilidad** (Imagen 4): escena sticky bajo el header (`headerOffset` 72 px), veladura superior protectora, textos y rail con z-index y fondo blur, títulos más compactos. Pasos "Cómo referir": activo 100 % · completado 78 % · próximos 62 % (nunca parecen deshabilitados).
- **Texto + construcción juntos**: cada escena lleva su paso ("Paso 2 · Comparte sus datos" aparece con los chips; "Paso 4 · GEENERA evalúa" con los módulos; "Paso 5 · Sigue su avance" con el Sol).
- **Casos y proyectos** (antes Case Finder) → abre https://geenera.com/proyectos/ en pestaña nueva; sin buscador ficticio.
- **Soporte** (Imagen 5): dos CTA con intención distinta al mismo WhatsApp del equipo de Alianzas, con mensajes prellenados diferentes; también en Perfil y en el botón Ayuda. Número centralizado.
- **Academy v2** (inspiración conceptual LAB10, no su branding): home que responde dónde estoy / qué sigue / qué terminé / qué desbloqueo / qué aplico — hero personalizado, **Continuar aprendiendo** (curso, progreso, tiempo, siguiente lección), **Impacto del aprendizaje** (Calidad de tus referidos → curso recomendado), **Diagnóstico** de 6 preguntas → ruta recomendada, **Mis rutas** como recorrido 01→02→03→★ con dificultad, tiempo, certificación y Puntos Sol disponibles, certificaciones y capa **Comunidad** (Próximamente). Ruta = journey vertical con módulos ✓ ● ○. Clase con video, nivel, duración, quiz, recurso, reto y ruta lateral. **Retos Solares** (5) al final de módulos; el reto constructivo no registra oportunidad hasta que el usuario elige "Convertir en oportunidad real". **Continuidad**: pantalla "Lección completada · +5 · Siguiente · Continuar / Ver ruta completa".
- **Timing global**: reveals 520/600 ms (antes 700/820); micro 150–250 ms.
- **Estados:** IMPLEMENTADO — todo lo anterior. REQUIERE VALIDACIÓN — copy de retos y diagnóstico, preguntas del diagnóstico, nombres de rutas ("Domina Aliados del Sol", "Así funciona GEENERA"). PENDIENTE DE ASSET — frames del Solar Build, videos de lección, logos. PENDIENTE DE INTEGRACIÓN — motor de Academy, WhatsApp Business (mensajes prellenados funcionan con el enlace estándar).


### 2026-09-11 — v4 · Motion System, Solar Build, G de GEENERA, roles y temas

- **Solicitado:** iteración mayor sin reconstruir: mucho más movimiento con identidad propia, Solar Build Sequence realista, eliminar el círculo solar como indicador, logo wall editorial en tres categorías, seis niveles memorables, Academy con contenido real, proceso comercial público sin detalles estratégicos, timeline de ejecución cinematográfico con hitos de comisión role-based, GProgress sobre la geometría oficial, dashboards por rol con forecast de desembolsos y widgets personalizables, Dark + Light, permisos y asset brief.
- **Nuevo Motion System (3 niveles)** y motor único `data-reveal / data-count / data-scrub` en la clase raíz; `prefers-reduced-motion` respetado en todo. Integración de patrones de 21st.dev adaptados al DS (no copiados).
- **Solar Build Sequence** (`SolarBuildSequence.dc.html`): 7 escenas con la cubierta, el referido (5 datos → barra de calidad), estructura (rieles y apoyos), 18 módulos por grupos, sistema terminado, aparición del Sol (glow + sheen + bordes dorados) y conversión con CTA que lleva al formulario Clientify. Rail lateral con los 5 pasos públicos de cómo referir. Capas CSS **placeholder** claramente etiquetadas; ASSET BRIEF en G.
- **Eliminado el círculo solar** (Imagen 1 y 6): `SunProgress.dc.html` y `SolarJourney.dc.html` borrados. Hero rediseñado: luz solar como gradiente, fotografía real de cubierta al 22 %, titular con reveal por palabras.
- **GProgress**: máscara de la G oficial; el anillo se llena en sentido antihorario desde las 12 y al 100 % se encienden el cuarto de sol interior y el halo (sin confeti). Cifra y subtítulo siempre visibles. Usado en Hub Inicio, Beneficios, Beneficios público, mobile y modales.
- **Logo wall** (Imagen 2): eliminados los recuadros con nombre bajo cada logo (además, había un bug de `sc-if` que renderizaba ambas ramas). Tres categorías: aliados financieros (marquee de 72 s, pausa al hover, monocromo → color), gremios (grid con reveal, placeholders nombrados) y **Aliados del Sol · clientes** (placeholders, sin inventar empresas).
- **Seis niveles** (Imagen 3): Bronce → Plata → Oro → Platino → Diamante → Círculo Solar, como **LevelJourney** horizontal con lámpara de energía por nivel, segmento de progreso, calidad mínima y perks; swipe en mobile. **Círculo Solar** con tratamiento fotográfico de luz, G como marca de agua y copy aspiracional. Catálogo de beneficios remapeado a los nuevos nombres. El demo (560 pts) queda en **Platino**, 44 % hacia Diamante.
- **Academy con contenido**: 5 rutas / 11 cursos / 34 lecciones (texto corto, ejemplo, quiz, recurso, progreso, siguiente lección), indicador de si el curso suma puntos, 3 certificaciones con requisitos y progreso. Academy pública muestra las rutas reales (2 abiertas).
- **Proceso comercial público** (Imagen 4): 7 etapas renumeradas; DTP y Estructuración ya no se publican y se agrupan como "Evaluación en curso" en badges, detalle y pipeline. La leyenda de estados también las omite.
- **Ejecución del proyecto** (Imagen 5): timeline con línea de energía que avanza con el scroll y etapas que se iluminan (público y detalle). **Hitos de comisión** 50 %/50 % en etapas 01 y 06 solo para roles con `seeCommission`; un ejecutivo bancario ve en ese lugar su gestión, nunca comisión.
- **Role-based dashboard**: perfiles referidor, ejecutivo de banco, directivo de banco y gremio (selector demo en el sidebar). Dashboard bancario con KPIs (pipeline COP, kWp, referidas, calificadas, activas, propuestas, cierres, valor cotizado, conversión, tiempo promedio), pipeline por etapa, COP/kWp por mes con filtro Mes/Trimestre/Semestre/Año y cambio de serie animado, **Próximos desembolsos 30/60/90** con "Fecha estimada de desembolso" + tooltip legal, tabla Mis referidos con **Ejecutivo GEENERA** por oportunidad, distribución por regional y por ejecutivo (directivo/gremio), calidad, y **Personalizar dashboard** (checklist + reordenar, guardado por usuario y rol).
- **Dark + Light**: light mode diseñado (blanco cálido `#F7F3EC`, marfil, carbón `#1B1915`, ámbar para texto de marca); ThemeToggle Oscuro/Claro/Auto en header y sidebar; preferencia guardada; Auto sigue al dispositivo. Todos los componentes (GProgress, Solar Build, logo wall, Academy, dashboard, tooltips, formularios) usan tokens.
- **Estados:** APROBADO — reglas Puntos Sol, racha, calidad, ventana 6 meses (sin cambios). IMPLEMENTADO — todo lo anterior. REQUIERE VALIDACIÓN — umbrales de calidad por nivel (60/70/75/80/85), copy de forecast y de hitos de comisión, nombres de certificaciones, perks por nivel. PENDIENTE DE ASSET — renders/frames del Solar Build, logos de gremios y clientes, fotografía editorial, videos de Academy (ver G). PENDIENTE DE INTEGRACIÓN — roles desde login, permisos desde backend, CRM/API para fechas estimadas de desembolso, motor de Academy (progreso real), Clientify embed.


### 2026-09-02 — v3.1 · Cierre de coherencia del catálogo y nomenclatura

- **Solicitado:** cierre de la iteración v3 — eliminar los últimos rastros del esquema anterior.
- **Catálogo de beneficios reescalado:** los costos estaban en la escala vieja (600–6000 pts) sobre un techo de nivel de 900. Reescalados a la escala Puntos Sol (40–600) y los requisitos `Pro` / `Élite` reemplazados por los cinco niveles nuevos (Aliado, Aliado Activo, Aliado Estratégico, Embajador Solar, Círculo Solar). Renombrados "Retiro Élite en Guatapé" → "Retiro del Círculo Solar en Guatapé" y "Grupo de 8 aliados Élite" → "del Círculo Solar".
- **Última referencia a Financing Hub:** el mapa de acceso público de herramientas todavía la usaba como clave; ahora es `Financiación Solar` con CTA "Ver aliados financieros" y sin la etiqueta "beta".
- **Etapas y estados:** `ST`, la leyenda de estados y los filtros de Oportunidades se derivan de `OPPORTUNITY_STAGE_CONFIG` por `stageId`, no por cadenas de etiqueta. Renombrar una etapa ya no rompe filtros ni badges.
- **Pantallas afectadas:** Home, Beneficios público, Herramientas público, Hub Beneficios, Hub Oportunidades.
- **Estado:** entregado.

### 2026-09-02 — v3 · Puntos Sol (iteración de reglas de negocio)

- **Solicitado:** reemplazar el sistema de puntos por **Puntos Sol**, con penalizaciones, cinco niveles nuevos, ventana móvil de 6 meses, indicador de calidad, Racha Solar 4x4, historial transparente, proceso comercial real de GEENERA, timeline de ejecución, renombre de Financing Hub y nueva estructura de Aliados — todo como variables configurables.
- **Nuevo sistema Puntos Sol:** matriz por milestone de oportunidad (10/20/30/20/30/50/150) reemplaza el esquema de 20/150/250 por referido. La interfaz comunica **Puntos + Nivel + Calidad + Racha + Impacto**, no un saldo.
- **Penalizaciones:** −10 referido imperfecto y no calificado, −15 empresa fuera de perfil evitable, −30 datos falsos, −20 reincidencia tras retroalimentación. Cada pérdida se muestra como "−10 Puntos Sol · empresa · motivo" con acceso a "¿Cómo mejorar tus próximos referidos?".
- **Sin penalización:** duplicado, empresa que no compra, proyecto inviable, empresa sin financiación, oportunidad que no cierra. Bloque explícito "Nunca penalizamos el resultado comercial" en la vista Puntos Sol y aviso en el detalle de la oportunidad.
- **Cinco niveles nuevos:** Aliado / Aliado Activo / Aliado Estratégico / Embajador Solar / Círculo Solar. Eliminado Aliado → Pro → Élite en Hub, sitio público y microexperiencia de nivel.
- **Ventana móvil de 6 meses:** rótulo permanente en Inicio y vista Puntos Sol, con "Cómo funciona" en lugar de párrafos largos.
- **Calidad de tus referidos:** KPI independiente 0–100 % con 5 métricas ponderadas (calificados 35, perfectos 25, DTP 20, datos incorrectos 10 inverso, fuera de perfil 10 inverso), mínimo de muestra y estado "Calidad en construcción" para no mostrar 0 %.
- **Racha Solar 4x4:** componente reemplazado. Lenguaje propio de energía: cada semana calificada ilumina un módulo fotovoltaico de 4 celdas; 4/4 deja la composición encendida. Sin ícono de fuego.
- **Historial de Puntos Sol:** sección nueva con fecha, empresa, acción, cantidad, motivo y estado, más filtros Todos / Ganados / Perdidos / Oportunidades / Racha / Academy / Misiones.
- **Nuevo proceso comercial:** 9 etapas reales (recibida → validación → información energética → calificación → DTP → estructuración → propuesta → negociación → cerrado) + "No viable / no continúa". El detalle de oportunidad muestra la escalera de valor con puntos generados y potencial adicional.
- **Timeline de ejecución:** módulo independiente "Ejecución de tu proyecto" que aparece solo tras el cierre, con los 3 trámites en paralelo (operador de red, Ley 1715, RETIE) y sin promesas de tiempo.
- **GEENERA como solución integral:** bloque público de estructuración, ingeniería, análisis energético, diseño, implementación, legalización y acompañamiento.
- **Financing Hub → Financiación Solar:** renombrado, ruta `financiacion` propia, composición editorial ("Financia la transición de tu empresa"), selector de entidad con descripción general y disclaimer. Sin tasas, cuotas, plazos, porcentajes ni tiempos de aprobación.
- **Aliados:** logo wall editorial separado en Aliados financieros y Gremios/cámaras; logos respirando sin cards, monocromático → color en hover, placeholders identificados para lo que falta.
- **Configuración central:** `POINTS_CONFIG`, `LEVEL_CONFIG`, `STREAK_CONFIG`, `QUALITY_CONFIG`, `OPPORTUNITY_STAGE_CONFIG`, `EXECUTION_CONFIG`, `FINANCE_CONFIG`, `GUILD_PARTNERS`, `IMPACT_CONFIG`.
- **Assets pendientes:** 6 logos de gremios (Fenalco Santander / Barranquilla / Santa Marta, Cámara de Comercio de Bucaramanga, Clúster de Energía, Fenavi Costa).
- **Conservado sin tocar:** scrollytelling, Sol interactivo, formulario Clientify, navegación, responsive, Academy, comisiones, vista mobile.
- **Estado:** entregado, pendiente de validación de negocio sobre umbrales demo.

#### Estado por bloque de esta iteración

| Bloque | Estado |
|---|---|
| Matriz Puntos Sol por oportunidad | IMPLEMENTADO · valores demo, REQUIERE VALIDACIÓN |
| Penalizaciones y casos sin penalización | IMPLEMENTADO · APROBADO en concepto |
| Cinco niveles y rangos | IMPLEMENTADO · REQUIERE VALIDACIÓN de rangos |
| Ventana móvil de 6 meses | IMPLEMENTADO (conceptual: el cálculo real depende del backend) |
| Calidad de tus referidos | IMPLEMENTADO con fórmula demo · REQUIERE VALIDACIÓN de ponderaciones |
| Racha Solar 4x4 | IMPLEMENTADO · APROBADO |
| Historial de Puntos Sol + filtros | IMPLEMENTADO |
| Proceso comercial de 9 etapas | IMPLEMENTADO · REQUIERE VALIDACIÓN de nombres finales |
| Ejecución del proyecto + trámites | IMPLEMENTADO |
| Financiación Solar | IMPLEMENTADO · PENDIENTE DE INTEGRACIÓN (ruta de contacto por entidad) |
| Aliados financieros (5 logos) | IMPLEMENTADO con archivos oficiales |
| Gremios y cámaras (6 logos) | PENDIENTE DE ASSET |
| Saldo vs. puntos de nivel | IMPLEMENTADO en el modelo · PENDIENTE DE INTEGRACIÓN con backend |
| Deduplicación de milestones | IMPLEMENTADO como regla (`autoFrom`) · PENDIENTE DE INTEGRACIÓN |

### 2026-08-29 — v2 · Sitio público + Hub
- **Solicitado:** convertir el módulo privado en sitio público navegable con Hub autenticado; nuevo Home con scrollytelling; Sol interactivo protagonista; formulario Clientify; logo wall de respaldo; soporte accesible; handoff vivo; mayor dirección artística.
- **Pantallas afectadas:** nuevas — Home público, Oportunidades público, Beneficios público, Herramientas público, Academy público, Aliados/Ecosistema, Soporte. Modificadas — Login (retorno al sitio), Hub Inicio (racha), Sidebar (salida al sitio público).
- **Componentes afectados:** nuevos — PublicHeader, PublicFooter, HelpButton, SolarJourney, ReferralForm, PartnerLogoWall, QualityTiers, StreakComponent, FAQAccordion. Modificados — `SunProgress` (nueva prop `lit` para separar arco de zona iluminada), router del componente raíz (rutas públicas vs. privadas).
- **Cambio realizado:** implementado. El Hub previo se conservó íntegro; no se rediseñó ninguna pantalla aprobada.
- **Estado:** entregado, en revisión.
- **Pendientes:** embed real de Clientify, logos oficiales, fotografía de catálogo.

### 2026-08-31 — v2.6 · Ciclo de vida: interacciones sobreviven al remount
- **Problema:** al salir del Home y volver, la escena quedaba congelada en su estado final: el visitante que regresaba recorría 4,6 pantallas de instalación ya terminada con el último titular fijo, sin ver ninguno de los cinco momentos.
- **Causa raíz:** el runtime reutiliza la misma instancia del componente al quitar y re-añadir el `sc-if` del Home, así que el `componentWillUnmount` saliente ejecutaba `clearInterval` sobre el intervalo que el `componentDidMount` entrante acababa de crear. Un solo repintado y luego nada. `SunProgress` tenía el mismo defecto latente con `removeEventListener`.
- **Cambio realizado:** las interacciones ya no dependen de la simetría mount/unmount. Ambos componentes exponen un inicializador idempotente (`ensureTicker()` / `ensureListeners()`) que se invoca también desde `renderVals()`, así que cualquier render restablece el ticker o los listeners. Se eliminó `componentWillUnmount` de los dos: en su lugar, cada escritura comprueba `document.contains(el)` mediante un helper `live()`, de modo que un nodo desprendido simplemente se ignora en vez de matar el temporizador. `track()` re-resuelve entre `root` y `stage.parentElement` descartando nodos desprendidos, y el gate `this._p` se reinicia en cada render para forzar un repintado tras el remount.
- **Verificado (Home → Beneficios → Home):** p=0.13 → haz 0.29, momento 01; p=0.46 → haz completo, momento 03; p=0.77 → 14/15 paneles, momento 04; p=0.98 → 15/15, momento 05. Halo del Sol 0.97 / `scale(1.16)` cerca y 0.42 lejos. Consola limpia.
- **Regla:** en un DC, **nunca** atar un temporizador o listener global a `componentDidMount`/`componentWillUnmount`: la instancia puede reutilizarse entre montajes. Inicializador idempotente llamado desde `renderVals()` + comprobación `document.contains` antes de escribir.
- **Pantallas afectadas:** Home (escena y hero) y `SunProgress` en todos sus puntos de montaje.
- **Componentes afectados:** `SolarJourney`, `SunProgress`.
- **Estado:** entregado.

### 2026-08-31 — v2.5 · Sol y scrollytelling reactivados (bug crítico)
- **Problema:** las dos interacciones centrales de la iteración estaban inertes. Ni `SunProgress` ni `SolarJourney` escribían al DOM: el usuario recorría ~4,6 pantallas de retícula vacía sin ver ninguno de los cinco momentos, y el Sol no respondía al cursor.
- **Diagnóstico (medido, no supuesto):** `componentDidMount` sí se ejecuta y todos los `ref` sí se resuelven en hijos montados con `dc-import` (verificado con una sonda desechable). El fallo real: **los callbacks de `requestAnimationFrame` nunca se ejecutan desde la clase lógica de un DC**, y ambos componentes usaban el patrón `if (this._raf) return; this._raf = requestAnimationFrame(…)`. Al no ejecutarse nunca el callback, `this._raf` quedaba truthy para siempre y el guard bloqueaba todos los eventos siguientes: exactamente un tick y cero frames. Segundo hallazgo: en el host de preview **los eventos `scroll` no se entregan a `window` ni a `document`** (el scroller se mueve, `scrollTop` cambia, se emiten 0 eventos).
- **Cambio realizado:** eliminada toda dependencia de `requestAnimationFrame` en ambos componentes. `SunProgress` aplica el halo de forma síncrona en `pointermove`. `SolarJourney` mantiene los listeners de `scroll`/`resize` (útiles en navegador real) y añade un sondeo con `setInterval` de 32 ms que lee `getBoundingClientRect()`; un gate `this._p` evita repintar cuando el progreso no cambió, y `set()` sigue escribiendo solo las propiedades que cambian.
- **Verificado:** p=0.13 → haz `scaleY(0.29)`, momento 01; p=0.46 → haz completo, momento 03; p=0.64 → 5/15 paneles, momento 04; p=0.98 → 15/15 paneles, momento 05. Halo del Sol 0.45 → 0.97 con `scale(1.16)` al acercar el cursor y regreso a 0.42 al alejarlo.
- **Regla:** **no usar `requestAnimationFrame` dentro de la clase lógica de un DC**, y no depender de eventos `scroll` como única fuente: muestrear por intervalo con gate de cambio.
- **Pantallas afectadas:** Home (escena y hero), y `SunProgress` en todos sus puntos de montaje (Beneficios público, Hub Inicio, frames mobile, overlay de nivel).
- **Componentes afectados:** `SolarJourney`, `SunProgress`.
- **Estado:** entregado.

### 2026-08-31 — v2.4 · Foto del beneficio como capa de fondo
- **Solicitado:** los 3 errores de recurso seguían apareciendo tras v2.3.
- **Causa real:** durante el parseo del template el marcado llega al navegador como HTML literal, así que el navegador intenta descargar la cadena `{{ b.img }}` una vez por cada aparición autorada (3), antes de que el runtime evalúe cualquier `sc-if`. La guarda no evita la petición: el problema es tener un hole en `src`.
- **Cambio realizado:** las tres cards ya no usan `<img>`. La fotografía real se pinta como capa absoluta con `background-image:{{ b.imgUrl }}` sobre el fondo rayado literal; `renderVals` devuelve `imgUrl` como `url("…")` o `none`. Un hole sin resolver en `style` es solo un valor CSS inválido: se ignora y no dispara ninguna petición. Accesibilidad conservada con `role="img"` + `aria-label`.
- **Regla (reemplaza la de v2.3):** **nunca un `{{ }}` en `src`, `href` ni ningún atributo de URL de valor completo**, ni con guarda. Si la URL es dinámica, va como `background-image` en `style`.
- **Pantallas afectadas:** Home, Beneficios público, Beneficios (Hub).
- **Componentes afectados:** BenefitCard.
- **Estado:** entregado.

### 2026-08-31 — v2.3 · Placeholder de beneficio como fondo literal (superado por v2.4)
- **Solicitado:** corrección de revisión (3 errores de recurso: `src` con el hole literal `{{ b.img }}`).
- **Causa:** el `<img>` sin guarda también se renderizaba en la fase de placeholder de `sc-for`, cuando el item aún es `undefined`, y un hole de atributo completo no puede resolverse ahí.
- **Cambio realizado:** la textura rayada pasó a ser `background` literal del contenedor de la card (pinta al instante, sin holes) y la fotografía real volvió detrás de `<sc-if value="{{ b.hasImg }}" hint-placeholder-val="{{ false }}">`, en posición absoluta sobre el fondo. `hasImg` restaurado en las tres proyecciones de `renderVals`.
- **Nota:** el diagnóstico de esta entrada era incorrecto; ver v2.4.
- **Pantallas afectadas:** Home, Beneficios público, Beneficios (Hub).
- **Componentes afectados:** BenefitCard.
- **Estado:** entregado.

### 2026-08-29 — v2.2 · Correcciones de revisión
- **Solicitado:** corrección de revisión interna.
- **Cambio realizado:** (1) Primer intento de eliminar el hueco de las cards sin fotografía (revisado en v2.3). (2) `SolarJourney` evalúa `prefers-reduced-motion` como campo de clase, antes del primer render, de modo que el track se define en 120vh desde el inicio y no registra listeners.
- **Pantallas afectadas:** Home, Beneficios público, Beneficios (Hub).
- **Componentes afectados:** BenefitCard, `SolarJourney`.
- **Estado:** entregado.

### 2026-08-29 — v2.1 · Rendimiento y navegación móvil
- **Solicitado:** corrección de revisión interna.
- **Cambio realizado:** (1) `SolarJourney` pasó de 7 a 46–55 fps eliminando la máscara radial a pantalla completa, promoviendo capas de fondo, animando el haz con `scaleY`, cacheando escrituras de estilo, quitando `preserve-3d` y las sombras por panel, y aislando el stage con `contain:paint`. (2) El header público ya no recorta secciones: por debajo de 1080 px muestra un menú compacto con los siete destinos más “Iniciar sesión” y “Referir empresa” con objetivos táctiles de 46–48 px.
- **Pantallas afectadas:** Home (escena), todas las públicas (header).
- **Componentes afectados:** `SolarJourney`, PublicHeader, nuevo PublicMobileMenu.
- **Estado:** entregado.

### 2026-08-28 — v1 · Hub autenticado
- **Solicitado:** sistema de interfaz completo del Hub con seis secciones, estados, responsive, Sol de progreso, datos demo.
- **Cambio realizado:** Hub completo + login + microexperiencia de nivel + vista mobile.
- **Estado:** aprobado como base.

---

## J. CRITERIOS DE ACEPTACIÓN (v5)

| Criterio | Cómo se cumple |
|---|---|
| Proceso comercial como recorrido | Línea de energía + foco + anticipación; sin siete cards. |
| Redundancia | Sección de estados eliminada por completo. |
| GProgress | Porcentaje en el corte de la G o en composición editorial; nunca centrado sobre la forma. |
| Solar Build | 320 vh (≈ 2,2 pantallas útiles) frente a 700 vh. |
| Legibilidad y header | `headerOffset`, veladura, z-index; ningún título bajo la navegación. |
| Case Finder | Abre geenera.com/proyectos en pestaña nueva. |
| Soporte | Ambos CTA → WhatsApp 573114949705 con mensajes distintos. |
| Academy | Journey, retos, diagnóstico, continuidad y comunidad; no es una grilla de cursos. |
| Performance | Mismo motor de sondeo; sin listeners nuevos; reveals más cortos. |
| Mobile | Journey vertical, Academy en una columna, Solar Build 260 vh. |

---

## J-bis. CRITERIOS DE ACEPTACIÓN VISUAL (v4)

| Criterio | Cómo se cumple |
|---|---|
| **Movimiento** — ¿considerablemente más viva? | Motor de reveal/contadores/scrub en todas las vistas, Solar Build de 7 escenas, líneas de energía, marquee, barras animadas, GProgress. |
| **Identidad** — ¿podría pertenecer solo a Aliados del Sol? | La G de GEENERA como progreso, el Sol como luz (no como círculo), módulos fotovoltaicos como lenguaje de racha y de niveles. |
| **Solar Build** — ¿realista? | Estructura y timing listos; el realismo final depende de los frames del ASSET BRIEF (placeholder CSS etiquetado). |
| **UX** — ¿el movimiento explica cómo referir? | Rail "Cómo referir" (5 pasos públicos) avanza con las escenas; el referido incompleto/completo se ve como barra de calidad. |
| **Niveles** — ¿fáciles de recordar y aspiracionales? | Bronce → Círculo Solar; Círculo Solar con luz fotográfica y G. |
| **Academy** — ¿contenido real? | 34 lecciones navegables con quiz y certificaciones. |
| **Confidencialidad** — ¿desaparecieron DTP y estructuración? | Sí, en proceso público, badges, leyenda, detalle, pipeline e historial ("Evaluación técnica" / "Evaluación en curso"). |
| **Comisiones** — ¿solo perfiles elegibles? | `PERMISSIONS_CONFIG.seeCommission`; bancos y gremios no ven hitos ni la ruta Mis comisiones. |
| **G de GEENERA** — ¿geometría oficial? | Máscara del asset oficial, sin redibujar; sweep de 270° configurable. |
| **Dashboard** — ¿un ejecutivo bancario entiende en segundos? | Pipeline COP y kWp como KPIs protagonistas, estado y ejecutivo GEENERA por fila, siguiente hito. |
| **Desembolsos** — ¿claramente estimaciones? | "Fecha estimada de desembolso" + tooltip + nota al pie en el módulo. |
| **Themes** — ¿dos productos diseñados? | Light con paleta propia (no inversión); modales siempre oscuros mediante `data-theme="dark"` anidado. |
| **Performance** — ¿sigue rápida? | Un solo sondeo global, sin listeners de scroll, capas con `will-change`, escenas pausadas fuera del viewport, sin 3D. |
| **Mobile** — ¿conserva personalidad? | Solar Build a 520 vh, niveles con swipe, dashboard con tablas desplazables, hero fluido. |

---

## J-ter. CRITERIOS DE ACEPTACIÓN (v3 · Puntos Sol)

| Criterio | Cómo se cumple |
|---|---|
| **Puntos** — ¿la interfaz premia calidad y avance, no volumen? | La escalera de valor del detalle muestra cuánto genera cada milestone y el potencial restante; Academy tiene tope mensual y las oportunidades concentran el valor alto (150 al cierre). |
| **Niveles** — ¿se entiende que dependen de los últimos 6 meses y de la calidad? | Rótulo de ventana móvil junto al progreso en Inicio y en Puntos Sol, más la calidad mínima por nivel en cada tarjeta de nivel. |
| **Racha** — ¿se entiende que exige una empresa calificada por semana durante 4 semanas? | Regla escrita bajo los cuatro módulos, nudge cuando falta la semana en curso y la palabra "calificada" en la regla, no "contacto". |
| **Calidad** — ¿existe como KPI separado del saldo? | Indicador propio "Calidad de tus referidos" con sus 5 métricas ponderadas y estado "Calidad en construcción" bajo el mínimo de muestra. |
| **Historial** — ¿es transparente por qué se gana o se pierde? | Cada movimiento lleva fecha, empresa, acción, cantidad, motivo y estado; las pérdidas incluyen "¿Cómo mejorar tus próximos referidos?". |
| **Oportunidades** — ¿se distingue proceso comercial de ejecución? | Dos módulos separados: 9 etapas comerciales siempre visibles y "Ejecución de tu proyecto" solo tras el cierre. |
| **GEENERA** — ¿solución integral y no "instalación de paneles"? | Bloque de estructuración, ingeniería, análisis energético, diseño, implementación, legalización y acompañamiento, más los trámites en paralelo. |
| **Financiación** — ¿es imposible leer una promesa de tasa o condición? | Sin tasas, cuotas, plazos, porcentajes ni tiempos; disclaimer de que cada entidad define condiciones, repetido en Aliados y en Financiación Solar. |
| **Aliados** — ¿respaldo sin directorio corporativo antiguo? | Logo wall editorial en dos grupos, logos sin card, monocromático → color en hover, placeholders nombrados para lo que falta. |
| **Configuración** — ¿se pueden cambiar puntos, niveles, calidad, rachas y etapas sin rediseñar? | Nueve constantes al tope de la clase de lógica; ningún componente duplica un valor de negocio. |

---

## J-bis. CRITERIOS DE ACEPTACIÓN (v2)

1. Un visitante sin cuenta entiende qué es Aliados del Sol y llega al formulario de referido en **un clic** desde cualquier página.
2. Ninguna ruta pública exige iniciar sesión; el login solo aparece para datos personales, y siempre con contexto previo.
3. El scrollytelling avanza y retrocede con el scroll natural del usuario, sin bloqueos ni saltos, y colapsa a estado final con `prefers-reduced-motion`.
4. El Sol es el mismo componente en el sitio público y en el Hub: allí es luz, aquí es progreso con puntos, porcentaje, nivel actual y siguiente nivel visibles en texto.
5. El formulario de Clientify vive en un contenedor propio, con el snippet oficial conservado y documentado; no hay formulario alternativo inventado.
6. Puntos y comisiones nunca se presentan como el mismo saldo.
7. Ningún logo institucional se redibuja: los faltantes se muestran como placeholder nombrado.
8. Niveles, umbrales y puntajes se cambian sin tocar el marcado.
9. Contraste suficiente, foco visible, objetivos táctiles ≥ 44 px y estados legibles sin depender solo del color.
10. Sin `@media` de layout: todas las rejillas son fluidas y el contenido no se desborda entre 360 px y 2560 px.

---

## K. REGLA PARA LAS SIGUIENTES ITERACIONES

1. Leer este handoff antes de tocar código.
2. Identificar los componentes afectados en el inventario (sección D).
3. Modificar solo lo necesario; no reconstruir pantallas aprobadas.
4. Actualizar el componente reutilizable, no la copia local.
5. Registrar el cambio en el changelog (sección I) y actualizar el estado (sección A).
6. Informar brevemente qué cambió.
