# CLAUDE.md — Aliados del Sol Hub (GEENERA)

> Contexto permanente para Claude Code. Léelo completo antes de cualquier tarea en este repositorio.
> Idioma del proyecto: español (UI, nombres de tablas y columnas en `snake_case` español).
> Zona horaria de negocio: **America/Bogota** (semanas lunes–domingo, meses calendario).
> Guía para personas (funcionamiento, decisiones, tablas, planes y puesta en marcha): `docs/GUIA_HUB.md` y su PDF `docs/Guia_integral_Aliados_del_Sol_Hub.pdf`. Actualízala cuando cambie algo de lo que describe.

---

## 1. Qué es el proyecto

**Aliados del Sol Hub** es la plataforma de GEENERA para su programa de referidos. Los **aliados** refieren empresas (leads) y ganan **Puntos Sol**, suben de **nivel** y canjean recompensas.

- La página ya existe, fue construida con Claude Code y está desplegada en **Vercel**. Es un **sitio estático** (HTML, CSS y JS, sin framework ni paso de build; `package.json` solo tiene `npx serve`). Revisa la estructura antes de programar y **no reescribas lo existente sin necesidad**.

### Stack y arquitectura técnica

- **Frontend:** se mantiene estático. Supabase se usa en el navegador con `@supabase/supabase-js`, cargado como módulo ES desde CDN (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`). En el navegador solo se usa la URL y la *publishable key*; la seguridad la da RLS.
- **Backend:** son **Vercel Functions** en la carpeta `/api` de la raíz, con **Node.js 22** (`engines: 22.x`, lo exige `@supabase/supabase-js` 2.117) y ESM. Vercel las detecta sin configuración, también en proyectos estáticos. Ahí viven las claves secretas y toda la integración con Clientify.
  - Código compartido en `/lib` (por ejemplo `lib/clientify/mapeo.ts`, o `.js` si no se agrega TypeScript).
  - Dependencias de servidor (`@supabase/supabase-js`, etc.) en `package.json`.
- **Configuración pública por entorno:** como no hay build, el front **no puede leer variables de entorno**. Crea `GET /api/config`, que devuelve `{ supabaseUrl, supabasePublishableKey }` desde `process.env`. Así Preview usa `dev` y Production usa `prod` sin cambiar el código. El front lo consulta una vez al cargar.
- **Desarrollo local:** `npx serve` no ejecuta `/api`. Usa `vercel dev` y actualiza el script `dev` de `package.json`.
- **Cron jobs:** se declaran en `vercel.json`, que define los crons de Vercel, o con `pg_cron` en Supabase para lo que sea solo de base de datos.
- **Si en el futuro la complejidad del front lo justifica** (muchas pantallas o estado), se puede evaluar migrar a Vite o Next.js. **No lo hagas sin aprobación del equipo.**
- Hay tres sistemas, cada uno **dueño** de su información:

| Sistema | Es dueño de | Notas |
|---|---|---|
| **Supabase** (PostgreSQL + Auth + Storage, región East US (N. Virginia) `us-east-1`; funciones de Vercel en `iad1`, la misma zona) | Aliados, credenciales, puntos, niveles, racha, módulos, eventos, canjes y **copia de trabajo** de las empresas referidas y su avance | Fuente de verdad del programa de puntos |
| **Clientify** (CRM) | Leads, empresas, oportunidades, pipeline comercial, lead scoring | Fuente de verdad del proceso comercial. Ya existe el campo personalizado **`ID_aliado`** |
| **Vercel** (Hub + funciones `/api/*`) | Interfaz y la lógica de integración | Único intermediario entre Supabase y Clientify |

**Regla de oro:** el navegador nunca habla con Clientify. Toda llamada a Clientify la hace una función de servidor en Vercel, con `CLIENTIFY_API_KEY` en variables de entorno.

---

## 2. Identificadores: `id` interno vs `codigo_aliado` público

- `aliados.id` (uuid, PK, igual a `auth.users.id`) es la llave técnica. **Nunca se muestra en la UI ni se envía a Clientify ni a sistemas externos.**
- `aliados.codigo_aliado` (texto, `UNIQUE NOT NULL`) es el identificador público. Es el que se muestra al aliado, se comparte y se escribe en el campo `ID_aliado` de Clientify.
- Las relaciones internas (FK) usan siempre `aliado_id → aliados.id`. Cuando se necesite el código en consultas o vistas, se obtiene por JOIN. No se duplica en tablas hijas.

### Regla de generación de `codigo_aliado`

`PREFIJO_TIPO + INICIALES + ALEATORIO_8`

1. **Prefijo por tipo:** `FI` = AdS Financieros · `EM` = AdS EMI · `LK` = AdS Linker · `CE` = AdS Cliente Embajador · `AG` = AdS Agremiaciones.
2. **Iniciales del nombre completo:** primera letra de cada palabra, en mayúscula y sin tildes (`Á→A`, `Ñ→N`, `Ü→U`).
   - Ejemplo: "Juan José Pérez León" → `JJPL`.
   - Se ignoran las partículas (`de`, `del`, `la`, `las`, `los`, `y`) y se usan máximo 4 iniciales (decisión del equipo). Si no queda ninguna letra, se usa `X`.
3. **Aleatorio:** 8 caracteres del alfabeto sin caracteres confusos: `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (sin `0 O 1 I L`).
4. **Unicidad:** se genera en la base de datos (función SQL en el trigger de alta). Si hay colisión, se regenera en bucle hasta que sea única, respaldado por el índice `UNIQUE`.
5. Una vez creado es **inmutable**, aunque el aliado cambie de nombre o de tipo, porque ya está en Clientify y en materiales compartidos.

Ejemplo: `FIJJPL7K4MQ9TX`.

---

## 3. Tipos de aliado y registro ("Quiero ser aliado")

Formulario propio del Hub. No es de Clientify.

| Campo | Obligatorio | Aplica a |
|---|---|---|
| Nombre completo | Sí | Todos |
| Email | Sí | Todos |
| Celular (selector de país; se guarda en formato internacional `+57…`) | Sí | Todos |
| Regional / ciudad | No | Todos |
| Tipo de aliado | Sí | Todos: `financiero`, `emi`, `linker`, `cliente_embajador`, `agremiaciones` |
| Organización | Sí | `financiero`, `agremiaciones` |
| Cargo | Sí | `financiero`, `agremiaciones` |
| ¿Cómo llegas a las empresas? | Sí | `emi`, `linker`, `cliente_embajador` |
| Contraseña + confirmación | Sí | Todos |
| Aceptación de los Términos y condiciones (checkbox sin marcar por defecto) | Sí | Todos |
| Autorización de tratamiento de datos (checkbox sin marcar por defecto) | Sí | Todos |

### Flujo de registro

1. El front llama a `supabase.auth.signUp({ email, password, options: { data: {...campos} } })`.
   - **La contraseña la gestiona exclusivamente Supabase Auth** (hash bcrypt). **Nunca** se guarda en tablas propias ni en logs.
2. Un trigger `on auth.users insert` → `interno.handle_new_aliado()`:
   - valida los datos en el servidor; si algo falta, **se rechaza todo el registro** (no quedan usuarios de Auth sin aliado);
   - crea la fila en `aliados` con `estado = 'pendiente'` y genera `codigo_aliado`;
   - crea la fila en `aliados_perfil_organizacion` o en `aliados_perfil_alcance` según el tipo;
   - guarda `autorizacion_datos_at`, `terminos_aceptados_at` y las versiones aceptadas (`terminos_version`, `politica_datos_version`);
   - `rol` y `estado` **nunca** se toman de los metadatos del navegador.
3. **Cuando GEENERA aprueba la solicitud** (`pendiente → activo`), se sincroniza con Clientify (ver §8, flujo A). No se sincroniza al registrarse, para no llevar al CRM solicitudes que se van a rechazar (decisión del equipo). El aliado se crea como contacto con la etiqueta de aliado (**"aliados del sol"**, o **"aliado del sol hub"** si es Cliente Embajador), la etiqueta de su tipo, `ID_aliado = codigo_aliado` y el **Tipo de Clientify "Aliados Estratégicos"** (§8). Si falla, `clientify_sync_estado = 'pendiente'` y se reintenta por cron. **Ni el registro ni la aprobación fallan por culpa de Clientify.**
4. El aliado **confirma su correo** (obligatorio antes del primer login) y **GEENERA aprueba la solicitud** (decisiones del equipo):
   - mientras `estado = 'pendiente'`, el login responde "Tu solicitud está en revisión" y no entra al Hub;
   - un admin la aprueba con `estado = 'activo'`, `aprobado_at` y `aprobado_por` desde el **panel admin** (`admin.html`, fase 9), o la rechaza (`estado = 'rechazado'`: no entra al Hub y ve "Tu solicitud no fue aprobada"; se puede aprobar después);
   - solo las cuentas `activo` entran al Hub. **Todo endpoint de `/api` debe verificar `estado = 'activo'`.**
5. En el front, toda la lógica de Supabase vive en `js/supabase.js`: la página emite eventos `ads:*` (`ads:join-register`, `ads:login`, `ads:logout`) y el módulo responde (`ads:join-resultado`, `ads:login-resultado`, `ads:sesion`, `ads:aviso`).
6. **Excepción (fase 11):** si el correo tiene una invitación de **operador** (§4.10), el trigger de alta solo vincula la cuenta a `operadores` y no crea un aliado. La invitación solo la crea un admin; el navegador no puede marcarse como operador. Es el único caso de un usuario de Auth sin fila en `aliados`.

7. **Celular único** (decisión del equipo, oct 2026): índice `aliados_celular_key`. Clientify une en un solo contacto los que comparten celular, así que dos aliados con el mismo celular no podían sincronizarse. Un registro con un celular ya usado se rechaza completo; el Hub lo menciona en el mensaje genérico de registro, sin decir que ese celular existe.
8. **Recuperar contraseña** («¿Olvidaste tu contraseña?» en el login del Hub; `admin.html` y `canje.html` enlazan a `/#recuperar`): `js/supabase.js` responde `ads:recuperar` → `ads:recuperar-resultado` (`resetPasswordForEmail` con `redirectTo` = el origen; el mensaje no revela si el correo existe) y `ads:clave-nueva` → `ads:clave-nueva-resultado` o `ads:login-resultado` con `claveNueva`. El correo trae `#recuperacion=<token_hash>` y el código solo se usa (`verifyOtp`) al guardar la contraseña nueva, para que un antivirus o una vista previa no lo gasten. Después se entra con las reglas del login.
9. **Una cuenta de admin solo usa el panel** (decisión del equipo): si entra por el login del Hub, `resolverAcceso` la envía a `admin.html`, igual que a un operador a `canje.html`.
10. **Captcha «No soy un robot»** (decisión del equipo, oct 2026) en «Quiero ser aliado», el login del Hub, «¿Olvidaste tu contraseña?» y los logins de `admin.html` y `canje.html`. Usa la **protección CAPTCHA de Supabase Auth** con Cloudflare Turnstile (*Authentication → Attack Protection*), con el mismo widget del formulario público: `js/captcha.js` pinta un widget por contenedor con nombre (`[data-captcha="registro"|"login"|"recuperar"]`) y el front envía el token en `options.captchaToken` de `signUp`, `signInWithPassword` y `resetPasswordForEmail`; Supabase lo verifica con la clave secreta configurada en su panel (no hay código de servidor propio). Cada token sirve una vez y el widget se reinicia tras cada intento. Sin `TURNSTILE_SITE_KEY` no se pinta nada y no se envía token, así que **la protección de Supabase solo se enciende en un proyecto cuyo despliegue ya tiene la site key** (si no, nadie podría entrar). Crear la contraseña desde un enlace (`verifyOtp`) no lleva captcha.

Validar en front **y** en servidor: formato de email, celular (formato internacional E.164; si es de Colombia, 10 dígitos que empiezan por 3), contraseñas iguales y mínimo 8 caracteres, campos condicionales según el tipo, aceptación de términos y autorización de datos.

---

## 4. Modelo de datos (Supabase)

> Basado en `relacionestablas1.xlsx`. Las diferencias con el Excel se explican al final de esta sección.
> Estados triestado: `enum estado_triple AS ('si','no','revision')`.

### 4.1 `aliados` (tabla principal)

```
id                      uuid PK  FK auth.users(id) ON DELETE CASCADE   -- ID_sup, NUNCA exponer
codigo_aliado           text UNIQUE NOT NULL                          -- ID_Aliado público
nombre_completo         text NOT NULL
correo                  text UNIQUE NOT NULL
celular                 text UNIQUE NOT NULL                   -- E.164; único por aliado (migración celular_unico)
regional                text NULL
tipo_aliado             enum tipo_aliado NOT NULL
-- Valores calculados (caché; la fuente de verdad es movimientos_puntos / avance_empresa)
puntos_nivel            int NOT NULL DEFAULT 0      -- "Puntos de sol": ganados − perdidos, últimos 6 meses, mínimo 0
puntos_disponibles      int NOT NULL DEFAULT 0      -- ganados − perdidos − redimidos (histórico), mínimo 0
calidad_referidos       numeric(5,2) NULL           -- 0–100 %, promedio de calidad_empresa; NULL si no hay empresas evaluables
nivel                   enum nivel NOT NULL DEFAULT 'bronce'
-- Racha Solar 4x4
racha_semana_1..4       boolean NOT NULL DEFAULT false
racha_ultima_semana     date NULL                   -- lunes de la última semana contada
-- Integración y cumplimiento
clientify_contact_id    text NULL
clientify_sync_estado   text NOT NULL DEFAULT 'pendiente'   -- pendiente | ok | error | excluido (cuenta de admin, fase 10)
clientify_sync_error    text NULL
autorizacion_datos_at   timestamptz NOT NULL
terminos_aceptados_at   timestamptz NOT NULL
terminos_version        text NOT NULL                       -- versión de los Términos aceptada (fecha de entrada en vigor)
politica_datos_version  text NOT NULL                       -- versión de la Política de Tratamiento de Datos vigente al autorizar
estado                  text NOT NULL DEFAULT 'pendiente'   -- pendiente | activo | suspendido | rechazado
aprobado_at             timestamptz NULL                    -- cuándo GEENERA aprobó la solicitud
aprobado_por            uuid NULL FK aliados(id)            -- admin que la aprobó
rol                     text NOT NULL DEFAULT 'aliado'      -- aliado | admin (equipo GEENERA)
created_at, updated_at  timestamptz
```

### 4.2 `aliados_perfil_organizacion` (Financieros y Agremiaciones), 1:1

```
aliado_id    uuid PK FK aliados(id)
organizacion text NOT NULL
cargo        text NOT NULL
```

### 4.3 `aliados_perfil_alcance` (EMI, Linker, Cliente Embajador), 1:1

```
aliado_id              uuid PK FK aliados(id)
como_llega_empresas    text NOT NULL
```

Un trigger o CHECK valida que el perfil corresponda al `tipo_aliado`.

### 4.4 `empresas` (referidos)

```
id                     uuid PK                      -- ID_Empresa (interno)
aliado_id              uuid FK aliados(id) NOT NULL
origen                 text NOT NULL                -- 'hub' (registrada por el Hub) | 'clientify_form' (antiguo formulario de Clientify)
canal                  text NULL                    -- solo origen 'hub': 'sesion' (Nueva oportunidad) | 'publico' (formulario público, §7.1)
empresa                text NOT NULL
sector                 text NOT NULL
subsector              text NULL
ciudad                 text NULL
nombre_contacto        text NOT NULL
cargo                  text NULL
telefono               text NOT NULL
correo                 text NOT NULL
valor_factura          numeric NOT NULL
observaciones          text NULL
factura_id             uuid NULL FK facturas(id)
es_perfecto            boolean NOT NULL             -- calculado al guardar (ver regla abajo)
clientify_contact_id   text NULL
clientify_company_id   text NULL
clientify_deal_id      text NULL
clientify_sync_estado  text NOT NULL DEFAULT 'pendiente'   -- pendiente | ok | error (cola del flujo B)
clientify_sync_error, clientify_sync_intentos, clientify_sync_proximo_at, clientify_sync_at   -- reintentos del flujo B
autorizacion_contacto_at timestamptz NULL           -- declaración Ley 1581 del aliado; obligatoria si origen = 'hub'
created_at, updated_at timestamptz
```

Un contacto solo puede referirse **una vez** en todo el programa: índice único `lower(correo)` (gana el primer aliado).

Los leads del antiguo formulario de Clientify (`origen = 'clientify_form'`) pueden llegar sin empresa, sector, teléfono, correo o valor de la factura; para `origen = 'hub'` esos campos siguen siendo obligatorios (CHECK `empresas_campos_hub`).

**Referido perfecto:** los **10 campos** completos: empresa, sector, subsector, ciudad, nombre_contacto, cargo, telefono, correo, valor_factura y **factura adjunta**. `observaciones` no cuenta. Si falta alguno, `es_perfecto = false` (imperfecto).

### 4.5 `facturas`

```
id               uuid PK                 -- ID_pdf
empresa_id       uuid FK empresas(id)
aliado_id        uuid FK aliados(id)
tipo_documento   text                    -- pdf | jpg | png
storage_path     text NOT NULL           -- bucket privado 'facturas': {aliado_id}/{empresa_id}/{archivo}
nombre_archivo   text NOT NULL
fecha_carga      timestamptz NOT NULL DEFAULT now()
validacion       text NOT NULL DEFAULT 'pendiente'   -- pendiente | revisado
aprobado         estado_triple NOT NULL DEFAULT 'revision'
clientify_subida_at timestamptz NULL     -- cuándo se dejó el enlace de la factura en la empresa de Clientify
```

El bucket de Storage es **privado** y se accede con URLs firmadas de corta duración. Límite: 10 MB; tipos PDF, JPG y PNG (lo impone el bucket). No tiene políticas: el navegador sube con una URL firmada de un solo uso y solo el servidor lee.

### 4.6 `avance_empresa` (espejo del avance en Clientify), 1:1 con `empresas`

```
empresa_id              uuid PK FK empresas(id)
-- Variables de calidad (ponderación en §6.3)
calificado              estado_triple DEFAULT 'revision'
perfecto                estado_triple                 -- se inicializa desde empresas.es_perfecto; Clientify puede corregirlo
oportunidad_tecnica     estado_triple DEFAULT 'revision'   -- = "Evaluación técnica realizada"
integridad_informacion  estado_triple DEFAULT 'revision'
calidad_empresa         numeric(5,2) NULL             -- ver §6.1; NULL si alguna de las 4 está en 'revision'
-- Variables de avance comercial (derivadas de la fase de la oportunidad, §8)
propuesta_comercial     estado_triple DEFAULT 'revision'
negocio_cerrado         estado_triple DEFAULT 'revision'
-- Variables de penalización
informacion_falsa       estado_triple DEFAULT 'revision'   -- etiqueta de Clientify
fuera_perfil            estado_triple DEFAULT 'revision'   -- derivada: no calificado + perfecto
-- Datos crudos de Clientify (se guardan tal cual para auditoría y recálculo)
estado_contacto_clientify text NULL     -- campo nativo Status/Estado del contacto (p. ej. "3. lead caliente")
fase_oportunidad        text NULL       -- fase actual de la oportunidad (p. ej. "6. Presentación de oferta")
fase_oportunidad_num    int NULL        -- número extraído del prefijo de la fase (3, 6, 10…)
estado_oportunidad      text NULL       -- abierta | ganada | perdida (nativo de la oportunidad)
lead_scoring            numeric NULL    -- nativo de Clientify
valor_oportunidad       numeric NULL    -- oportunidad: pipeline originado
valor_cotizado          numeric NULL    -- oportunidad
potencia_instalada_kwp  numeric NULL    -- campo "Potencia" de Clientify
fecha_calificado        timestamptz NULL  -- momento en que calificado pasó a 'si' (para la Racha)
clientify_updated_at    timestamptz NULL
updated_at              timestamptz
```

> **Decisión:** los datos de Clientify que usan los dashboards **se guardan como columnas en Supabase** (caché sincronizada por webhook y conciliación). No se consulta la API de Clientify en vivo desde el dashboard: sería lento, tiene límites de uso y expondría la integración.

### 4.7 `movimientos_puntos` (libro mayor; **única fuente de verdad de los puntos**)

```
id                uuid PK                 -- ID_Mov
aliado_id         uuid FK aliados(id) NOT NULL
tipo              text NOT NULL           -- 'ganado' | 'perdido' | 'redimido'
puntos            int NOT NULL CHECK (puntos > 0)   -- valor nominal de la regla (p. ej. 30)
puntos_aplicados  int NOT NULL CHECK (puntos_aplicados >= 0)   -- lo que realmente se descontó/sumó al saldo disponible (ver §5.4)
motivo            text NOT NULL           -- código de la tabla §5
vinculo           text NOT NULL           -- tabla origen: 'empresas' | 'eventos' | 'modulos_completados' | 'racha' | 'canjes' | 'ajuste_admin'
vinculo_id        text NULL               -- id del registro origen
clave_unica       text UNIQUE NOT NULL    -- IDEMPOTENCIA (ver §5.1)
fecha             timestamptz NOT NULL DEFAULT now()
creado_por        text NOT NULL           -- 'sistema' | 'webhook_clientify' | 'admin:{id}' | 'canjes_api' | 'canjes_qr'
nota              text NULL
secuencia         bigint IDENTITY         -- orden determinista cuando dos movimientos tienen la misma fecha
```

- Es **solo inserción**: no se hacen UPDATE ni DELETE. Las correcciones se registran como un movimiento nuevo con motivo `ajuste_admin`.
- Cada movimiento dispara el recálculo de `aliados.puntos_nivel`, `puntos_disponibles` y `nivel`.
- **Cómo registrar un movimiento** (fase 3): se inserta con `ON CONFLICT (clave_unica) DO NOTHING` indicando `aliado_id`, `tipo`, `motivo`, `vinculo`, `vinculo_id`, `clave_unica` y `creado_por`. **La base de datos hace el resto:**
  - toma `puntos` del catálogo `reglas_puntos` (§5) y rechaza un valor distinto; solo `ajuste_admin` y `canje` llevan `puntos` explícito;
  - calcula `puntos_aplicados` (piso en 0 para `perdido`; rechaza un `redimido` mayor al saldo) bloqueando la fila del aliado;
  - recalcula la caché del aliado. Nunca se escriben a mano `puntos_*`, `calidad_referidos` ni `nivel`.
- **Cuenta no activa (decisión del equipo):** si el aliado está `suspendido` o `pendiente`, sus movimientos no entran al libro: quedan en `movimientos_retenidos` y se acreditan automáticamente cuando la cuenta vuelve a `activo`, en su orden original y con la fecha de la reactivación (la nota guarda la fecha original). Mientras no esté activo no puede canjear. Los `ajuste_admin` se aplican siempre.
- El dashboard filtra los ganados y perdidos por semana, mes y trimestre usando `fecha`.

### 4.8 `eventos`

```
id                       uuid PK
aliado_id                uuid FK aliados(id)
nombre_evento            text NOT NULL
tipo_evento              text NULL          -- conferencia, taller, etc.
fecha                    date NOT NULL
geenera_involucrada      boolean
registro_asistentes      boolean            -- + archivo opcional en Storage
empresas_perfil_count    int
estado                   text DEFAULT 'pendiente'   -- pendiente | validado | rechazado
validado_por, validado_at
```

Otorga +100 solo cuando un **admin** lo marca `validado` y se cumplen: evento realizado, GEENERA involucrada, registro de asistentes y `empresas_perfil_count >= 5`.

**Implementado (fase 9):**
- El **aliado** reporta el evento desde el Hub (pantalla Puntos Sol, "Reporta un evento"): `POST /api/eventos` con `accion: 'subir'` da una URL firmada de un solo uso para el registro de asistentes (bucket privado `eventos`, 10 MB, PDF/JPG/PNG/XLSX/CSV, ruta `{aliado_id}/{evento_id}/{archivo}`) y `accion: 'registrar'` llama a `public.registrar_evento` (cuenta activa, máximo 5 por día, fecha ya pasada y del último año). Columnas nuevas: `descripcion` y `revision_nota`. El aliado ve sus eventos en `v_mis_eventos`.
- Un **admin** lo valida o rechaza en el panel (`admin_validar_evento`, `admin_rechazar_evento`): validar exige las 4 condiciones y otorga `evento_validado` (+100, clave `evento:{id}`, `vinculo = 'eventos'`); rechazar exige motivo, que el aliado ve.

### 4.9 `modulos` (catálogo) y `modulos_completados`

```
modulos:             id, codigo text UNIQUE NOT NULL,           -- id del curso en la Academy del Hub (c11, c12…)
                     nombre, orden, activo,
                     puntos int NOT NULL DEFAULT 0 CHECK (0..20) -- 0 = sin puntos (fase 7)
modulos_completados: id, aliado_id FK, modulo_id FK, fecha_completado timestamptz,
                     puntos int NOT NULL                          -- valor del módulo al completarlo
                     recompensa_estado text DEFAULT 'pendiente',  -- pendiente | otorgada | no_aplica
                     fecha_otorgada timestamptz NULL,
                     UNIQUE (aliado_id, modulo_id)                -- un módulo se premia una sola vez
```

### 4.10 `canjes` (redención de puntos: por API de un proveedor o con el QR del aliado)

```
id                   uuid PK
aliado_id            uuid FK aliados(id)
puntos               int CHECK (puntos > 0)
recompensa           text
nivel_requerido      enum nivel NULL
proveedor            text                 -- quien entrega el beneficio / chatbot
referencia_externa   text UNIQUE NOT NULL -- idempotencia del sistema externo
fecha                timestamptz
```

Entra por un endpoint seguro `POST /api/canjes` (API key propia por proveedor), no por acceso directo a la base. El endpoint valida que `puntos <= puntos_disponibles` y que el nivel del aliado permita la recompensa; luego inserta en `canjes` y el movimiento `tipo='redimido'`. *El sistema externo aún no está definido.*

**Implementado (fase 10, migración `canjes_api`):**
- **Catálogo `recompensas`** (decisión del equipo: lo administra GEENERA desde el panel): `codigo` (el que usa el proveedor; minúsculas, números, `-` y `_`; inmutable), `nombre`, `descripcion`, `categoria`, `puntos` (1–100 000), `nivel_minimo`, `proveedor` (NULL = cualquiera; si tiene valor, solo ese proveedor la canjea) y `activa`. Cambiar puntos o nivel solo afecta canjes futuros: cada canje guarda los suyos.
- **`canjes`** gana `recompensa_id`, `estado` (`confirmado` | `anulado`), `anulado_at`, `anulado_por`, `anulacion_motivo`. La referencia es única **por proveedor** (`UNIQUE (proveedor, referencia_externa)`). Un canje no se edita ni se borra; solo pasa una vez de confirmado a anulado.
- **`POST /api/canjes`** (`Authorization: Bearer <key>`; `CANJES_API_KEYS` = `proveedor1:key1,proveedor2:key2`, keys de mínimo 24 caracteres, comparadas en tiempo constante). El proveedor sale de la key, nunca del cuerpo.
  - `{ accion: 'consultar', codigo_aliado }` → `public.consultar_canjes`: `{ codigo_aliado, activo, nivel, puntos_disponibles, recompensas: [{ codigo, nombre, puntos, nivel_minimo, disponible, motivo }] }`, solo las activas de ese proveedor o de todos. Sin nombre, correo ni otros datos personales.
  - `{ accion: 'canjear', codigo_aliado, recompensa, referencia_externa }` → `public.registrar_canje`, que en una transacción bloquea al aliado y exige cuenta activa, recompensa activa del proveedor, **nivel actual ≥ nivel mínimo**, saldo suficiente y máximo **30 canjes por hora**; inserta el canje y el movimiento `redimido` (clave `canje:{id}`, `creado_por = 'canjes_api'`, nota = nombre de la recompensa). Responde `201`; repetir la misma referencia responde `200` con el canje original y `duplicado: true` (no descuenta dos veces).
  - Errores con código estable en el cuerpo (`{ error, codigo }`): `aliado_inexistente`/`recompensa_inexistente` 404, `aliado_no_activo`/`nivel_insuficiente`/`saldo_insuficiente`/`referencia_duplicada` 409, `dato_invalido` 422, `limite_canjes` 429; key inválida 401; sin keys configuradas 503.
- **Anulación** (solo admin, desde el panel, motivo obligatorio de 10 caracteres): `admin_anular_canje` marca el canje `anulado` y devuelve los puntos con un `ajuste_admin` `ganado` (`vinculo = 'canjes'`, clave `canje_anulado:{id}`). La devolución suma a `puntos_disponibles` pero **no** a `puntos_nivel`, porque el canje tampoco los restó (§5.4). El aliado ve el motivo.
- Vistas: `v_mis_canjes` y `v_recompensas` (catálogo activo con `disponible`, `falta_nivel` y `puntos_faltantes` del aliado de la sesión), `v_admin_canjes` y `v_admin_recompensas` (con uso de cada recompensa).

**Implementado (fase 11, canje con QR; migraciones `canjes_qr` y `eliminar_operador`). FASE FINALIZADA: probada en `aliados-dev` con pgTAP, `npm test`, navegador y prueba real con celulares Android e iPhone (1 oct 2026).**
- **Cómo funciona:** el aliado abre **«Mi QR para canjear»** en el Hub y lo muestra; un **operador** (quien entrega la recompensa) lo escanea en **`canje.html`**, elige la recompensa entre las de su proveedor y confirma. El aliado ve «¡Canje registrado!» y su nuevo saldo sin recargar.
- **El QR** es un enlace a `/canje.html#q=<ficha>` (lo que va tras el `#` no viaja a ningún servidor). La ficha es aleatoria (32 bytes), **vale 5 minutos, sirve una sola vez** y la base solo guarda su huella (sha256). El Hub pide una nueva **cada 60 s** y cada QR nuevo anula el anterior: una captura de pantalla deja de servir enseguida. Sin señal, el último QR sigue sirviendo hasta que vence. Debajo va un **código corto** de 8 caracteres (alfabeto sin `0 O 1 I L`) por si la cámara falla. El QR nunca contiene `aliados.id` ni datos personales.
- **Operadores** (tabla `operadores`: `usuario_id`, `correo`, `nombre`, `proveedor`, `activo`, `invitado_por`): **no son aliados**. Los invita un admin desde el panel (pestaña Operadores); canjean solo recompensas de su proveedor (o de todos). Un **admin** también puede escanear, como proveedor `geenera`. Un operador no puede canjear su propio QR.
  - Invitación: `POST /api/admin { accion: 'invitar_operador', correo, nombre, proveedor }` → `admin_invitar_operador` y `auth.admin.generateLink` (`invite` si el correo no tiene cuenta, `recovery` si es una cuenta de operador sin contraseña; si el correo ya es de un aliado, entra con su contraseña y **no** hay enlace, así un admin no puede tomar la cuenta de un aliado). El enlace **no** se envía por correo (no depende del SMTP): el panel lo muestra para copiarlo y enviarlo por WhatsApp.
  - El enlace es `/canje.html#invitacion=<hashed_token>&tipo=invite|recovery` y el código solo se usa (`verifyOtp`) cuando la persona guarda su contraseña: **el enlace directo de Supabase se gastaba con la vista previa de WhatsApp** (hallado en la prueba real). Sirve una vez y vence según Supabase (1 h por defecto); si vence, «Nuevo enlace».
  - `estado_operador` (desactivar con motivo / reactivar) y `eliminar_operador` (motivo; **solo si no registró canjes**, para no perder quién los registró; borra también su cuenta de Auth si no es aliado). Todo queda en `acciones_admin`.
- **Tablas:** `canjes_qr` (`aliado_id`, `ficha_hash`, `codigo_corto`, `vence_at`, `usado_at`, `anulado_at` = reemplazado, `canje_id`) y `canjes_qr_intentos` (códigos inexistentes por operador). Sin políticas: solo se escriben con funciones. `canjes` gana `origen` (`api` | `qr`) y `registrado_por` (usuario de Auth del operador o admin); ninguno se edita.
- **Funciones con la sesión del usuario** (`SECURITY DEFINER` + `auth.uid()`, ejecutables por `authenticated`; **única excepción** al patrón «escrituras solo por `/api`», para no gastar funciones de Vercel). Cada una verifica quién la llama:
  - aliado activo: `generar_qr_canje()` (máx. 30 cada 10 min) y `estado_qr_canje(codigo)`;
  - operador activo o admin: `perfil_operador()`, `consultar_qr_canje(qr)` (código, nombre corto tipo «Laura P.», nivel, saldo y recompensas con `disponible`/`motivo`), `canjear_qr(qr, recompensa)` y `mis_canjes_registrados()` (los del día).
  - Un QR inexistente, vencido, usado o reemplazado **no es error**: responden `{ ok: false, codigo: 'qr_invalido' | 'qr_vencido' | 'qr_usado' | 'qr_reemplazado' }` para que el intento quede contado. Máx. **20 códigos inexistentes cada 10 min** por operador (`limite_intentos`). Errores con prefijo: `propio_qr`, `no_autorizado`, `limite_qr`, `aliado_inexistente`, más los del canje.
- **Una sola lógica de canje:** `interno.registrar_canje_base` (cuenta activa, recompensa del proveedor, nivel ≥ mínimo, saldo, 30 canjes por hora, idempotencia por referencia) la usan `public.registrar_canje` (API, sin cambios por fuera) y `canjear_qr` (referencia `qr:{id}`, movimiento con `creado_por = 'canjes_qr'`). `interno.recompensas_para` la comparten `consultar_canjes` y `consultar_qr_canje`. Un **doble toque** en Confirmar devuelve el mismo canje (`duplicado: true`).
- **Concurrencia:** `canjear_qr` bloquea la ficha y luego al aliado; `generar_qr_canje` no bloquea al aliado (evita el cruce de bloqueos).
- **Limpieza:** cron `depurar-canjes-qr` (`40 5 * * *` UTC = 00:40 Bogotá) borra las fichas vencidas sin usar de más de 7 días y los intentos de más de 1 día.
- **Front:**
  - `js/mi-qr.js` pinta «Mi QR» encima del Hub (librería `qrcode-generator@2.0.4` de jsDelivr), ajustado al área visible del celular (`visualViewport`), con cuenta regresiva, aviso «Sin señal: este QR sirve hasta las…» y la pantalla de éxito (consulta el estado cada 3 s). `js/supabase.js` responde `ads:qr-generar` → `ads:qr` y `ads:qr-estado` → `ads:qr-estado-resultado`; una cuenta de operador que entra al Hub se envía a `canje.html`.
  - `canje.html` + `js/canje.js`: login, crear contraseña desde la invitación, cámara (`BarcodeDetector` en Android; `jsQR@1.4.0` en iPhone), código escrito a mano, confirmación, resultado y «Tus canjes de hoy». Si se cae la conexión al confirmar, «Reintentar» es seguro (no descuenta dos veces).
  - Panel: pestaña **Operadores** y, en Canjes, «QR · operador» o «API · ref.».
- **Vistas:** `v_mis_canjes` y `v_admin_canjes` ganan `origen` (y `registrado_por` en la de admin); nueva `v_admin_operadores` (con canjes registrados de cada operador).
- **Siguen siendo 12 funciones de Vercel.** `POST /api/canjes` no cambió.

### 4.11 `webhook_eventos` (auditoría de integración)

```
id, fuente ('clientify'), payload jsonb, recibido_at, procesado_at NULL, error text NULL,
entidad ('contacto' | 'oportunidad'), entidad_id, accion        -- fase 6
```

- `error` guarda también los **avisos** de un evento procesado (Status o fase desconocidos, `ID_aliado` inexistente, conflictos).
- El payload crudo se vacía a los **90 días** (`interno.depurar_webhooks_clientify()`, cron `depurar-webhooks-clientify` el día 1 de cada mes) porque trae datos personales (decisión del equipo).
- Los eventos de contactos u oportunidades **ajenos al programa** (resultado "ignorado") se vacían **al procesarlos** (`{"descartado": true}`): Clientify envía los cambios de todas sus oportunidades y no se guardan datos que no son del programa (decisión del equipo).

**Tablas de la fase 6:**
- `clientify_cola_entidades` (PK `entidad, entidad_id`): contactos y oportunidades por reprocesar; varios eventos de la misma entidad quedan en una sola fila. Solo el servidor.
- `avance_conflictos`: cambios de Clientify sobre un valor que ya era definitivo (§5.1). No cambian puntos ni calidad; los resuelve un admin con `ajuste_admin` (panel de la fase 9). Un admin puede leerlos.

### 4.12 Vista `v_aliado_dashboard`

Expone al front únicamente lo que el aliado puede ver: `codigo_aliado`, nombre, tipo, puntos, nivel, racha, calidad, conteos y sumas por tipo. **No expone `id`.**

**Implementado (fase 8, migración `vistas_dashboard`):** cuatro vistas `security_invoker` que además filtran por `auth.uid()` (cada aliado, también un admin, ve solo lo suyo) y no exponen `id` ni `aliado_id`. Solo lectura para `authenticated`; `anon` no tiene acceso.

- `v_aliado_dashboard`: perfil, puntos, nivel, calidad y `empresas_evaluadas`, racha (con `racha_semana_actual`), conteos de referidos (total, calificados, propuesta, cerrados, no continúan, activos), indicadores de Financieros (`potencia_kwp`, `pipeline_originado`, `valor_cotizado`, en COP) y módulos (completados, pendientes, `puntos_modulos_mes`).
- `v_mis_movimientos`: historial con valor nominal y aplicado, descripción de la regla y nombre de la empresa o del módulo.
- `v_mis_referidos`: empresas con su avance, `etapa` visible (ids de `OPPORTUNITY_STAGE_CONFIG`: recibida, validacion, calificacion, dtp, propuesta, cerrado, noviable), puntos netos por empresa y, desde oct 2026 (migración `serie_mensual_referidos`), `fecha_propuesta` y `fecha_cierre`: la fecha del primer movimiento `propuesta_comercial` y `negocio_cerrado` de la empresa (las usa la serie mensual, §9).
- `v_mis_modulos`: catálogo activo con los puntos de cada módulo y el estado del aliado en cada uno.

### Diferencias respecto al Excel y por qué

1. **Tablas hijas sin `ID_Aliado` duplicado.** Solo llevan la FK `aliado_id`, y el código se obtiene por JOIN. Así se evita que existan dos llaves que puedan desincronizarse.
2. **`eventos` sin la columna "Tipo" de aliado,** porque se deriva del aliado.
3. **`movimientos_puntos` usa `tipo` + `puntos`** en lugar de tres columnas (ganados, perdidos, utilizados). El resultado es equivalente y más simple de validar. Se añade `clave_unica` para impedir puntos duplicados.
4. **Tablas nuevas:** `canjes`, `modulos` (catálogo), `webhook_eventos`. **Columnas nuevas:** ids de Clientify, estado de sincronización, datos crudos de Clientify (estado del contacto, fase de la oportunidad), fecha de calificación y los datos para el dashboard de Financieros.
5. **`perfecto` en dos lugares.** `es_perfecto` en `empresas` es lo que se calculó al registrar. `avance_empresa.perfecto` es el valor vigente para calidad y puntos, que Clientify puede corregir.

---

## 5. Reglas de Puntos Sol

| Código `motivo` | Evento disparador | Puntos | Clave única |
|---|---|---|---|
| `registro_valido` | Lead creado con los campos obligatorios (Hub) o lead nuevo en Clientify con `ID_aliado` válido | **+10** | `empresa:{id}:registro_valido` |
| `referido_perfecto` | `perfecto = si` (10 campos incluida factura) | **+20** | `empresa:{id}:perfecto` |
| `referido_imperfecto` | `perfecto = no` | **−5** | `empresa:{id}:perfecto` |
| `empresa_calificada` | `calificado = si` | **+30** | `empresa:{id}:calificado` |
| `referido_no_calificado` | `calificado = no` | **−10** | `empresa:{id}:calificado` |
| `evaluacion_tecnica` | `oportunidad_tecnica = si` | **+30** | `empresa:{id}:oportunidad_tecnica` |
| `propuesta_comercial` | `propuesta_comercial = si` | **+50** | `empresa:{id}:propuesta_comercial` |
| `negocio_cerrado` | `negocio_cerrado = si` (el proyecto pasa a ejecución) | **+150** | `empresa:{id}:negocio_cerrado` |
| `fuera_perfil` | `fuera_perfil = si` (había información suficiente para identificarlo) | **−15** | `empresa:{id}:fuera_perfil` |
| `informacion_falsa` | `informacion_falsa = si` (empresa inexistente o datos deliberadamente incorrectos) | **−30** | `empresa:{id}:informacion_falsa` |
| `baja_calidad_reiterada` | Admin lo registra tras retroalimentación previa | **−20** | `aliado:{id}:baja_calidad:{fecha}` |
| `modulo_completado` | Módulo terminado (máx. 20 pts/mes, ver §5.3) | **según el módulo** (hoy +5) | `modulo:{modulos_completados.id}` |
| `evento_validado` | Evento validado por admin | **+100** | `evento:{id}` |
| `racha_solar` | Racha 4x4 completada | **+75** | `racha:{aliado_id}:{lunes_semana_4}` |
| `ajuste_admin` | Corrección manual justificada | ± | `ajuste:{uuid}` |

**Aclaraciones:**

- La Racha Solar vale **75** (no 90).
- **"Información disponible" fue eliminada** del programa (decisión del equipo): equivalía a "Referido perfecto", que se mantiene en +20. No existe esa columna, ni ese motivo, ni ese mapeo.
- `fuera_perfil` (−15) es **derivada**: se activa cuando `calificado = no` **y** `perfecto = si`. **Se suma** al −10 de no calificado, así que ese referido pierde **−25** en total (decisión del equipo). Son dos movimientos independientes, cada uno con su propia clave única.
- Integridad de la información **no da puntos**; solo cuenta para la calidad.
- `REVISION` **nunca** genera movimiento ni penaliza. Solo se registra el paso a `si` o `no`.
- `integridad_informacion = no` no resta puntos; solo baja la calidad.

### 5.1 Idempotencia: puntos únicos por evento

- **Cada variable de cada empresa genera como máximo un movimiento en toda su vida.** Lo garantiza el `UNIQUE (clave_unica)`, y se inserta con `ON CONFLICT DO NOTHING`.
- Una empresa **no puede ser calificada dos veces.** El **primer** estado definitivo (`si` o `no`) de la variable es el que registra puntos. Por eso ganar y perder comparten la misma clave: `+30` o `−10`, nunca ambos.
- Si Clientify cambia después un valor definitivo (por ejemplo de `no` a `si`), **no** se generan puntos automáticamente. Queda registrado en `webhook_eventos` y lo resuelve un admin con `ajuste_admin`.
- Los webhooks repetidos o reprocesados son inofensivos gracias a la clave única.

### 5.2 Racha Solar 4x4

- Semanas **lunes 00:00 – domingo 23:59, hora Bogotá.**
- **Cuenta la fecha de calificación, no la de registro** (decisión del equipo).
- **Secuencia obligatoria:** cuando `avance_empresa.calificado` pasa de `revision` a `si`:
  1. se guarda `fecha_calificado = now()`;
  2. se inserta el movimiento `empresa_calificada` (+30) con esa fecha;
  3. **después**, con esa misma fecha, se actualiza la racha.
- Una semana cuenta como `1` si el aliado tiene **al menos una empresa que pasó a calificada** en esa semana.
- **Al calificarse un lead en la semana S:**
  - si `S` ya está contada, no pasa nada;
  - si `racha_ultima_semana = S − 7 días`, se marca la siguiente `semana_n = true`;
  - si no, la racha **reinicia**: `semana_1 = true` y las demás en `false`.
  - Luego `racha_ultima_semana = S`.
- **Al completar 4 de 4:** se inserta `racha_solar` (+75). La racha se ve completa el resto de esa semana y el cron del lunes siguiente la vuelve a `0 0 0 0` (decisión del equipo).
- **Cron semanal** (lunes 00:05 Bogotá): vuelve a `0 0 0 0` la racha completada la semana anterior y la de quien no calificó ninguna empresa en la semana recién terminada.
- **Garantía:** no puede existir más de un `racha_solar` por aliado en **4 semanas calendario**. Se valida en la función antes de insertar, comparando el **lunes** de la semana de la racha anterior con el de la actual (`interno.lunes_bogota(fecha) > semana − 28 días` bloquea), no los momentos exactos. Antes se comparaban los momentos: una racha completada un domingo y la siguiente el lunes de su cuarta semana quedaban a 22 días y el segundo +75 **se perdía** (la semana ya quedaba contada y nada lo volvía a intentar). Corregido en la migración `racha_semanas_calendario` (oct 2026, hallado en las pruebas de aceptación).
- Una calificación retenida mientras la cuenta no estaba activa (§4.7) no cuenta para la racha (decisión del equipo).
- Implementación: trigger `movimientos_puntos_racha` sobre el movimiento `empresa_calificada`, `interno.actualizar_racha` e `interno.reiniciar_rachas` (migración `racha_solar`).

### 5.3 Módulos (puntos por módulo, máximo 20 puntos por mes calendario)

- **Cada módulo tiene su propio valor** en `modulos.puntos` (0 = contenido sin puntos, máximo 20). El tope mensual es de **20 puntos**, no de un número de módulos (decisión del equipo). La regla `modulo_completado` de `reglas_puntos` no tiene valor fijo.
- El catálogo `modulos` usa `codigo`, el mismo identificador de los cursos de la Academy del Hub (`c11`, `c12`…).
- Completar un módulo (`public.completar_modulo(aliado, codigo)`, que llama el servidor con el aliado de la sesión) crea una fila en `modulos_completados` con el valor del módulo en ese momento y `recompensa_estado = 'pendiente'`, o `'no_aplica'` si el módulo no da puntos.
- La función `otorgar_modulos_pendientes(aliado)` corre al completar un módulo, al activarse la cuenta y en un **cron el día 1 de cada mes a las 00:05**. Hace lo siguiente:
  - suma los puntos de los movimientos `modulo_completado` del mes en curso;
  - otorga pendientes en orden FIFO mientras quepan completos en el tope de 20 puntos del mes; un módulo que no cabe espera al mes siguiente, y los que llegaron después también esperan;
  - marca `otorgada` y `fecha_otorgada = now()`.
- Ejemplo: 8 módulos de 5 puntos en septiembre dan 20 puntos en septiembre, los otros 4 quedan pendientes y se otorgan el 1 de octubre. Total visible: 40 puntos al cabo de dos meses.
- Una cuenta que no está activa no recibe puntos de módulos: quedan pendientes hasta que se active.
- El dashboard muestra los módulos con "recompensa pendiente".

### 5.4 Cálculos de saldo: **piso en 0 y sin memoria** (decisión del equipo)

Los Puntos Sol **nunca son negativos**, y una penalización recibida con saldo bajo **no genera deuda**: lo que no se pudo descontar se pierde y no afecta puntos futuros.

- **`puntos_disponibles`** (histórico, no vence):
  - al insertar un movimiento `perdido`: `puntos_aplicados = LEAST(puntos, saldo_disponible_actual)`;
  - para `ganado` y `redimido`: `puntos_aplicados = puntos` (el canje ya valida saldo suficiente);
  - `puntos_disponibles = Σ aplicados(ganado) − Σ aplicados(perdido) − Σ aplicados(redimido)`, que por construcción siempre es ≥ 0.
  - La inserción de un `perdido` debe bloquear la fila del aliado (`SELECT … FOR UPDATE`) para evitar condiciones de carrera.
- **`puntos_nivel`** (ventana de 6 meses): **suma acumulada con piso**. Se recorren los movimientos `ganado` y `perdido` con `fecha >= now() − interval '6 months'` en orden cronológico, aplicando `saldo = GREATEST(0, saldo ± puntos)` en cada paso (con el valor **nominal** `puntos`). El resultado final es `puntos_nivel`. Así una penalización con saldo 0 tampoco "consume" puntos futuros dentro de la ventana.
  - Ejemplo: +10, −30, +20 → 10 → 0 → **20** (no 0).
- Implementar como funciones SQL `calcular_puntos_nivel(aliado)` y `calcular_puntos_disponibles(aliado)`, con tests del ejemplo anterior.
- En la UI, el historial muestra el valor nominal ("−30 · Información falsa") y, si `puntos_aplicados < puntos`, una nota del tipo "se descontaron 10 porque tu saldo era 10".
- La fecha que cuenta es `movimientos_puntos.fecha`, el momento en que se otorgó.
- La devolución de un canje anulado (`ajuste_admin` con `vinculo = 'canjes'`) no cuenta para `puntos_nivel` (fase 10): el canje no restó puntos de nivel, así que su devolución tampoco los suma.
- Recalcular en un trigger después de cada `INSERT` en `movimientos_puntos` **y** en un cron diario (00:15 Bogotá), porque `puntos_nivel` baja solo con el paso del tiempo.
  - Implementado (fase 3): `interno.recalcular_aliado(aliado)` actualiza saldos, calidad y nivel; el cron `recalcular-puntos-diario` de `pg_cron` (`15 5 * * *` UTC = 00:15 Bogotá) llama a `interno.recalcular_todos()`. La calidad también se recalcula al cambiar `avance_empresa` o al borrar una empresa.

---

## 6. Calidad de referidos y niveles

### 6.1 Calidad por empresa (binaria y ponderada)

```
calidad_empresa = 100 × (0.40·calificado + 0.30·perfecto + 0.20·oportunidad_tecnica + 0.10·integridad_informacion)
```

- Cada variable vale `si = 1` y `no = 0`.
- Si **alguna** de las 4 está en `revision`, `calidad_empresa = NULL` y la empresa **queda excluida** del promedio, para no penalizar lo que está en proceso (decisión del equipo).
- **La calidad se calcula siempre con esta fórmula ponderada**, a partir de las 4 columnas de `avance_empresa` (decisión del equipo). **Nunca** se usa el lead scoring de Clientify para la calidad ni para los niveles: `lead_scoring` se guarda únicamente para mostrarlo en dashboards.

### 6.2 Calidad del aliado

- `calidad_referidos` es el promedio de `calidad_empresa` de todas sus empresas con calidad no nula, **sin ventana de tiempo**: la calidad no se pierde por inactividad.
- Si no hay empresas evaluables, vale `NULL` y cuenta como 0 para los niveles.
- Se recalcula en un trigger cada vez que cambia `avance_empresa`.

### 6.3 Niveles (se evalúan **de arriba hacia abajo**; deben cumplirse puntos **y** calidad)

| Orden | Nivel | `puntos_nivel` ≥ | `calidad_referidos` ≥ |
|---|---|---|---|
| 1 | Círculo Solar | 1000 | 85 % |
| 2 | Diamante | 700 | 80 % |
| 3 | Platino | 450 | 70 % |
| 4 | Oro | 250 | 60 % |
| 5 | Plata | 100 | 50 % |
| 6 | Bronce | 0 | — (cualquier caso restante) |

- Se asigna el **primer** nivel cuyas dos condiciones se cumplan. Ejemplo: 1000 puntos con 60 % de calidad → **Oro**.
- Dicho de otra forma (decisión del equipo): el nivel es el **menor** entre el que dan los puntos y el que da la calidad. Con muchos puntos y baja calidad, manda la calidad; con buena calidad y pocos puntos, mandan los puntos. Nadie queda por fuera.
- Bronce es el nivel por defecto, así que **ningún aliado queda sin nivel.**
- El nivel **no depende de `puntos_disponibles`**. Mucho saldo con baja calidad o sin actividad reciente puede significar Bronce.
- Las recompensas canjeables dependen del nivel **actual**.
- Implementarlo como función SQL pura `calcular_nivel(puntos int, calidad numeric) → nivel`, con **tests** para cada límite: 99/100, 249/250, calidad 49.99/50, etc.

---

## 7. Formularios de leads

### 7.1 "Referir una empresa" (público, sin sesión, formulario **del Hub**)

**Desde oct 2026 (decisión del equipo, rama `correcciones-hub`) el sitio público ya no usa el SuperForm de Clientify:** usa un formulario propio de 2 pasos, igual al de "Nueva oportunidad" (§7.2), que además pide el **email de quien refiere**. Objetivo: que toda empresa referida quede en el Hub relacionada con un aliado (no hay empresas sin aliado).

- **Quién puede referir:** el correo debe ser de un aliado (`rol = 'aliado'`) `activo`, `pendiente` o `suspendido`. Activo: puntos normales; pendiente o suspendido: la empresa se registra y los puntos quedan **retenidos** (§4.7). Si el correo no existe, es de una cuenta rechazada o de un admin, **no se registra**. Solo se acepta el correo (no el celular), decisión del equipo.
- **Mismas reglas del Hub:** campos obligatorios, referido perfecto (10 campos + factura), duplicados, autorreferido, 20 referidos por hora por aliado, declaración Ley 1581 (casilla obligatoria) y +10 / +20 o −5. Entra a Clientify por el **flujo B** (empresa, factura adjunta, contacto con `ID_aliado` y la etiqueta "Referido perfecto" o "Referido imperfecto"; **sin** "aliado del sol hub" ni "aliados del sol", decisión del equipo).
- **Privacidad y abuso (sin sesión):**
  - **Mensaje ambiguo:** un correo que no es de un aliado, una cuenta que no puede referir o un autorreferido responden lo mismo: «Hubo un problema al registrar esta oportunidad. Verifica los datos e intenta de nuevo.» No revela quién es aliado (decisión del equipo; lo mitiga, no lo elimina).
  - **Captcha** («No soy un robot»): Cloudflare Turnstile, gratis y sin rastreo publicitario. Site key pública en `GET /api/config` (`TURNSTILE_SITE_KEY`) y verificación en el servidor con `TURNSTILE_SECRET_KEY`. Sin la clave secreta, en Production el formulario responde 503; en Preview/Development se omite.
  - **Límite por conexión:** 20 intentos por hora (pedir la subida de la factura cuenta como uno), por la huella HMAC-SHA256 de la IP con `SUPABASE_SECRET_KEY`; la IP nunca se guarda (`referidos_publicos_intentos`, una fila por conexión, sin historial).
  - La respuesta trae solo `{ es_perfecto, puntos, clientify }`: nunca el saldo, el nivel ni el código del aliado.
- **Implementación (migración `referido_publico`):**
  - `POST /api/oportunidades/factura` con `{ publico: true, captcha, nombre_archivo, tipo, tamano }`: cuenta el intento, verifica el captcha, da la URL firmada en **`publico/{empresa_id}/{archivo}`** (sin el id del aliado) y crea un permiso de un solo uso de 30 min (`referidos_publicos_permisos`). No pide el correo del aliado, así este paso no revela nada.
  - `POST /api/oportunidades` con `{ publico: true, correo_aliado, captcha?, empresa_id, datos, factura? }`: cuenta el intento; sin factura verifica el captcha; llama a `public.registrar_oportunidad_publica(correo, empresa, datos, factura)`, que exige el permiso si hay factura y usa la misma lógica que el Hub (`interno.registrar_oportunidad_base`, canal `publico`). Errores `referidor_invalido`, `aliado_no_activo` y `autorreferido` → 422 con el mensaje ambiguo; `limite_referidos` → 429 genérico. Sigue siendo **12 funciones** de Vercel.
  - Front: `js/supabase.js` responde `ads:referral-publico { datos, archivo?, correo_aliado }` → `ads:referral-publico-resultado { ok, mensaje?, es_perfecto?, puntos? }`; `js/captcha.js` pinta Turnstile en `[data-captcha-referido]` y lo reinicia tras cada envío.
- `main` tenía el formulario sin lógica (subido a mano sobre una versión vieja de la página); se trajo a `correcciones-hub` sin su pantalla de recuperar contraseña ni su Academy (decisiones del equipo).

**Antiguo formulario de Clientify** (lo que sigue describe el flujo C para los leads que ya existen o que lleguen con `ID_aliado` por otra vía):

- Estaba configurado en Clientify, con sus etiquetas y su proceso.
- Al llenarse, Clientify pone en el **referido** la etiqueta **"aliado del sol hub"** y "referido perfecto" o "referido imperfecto", dispara mensajes de WhatsApp y automatizaciones de n8n. El Hub lee esas etiquetas (el perfecto/imperfecto da +20/−5) pero **no** usa "aliado del sol hub" para reconocer aliados.
- Los datos llegan a Clientify con `ID_aliado`. El Hub se entera por webhook (§8, flujo C):
  - crea la fila en `empresas` con `origen = 'clientify_form'` y en `avance_empresa`;
  - otorga `registro_valido` si `ID_aliado` corresponde a un aliado activo.
- Si `ID_aliado` no existe o viene vacío, se registra en `webhook_eventos` con un error para revisión y no se otorgan puntos.
- **Implementado (fase 6):** `public.clientify_registrar_lead(codigo, contact_id, datos)`. Si el aliado está `pendiente` o `suspendido`, la empresa se crea y el `registro_valido` queda **retenido** hasta que la cuenta vuelva a `activo` (§4.7, decisión del equipo). `perfecto` queda en `revision` y lo define la etiqueta del contacto.

### 7.2 "Nueva oportunidad" (dentro del Hub, con sesión iniciada)

| Campo | Tipo |
|---|---|
| Nombre de la empresa | Obligatorio |
| Sector | Obligatorio |
| Subsector | Perfecto |
| Ciudad | Perfecto |
| Nombre del contacto | Obligatorio |
| Cargo | Perfecto |
| Teléfono | Obligatorio |
| Correo | Obligatorio |
| Valor factura | Obligatorio |
| Observaciones | Opcional |
| Adjuntar factura | Perfecto |

- El `aliado_id` se toma de la **sesión**. Nunca se toma de un campo del formulario.
- Incluir una casilla: "Declaro que cuento con autorización del contacto para compartir sus datos con GEENERA" (Ley 1581).

**Flujo:** `POST /api/oportunidades`.

1. Valida la sesión y los campos.
2. Sube la factura a Storage, si hay.
3. Inserta en `empresas` (calcula `es_perfecto`), `facturas` y `avance_empresa` (`perfecto` inicial).
4. Otorga `registro_valido` y `referido_perfecto` o `referido_imperfecto`.
5. Envía a Clientify (§8, flujo B).
6. Responde al front.

**Implementación (fase 5):**
- `POST /api/oportunidades/factura` `{ nombre_archivo, tipo, tamano }` valida tipo y tamaño y devuelve `{ empresa_id, ruta, token }`: una URL firmada de subida de un solo uso en `{aliado_id}/{empresa_id}/{archivo}`. El navegador sube directo a Storage (`uploadToSignedUrl`) porque Vercel limita el cuerpo de las funciones a 4,5 MB.
- `POST /api/oportunidades` `{ empresa_id, datos, factura? }` toma el aliado del token (`lib/sesion.js`, exige `activo`) y llama a `public.registrar_oportunidad`, que en **una transacción** bloquea al aliado, aplica el **límite de 20 referidos por hora**, valida campos (correo, teléfono E.164 con la regla de Colombia, valor > 0, declaración Ley 1581), rechaza el **autorreferido** (mismo correo o celular del aliado) y los **duplicados**, verifica que la factura exista en el bucket dentro de la carpeta del aliado y de esa empresa, calcula `es_perfecto`, inserta `empresas`, `facturas` y `avance_empresa` y otorga los puntos. Los errores llevan un prefijo estable (`aliado_no_activo`, `limite_referidos`, `referido_duplicado`, `autorreferido`, `oportunidad_invalida`, `factura_invalida`) que el endpoint traduce a 403/429/409/422. Si el registro falla, se borra la factura subida.
- Después intenta el flujo B en el momento (mejor esfuerzo); si Clientify falla, queda en la cola. Responde `201 { es_perfecto, movimientos, puntos_disponibles, puntos_nivel, nivel, clientify: 'ok' | 'pendiente' }`.
- En el front, el formulario "Referir" emite `ads:referral { datos, archivo }` y `js/supabase.js` responde `ads:referral-resultado`; la pantalla final muestra los puntos que confirmó el servidor.

---

## 8. Integración con Clientify

Autenticación con API key (`Authorization: Token ...`) en `CLIENTIFY_API_KEY`. Consulta la documentación oficial en https://developer.clientify.com/ antes de implementar cada llamada.

### Flujo A — Aliado aprobado → Clientify

Cuando GEENERA aprueba al aliado (`estado` pasa de `pendiente` a `activo`), no al registrarse:

1. Crear el contacto con la etiqueta de aliado (**"aliados del sol"**; **"aliado del sol hub"** si el tipo es Cliente Embajador, decisión del equipo), la etiqueta de tipo, el campo `ID_aliado = codigo_aliado` y el **Tipo** del contacto = **"Aliados Estratégicos"** (con tilde; campo nativo `contact_type` de la API, columna "tipo" al exportar; confirmado con el diagnóstico). Es el mismo valor para los cinco tipos de aliado y sirve para filtrar los flujos de Clientify (p. ej. el aviso de cuenta activa). **No es el `tipo_aliado` del Hub**, que no cambia y sigue definiendo la etiqueta «AdS …». Los referidos (flujo B) no llevan este Tipo (decisión del equipo, `correcciones-hub`).
2. Guardar `clientify_contact_id`.
3. Si falla, dejar `pendiente` y reintentar con un cron cada 15 min con backoff.

Cuando el aliado edita su perfil, también se replica en Clientify.

**Las cuentas de admin no se sincronizan** (decisión del equipo, fase 10): al volverse admin, `clientify_sync_estado = 'excluido'` (trigger `aliados_exclusion_clientify`), la cola del flujo A nunca las reclama y un resultado en curso no las saca de `excluido`. Si una cuenta deja de ser admin, vuelve a `pendiente` y entra a la cola.

**Implementación (fase 4):**
- Cola en la base: `public.clientify_reclamar_aliados(limite)` toma aliados `activo` con `clientify_sync_estado` `pendiente`/`error` cuya espera se cumplió (con préstamo de 10 min y `SKIP LOCKED`); `public.clientify_registrar_resultado(aliado, contact_id, error)` guarda el éxito o programa el reintento (15 min, 30, 1 h… máximo 24 h; columnas `clientify_sync_intentos`, `clientify_sync_proximo_at`, `clientify_sync_at`). Solo `service_role` puede ejecutarlas.
- Cambiar nombre, correo, celular, regional, tipo, organización o cargo de un aliado ya sincronizado lo vuelve a marcar `pendiente`.
- `GET|POST /api/cron/clientify` procesa un lote de aliados (flujo A), otro de oportunidades (flujo B) y otro de eventos de Clientify (flujo C) en un presupuesto de 40 s; se protege con `Authorization: Bearer <CRON_SECRET>`. `/api/cron/clientify-aliados` queda como alias para no romper la URL ya guardada en el Vault (se recomienda actualizar `clientify_sync_url` a `/api/cron/clientify`).
- **Programación (independiente del plan de Vercel):** el job `sincronizar-clientify-aliados` de `pg_cron` llama al endpoint **cada 2 minutos** (desde la fase 6, para procesar los webhooks) con `pg_net`, usando la URL y el `CRON_SECRET` guardados en el **Vault** de cada proyecto de Supabase (`clientify_sync_url`, `cron_secret` y, si el despliegue tiene Deployment Protection, `vercel_bypass_secret`). Sin esos secretos el job no hace nada. Además, `vercel.json` declara un Vercel Cron **diario** (`0 7 * * *` UTC = 02:00 Bogotá) a `/api/cron/clientify-conciliacion`, que concilia y procesa las colas (respaldo compatible con el plan Hobby). `interno.invocar_cron_hub('<endpoint>')` llama a otro `/api/cron/*` del despliegue guardado en el Vault (p. ej. el diagnóstico).
- Código: `lib/clientify/mapeo.js` (nombres de Clientify), `lib/clientify/cliente.js` (HTTP), `lib/clientify/aliados.js` (flujo A), `lib/clientify/empresas.js` (flujo B) y `lib/clientify/cola.js` (procesamiento de ambas colas). Si ya existe un contacto con el mismo correo (p. ej. un cliente que se vuelve Cliente Embajador), **se vincula sin pisar sus datos**: solo se agregan `ID_aliado` y las etiquetas, y su Tipo pasa a "Aliados Estratégicos" aunque tuviera otro (decisión del equipo).
- Fuera de Production (`VERCEL_ENV` ≠ `production`) se agrega `PRUEBA HUB` y **solo se sincronizan correos con `+prueba`**; los demás quedan en `error` sin llamar a Clientify.

### Flujo B — Nueva oportunidad (Hub) → Clientify

1. Crear el contacto (y la empresa, si aplica) con el campo personalizado `ID_aliado = codigo_aliado`.
2. Poner la etiqueta **"Referido perfecto"** o **"Referido imperfecto"** según `es_perfecto`, para que Clientify continúe su proceso existente. El contacto entra con el Status inicial que use su flujo actual.
3. La factura queda en la **ficha de la empresa** en Clientify como un **enlace privado de descarga de 180 días** en su descripción (decisión del equipo, oct 2026: la API de Clientify no permite subir archivos, lo confirmó su soporte). **El equipo no debe copiar ni compartir el enlace:** descarga la factura y la guarda con el cuidado que exige la política de datos.
4. Guardar el **`ID` nativo del contacto** que devuelve Clientify en `clientify_contact_id`. Es el mismo "ID" que aparece al exportar leads, y no se necesita crear ningún campo adicional. La oportunidad la crea el equipo comercial más adelante; su id se captura por webhook.

**Implementación (fase 5):**
- La empresa **siempre** se crea (o se reutiliza si ya existe con el mismo nombre; una que ya existía no se modifica, salvo agregar el enlace de la factura al final de su descripción). La nueva lleva `company_sector` (sector / subsector), la ciudad en `addresses` (`country: 'co'`) y el resumen del referido en `description`.
- El contacto se vincula por el **nombre** de la empresa (`company` es texto: con la URL de la empresa, Clientify creaba otra empresa llamada como la URL, hallado en la prueba real). Lleva `ID_aliado`, la etiqueta de perfecto/imperfecto, `contact_sector`, la ciudad y los campos del antiguo formulario («Subsector Economico» y «Valor pagado en factura (COP / mes)»). Si Clientify rechaza la dirección o el sector (400), se crea sin ellos.
- Orden: empresa → contacto → enlace de la factura. La factura va al final: en la primera prueba real (oct 2026) Clientify respondió 403 al adjuntarla y, con el orden anterior, el contacto nunca se creaba. El enlace es una URL firmada de Storage con descarga forzada (`enlazadorDeFacturas` en `cola.js`); el párrafo se marca con «Factura de energía del referido» para no repetirlo en un reintento. Cada paso se guarda aunque el siguiente falle (`clientify_company_id`, `clientify_contact_id`, `facturas.clientify_subida_at`), así el reintento no duplica nada. El diagnóstico `/api/cron/clientify-diagnostico?archivos=<id de empresa>&contacto=<id>` (solo GET/OPTIONS) muestra los campos que aceptan contactos y empresas.
- Si el contacto ya existe en Clientify sin `ID_aliado`, se vincula a la empresa y recibe `ID_aliado` y etiquetas; si ya tiene **otro** `ID_aliado`, no se cambia la atribución: queda en `error` para revisión del equipo.
- Cola en la base: `public.clientify_reclamar_empresas(limite, empresa)` y `public.clientify_registrar_resultado_empresa(...)`, con el mismo préstamo y backoff del flujo A; solo `service_role`. Las procesa el mismo cron `/api/cron/clientify`.
- Fuera de Production aplica la misma regla: `PRUEBA HUB` y solo contactos con `+prueba` en el correo.
- *Confirmado con la API real (5 oct 2026, referidos de prueba perfecto e imperfecto):* `custom_fields` como `{field, value}`; `company` del contacto como nombre, que Clientify vincula a la empresa ya creada por el Hub (sin duplicarla); `addresses` como `[{ city, country: 'co' }]`; y que no se pueden subir archivos (por eso el enlace).

**Evitar duplicados:** Clientify también dispara el webhook de "contacto creado" para este lead, y puede llegar **antes** de que el Hub guarde el `ID`. Por eso:

- el procesamiento de un contacto nuevo con `ID_aliado` se **difiere unos 2 minutos**;
- antes de crear una empresa nueva, se busca una fila existente por `clientify_contact_id` **o** por (`aliado_id` + `correo` del contacto, creada en las últimas 24 h y sin `clientify_contact_id`);
- si existe, se vincula y actualiza: no se crea otra fila ni se otorga un segundo `registro_valido`.

### Flujo C — Clientify → Supabase (webhook)

- Configuración en Clientify: *Configuración > Integraciones > Webhooks*, eventos de crear, actualizar y eliminar para **contactos y oportunidades**.
  - **Estado real:** solo el webhook de **oportunidades** apunta al Hub. El de contactos alimenta un flujo de **n8n** y no se cambia (decisión del equipo). Por eso los cambios de Status y etiquetas de los referidos llegan con la conciliación horaria o con cualquier evento de su oportunidad, y un lead del formulario público se descubre cuando se le crea una oportunidad (ver "Pendiente" en la implementación).
  - Formato confirmado con los primeros eventos: `{ "hook": { "id", "event": "deal.saved", "target" }, "data": { "id", … } }`.
- Destino: `POST /api/webhooks/clientify?token=<CLIENTIFY_WEBHOOK_SECRET>`.

Pasos:

1. Validar el token (comparación en tiempo constante) y guardar el payload crudo en `webhook_eventos`.
2. Responder `200` rápido y procesar después.
3. **Volver a consultar** la entidad en la API de Clientify para obtener su estado completo y actual, en vez de confiar solo en el payload.
4. Resolver la empresa:
   - por el `ID` del contacto (`clientify_contact_id`);
   - en el caso de oportunidades, por el contacto vinculado a la oportunidad, guardando `clientify_deal_id`;
   - en el caso de leads nuevos del formulario público, por `ID_aliado`, aplicando la deduplicación del flujo B.
5. Mapear los campos de Clientify a `avance_empresa` (tabla de mapeo abajo) y hacer el upsert.
6. Por cada variable que pasó de `revision` a `si` o `no`, insertar el movimiento con su `clave_unica`. Luego recalcular la calidad, los saldos, el nivel y la racha.
7. Marcar `procesado_at` o `error`.

**Implementación (fase 6):**
- `POST /api/webhooks/clientify?token=…` (o con el encabezado `x-webhook-token`, pensado para n8n) valida `CLIENTIFY_WEBHOOK_SECRET` en tiempo constante, interpreta el evento (`interpretarWebhook` en `mapeo.js`) y llama a `public.webhook_clientify_recibir`, que guarda el evento y encola la entidad. Responde 200 sin procesar (500 si no pudo guardar, para que Clientify reintente). Un contacto **creado** espera 2 minutos.
- El cron (cada 2 min) toma la cola (`clientify_reclamar_entidades`, préstamo de 5 min y `SKIP LOCKED`) y, por entidad (`lib/clientify/webhook.js`):
  1. vuelve a consultar el contacto (una oportunidad se resuelve a su contacto) y las oportunidades candidatas: la del evento (o del escaneo) y la ya guardada en `clientify_deal_id`. Se queda con las vinculadas a ese contacto y de un embudo del programa, y usa la más avanzada. **La API no filtra oportunidades por contacto** (`/deals/?contact=` devuelve todas, confirmado con el diagnóstico);
  2. resuelve la empresa por `clientify_contact_id`; si no existe y el contacto tiene `ID_aliado`, es un lead del formulario (§7.1). Se ignoran sin error el contacto de un aliado (se reconoce por `aliados.clientify_contact_id`; las etiquetas "aliado del sol hub" / "aliados del sol" **no** sirven porque el formulario las pone en los referidos) y los contactos sin `ID_aliado`. Si el correo del lead es el del propio aliado, se rechaza como `autorreferido`. Fuera de Production se ignoran los correos sin `+prueba`; en Production, los contactos con `PRUEBA HUB`;
  3. deriva con `derivarAvance` (`lib/clientify/avance.js`) y aplica con `public.aplicar_avance_clientify(empresa, crudos, variables, deal_id)`, que en una transacción guarda los datos crudos, pasa de `revision` a definitivo, registra conflictos y luego inserta los movimientos en el orden de esta sección.
  4. `clientify_resultado_entidad` cierra los eventos (con sus avisos) o programa el reintento (2 min, 4, 8… máximo 6 h).
- **Conciliación (cada hora, minuto 7, job `conciliar-clientify`, y a las 02:00 por Vercel Cron):** `/api/cron/clientify-conciliacion` encola los contactos de las empresas que siguen en curso (`negocio_cerrado <> 'si'`) con `public.clientify_encolar_conciliacion()`, **escanea todas las oportunidades** (páginas de 100) y encola las de contactos referidos que son nuevas con más hitos que los alcanzados o que son la guardada y cambiaron de fase o estado, y procesa las colas. Así los cambios del contacto llegan con máximo 1 h de retraso aunque su webhook no apunte al Hub.
- **Referidos cerrados, una vez al día** (decisión del equipo, oct 2026; migración `conciliacion_cerrados`): la corrida de la **hora 2 de Bogotá** (la de Vercel Cron a las 02:00 y la horaria de las 02:07) llama a `clientify_encolar_conciliacion(true)` y encola **también** los referidos con `negocio_cerrado = 'si'`. Así se detectan los cambios que solo tocan el contacto de un referido ya cerrado (una etiqueta de información falsa, un retroceso de Status que genera conflicto), que el resto del día no se ven porque su oportunidad ya no se mueve. El retraso máximo para esos casos es de 1 día; para los referidos en curso sigue siendo de 1 h. `horaBogota` e `incluirCerrados` viven en el endpoint, y `?cerrados=1` lo fuerza en una corrida manual. La función sin parámetro se conserva y llama a la nueva con `false`.
- **Reenvío desde n8n (plan acordado para los leads del formulario):** el webhook de contactos de Clientify va a n8n. En ese flujo se agrega una rama que, si el contacto tiene la etiqueta "aliado del sol hub" o "aliados del sol" (o el campo `ID_aliado`), hace `POST` a `/api/webhooks/clientify` con el encabezado `x-webhook-token` y un cuerpo mínimo `{"hook": {"event": "contact.created"}, "data": {"id": <ID del contacto>}}` (el Hub vuelve a consultar Clientify; no hace falta enviar datos personales). La rama no debe bloquear el resto del flujo (continuar si falla). Mientras no exista, un lead del formulario que nunca tenga oportunidad no se descubre.
- Lo ignorado (contactos u oportunidades ajenos al programa) se procesa sin error y su payload se borra (`clientify_resultado_entidad(..., p_descartar => true)`).
- **Diagnóstico:** `/api/cron/clientify-diagnostico` (con `CRON_SECRET`) devuelve solo nombres y estructura, sin datos personales: campos personalizados, etiquetas (paginadas), embudos, fases, los valores de Status en uso, la forma de contactos y oportunidades y la estructura de los últimos webhooks. Sirve para confirmar el mapeo y responder §14 (preguntas 1 y 2). Se llama con `select interno.invocar_cron_hub('clientify-diagnostico');`.

**Conciliación nocturna** (Vercel Cron, 02:00 Bogotá): es la misma conciliación horaria descrita arriba (vuelve a encolar los referidos en curso, escanea todas las oportunidades y procesa las colas), como respaldo si `pg_cron` falla. El proceso es idempotente, así que repetirlo es inofensivo y cubre los webhooks perdidos.

### Mapeo Clientify → `avance_empresa` (decisión del equipo)

Clientify **no** tiene campos SI / NO / REVISION. Las variables se **derivan** en el Hub a partir de cuatro fuentes nativas de Clientify:

1. el **Status/Estado del contacto**;
2. la **fase de la oportunidad** (en *Ventas > Oportunidades*);
3. **etiquetas**;
4. algunos campos.

Supabase guarda el dato crudo (`estado_contacto_clientify`, `fase_oportunidad`…) **y** la variable derivada.

**Identificadores**

| Supabase | Clientify |
|---|---|
| `aliados.codigo_aliado` | Campo personalizado `ID_aliado` (ya existe) |
| `empresas.clientify_contact_id` | `ID` nativo del contacto (visible al exportar) |
| `empresas.clientify_deal_id` | `ID` nativo de la oportunidad vinculada |

**A. Status del contacto → `calificado`**

| Status en Clientify (interfaz) | Código en la API | `calificado` |
|---|---|---|
| 0. lead no calificado | `other` | `no` |
| 3. lead caliente | `hot-lead` | `si` |
| 4. en oportunidad | `in-deal` | `si` (superó "caliente") |
| 5. cliente | `client` | `si` (superó "caliente") |
| 1. lead frío, 2. lead templado | `cold-lead`, `warm-lead` | `revision` |
| 0. contacto alternativo | `not-qualified-lead` | `revision` |
| 0. lead verificado | `visitor` | `revision` |
| 0. lead perdido | `lost-lead` | `revision` (decisión del equipo) |
| 0. cliente perdido | `lost-client` | sin cambio (ya fue `si`) |

La API devuelve solo el **código** del Status, no su nombre; se aceptan el código y el nombre. **Los códigos de los «0.» se calibraron con contactos de prueba reales (5 oct 2026)** y no coinciden con su sentido en inglés: en la cuenta de GEENERA «0. lead no calificado» es `other` y «0. contacto alternativo» es `not-qualified-lead` (la tabla anterior los tenía invertidos y el «no calificado» nunca restaba). Si el equipo crea, renombra o reordena un Status en Clientify, hay que volver a calibrar: poner un contacto de prueba en cada Status y leerlo con `/api/cron/clientify-diagnostico?referido=<id del contacto>`.

Comparar los textos normalizados (minúsculas, sin tildes, `trim`). El mapeo vive en `lib/clientify/mapeo.ts` para que pueda ajustarse si Clientify cambia los nombres.

**B. Fase de la oportunidad → avance comercial**

**Cuentan todos los embudos de proyectos** (decisión del equipo): GEENERA AUTOCONSUMO, OFF GRID, MINIGRANJAS, Care y los que se creen. Cada embudo numera distinto (en OFF GRID el diseño es la 2 y existe una 8; MINIGRANJAS y Care no tienen número), así que los hitos se identifican por el **nombre de la fase** (sin el número) y la **posición** de la fase dentro de su embudo, con el catálogo `/deals/pipelines/stages/` (`HITOS_FASE` en `mapeo.js`, `construirCatalogoFases` y `hitosDeOportunidad` en `avance.js`):

| Hito | Fase (por nombre) | Regla |
|---|---|---|
| `oportunidad_tecnica` | "Diseño" | la fase de la oportunidad está en la posición de "Diseño" o después |
| `propuesta_comercial` | "Presentación de oferta" | ídem |
| `negocio_cerrado` | "Contrato" | ídem |

Un embudo sin esas fases (p. ej. GEENERA_ADS, de eventos, o "Por defecto") no genera puntos de avance. Una fase que no está en el catálogo → `revision` y aviso. Las filas de abajo son las de GEENERA AUTOCONSUMO. El estado de la oportunidad se lee de `status_desc`: Open → abierta, Won → ganada, Lost y Expired → perdida.

**Fases del pipeline** (la 8 no existe):

| Núm. | Fase |
|---|---|
| 1 | Diseña tu proyecto |
| 2 | Agendamiento visita técnica |
| 3 | Diseño |
| 4 | Modelamiento de PPA |
| 5 | Asignación de presentación |
| 6 | Presentación de oferta |
| 7 | Interesado No ahora |
| 9 | Financiación |
| 10 | Contrato |

El número del prefijo de la fase (`"3. Diseño"` → 3) se guarda en `fase_oportunidad_num`. Se usa **mayor o igual**, porque una oportunidad puede saltarse fases o el webhook de una fase intermedia puede perderse. Una oportunidad en `7. Interesado No ahora` ya pasó por la presentación de oferta, así que cuenta como `propuesta_comercial = si` y recibe los +50 (decisión del equipo).

| Variable | Regla | Puntos |
|---|---|---|
| `oportunidad_tecnica` | `si` si la fase es "Diseño" o posterior (en AUTOCONSUMO, `fase_num >= 3`). `no` si `calificado = no`, o si la oportunidad se pierde antes del diseño. En otro caso, `revision`. | +30 al pasar a `si` |
| `propuesta_comercial` | `si` si la fase es "Presentación de oferta" o posterior (en AUTOCONSUMO, `>= 6`). En otro caso, `revision`. | +50 |
| `negocio_cerrado` | `si` si la fase es "Contrato" (en AUTOCONSUMO, la 10). En otro caso, `revision`. | +150 |

- Si pasan varias fases de golpe (por ejemplo de 2 a 6), se otorgan en el mismo proceso todos los movimientos pendientes (+30 y +50), cada uno con su clave única.
- Si una empresa referida tiene **varias oportunidades**, se usa **siempre la más avanzada** (decisión del equipo): la que alcanzó más hitos y, a igualdad, la de fase posterior, aunque sean de embudos distintos. `clientify_deal_id` guarda la de esa oportunidad.

**C. Variables derivadas**

| Variable | Regla |
|---|---|
| `integridad_informacion` | `no` si `calificado = no`; `si` si `calificado = si`; `revision` en otro caso |
| `perfecto` | Etiqueta `Referido perfecto` → `si`; `Referido imperfecto` → `no`; sin etiqueta → `revision` |
| `fuera_perfil` | `si` si `calificado = no` **y** `perfecto = si`; `no` si `calificado` es definitivo y no se cumple lo anterior; `revision` en otro caso (ver §5, aclaraciones) |
| `informacion_falsa` | `si` si el contacto tiene **cualquiera** de las etiquetas "fraude", "no existe" o "información de contacto errónea" (decisión del equipo: se aplican a casos distintos); `revision` si no tiene ninguna |

**D. Datos numéricos para dashboards**

| Supabase | Clientify |
|---|---|
| `lead_scoring` | Lead scoring nativo del contacto |
| `potencia_instalada_kwp` | Campo personalizado de la oportunidad **"Potencia (kWp)"** (confirmado con el diagnóstico) |
| `valor_cotizado` | **Suma del "Importe"** (`amount`) de **todas** las oportunidades de proyectos del referido (decisión del equipo) |
| `valor_oportunidad` (pipeline originado) | **Suma del "Importe"** solo de las oportunidades que se cierran y se llevan a cabo: ganadas o en "Contrato" (decisión del equipo; separa cotizaciones de cierres) |
| `potencia_instalada_kwp` (suma) | Suma de la "Potencia (kWp)" de esas mismas oportunidades cerradas |
| `estado_oportunidad` | Estado nativo de la oportunidad: abierta, ganada o perdida |

**Reglas de implementación:**

- Todo el mapeo (textos de Status, fases, etiquetas, nombres de campos) vive en **un solo archivo**, `lib/clientify/mapeo.ts`. Ninguna otra parte del código usa nombres de Clientify directamente.
- La derivación es una **función pura** `derivarAvance(datosClientify) → avance`, con tests para cada fila de las tablas A, B y C.
- Un Status o una fase desconocidos → `revision`, más un error en `webhook_eventos`. Nunca deben generar puntos.
- Los valores definitivos siguen la regla de §5.1: solo el primer valor definitivo genera puntos. Si Clientify retrocede un estado (por ejemplo de caliente a no calificado), se registra y lo resuelve un admin.
- **Orden de proceso por evento:**
  1. actualizar los datos crudos;
  2. derivar las variables;
  3. insertar los movimientos, en orden: calificado → perfecto → fuera_perfil → oportunidad_tecnica → propuesta → cierre → información falsa;
  4. actualizar la racha;
  5. recalcular la calidad, los saldos y el nivel.
- **Valor efectivo en las derivadas:** `fuera_perfil`, `integridad_informacion` y `oportunidad_tecnica = no` usan el valor vigente del Hub si ya es definitivo (p. ej. el `perfecto` de un referido del Hub); si no, el de Clientify. Con `calificado = no` y `perfecto` aún en `revision`, `fuera_perfil` queda en `revision`.
- **Confirmado con el diagnóstico (fase 6):** estructura de contactos y oportunidades, códigos de Status, `status_desc`, `pipeline_desc`, `pipeline_stage_desc`, `amount`, `custom_fields` como `{field, value}`, etiquetas en minúscula (se comparan sin distinguir mayúsculas) y los campos del contacto que usa el formulario público ("Valor pagado en factura (COP / mes)", "Subsector Economico", ciudad en `addresses`). El lead scoring no viene en la **lista** de contactos; sí en la ficha completa (`/contacts/{id}/`, `lead_scoring`, visto en oct 2026), igual que `contact_type`.
- Los tres valores de la tabla D se calculan en el **escaneo horario** (`valoresDelReferido` en `avance.js`, `public.clientify_actualizar_valores`), porque es el único que ve todas las oportunidades de cada contacto; un evento suelto solo actualiza fase y estado. Si el escaneo no alcanzó a ver todas las oportunidades (más de 10 000), no borra valores.
- **Racha:** `aplicar_avance_clientify` guarda `fecha_calificado` y el movimiento `empresa_calificada` actualiza la racha con esa fecha (trigger `movimientos_puntos_racha`, fase 7; §5.2).

---

## 9. Dashboard por tipo de aliado

Todos ven un saludo con su **nombre completo**, su `codigo_aliado` (copiable, para compartir), sus Puntos Sol y su nivel.

| Tipo | Contenido principal |
|---|---|
| **EMI, Linker, Cliente Embajador** | Puntos de nivel, puntos disponibles, nivel y progreso al siguiente (puntos **y** calidad faltantes), Racha Solar 4x4, calidad de referidos, historial de movimientos filtrable (semana, mes, trimestre), módulos y recompensas pendientes, lista de referidos con su estado |
| **Financieros** | Potencia instalada (kWp), pipeline originado (millones COP), oportunidades referidas, empresas calificadas, valor cotizado. Sale de `avance_empresa` sincronizado desde Clientify. También ven sus puntos y su nivel (decisión del equipo). |
| **Agremiaciones** | Distribución regional de sus referidos (por la ciudad de la empresa referida, decisión del equipo) y calidad de referidos. |

Botón **"Nueva oportunidad"** (§7.2) para todos los tipos.

**Implementado (fase 8):**
- `js/supabase.js` carga las vistas del §4.12 al entrar, después de un referido y al completar un módulo, y emite `ads:dashboard { ok, aliado, movimientos, referidos, modulos, eventos, canjes, recompensas }`; la página lo pide con `ads:consultar-dashboard`.
- En `index.html` (y su fuente en `src/`), con sesión todas las pantallas usan esos datos; sin sesión se sigue viendo la demostración. Las funciones `referidoComoOpp`, `referidoComoCartera` y `movimientoComoHistorial` convierten las vistas a las formas de las constantes de demostración, así el diseño no cambia.
- La vista la define `tipo_aliado` y se ocultan el selector de rol y las vistas de demostración: EMI, Linker y Cliente Embajador ven el dashboard de aliado; Financieros y Agremiaciones, el de gestión (solo sus referidos), también con su nivel, puntos y código.
- El nivel es el de la base (puntos **y** calidad, §6.3); el Hub no muestra los requisitos de calidad por nivel (decisión del equipo).
- La calidad se muestra desde la **primera empresa evaluada** (`QUALITY_CONFIG.minSample = 1`, decisión del equipo, oct 2026; la demostración pedía 5 y el Hub decía «Calidad en construcción» aunque el nivel ya la usaba). «En construcción» solo aparece si no hay ninguna empresa evaluada.
- El historial se filtra por tipo y por semana, mes y trimestre (hora Bogotá), con la nota de descuento parcial del §5.4.
- Agremiaciones: la distribución regional agrupa por la ciudad de la empresa referida.
- Secciones sin datos reales todavía (Beneficios sin catálogo y Comisiones) conservan los datos de demostración con la etiqueta **"Demostración"**.
- **Serie «COP cotizados y kWp» con datos reales** (decisión del equipo, oct 2026; importante para los bancos): `serieReal()` en la página. Cada referido cuenta **una vez**: su `valor_cotizado` en el mes de `fecha_propuesta` (llegó a «Presentación de oferta») y su potencia en el mes de `fecha_cierre` (llegó a «Contrato»). Clientify no da la fecha de cambio de fase; el Hub usa la de su propio movimiento de puntos. «Mes» = semanas del mes en curso; Trimestre, Semestre y Año = últimos 3, 6 y 12 meses; todo en hora Bogotá. Un referido que ya había pasado esas fases antes del Hub cae en el mes en que el Hub lo registró: la nota desplegable «¿De qué mes es cada valor?» lo explica a los aliados antiguos.
- **Con sesión no se muestran** «Próximos desembolsos 30/60/90» (Financieros) ni «Distribución por ejecutivo GEENERA» (Agremiaciones): Clientify no da fechas de desembolso y el Hub no guarda el ejecutivo de cada oportunidad (decisión del equipo, oct 2026). Siguen en la demostración sin sesión. La distribución **por regional** sí es real y se mantiene. Por lo mismo, con sesión la tabla «Mis referidos» no tiene la columna «Ejecutivo GEENERA» ni el texto «Cada oportunidad muestra quién la gestiona en GEENERA» (`refCols`, `refMinW`).
- **Financiación Solar** no aparece para los aliados **Financieros** en ninguna parte del Hub (decisión del equipo, oct 2026): ni la tarjeta de Herramientas, ni su pantalla (`go('financiacion')` lleva a Herramientas), ni la ruta `r4` de la Academy (`RUTA_FINANCIACION`, `rutasAcademy()`). Se decide con `sinFinanciacion()` (rol `orgType = 'banco'` dentro de las rutas del Hub); los demás tipos y el sitio público la siguen viendo.
- **Beneficios y canjes (fase 10):** si hay recompensas activas en el catálogo (`v_recompensas`), reemplazan las de demostración y se agrupan por su categoría; cada tarjeta muestra si está disponible, cuántos puntos faltan o qué nivel exige. El canje lo confirma el proveedor (§4.10), así que el Hub solo informa. Sin catálogo real se siguen viendo las de demostración con la etiqueta "Demostración". "Mis canjes" (`v_mis_canjes`) muestra cada canje con su estado y, si se anuló, el motivo. El historial tiene el filtro "Canjes" y un canje no cuenta como "Perdido".
- **Canje con QR (fase 11):** «Mi QR para canjear» en el menú, la banda «Canjea con tu QR» en Beneficios y «Canjear con mi QR» en cada recompensa disponible (§4.10). «Mis canjes» marca los hechos con QR.
- **Datos al día sin recargar:** al volver a la pestaña o a la app, y cada 2 min con la página visible, `js/supabase.js` recarga el dashboard (máximo cada 30 s); así se ven, por ejemplo, la anulación de un canje o los avances de Clientify.
- **Celular:** con tema claro todo el fondo es claro. Bajo **860 px** el menú lateral se oculta y se abre con **«☰ Menú»** como panel sobre el contenido (se cierra al navegar, al referir, al abrir «Mi QR» o al tocar fuera) y el buscador del encabezado se oculta; las tablas anchas se desplazan dentro de su recuadro, así que la página ya no se mueve hacia los lados (rama `correcciones-hub`). En escritorio no cambia nada. El sitio público también cabe en 390 px.
- **Academy:** los puntos de cada curso salen de `v_mis_modulos`. Al terminar la última lección se llama a `POST /api/modulos { codigo }`, que toma el aliado del token, exige cuenta activa y ejecuta `public.completar_modulo`; responde `{ codigo, nuevo, puntos, recompensa_estado, puntos_disponibles, puntos_nivel, nivel }`. En la base solo queda el curso completado; el avance por lección vive en el navegador (`localStorage`, clave `ads-aca-{codigo_aliado}`).

---

## 10. Seguridad

- **RLS activado en todas las tablas.**
  - El aliado solo puede **leer** sus propias filas (`aliado_id = auth.uid()`).
  - Las **escrituras** de puntos, avance, eventos, canjes y sincronización se hacen solo desde el servidor con `SUPABASE_SECRET_KEY` (nunca en el cliente), o con funciones `SECURITY DEFINER` controladas.
- Rol `admin` (equipo GEENERA) para validar eventos, registrar baja calidad reiterada, hacer ajustes y resolver conflictos. Las acciones de admin quedan auditadas en `creado_por`.

**Panel de administración (fase 9):**
- Página separada `admin.html` + `js/admin.js` (el Hub no se toca). Usa la misma sesión de Supabase; solo entra una cuenta con `rol = 'admin'` y `estado = 'activo'` (las demás ven "Sin acceso"). Pestañas: Resumen, Solicitudes, Aliados (historial, ajustes, baja calidad, suspender/reactivar), Eventos, Conflictos de Clientify, Canjes (anular) y Recompensas (crear y editar el catálogo; fase 10) y Auditoría.
- Un admin puede leer todas las filas de `aliados` (RLS), así que el front siempre lee la fila propia filtrando por el usuario de la sesión (`.eq('id', session.user.id)`), sin seleccionar ni mostrar el `id`.
- **Lecturas:** vistas `v_admin_resumen`, `v_admin_aliados`, `v_admin_movimientos`, `v_admin_eventos`, `v_admin_conflictos`, `v_admin_acciones`, `v_admin_canjes`, `v_admin_recompensas` (`security_invoker` y `where es_admin()`: un aliado no ve filas; ninguna expone `aliados.id`, los admins aparecen por su `codigo_aliado`).
- **Escrituras:** un solo endpoint `POST /api/admin { accion, ... }` (acciones `aprobar`, `rechazar`, `suspender`, `reactivar`, `ajuste`, `baja_calidad`, `validar_evento`, `rechazar_evento`, `resolver_conflicto`, `anular_canje`, `guardar_recompensa`, `invitar_operador`, `estado_operador`, `eliminar_operador` (fase 11) y `archivo_evento`, que da una URL firmada de 5 min). Toma al admin del token (`adminDeLaSesion` en `lib/sesion.js`) y llama a `public.admin_*` (solo `service_role`), que vuelven a verificar al admin con `interno.exigir_admin`, identifican al aliado por `codigo_aliado` y registran la acción en **`acciones_admin`** (solo inserción). Errores con prefijo estable: `no_autorizado`, `no_permitido`, `aliado_inexistente`, `evento_inexistente`, `conflicto_inexistente`, `canje_inexistente`, `recompensa_inexistente`, `operador_inexistente`, `estado_invalido`, `dato_invalido`, `evento_incompleto`.
- **Reglas:** rechazar, suspender y reactivar exigen motivo; un admin no se suspende a sí mismo ni a otro admin; el ajuste exige justificación (mín. 10 caracteres), va de ±1 a ±5000, respeta el piso en 0 y usa una clave que genera el panel (un doble clic no lo duplica); la baja calidad reiterada es −20 y máximo una por aliado y día; resolver un conflicto exige nota y puede aceptar el valor de Clientify en `avance_empresa` (cambia la calidad, no los puntos) y registrar un ajuste en la misma transacción.
- **El panel no cambia roles** (decisión del equipo). Un admin se asigna por SQL, después de que la persona se registre en el Hub y confirme su correo:
  ```sql
  update public.aliados set rol = 'admin', estado = 'activo', aprobado_at = coalesce(aprobado_at, now())
  where lower(correo) = '<correo>';
  ```
- **Registro de canjes (fase 11):** página separada `canje.html` para operadores y admins (§4.10). Las funciones del QR son las únicas que el navegador llama directamente con su sesión; cada una verifica al usuario.
- Funciones de Vercel: con `/api/admin`, `/api/eventos` y `/api/canjes` son **12, el máximo del plan Hobby** (la fase 11 no agregó ninguna). Un endpoint nuevo exige unir funciones o pasar a Pro (el equipo planea pasar Vercel y Supabase a Pro; hoy Vercel está en prueba de Pro y Supabase en el plan gratuito).
- Variables de entorno en Vercel (sin prefijos, porque el sitio es estático): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (solo estas dos se exponen, vía `/api/config`), `SUPABASE_SECRET_KEY`, `CLIENTIFY_API_KEY`, `CLIENTIFY_WEBHOOK_SECRET`, `CANJES_API_KEYS` (`proveedor:key,proveedor:key`, §4.10), `CRON_SECRET` (protege `/api/cron/*`; Vercel Cron lo envía solo), `TURNSTILE_SITE_KEY` (pública, vía `/api/config`) y `TURNSTILE_SECRET_KEY` (captcha del formulario público, §7.1). **Nunca** se escriben en el código ni en commits.
  - **Production** apunta al proyecto `aliados-prod`; **Preview** y **Development** apuntan a `aliados-dev`.
  - `SUPABASE_PUBLISHABLE_KEY` es la *publishable key* (o la *anon key* legacy). `SUPABASE_SECRET_KEY` es la *secret key* (o la *service_role* legacy). **`SUPABASE_SECRET_KEY` solo se usa dentro de `/api`, jamás en el navegador.**
  - En local se usan con `vercel env pull .env.local`. Verifica que `.env*.local` esté en `.gitignore`.
- **Clientify es uno solo para pruebas y producción.** Los contactos creados desde Preview o Development llevan además la etiqueta `PRUEBA HUB` y su correo debe contener `+prueba`, para poder identificarlos y borrarlos.
- Nunca registrar en logs contraseñas, tokens ni datos personales completos.
- Rate limiting en registro, login y `/api/oportunidades` (20 referidos por hora por aliado; el formulario público además tiene captcha y 20 intentos por hora por conexión, §7.1). Registro, login y recuperar contraseña llevan el captcha de Supabase Auth (§3, punto 10).

**Correo de las cuentas (rama `config-smtp`, oct 2026):**
- Supabase Auth envía por **SMTP propio con Resend** desde `Aliados del Sol · GEENERA <no-reply@notificaciones.geenera.com>`. El subdominio `notificaciones.geenera.com` solo envía: DKIM, SPF de rebotes (`send.notificaciones`) y DMARC propio en `p=none`, en Cloudflare (región de Resend `us-east-1`). **No se tocan** el SPF ni el DMARC de `geenera.com` (Microsoft 365 y Clientify/SparkPost). Sin seguimiento de clics ni aperturas.
- La API key de Resend (contraseña SMTP; usuario `resend`, `smtp.resend.com:465`) vive solo en el panel de cada proyecto de Supabase, una key por proyecto con permiso solo de envío. **Nunca** en el código ni en Vercel.
- *Email OTP Expiration* = 86400 (24 h) en los dos proyectos, para todos los enlaces (confirmación, recuperación e invitación de operadores); contraseña mínima de 8. *Redirect URLs*: en dev, `https://*-growth-73f6.vercel.app/**` y `http://localhost:3000/**`; en prod, solo `https://<dominio>/**`.
- Plantillas en `supabase/templates/` (fuente de verdad; `README.md` con asuntos y dónde se pegan): confirmación, recuperación, cambio de correo y aviso de contraseña cambiada, con los logos publicados en `geenera.com/wp-content/uploads/`. `supabase/config.toml` usa las mismas en la base local.
- El aviso de «cuenta aprobada» no lo envía Supabase: lo hará una automatización de Clientify o n8n cuando se crea el contacto del aliado (flujo A).

## 11. Legal (Colombia, Ley 1581 de 2012 y Decreto 1377 de 2013)

- Autorización explícita en el registro, con la fecha guardada en `autorizacion_datos_at`, y enlace a la política de tratamiento de datos y a los términos del programa de puntos.
- Los Términos y condiciones son **los mismos para todos los tipos de aliado**, aunque el documento diga "EMI" (decisión del equipo).
- El footer del sitio ("Términos y condiciones" y "Política de privacidad") abre los mismos PDF vigentes.
- Los documentos se publican en `assets/legal/` con la versión (fecha) en el nombre del archivo, porque `assets/` se cachea un año: `terminos-aliados-del-sol-2026-02-06.pdf` y `politica-tratamiento-datos-2026-09-25.pdf`. Al publicar una versión nueva se sube un archivo nuevo, se actualiza `JOIN_CONFIG.legal` en la página y las funciones `interno.version_terminos_vigente()` / `interno.version_politica_datos_vigente()` con una migración.
- **Pendiente:** la política de beneficios (se incluirá en los términos).
- Declaración del aliado sobre la autorización de los contactos que refiere.
- Canal para consultar, corregir o eliminar datos, y proceso de borrado de cuenta.
- Datos alojados en Supabase East US (EE. UU.), lo que implica transferencia internacional; se declara en la política y se valida con el asesor legal (EE. UU. figura entre los países con nivel adecuado según la SIC).
- Revisión final con el asesor legal de GEENERA.

## 12. Entornos y forma de trabajo

- Dos proyectos de Supabase: **dev** y **prod**. El conector MCP de Supabase apunta **solo a dev**.
- Todo cambio de esquema va como **migración** versionada en `supabase/migrations/`. Nunca se hacen cambios manuales en prod.
- Cada funcionalidad va en su propia rama y se prueba en el Preview Deployment de Vercel. El webhook de pruebas de Clientify apunta al preview.
- **Orden de implementación sugerido:**
  1. enums, tablas, RLS y la función `calcular_nivel` con tests;
  2. registro, login y generación de `codigo_aliado`;
  3. libro mayor y recálculos (triggers y cron);
  4. flujo A (aliado → Clientify);
  5. "Nueva oportunidad" y flujo B;
  6. webhook (flujo C) y conciliación;
  7. racha y módulos;
  8. dashboards por tipo;
  9. panel admin y eventos;
  10. endpoint de canjes;
  11. canje con QR (**finalizada**, rama `fase-11-qr-canjes`).
- **Ramas actuales:** `config-smtp` reúne las fases 1–11 y el correo propio (§10). Sobre ella, **`correcciones-hub`** reúne las correcciones previas a la etapa 1 de pruebas de aceptación (guía §10.1) y es la rama cuyo Preview se prueba. El despliegue a producción se trabaja aparte, en `despliegue-prod`.
- **Migraciones con el conector de Supabase:** el conector corta los envíos grandes (~60 s) y pide una confirmación que no llega cuando el SQL contiene `delete`. En esos casos se aplica por partes o la persona pega el SQL en el *SQL Editor* de `aliados-dev`, y se registra en `supabase_migrations.schema_migrations` con la versión del nombre del archivo. Las pruebas pgTAP se corren en dev dentro de un bloque que termina con un error a propósito (así todo se deshace).
- **Tests:** `npm run test:db` (pgTAP, base local con `npx supabase start`) y `npm test` (`node --test` de `/lib` y `/api`; las pruebas de integración se omiten si no están `PRUEBAS_SUPABASE_URL`, `PRUEBAS_SUPABASE_SECRET_KEY`, `PRUEBAS_SUPABASE_PUBLISHABLE_KEY` y `PRUEBAS_DB_URL`; corren en serie porque comparten la base local).
- Incluir tests de las reglas críticas: idempotencia de puntos, límites de nivel, tope mensual de módulos, racha (incluido el reinicio y el bloqueo de 4 semanas calendario, con el caso domingo → lunes), el cálculo de calidad con `revision` y el saldo con piso en 0 sin memoria (ejemplo +10, −30, +20 = 20).

## 13. Decisiones tomadas

- "Información disponible" se eliminó del programa. "Referido perfecto" se mantiene en +20 (§5).
- Clientify no usa campos SI/NO/REVISION. Las variables se **derivan** del Status del contacto, la fase de la oportunidad, las etiquetas y algunos campos (§8).
- El vínculo con Clientify usa el `ID_aliado` (campo personalizado) y el `ID` nativo del contacto. No se crea `ID_referido_hub` (§8, flujo B).
- La racha usa la **fecha de calificación** (`revision → si`). El orden es: movimiento de puntos y, después, la racha (§5.2).
- Las empresas con alguna variable de calidad en `revision` se excluyen del promedio (§6.1).
- La calidad se calcula siempre con la fórmula ponderada; el lead scoring de Clientify nunca se usa para la calidad (§6.1).
- Fuera del perfil (−15) se suma a no calificado (−10): −25 en total (§5).
- Con varias oportunidades se usa la más avanzada; `0. lead perdido` = `revision` (§8).
- Puntos con piso en 0 y **sin memoria**: las penalizaciones no generan deuda (§5.4).
- Cambios posteriores de un valor definitivo en Clientify se corrigen manualmente con `ajuste_admin` (§5.1).
- Iniciales de `codigo_aliado`: se ignoran partículas y se usan máximo 4 letras (§2).
- Registro: verificación de correo obligatoria y aprobación de GEENERA con `estado = 'pendiente'` (§3).
- Celular internacional con selector de país; regla colombiana cuando el indicativo es +57 (§3).
- Regional opcional; "¿Cómo llegas a las empresas?" obligatoria para EMI, Linker y Cliente Embajador (§3).
- Nivel = el menor entre el nivel por puntos y el nivel por calidad (§6.3).
- Los Términos y condiciones aplican a todos los tipos de aliado (§11).
- El contacto del aliado en Clientify se crea cuando GEENERA aprueba la solicitud, no al registrarse (§3, §8 flujo A).
- La Política de Tratamiento de Datos debe incluir la transferencia internacional (§11).
- Un aliado suspendido (o pendiente) no gana ni pierde puntos: se retienen y se acreditan al reactivarse (§4.7).
- La factura de una oportunidad queda en la **empresa** en Clientify como enlace privado de descarga de 180 días en su descripción (la API no permite subir archivos); el equipo descarga la factura y no comparte el enlace. La empresa se crea siempre, vinculada al contacto por su nombre (§8, flujo B).
- Un contacto solo se refiere una vez (gana el primer aliado) y un aliado no puede referirse a sí mismo (§4.4, §7.2).
- Máximo 20 referidos por hora por aliado (§7.2).
- Un lead del formulario público de un aliado `pendiente` o `suspendido` se registra y sus puntos quedan retenidos hasta la reactivación (§7.1).
- El payload crudo de los webhooks se conserva 90 días (§4.11).
- Un cambio de Clientify sobre un valor definitivo queda en `avance_conflictos` para un admin; no cambia puntos ni calidad (§5.1, §8).
- Cuentan todos los embudos de proyectos; los hitos se reconocen por el nombre de la fase ("Diseño", "Presentación de oferta", "Contrato") y su posición en el embudo (§8).
- La conciliación revisa los referidos **en curso** cada hora y, una vez al día (02:00 Bogotá), **también los cerrados**, para no perder un cambio hecho solo en el contacto de un referido ya cerrado (§8, flujo C).
- Información falsa: cualquiera de las etiquetas "fraude", "no existe" o "información de contacto errónea" (§8).
- Valor cotizado = "Importe" de la oportunidad (`amount`) (§8).
- Etiqueta de aliado: "aliado del sol hub" para Cliente Embajador y "aliados del sol" para los demás (§8, flujo A).
- Todo aliado que llega a Clientify lleva el Tipo de contacto "Aliados Estratégicos" (`contact_type`), también si ya existía con otro Tipo; el `tipo_aliado` del Hub no cambia y los referidos no lo llevan (§8, flujo A).
- Los eventos de webhook ajenos al programa se borran al procesarlos (§4.11).
- El webhook de contactos de Clientify sigue en n8n; al Hub solo llega el de oportunidades, y la conciliación corre cada hora (§8, flujo C).
- Valor cotizado = suma del Importe de todas las oportunidades del referido; pipeline originado = suma del Importe de las que se cierran (ganadas o en "Contrato") (§8, tabla D).
- Las etiquetas "aliado del sol hub" / "aliados del sol" marcan **referidos** (el formulario público pone "aliado del sol hub"); el contacto de un aliado se reconoce por su ID (§7.1, §8).
- Las etiquetas de tipo ("AdS Financieros", "AdS EMI", "AdS Linker", "AdS Cliente Embajador", "AdS Agremiaciones") son las mismas del formulario público y del registro del Hub; se dejan así.
- Racha Solar: al completar 4 de 4 se reinicia el lunes siguiente; las calificaciones retenidas no cuentan; máximo un +75 cada 4 semanas calendario, medido por semanas y no por horas (§5.2).
- Módulos: cada uno vale lo que indique el catálogo y el tope es de 20 puntos por mes, sin partir módulos y en orden de llegada (§5.3).
- `empresas` exige los campos obligatorios del formulario solo para `origen = 'hub'`; el formulario público de Clientify puede traerlos incompletos (§4.4, §7.1).
- Financieros y Agremiaciones también ven sus puntos y su nivel (§9).
- Agremiaciones: la distribución regional se agrupa por la ciudad de la empresa referida (§9).
- Las secciones del Hub sin datos reales todavía se muestran con datos de demostración y la etiqueta "Demostración" (§9).
- Academy: en la base solo se guarda el curso completado; el avance por lección vive en el navegador del aliado (§9).
- El Hub no muestra los requisitos de calidad por nivel, pero el nivel sí los aplica (§6.3, §9).
- El panel de administración es una página separada (`admin.html`) y no permite cambiar roles (§10).
- Los eventos los reporta el aliado desde el Hub y un admin los valida (§4.8).
- Una solicitud rechazada queda en `estado = 'rechazado'` (no se borra la cuenta) y se puede aprobar después (§3).
- Las cuentas de admin no se sincronizan con Clientify (`clientify_sync_estado = 'excluido'`) (§8, flujo A).
- Canjes: el catálogo de recompensas lo crea y edita GEENERA desde el panel; los puntos y el nivel mínimo salen de ahí (§4.10).
- El proveedor puede consultar el nivel, el saldo y las recompensas disponibles de un aliado por su código, sin datos personales (§4.10).
- Un admin puede anular un canje no entregado: se devuelven los puntos disponibles, no los de nivel (§4.10, §5.4).
- **Correo de las cuentas:** Resend con `no-reply@notificaciones.geenera.com`, subdominio solo para enviar; enlaces de 24 h; plantillas en español con logos; contacto `c.arenas@geenera.com` (§10).
- El aviso de cuenta aprobada se hará con una automatización de Clientify o n8n, no con Supabase (§10).
- Recuperación de contraseña desde el Hub; al guardar la contraseña nueva se entra directo (§3).
- Una cuenta de admin solo usa el panel; el Hub la envía a `admin.html` (§3).
- Captcha «No soy un robot» también en el registro, el login (Hub, panel y canjes) y «¿Olvidaste tu contraseña?», con la protección CAPTCHA nativa de Supabase Auth y el mismo widget de Turnstile (§3).
- En el celular (bajo 860 px) el menú del Hub es un panel que se abre con «☰ Menú» (§9).
- El celular es único por aliado (§3, §4.1).
- **Canje con QR (fase 11):** QR dinámico firmado por la base, de 5 minutos y un solo uso, renovado cada 60 s; código corto de respaldo (§4.10).
- Escanean **operadores** (personal de GEENERA o del proveedor) invitados por un admin, ligados a un proveedor; no son aliados. Los admins también escanean (§4.10).
- La recompensa la elige el operador al escanear; una por escaneo; el aliado no aprueba en su celular (mostrar el QR es su consentimiento) (§4.10).
- El operador ve el nombre corto del aliado («Laura P.»), su código, nivel y saldo; nunca su correo ni su celular (§4.10).
- Un operador se elimina solo si no registró canjes; si no, se desactiva (§4.10).
- **Formulario público propio** en lugar del de Clientify: pide el correo de quien refiere y la empresa queda en el Hub de ese aliado; si el correo no es de un aliado, no se registra (§7.1).
- Solo el correo identifica a quien refiere (no el celular); se acepta un aliado activo, pendiente o suspendido (estos dos con puntos retenidos) (§7.1).
- El error del formulario público es ambiguo («Hubo un problema al registrar esta oportunidad…») para no revelar quién es aliado; lleva casilla Ley 1581 y captcha (§7.1).
- Los referidos (Hub y formulario público) solo llevan "Referido perfecto" o "Referido imperfecto": los flujos de Clientify se disparan con "referido perfecto" y el imperfecto va a n8n (flujos de Valentina y Enrique); no llevan "aliado del sol hub" ni "aliados del sol" (§8, flujo B).

## 14. Preguntas abiertas

**Necesarias antes de la fase del webhook** (no bloquean las fases 1 a 5):

1. ~~Etiqueta de información falsa~~ Resuelta: "fraude", "no existe" e "información de contacto errónea" (§8).
2. ~~Campo "Potencia" y valores~~ Resuelta: "Potencia (kWp)" de la oportunidad, valor cotizado = suma del "Importe" (`amount`) y pipeline originado = suma del "Importe" de las oportunidades ganadas o en "Contrato" (§8, tabla D).
10. ~~¿Qué embudos cuentan?~~ Resuelta: todos los de proyectos (§8).
11. ~~Etiqueta de aliado~~ Resuelta: "aliado del sol hub" (Cliente Embajador) y "aliados del sol" (§8, flujo A).
12. ~~Leads del formulario público sin oportunidad~~ Ya no aplica para los nuevos: el formulario público es del Hub y registra la empresa al enviarlo (§7.1). El reenvío desde n8n solo haría falta si siguen llegando leads con `ID_aliado` por otra vía de Clientify.
13. ~~Etiquetas del flujo A y B~~ Resuelta: los referidos solo llevan "Referido perfecto"/"Referido imperfecto" (los flujos se disparan con esas); el aliado conserva "aliados del sol"/"aliado del sol hub" y el Tipo "Aliados Estratégicos" (§8, §13).
20. **Claves del captcha (Cloudflare Turnstile):** widget real (modo *Managed*) para el dominio oficial en Production y, en Preview, las claves de prueba de Cloudflare (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`, pasan siempre). Pasos en la guía §10.2, paso 4. Sin ellas, en Production el formulario público no funciona (503). Además, en cada proyecto de Supabase: *Authentication → Attack Protection → Enable CAPTCHA protection*, proveedor Turnstile, con la clave secreta del mismo widget, **después** de que el despliegue tenga la site key. **Estado:** `aliados-dev` ya lo tiene encendido con la clave de prueba y funciona en el Preview (5 oct 2026). **`aliados-prod` se configura solo al desplegar a producción** (rama `despliegue-prod`, guía §10.2, paso 4), con los mismos pasos y la clave real; antes no, porque `main` no tiene el captcha y nadie podría entrar.
21. **`main` en producción tiene el formulario público sin lógica:** lo que se envía ahí hoy no se guarda. Decisión del equipo: se deja así porque el lanzamiento es esta semana; se corrige al publicar `correcciones-hub`.
22. ~~Flujo C sin probar con un referido real~~ Verificado con Clientify real (5 oct 2026): flujo B completo (empresa, contacto, etiquetas, campos y enlace de la factura) y flujo C (+30 al calificar con Racha, +30/+50/+150 por fases, −30 por «fraude», −10 por «0. lead no calificado» tras calibrar los Status, conflicto «calificado sí → no», calidad y nivel recalculados). Falta: lead creado directo en Clientify (caso 8) y resolver un conflicto desde el panel. El estado de cada caso está en la guía §10.1.

**Generales:**

3. ~~Registro: ¿verificación de email obligatoria? ¿aprobación manual de GEENERA?~~ Resuelta: sí a ambas (§3).
4. ~~Iniciales: ¿ignorar partículas ("de", "la"…) y usar máximo 4 letras?~~ Resuelta: sí (§2, §13).
5. ~~Financieros y Agremiaciones: ¿también participan en puntos y niveles? ¿Qué criterio define la distribución regional?~~ Resuelta: sí ven puntos y nivel; la distribución regional usa la ciudad de la empresa referida (§9).
6. Sistema externo de canjes: quién lo opera. **Implementado del lado del Hub (fase 10):** API key por proveedor y catálogo en el panel (§4.10). **Fase 11:** el canje presencial ya funciona con QR y operadores, sin depender de un sistema externo. Pendiente: invitar a los operadores reales, cargar el catálogo real y, si un proveedor se integra por sistema, generar su key.
7. ~~Envío de la factura a Clientify: adjunto por API o enlace firmado.~~ Resuelta: enlace firmado de 180 días en la descripción de la empresa, porque la API no permite subir archivos (§8, flujo B).
8. ~~¿Los Términos (dicen "EMI") aplican a todos los tipos?~~ Resuelta: sí, aplican a todos (§11).
9. **Nueva versión de la Política de Tratamiento de Datos** (decidido agregar la transferencia internacional; pendiente de redacción final del equipo legal): transferencia internacional (Supabase en EE. UU. y Clientify), finalidades propias del programa de referidos y un canal concreto (correo) para consultas y reclamos. Al recibirla: subir el PDF con la fecha nueva en `assets/legal/`, actualizar `JOIN_CONFIG.legal` y `interno.version_politica_datos_vigente()` con una migración.
14. **Aviso de cuenta aprobada:** crear en Clientify o n8n la automatización que envía el correo cuando se crea el contacto del aliado (relacionada con la 13).
15. **Logos de los correos en PNG:** las plantillas ya usan PNG con fondo blanco (`supabase/templates/img/`; el WebP transparente salía con fondo negro en varios lectores y Outlook no mostraba WebP). **Falta:** subir los dos PNG a `geenera.com/wp-content/uploads/` y, después, volver a pegar las cuatro plantillas en `aliados-dev` (en `aliados-prod` al desplegar).
16. ~~Hub más ancho que el celular~~ Resuelta: bajo 860 px el menú es un panel con «☰ Menú» (§9).
17. **Secciones de demostración:** las comisiones siguen con datos de demostración y la etiqueta "Demostración". La serie por mes («COP cotizados y kWp») ya usa datos reales (oct 2026); desembolsos y distribución por ejecutivo ya no se muestran con sesión (§9).
18. **Imágenes de las recompensas:** el catálogo `recompensas` aún no guarda imágenes ni logos.
19. **Correo de `geenera.com` (área de TI):** Microsoft 365 no tiene la firma DKIM propia activada y el DMARC está en `p=none`. No afecta al Hub. Pasado un tiempo sin problemas, subir el DMARC de `notificaciones` a `quarantine`.
