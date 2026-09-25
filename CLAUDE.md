# CLAUDE.md — Aliados del Sol Hub (GEENERA)

> Contexto permanente para Claude Code. Léelo completo antes de cualquier tarea en este repositorio.
> Idioma del proyecto: español (UI, nombres de tablas y columnas en `snake_case` español).
> Zona horaria de negocio: **America/Bogota** (semanas lunes–domingo, meses calendario).

---

## 1. Qué es el proyecto

**Aliados del Sol Hub** es la plataforma de GEENERA para su programa de referidos. Los **aliados** refieren empresas (leads) y ganan **Puntos Sol**, suben de **nivel** y canjean recompensas.

- La página ya existe, fue construida con Claude Code y está desplegada en **Vercel**. Antes de programar, revisa el repo para confirmar el framework y la estructura actual. No reescribas lo existente sin necesidad.
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
   - *Propuesta, por confirmar:* ignorar partículas (`de`, `del`, `la`, `las`, `los`, `y`) y usar máximo 4 iniciales.
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
| Celular | Sí | Todos |
| Regional / ciudad | No | Todos |
| Tipo de aliado | Sí | Todos: `financiero`, `emi`, `linker`, `cliente_embajador`, `agremiaciones` |
| Organización | Sí | `financiero`, `agremiaciones` |
| Cargo | Sí | `financiero`, `agremiaciones` |
| ¿Cómo llegas a las empresas? | Sí | `emi`, `linker`, `cliente_embajador` |
| Contraseña + confirmación | Sí | Todos |
| Autorización de tratamiento de datos (checkbox sin marcar por defecto) | Sí | Todos |

### Flujo de registro

1. El front llama a `supabase.auth.signUp({ email, password, options: { data: {...campos} } })`.
   - **La contraseña la gestiona exclusivamente Supabase Auth** (hash bcrypt). **Nunca** se guarda en tablas propias ni en logs.
2. Un trigger `on auth.users insert` → `handle_new_aliado()`:
   - crea la fila en `aliados` y genera `codigo_aliado`;
   - crea la fila en `aliados_perfil_organizacion` o en `aliados_perfil_alcance` según el tipo;
   - guarda `autorizacion_datos_at`.
3. Se sincroniza con Clientify (ver §8, flujo A). El aliado se crea como contacto con la etiqueta **"Aliado del Sol"**, el tipo y `ID_aliado = codigo_aliado`. Si falla, `clientify_sync_estado = 'pendiente'` y se reintenta por cron. **El registro del aliado nunca falla por culpa de Clientify.**
4. El aliado puede iniciar sesión con email y contraseña.
   - *Por confirmar:* ¿se exige verificación de email antes del primer login? (recomendado). ¿GEENERA debe aprobar la solicitud?

