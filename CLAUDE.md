# CLAUDE.md — Aliados del Sol Hub (GEENERA)

> Contexto permanente para Claude Code. Léelo completo antes de cualquier tarea en este repositorio.
> Idioma del proyecto: español (UI, nombres de tablas y columnas en `snake_case` español).
> Zona horaria de negocio: **America/Bogota** (semanas lunes–domingo, meses calendario).

---

## 1. Qué es el proyecto

**Aliados del Sol Hub** es la plataforma de GEENERA para su programa de referidos. Los **aliados** refieren empresas (leads) y ganan **Puntos Sol**, suben de **nivel** y canjean recompensas.

- La página ya existe, fue construida con Claude Code y está desplegada en **Vercel**. Es un **sitio estático** (HTML, CSS y JS, sin framework ni paso de build; `package.json` solo tiene `npx serve`). Revisa la estructura antes de programar y **no reescribas lo existente sin necesidad**.

### Stack y arquitectura técnica

- **Frontend:** se mantiene estático. Supabase se usa en el navegador con `@supabase/supabase-js`, cargado como módulo ES desde CDN (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`). En el navegador solo se usa la URL y la *publishable key*; la seguridad la da RLS.
- **Backend:** son **Vercel Functions** en la carpeta `/api` de la raíz, con Node.js 18 o superior y ESM. Vercel las detecta sin configuración, también en proyectos estáticos. Ahí viven las claves secretas y toda la integración con Clientify.
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
3. **Cuando GEENERA aprueba la solicitud** (`pendiente → activo`), se sincroniza con Clientify (ver §8, flujo A). No se sincroniza al registrarse, para no llevar al CRM solicitudes que se van a rechazar (decisión del equipo). El aliado se crea como contacto con la etiqueta **"Aliado del Sol"**, el tipo y `ID_aliado = codigo_aliado`. Si falla, `clientify_sync_estado = 'pendiente'` y se reintenta por cron. **Ni el registro ni la aprobación fallan por culpa de Clientify.**
4. El aliado **confirma su correo** (obligatorio antes del primer login) y **GEENERA aprueba la solicitud** (decisiones del equipo):
   - mientras `estado = 'pendiente'`, el login responde "Tu solicitud está en revisión" y no entra al Hub;
   - un admin la aprueba con `estado = 'activo'`, `aprobado_at` y `aprobado_por` (por SQL hasta que exista el panel admin, fase 9);
   - solo las cuentas `activo` entran al Hub. **Todo endpoint de `/api` debe verificar `estado = 'activo'`.**
5. En el front, toda la lógica de Supabase vive en `js/supabase.js`: la página emite eventos `ads:*` (`ads:join-register`, `ads:login`, `ads:logout`) y el módulo responde (`ads:join-resultado`, `ads:login-resultado`, `ads:sesion`, `ads:aviso`).

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
celular                 text NOT NULL
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
clientify_sync_estado   text NOT NULL DEFAULT 'pendiente'   -- pendiente | ok | error
clientify_sync_error    text NULL
autorizacion_datos_at   timestamptz NOT NULL
terminos_aceptados_at   timestamptz NOT NULL
terminos_version        text NOT NULL                       -- versión de los Términos aceptada (fecha de entrada en vigor)
politica_datos_version  text NOT NULL                       -- versión de la Política de Tratamiento de Datos vigente al autorizar
estado                  text NOT NULL DEFAULT 'pendiente'   -- pendiente | activo | suspendido
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
origen                 text NOT NULL                -- 'hub' (Nueva oportunidad) | 'clientify_form' (Refiere tu empresa)
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
clientify_sync_estado  text NOT NULL DEFAULT 'pendiente'
created_at, updated_at timestamptz
```

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
```

El bucket de Storage es **privado** y se accede con URLs firmadas de corta duración. Límite sugerido: 10 MB; tipos PDF, JPG y PNG.

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
creado_por        text NOT NULL           -- 'sistema' | 'webhook_clientify' | 'admin:{id}' | 'canjes_api'
nota              text NULL
secuencia         bigint IDENTITY         -- orden determinista cuando dos movimientos tienen la misma fecha
```

- Es **solo inserción**: no se hacen UPDATE ni DELETE. Las correcciones se registran como un movimiento nuevo con motivo `ajuste_admin`.
- Cada movimiento dispara el recálculo de `aliados.puntos_nivel`, `puntos_disponibles` y `nivel`.
- **Cómo registrar un movimiento** (fase 3): se inserta con `ON CONFLICT (clave_unica) DO NOTHING` indicando `aliado_id`, `tipo`, `motivo`, `vinculo`, `vinculo_id`, `clave_unica` y `creado_por`. **La base de datos hace el resto:**
  - toma `puntos` del catálogo `reglas_puntos` (§5) y rechaza un valor distinto; solo `ajuste_admin` y `canje` llevan `puntos` explícito;
  - calcula `puntos_aplicados` (piso en 0 para `perdido`; rechaza un `redimido` mayor al saldo) bloqueando la fila del aliado;
  - recalcula la caché del aliado. Nunca se escriben a mano `puntos_*`, `calidad_referidos` ni `nivel`.
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

### 4.9 `modulos` (catálogo) y `modulos_completados`

```
modulos:             id, nombre, orden, activo
modulos_completados: id, aliado_id FK, modulo_id FK, fecha_completado timestamptz,
                     recompensa_estado text DEFAULT 'pendiente',  -- pendiente | otorgada
                     fecha_otorgada timestamptz NULL,
                     UNIQUE (aliado_id, modulo_id)                -- un módulo se premia una sola vez
```

### 4.10 `canjes` (redención de puntos; lo alimenta un sistema externo)

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

### 4.11 `webhook_eventos` (auditoría de integración)

```
id, fuente ('clientify'), payload jsonb, recibido_at, procesado_at NULL, error text NULL
```

### 4.12 Vista `v_aliado_dashboard`

Expone al front únicamente lo que el aliado puede ver: `codigo_aliado`, nombre, tipo, puntos, nivel, racha, calidad, conteos y sumas por tipo. **No expone `id`.**

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
| `modulo_completado` | Módulo terminado (máx. 20 pts/mes, ver §5.3) | **+5** | `modulo:{modulos_completados.id}` |
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
- **Al completar 4 de 4:** se inserta `racha_solar` (+75) y en la semana siguiente todo vuelve a `0 0 0 0`.
- **Cron semanal** (lunes 00:05 Bogotá): si `racha_ultima_semana` es anterior a la semana recién terminada, la racha se reinicia a `0 0 0 0`.
- **Garantía:** no puede existir más de un `racha_solar` por aliado en 28 días. Se valida en la función antes de insertar.

### 5.3 Módulos (+5 cada uno, máximo 20 por mes calendario)

- Completar un módulo crea una fila en `modulos_completados` con `recompensa_estado = 'pendiente'`.
- La función `otorgar_modulos_pendientes(aliado)` corre al completar un módulo y en un **cron el día 1 de cada mes a las 00:05**. Hace lo siguiente:
  - cuenta los movimientos `modulo_completado` del mes en curso;
  - otorga pendientes en orden FIFO hasta llegar a 4 en el mes (20 puntos);
  - marca `otorgada` y `fecha_otorgada = now()`.
- Ejemplo: 8 módulos en septiembre dan 20 puntos en septiembre, los otros 4 quedan pendientes y se otorgan el 1 de octubre. Total visible: 40 puntos al cabo de dos meses.
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

### 7.1 "Refiere tu empresa" (público, formulario **de Clientify**)

- Ya existe y está configurado en Clientify, con sus etiquetas y su proceso. **No se modifica.**
- Los datos llegan a Clientify con `ID_aliado`. El Hub se entera por webhook (§8, flujo C):
  - crea la fila en `empresas` con `origen = 'clientify_form'` y en `avance_empresa`;
  - otorga `registro_valido` si `ID_aliado` corresponde a un aliado activo.
- Si `ID_aliado` no existe o viene vacío, se registra en `webhook_eventos` con un error para revisión y no se otorgan puntos.

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

---

## 8. Integración con Clientify

Autenticación con API key (`Authorization: Token ...`) en `CLIENTIFY_API_KEY`. Consulta la documentación oficial en https://developer.clientify.com/ antes de implementar cada llamada.

### Flujo A — Aliado aprobado → Clientify

Cuando GEENERA aprueba al aliado (`estado` pasa de `pendiente` a `activo`), no al registrarse:

1. Crear el contacto con la etiqueta **"Aliado del Sol"**, la etiqueta de tipo y el campo `ID_aliado = codigo_aliado`.
2. Guardar `clientify_contact_id`.
3. Si falla, dejar `pendiente` y reintentar con un cron cada 15 min con backoff.

Cuando el aliado edita su perfil, también se replica en Clientify.

### Flujo B — Nueva oportunidad (Hub) → Clientify

1. Crear el contacto (y la empresa, si aplica) con el campo personalizado `ID_aliado = codigo_aliado`.
2. Poner la etiqueta **"Referido perfecto"** o **"Referido imperfecto"** según `es_perfecto`, para que Clientify continúe su proceso existente. El contacto entra con el Status inicial que use su flujo actual.
3. La factura se envía como adjunto o como enlace firmado (*confirmar qué soporta la API de Clientify*).
4. Guardar el **`ID` nativo del contacto** que devuelve Clientify en `clientify_contact_id`. Es el mismo "ID" que aparece al exportar leads, y no se necesita crear ningún campo adicional. La oportunidad la crea el equipo comercial más adelante; su id se captura por webhook.

**Evitar duplicados:** Clientify también dispara el webhook de "contacto creado" para este lead, y puede llegar **antes** de que el Hub guarde el `ID`. Por eso:

- el procesamiento de un contacto nuevo con `ID_aliado` se **difiere unos 2 minutos**;
- antes de crear una empresa nueva, se busca una fila existente por `clientify_contact_id` **o** por (`aliado_id` + `correo` del contacto, creada en las últimas 24 h y sin `clientify_contact_id`);
- si existe, se vincula y actualiza: no se crea otra fila ni se otorga un segundo `registro_valido`.

### Flujo C — Clientify → Supabase (webhook)

- Configuración en Clientify: *Configuración > Integraciones > Webhooks*, eventos de crear, actualizar y eliminar para **contactos y oportunidades**.
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

**Conciliación nocturna** (Vercel Cron, 02:00 Bogotá): recorre los contactos y oportunidades modificados en Clientify en las últimas 48 h y reaplica el mismo proceso, que es idempotente. Así se cubren webhooks perdidos.

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

| Status en Clientify | `calificado` |
|---|---|
| 0. lead no calificado | `no` |
| 3. lead caliente | `si` |
| 4. en oportunidad | `si` (superó "caliente") |
| 5. cliente | `si` (superó "caliente") |
| 0. contacto alternativo, 0. lead verificado, 1. lead frío, 2. lead templado | `revision` |
| 0. lead perdido | `revision` (decisión del equipo) |
| 0. cliente perdido | sin cambio (ya fue `si`) |

Comparar los textos normalizados (minúsculas, sin tildes, `trim`). El mapeo vive en `lib/clientify/mapeo.ts` para que pueda ajustarse si Clientify cambia los nombres.

**B. Fase de la oportunidad → avance comercial**

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
| `oportunidad_tecnica` | `si` si `fase_num >= 3` ("3. Diseño"). `no` si `calificado = no`, o si la oportunidad se pierde antes de la fase 3. En otro caso, `revision`. | +30 al pasar a `si` |
| `propuesta_comercial` | `si` si `fase_num >= 6` ("6. Presentación de oferta"). En otro caso, `revision`. | +50 |
| `negocio_cerrado` | `si` si `fase_num >= 10` ("10. Contrato"). En otro caso, `revision`. | +150 |

- Si pasan varias fases de golpe (por ejemplo de 2 a 6), se otorgan en el mismo proceso todos los movimientos pendientes (+30 y +50), cada uno con su clave única.
- Si una empresa referida tiene **varias oportunidades**, se usa **siempre la más avanzada**, la de mayor `fase_num` (decisión del equipo). `clientify_deal_id` guarda la de esa oportunidad.

**C. Variables derivadas**

| Variable | Regla |
|---|---|
| `integridad_informacion` | `no` si `calificado = no`; `si` si `calificado = si`; `revision` en otro caso |
| `perfecto` | Etiqueta `Referido perfecto` → `si`; `Referido imperfecto` → `no`; sin etiqueta → `revision` |
| `fuera_perfil` | `si` si `calificado = no` **y** `perfecto = si`; `no` si `calificado` es definitivo y no se cumple lo anterior; `revision` en otro caso (ver §5, aclaraciones) |
| `informacion_falsa` | `si` si el contacto tiene la etiqueta de información falsa (*nombre exacto de la etiqueta pendiente*); `revision` si no la tiene |

**D. Datos numéricos para dashboards**

| Supabase | Clientify |
|---|---|
| `lead_scoring` | Lead scoring nativo del contacto |
| `potencia_instalada_kwp` | Campo **"Potencia"**, en **kWp** (*confirmar si está en el contacto o en la oportunidad*) |
| `valor_oportunidad` | Valor o monto de la oportunidad (*confirmar el campo exacto*) |
| `valor_cotizado` | Campo de la oportunidad (*confirmar el campo exacto*) |
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

---

## 9. Dashboard por tipo de aliado

Todos ven un saludo con su **nombre completo**, su `codigo_aliado` (copiable, para compartir), sus Puntos Sol y su nivel.

| Tipo | Contenido principal |
|---|---|
| **EMI, Linker, Cliente Embajador** | Puntos de nivel, puntos disponibles, nivel y progreso al siguiente (puntos **y** calidad faltantes), Racha Solar 4x4, calidad de referidos, historial de movimientos filtrable (semana, mes, trimestre), módulos y recompensas pendientes, lista de referidos con su estado |
| **Financieros** | Potencia instalada (kWp), pipeline originado (millones COP), oportunidades referidas, empresas calificadas, valor cotizado. Sale de `avance_empresa` sincronizado desde Clientify. *Confirmar si también ven puntos y nivel.* |
| **Agremiaciones** | Distribución regional de sus referidos (por `empresas.ciudad` o regional) y calidad de referidos. *Confirmar el criterio regional.* |

Botón **"Nueva oportunidad"** (§7.2) para todos los tipos.

---

## 10. Seguridad

- **RLS activado en todas las tablas.**
  - El aliado solo puede **leer** sus propias filas (`aliado_id = auth.uid()`).
  - Las **escrituras** de puntos, avance, eventos, canjes y sincronización se hacen solo desde el servidor con `SUPABASE_SECRET_KEY` (nunca en el cliente), o con funciones `SECURITY DEFINER` controladas.
- Rol `admin` (equipo GEENERA) para validar eventos, registrar baja calidad reiterada, hacer ajustes y resolver conflictos. Las acciones de admin quedan auditadas en `creado_por`.
- Variables de entorno en Vercel (sin prefijos, porque el sitio es estático): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (solo estas dos se exponen, vía `/api/config`), `SUPABASE_SECRET_KEY`, `CLIENTIFY_API_KEY`, `CLIENTIFY_WEBHOOK_SECRET`, `CANJES_API_KEYS`. **Nunca** se escriben en el código ni en commits.
  - **Production** apunta al proyecto `aliados-prod`; **Preview** y **Development** apuntan a `aliados-dev`.
  - `SUPABASE_PUBLISHABLE_KEY` es la *publishable key* (o la *anon key* legacy). `SUPABASE_SECRET_KEY` es la *secret key* (o la *service_role* legacy). **`SUPABASE_SECRET_KEY` solo se usa dentro de `/api`, jamás en el navegador.**
  - En local se usan con `vercel env pull .env.local`. Verifica que `.env*.local` esté en `.gitignore`.
- **Clientify es uno solo para pruebas y producción.** Los contactos creados desde Preview o Development llevan además la etiqueta `PRUEBA HUB` y su correo debe contener `+prueba`, para poder identificarlos y borrarlos.
- Nunca registrar en logs contraseñas, tokens ni datos personales completos.
- Rate limiting en registro, login y `/api/oportunidades`.

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
  10. endpoint de canjes.
- Incluir tests de las reglas críticas: idempotencia de puntos, límites de nivel, tope mensual de módulos, racha (incluido el reinicio y el bloqueo de 28 días), el cálculo de calidad con `revision` y el saldo con piso en 0 sin memoria (ejemplo +10, −30, +20 = 20).

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

## 14. Preguntas abiertas

**Necesarias antes de la fase del webhook** (no bloquean las fases 1 a 5):

1. Nombre exacto de la **etiqueta de información falsa** en Clientify.
2. Campo **"Potencia"** (en kWp): ¿está en el contacto o en la oportunidad? ¿Qué campos exactos son el valor de la oportunidad y el valor cotizado? (Claude Code puede listarlos con la API de Clientify para confirmarlo.)

**Generales:**

3. ~~Registro: ¿verificación de email obligatoria? ¿aprobación manual de GEENERA?~~ Resuelta: sí a ambas (§3).
4. ~~Iniciales: ¿ignorar partículas ("de", "la"…) y usar máximo 4 letras?~~ Resuelta: sí (§2, §13).
5. Financieros y Agremiaciones: ¿también participan en puntos y niveles? ¿Qué criterio define la distribución regional?
6. Sistema externo de canjes: quién lo opera y cómo se autentica (se asume API key por proveedor).
7. Envío de la factura a Clientify: adjunto por API o enlace firmado.
8. ~~¿Los Términos (dicen "EMI") aplican a todos los tipos?~~ Resuelta: sí, aplican a todos (§11).
9. **Nueva versión de la Política de Tratamiento de Datos** (decidido agregar la transferencia internacional; pendiente de redacción final del equipo legal): transferencia internacional (Supabase en EE. UU. y Clientify), finalidades propias del programa de referidos y un canal concreto (correo) para consultas y reclamos. Al recibirla: subir el PDF con la fecha nueva en `assets/legal/`, actualizar `JOIN_CONFIG.legal` y `interno.version_politica_datos_vigente()` con una migración.