Validar en front **y** en servidor: formato de email, celular colombiano, contraseñas iguales y mínimo 8 caracteres, campos condicionales según el tipo.

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
estado                  text NOT NULL DEFAULT 'activo'      -- activo | suspendido
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
codigo_referido        text UNIQUE NOT NULL         -- ref. pública corta p/ Clientify (ver §8, evitar duplicados)
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
calidad_empresa         numeric(5,2) NULL             -- calculado; NULL si alguna de las 4 está en 'revision'
-- Variables de avance comercial
informacion_disponible  estado_triple DEFAULT 'revision'
propuesta_comercial     estado_triple DEFAULT 'revision'
negocio_cerrado         estado_triple DEFAULT 'revision'
-- Variables de penalización
informacion_falsa       estado_triple DEFAULT 'revision'
fuera_perfil            estado_triple DEFAULT 'revision'
-- Datos de Clientify para dashboards (sobre todo Financieros)
etapa_clientify         text NULL
lead_scoring            numeric NULL
valor_oportunidad       numeric NULL      -- pipeline originado
valor_cotizado          numeric NULL
potencia_instalada_kwp  numeric NULL
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
```

- Es **solo inserción**: no se hacen UPDATE ni DELETE. Las correcciones se registran como un movimiento nuevo con motivo `ajuste_admin`.
- Cada movimiento dispara el recálculo de `aliados.puntos_nivel`, `puntos_disponibles` y `nivel`.
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
4. **Tablas nuevas:** `canjes`, `modulos` (catálogo), `webhook_eventos`. **Columnas nuevas:** ids de Clientify, estado de sincronización, `codigo_referido`, fecha de calificación y los datos para el dashboard de Financieros.
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
| `informacion_disponible` | `informacion_disponible = si` | **+20** | `empresa:{id}:informacion_disponible` |
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

---

## 6. Calidad de referidos y niveles

### 6.1 Calidad por empresa (binaria y ponderada)

```
calidad_empresa = 100 × (0.40·calificado + 0.30·perfecto + 0.20·oportunidad_tecnica + 0.10·integridad_informacion)
```

- Cada variable vale `si = 1` y `no = 0`.
- Si **alguna** de las 4 está en `revision`, `calidad_empresa = NULL` y la empresa **queda excluida** del promedio, para no penalizar lo que está en proceso (decisión del equipo).

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

### Flujo A — Aliado nuevo → Clientify

Después del alta en Supabase:

1. Crear el contacto con la etiqueta **"Aliado del Sol"**, la etiqueta de tipo y el campo `ID_aliado = codigo_aliado`.
2. Guardar `clientify_contact_id`.
3. Si falla, dejar `pendiente` y reintentar con un cron cada 15 min con backoff.

Cuando el aliado edita su perfil, también se replica en Clientify.

### Flujo B — Nueva oportunidad (Hub) → Clientify

1. Crear o actualizar la empresa y el contacto, y crear la oportunidad.
2. Enviar los campos personalizados:
   - `ID_aliado = codigo_aliado`;
   - `ID_referido_hub = empresas.codigo_referido` (*campo por crear en Clientify*).
3. Poner la etiqueta **"Referido perfecto"** o **"Referido imperfecto"** según `es_perfecto`, para que Clientify continúe su proceso existente. Dejar los campos personalizados de avance en `REVISION`.
4. La factura se envía como adjunto o como enlace firmado (*confirmar qué soporta la API de Clientify*).
5. Guardar `clientify_contact_id`, `clientify_company_id` y `clientify_deal_id`.

**Evitar duplicados:** Clientify también disparará el webhook de "contacto creado" para este lead. En el flujo C, si el payload trae `ID_referido_hub` o un id de Clientify que ya existe en `empresas`, **se actualiza la fila existente**: no se crea otra ni se otorga un segundo `registro_valido`.

### Flujo C — Clientify → Supabase (webhook)

- Configuración en Clientify: *Configuración > Integraciones > Webhooks*, eventos de crear, actualizar y eliminar para **contactos y oportunidades**.
- Destino: `POST /api/webhooks/clientify?token=<CLIENTIFY_WEBHOOK_SECRET>`.

Pasos:

1. Validar el token (comparación en tiempo constante) y guardar el payload crudo en `webhook_eventos`.
2. Responder `200` rápido y procesar después.
3. **Volver a consultar** la entidad en la API de Clientify para obtener su estado completo y actual, en vez de confiar solo en el payload.
4. Resolver la empresa por `clientify_*_id`, `ID_referido_hub` o, para leads nuevos del formulario público, por `ID_aliado`.
5. Mapear los campos de Clientify a `avance_empresa` (tabla de mapeo abajo) y hacer el upsert.
6. Por cada variable que pasó de `revision` a `si` o `no`, insertar el movimiento con su `clave_unica`. Luego recalcular la calidad, los saldos, el nivel y la racha.
7. Marcar `procesado_at` o `error`.

**Conciliación nocturna** (Vercel Cron, 02:00 Bogotá): recorre las oportunidades modificadas en Clientify en las últimas 48 h y reaplica el mismo proceso, que es idempotente. Así se cubren webhooks perdidos.

### Mapeo Clientify → `avance_empresa` (decisión del equipo)

Todas las variables de avance son **campos personalizados en Clientify** con el mismo significado que la columna de Supabase. La **única excepción es `perfecto`**, que viene por **etiqueta**.

| Columna Supabase | Origen en Clientify | Valores |
|---|---|---|
| calificado | Campo personalizado | SI / NO / REVISION |
| oportunidad_tecnica | Campo personalizado | SI / NO / REVISION |
| integridad_informacion | Campo personalizado | SI / NO / REVISION |
| informacion_disponible | Campo personalizado | SI / NO / REVISION |
| propuesta_comercial | Campo personalizado | SI / NO / REVISION |
| negocio_cerrado | Campo personalizado | SI / NO / REVISION |
| informacion_falsa | Campo personalizado | SI / NO / REVISION |
| fuera_perfil | Campo personalizado | SI / NO / REVISION |
| **perfecto** | **Etiqueta** `Referido perfecto` → `si`; `Referido imperfecto` → `no`; sin etiqueta → `revision` | — |
| lead_scoring, valor_oportunidad, valor_cotizado, potencia_instalada_kwp | Campo personalizado (numérico) | número |
| etapa_clientify | Etapa del pipeline de la oportunidad | texto |

**Reglas de implementación:**

- Los nombres exactos de los campos en la API de Clientify (y si están en el contacto, la empresa o la oportunidad) se definen en **un solo archivo de configuración**, `lib/clientify/mapeo.ts`. Ninguna otra parte del código usa nombres de campos de Clientify directamente.
- Normalizar los valores recibidos: sin tildes, `trim`, mayúsculas. `SI`, `Sí` y `si` → `si`; `NO` → `no`; `REVISION`, `Revisión` o vacío → `revision`.
- Un valor desconocido → `revision`, más un error en `webhook_eventos`. Nunca debe generar puntos.
- La etiqueta de perfecto o imperfecto que el Hub pone al enviar (flujo B) y la que llega por webhook son la misma. Si Clientify cambia la etiqueta, se actualiza `avance_empresa.perfecto` (y la calidad), pero los puntos de `perfecto` siguen la regla de §5.1: solo cuenta el primer valor definitivo.

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
  - Las **escrituras** de puntos, avance, eventos, canjes y sincronización se hacen solo desde el servidor con `SUPABASE_SERVICE_ROLE_KEY` (nunca en el cliente), o con funciones `SECURITY DEFINER` controladas.
- Rol `admin` (equipo GEENERA) para validar eventos, registrar baja calidad reiterada, hacer ajustes y resolver conflictos. Las acciones de admin quedan auditadas en `creado_por`.
- Variables de entorno en Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CLIENTIFY_API_KEY`, `CLIENTIFY_WEBHOOK_SECRET`, `CANJES_API_KEYS`. **Nunca** se escriben en el código ni en commits.
- Nunca registrar en logs contraseñas, tokens ni datos personales completos.
- Rate limiting en registro, login y `/api/oportunidades`.

## 11. Legal (Colombia, Ley 1581 de 2012 y Decreto 1377 de 2013)

- Autorización explícita en el registro, con la fecha guardada en `autorizacion_datos_at`, y enlace a la política de tratamiento de datos y a los términos del programa de puntos.
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

- Las variables de avance son campos personalizados de Clientify; `perfecto` viene por etiqueta (§8).
- La racha usa la **fecha de calificación** (`revision → si`). El orden es: movimiento de puntos y, después, la racha (§5.2).
- Las empresas con alguna variable de calidad en `revision` se excluyen del promedio (§6.1).
- Puntos con piso en 0 y **sin memoria**: las penalizaciones no generan deuda (§5.4).
- Cambios posteriores de un valor definitivo en Clientify se corrigen manualmente con `ajuste_admin` (§5.1).

## 14. Preguntas abiertas (resolver antes o durante la implementación)

1. Nombres técnicos exactos de los campos personalizados en la API de Clientify y en qué entidad está cada uno (contacto, empresa u oportunidad). Crear el campo `ID_referido_hub`.
2. Registro: ¿verificación de email obligatoria? ¿aprobación manual de GEENERA?
3. Iniciales: ¿ignorar partículas ("de", "la"…) y usar máximo 4 letras?
4. Financieros y Agremiaciones: ¿también participan en puntos y niveles? ¿Qué criterio define la distribución regional?
5. Sistema externo de canjes: quién lo opera y cómo se autentica (se asume API key por proveedor).
6. Envío de la factura a Clientify: adjunto por API o enlace firmado.
