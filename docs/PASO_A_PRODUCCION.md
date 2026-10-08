# Paso a producción del Aliados del Sol Hub

> **Para qué sirve.** Es la lista ordenada de lo que hay que hacer para publicar en `aliadosdelsol.com` todo lo construido en la rama `correcciones-hub`. Cada paso dice qué hacer, dónde y cómo comprobarlo. Se trabaja en la rama **`despliegue-prod`**.
>
> **Fecha de corte:** 8 de octubre de 2026. **Estado de partida:** `main` (la versión publicada hoy) es la página sin la lógica del Hub; el formulario público no guarda nada. `aliados-prod` (ref `pysyxycrybayhrescplc`) aún no tiene el esquema. Todo lo de esta lista ya funciona y está probado en `aliados-dev` y en el Preview.
>
> **Reglas que no cambian:**
> - ninguna clave en chats, documentos ni commits;
> - en `aliados-prod` no se hacen cambios a mano: el esquema entra solo con las migraciones del repositorio;
> - el conector de Supabase de Claude trabaja solo sobre `aliados-dev`.
>
> El detalle de cada tema está en la *Guía integral* (`docs/GUIA_HUB.md`, §10.2) y en `CLAUDE.md`.

---

## 1. Qué cambia para los aliados con este despliegue

| Tema | Qué llega a producción | Dónde se configura |
|---|---|---|
| Registro y login | Solicitud con aprobación de GEENERA, confirmación de correo, celular único, recuperación de contraseña y captcha «No soy un robot». | Supabase Auth, Turnstile (pasos 4 y 6) |
| Correo propio (SMTP) | Los correos de la cuenta salen de `no-reply@notificaciones.geenera.com` con las plantillas de GEENERA. | Resend y Supabase (paso 4) |
| Formulario público «Referir una empresa» | Formulario propio del Hub: pide el correo del aliado y registra la empresa a su nombre. | Turnstile (paso 6) |
| Puntos Sol y niveles | Libro mayor, órbitas KILO a EXA, bienvenida +10, MEDDPICC +20, Racha Solar y penalizaciones. | Migraciones (paso 3) |
| Clientify | Aliados y referidos se crean solos; el avance comercial vuelve por webhook y conciliación horaria. | Vault, Vercel y Clientify (pasos 5, 9 y 10) |
| Correo «Confirmación de empresa referida» | Cada referido nuevo recibe el correo con el MEDDPICC del buzón de su regional. | `RESEND_API_KEY` (paso 5) |
| Avisos a n8n | Los referidos imperfectos y los perfectos van cada uno a su flujo de n8n. | Variables `N8N_*` (paso 5) |
| Academy | 99 minicursos, 5 certificaciones y 15 herramientas, administrables desde el panel. Puntos: +5 por minicurso, +10 la masterclass, máximo 40 al mes, y +15 por certificación completa. | Migraciones (paso 3) |
| Canje con QR | «Mi QR» del aliado y `canje.html` para los operadores. | Panel (paso 12) |
| Panel de administración | `admin.html`: solicitudes, aliados, eventos, conflictos, canjes, recompensas con imagen, operadores, Academy, correos, avisos a n8n y auditoría. | Primer admin (paso 11) |
| Microsoft Clarity | Mapas de calor y grabaciones con el Hub y los formularios tapados. | `CLARITY_PROJECT_ID` (ya guardado) |

---

## 2. Planes (antes de empezar)

- [ ] **Vercel Pro.** Hobby no permite uso comercial y ya está en el límite de 12 funciones.
- [ ] **Supabase Pro para `aliados-prod`**, en una organización aparte; `aliados-dev` puede quedarse en Free. Pro evita que el proyecto se pause y da copias de seguridad diarias.
- [ ] **Resend.** El plan gratis permite 100 correos al día y 3.000 al mes, compartidos entre los correos de Auth y los de confirmación de referidos. Pasar a Pro si se esperan más de unos 80 registros en un día.

---

## 3. Esquema de `aliados-prod` (39 migraciones)

**Cómo** (recomendado: Supabase CLI desde un computador del equipo, con la rama `despliegue-prod`):

```bash
npx supabase login
npx supabase link --project-ref pysyxycrybayhrescplc
npx supabase migration list   # muestra cuáles faltan; con la base vacía, faltan las 39
npx supabase db push          # las aplica en orden
```

- La CLI aplica también `academy_contenido` (la semilla de 470 KB) sin problema. El límite de tamaño es solo del conector de Claude.
- **Si alguna se pega a mano en el *SQL Editor*,** se respeta el orden de los nombres de archivo. En particular:
  1. `academy_catalogo`;
  2. `avisos_n8n_perfectos`;
  3. `academy_contenido` (sin ella la Academy se ve vacía);
  4. `academy_puntos` (debe ir después del catálogo, si no, la masterclass no queda en +10).

  Luego se registra cada versión en `supabase_migrations.schema_migrations`, para que la CLI no las vuelva a aplicar.

**Comprobar** en el *SQL Editor* de `aliados-prod` (solo lectura):

```sql
select (select count(*) from pg_tables where schemaname = 'public') as tablas,                    -- 28
       (select count(*) from pg_tables where schemaname = 'public' and rowsecurity) as con_rls,   -- 28
       (select count(*) from cron.job) as cron_jobs,                                              -- 7
       (select string_agg(id, ', ' order by id) from storage.buckets) as buckets,                 -- academy, eventos, facturas, recompensas
       (select count(*) from public.modulos where escuela is not null and activo) as minicursos,  -- 99
       (select count(*) from public.academy_certificaciones) as certificaciones,                  -- 5
       (select count(*) from public.academy_herramientas) as herramientas,                        -- 15
       (select max(puntos) from public.modulos where formato = 'masterclass') as masterclass;     -- 10
```

- [ ] Extensiones `pg_cron`, `pg_net` y Vault activas.
- [ ] Los 7 cron jobs: `conciliar-clientify`, `depurar-canjes-qr`, `depurar-webhooks-clientify`, `otorgar-modulos-mensual`, `recalcular-puntos-diario`, `reiniciar-rachas-semanal` y `sincronizar-clientify-aliados`.
- [ ] *Advisors → Security Advisor* sin alertas nuevas.

---

## 4. Autenticación y correo propio (SMTP) de `aliados-prod`

El dominio de envío `notificaciones.geenera.com` ya está verificado en Resend y sirve para los dos proyectos: **no hay que tocar el DNS**.

1. [ ] **Resend → API Keys → Create API Key:**
   - nombre `supabase-aliados-prod`, permiso *Sending access*, dominio `notificaciones.geenera.com`;
   - se pega directo en el punto 2 y no se guarda en otro lado;
   - es distinta de la de dev.
2. [ ] **Supabase → Authentication → Emails → SMTP Settings → Enable custom SMTP:**
   - sender `no-reply@notificaciones.geenera.com`, nombre `Aliados del Sol · GEENERA`;
   - host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = la key del punto 1.
3. [ ] **Authentication → URL Configuration:**
   - *Site URL* = `https://aliadosdelsol.com`;
   - *Redirect URLs* solo `https://aliadosdelsol.com/**`, más `https://www.aliadosdelsol.com/**` si se usa *www*;
   - en producción no va el comodín de Vercel.
4. [ ] **Authentication → Sign In / Providers → Email:**
   - *Confirm email* y *Secure email change* activados;
   - *Email OTP Expiration* = `86400` (24 h; Supabase avisa que supera lo recomendado y es lo decidido);
   - contraseña mínima de 8;
   - protección de contraseñas filtradas activada (requiere Pro).
5. [ ] **Authentication → Rate Limits:** 30 correos por hora para arrancar.
6. [ ] **Authentication → Emails → Templates:** pegar las plantillas de `supabase/templates/` con los asuntos de su `README.md`:
   - `confirmacion.html`;
   - `recuperacion.html`;
   - `cambio_correo.html`;
   - y en las notificaciones de seguridad, *Password changed* con `contrasena_cambiada.html`.
7. [ ] **El captcha de Supabase todavía no se enciende** (paso 6, punto 4).

---

## 5. Variables de *Production* en Vercel

En Vercel → proyecto → *Settings → Environment Variables*, entorno **Production**. Las secretas se marcan *Sensitive*. **Las variables solo aplican a despliegues nuevos.**

| Variable | De dónde sale | Estado |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | `aliados-prod` → *Project Settings → API Keys* | Pendiente |
| `CLIENTIFY_API_KEY` | Clientify (la misma cuenta de pruebas y producción) | Pendiente |
| `CLIENTIFY_WEBHOOK_SECRET` | Texto aleatorio largo **nuevo**, distinto del de pruebas | Pendiente |
| `CRON_SECRET` | Texto aleatorio largo **nuevo**; el mismo va al Vault (paso 9) | Pendiente |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Widget real de Cloudflare Turnstile (paso 6) | Pendiente |
| `RESEND_API_KEY` | Resend → otra key *Sending access* (no la del SMTP), para el correo de confirmación de referidos | Pendiente |
| `N8N_IMPERFECTOS_URL`, `N8N_IMPERFECTOS_TOKEN` | *Production URL* del webhook de n8n y su *Header Auth* | **Hecho** |
| `N8N_PERFECTOS_URL`, `N8N_PERFECTOS_TOKEN` | Flujo de perfectos en n8n | Pendiente |
| `CLARITY_PROJECT_ID` | Clarity → *Settings → Setup* | **Hecho** (8 oct 2026) |
| `CANJES_API_KEYS` | Solo cuando un proveedor se integre por sistema | Opcional |

Sin `TURNSTILE_SECRET_KEY` el formulario público responde 503. Sin `RESEND_API_KEY`, los correos de los referidos quedan en «Correos no enviados» del panel. Sin las `N8N_*`, los avisos quedan en «Avisos a n8n no enviados». Nada de esto hace fallar un registro.

---

## 6. Captcha (Cloudflare Turnstile), en este orden

1. [ ] dash.cloudflare.com → **Turnstile → Add widget**:
   - nombre `Aliados del Sol · Hub`;
   - *Hostnames* `aliadosdelsol.com` (incluye sus subdominios);
   - *Widget mode* **Managed**; *Pre-clearance* no.
2. [ ] Guardar la **Site Key** y la **Secret Key** en Vercel Production (paso 5) y desplegar.
3. [ ] Comprobar en `https://aliadosdelsol.com/api/config` que vienen `turnstileSiteKey` y `clarityProjectId`. La casilla debe verse en el login, en «Quiero ser aliado» y en el formulario público.
4. [ ] **Solo después**, en `aliados-prod` → *Authentication → Attack Protection* → *Enable CAPTCHA protection*:
   - proveedor Turnstile, con la misma Secret Key;
   - comprobar que se puede entrar al panel marcando la casilla.

**Por qué en este orden:** con la protección encendida, Supabase rechaza todo registro, login o recuperación sin captcha. Si el sitio aún no muestra la casilla, nadie podría entrar, tampoco los admins. **Para apagarlo:** primero en Supabase y después se quita la site key de Vercel.

---

## 7. Dominio y documentos legales

- [ ] **Dominio:** `aliadosdelsol.com` asignado a Production, que queda pública; los Preview siguen protegidos.
- [ ] **El mismo dominio en todos los servicios:**
  - las *Redirect URLs* de Supabase (paso 4);
  - los *Hostnames* de Turnstile (paso 6);
  - la URL del proyecto de Clarity («GEENERA - Aliados del Sol»).
- [ ] **Política de Tratamiento de Datos, versión nueva.** Debe cubrir:
  - la transferencia internacional (Supabase y Vercel en EE. UU., Clientify);
  - Resend para los correos;
  - n8n, que recibe los datos del contacto referido;
  - Microsoft Clarity: analítica con cookies, datos en EE. UU. y sin datos personales;
  - las finalidades propias del programa;
  - un correo para consultas y reclamos.

  Al recibirla: subir el PDF con la fecha en `assets/legal/`, actualizar `JOIN_CONFIG.legal` en la página y `interno.version_politica_datos_vigente()` con una **migración nueva**, y hacer la revisión con el asesor legal.
- [ ] **Términos o política de beneficios:** mencionar la bienvenida (+10), el MEDDPICC (+20), los puntos de la Academy (+5, la masterclass +10, máximo 40 al mes y +15 por certificación) y las órbitas KILO a EXA.

La base guarda qué versión aceptó cada aliado, así que los documentos deben estar listos **antes del primer registro real**.

---

## 8. Publicar el código

- [ ] Llevar `correcciones-hub` a `despliegue-prod` y de ahí a `main` (con *pull request*), **después** de los pasos 3 a 6. Vercel publica Production en `aliadosdelsol.com`.
- [ ] Si algo sale mal, Vercel permite volver al despliegue anterior con un clic (*Instant Rollback*). La base no se toca.

---

## 9. Vault de `aliados-prod`

En *Project Settings → Vault*, crear:

- [ ] `clientify_sync_url` = `https://aliadosdelsol.com/api/cron/clientify`;
- [ ] `cron_secret` = el mismo `CRON_SECRET` de Vercel Production;
- [ ] `vercel_bypass_secret`, solo si Production tuviera *Deployment Protection* (normalmente no).

Sin ellos, el cron cada 2 minutos y la conciliación horaria no hacen nada: los aliados y los referidos no llegan a Clientify y los avances no vuelven. El respaldo diario de Vercel (02:00 Bogotá) sí corre, pero no sustituye al de cada 2 minutos.

---

## 10. Webhooks

- [ ] **Clientify → Configuración → Integraciones → Webhooks:** crear el de **oportunidades** de producción.
  - URL: `https://aliadosdelsol.com/api/webhooks/clientify?token=<CLIENTIFY_WEBHOOK_SECRET de producción>`.
  - El del Preview puede quedarse para seguir probando: dev solo procesa correos con `+prueba`.
- [ ] El webhook de **contactos** sigue yendo a n8n; no se cambia.
- [ ] **n8n:**
  - el flujo de imperfectos ya está en Production;
  - falta crear el de perfectos y poner sus variables (paso 5);
  - los flujos de Clientify se siguen disparando con la etiqueta «referido perfecto».

---

## 11. Primer admin

1. [ ] La persona se registra en `https://aliadosdelsol.com` y confirma su correo.
2. [ ] En el *SQL Editor* de `aliados-prod`:
   ```sql
   update public.aliados set rol = 'admin', estado = 'activo', aprobado_at = coalesce(aprobado_at, now())
   where lower(correo) = 'c.lizarazo@geenera.com';
   ```
3. [ ] Entrar a `https://aliadosdelsol.com/admin.html` (con la casilla del captcha). La cuenta de admin queda fuera de Clientify automáticamente y no recibe la bienvenida.

---

## 12. Cargar lo real desde el panel

- [ ] **Recompensas:** crear el catálogo real con puntos, nivel mínimo y proveedor. La imagen va en JPG, PNG o WebP de máximo 2 MB; lo ideal es 1200×600 con lo importante en el centro. Desactivar las de prueba si se copiaron.
- [ ] **Operadores:** invitarlos en la pestaña Operadores y enviarles el enlace por WhatsApp con `docs/instructivo-operador-canje.pdf`. El enlace sirve una vez y vence en 24 h.
- [ ] **Academy:** revisar los cursos y certificaciones cargados por la semilla. Desde el panel se editan; un curso no se borra, se oculta.
- [ ] Compartir con los aliados `docs/instructivo-aliado-mi-qr.pdf`.

---

## 13. Piloto en producción (con 1 o 2 personas de confianza)

No es para probar la lógica, que ya se probó en dev, sino la **configuración**:

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Registrarse con un correo real | Llega el correo de confirmación de `no-reply@notificaciones.geenera.com` con el logo |
| 2 | Aprobar la solicitud en el panel | El aliado entra al Hub con +10 de bienvenida; en minutos aparece en Clientify con «aliados del sol» y el Tipo «Aliados Estratégicos» |
| 3 | «¿Olvidaste tu contraseña?» | Llega el correo; la contraseña nueva funciona |
| 4 | Referido perfecto desde el Hub y otro imperfecto desde el formulario público | +10 y +20, o −5; empresa y contacto en Clientify con la factura enlazada; llega «Confirmación de empresa referida»; cada uno llega a su flujo de n8n |
| 5 | Mover la oportunidad en Clientify (calificar, Diseño, Presentación de oferta) | Los puntos llegan solos (máximo 1 h si solo cambia el contacto) |
| 6 | Completar un minicurso de la Academy | +5 en el historial |
| 7 | Canje con QR entre un aliado y un operador | Se descuentan los puntos; los dos ven el canje |
| 8 | Revisar Clarity → *Settings → Setup* | Sitio instalado; las grabaciones del Hub muestran el texto tapado (puede tardar hasta 2 horas) |
| 9 | Panel → Resumen | Sin «Correos no enviados» ni «Avisos a n8n no enviados» acumulados |

En producción no se agrega `PRUEBA HUB`. Al terminar, marcar o limpiar en Clientify los datos del piloto. Si el piloto se hace con aliados reales, sus puntos son válidos.

---

## 14. Lo que no se debe hacer

- **No encender el captcha de Supabase** antes de que el sitio publicado muestre la casilla (paso 6).
- **No cambiar el enmascarado de Clarity a *Balanced* u *Off*,** ni agregar identificadores: quedarían grabados los datos de los aliados.
- **No reutilizar en producción** `CRON_SECRET`, `CLIENTIFY_WEBHOOK_SECRET` ni las keys de Resend de pruebas. Si una clave circuló por un chat, se rota.
- **No hacer cambios a mano en `aliados-prod`.** Todo cambio de esquema va como migración nueva, primero probada en dev.
- **No agregar funciones en `/api`:** ya son 12, el máximo de Hobby. Con Vercel Pro el límite sube, pero conviene mantener la estructura.
- **No compartir el enlace de la factura** que queda en la empresa de Clientify: se descarga y se guarda con cuidado.

---

## 15. Después de abrir

- **Diario:** solicitudes, eventos, conflictos de Clientify, correos y avisos no enviados en el panel.
- **Semanal:** aliados con error de sincronización (pestaña Aliados) y logs de funciones en Vercel.
- **Mensual:** uso y costos de Vercel, Supabase y Resend; *Security Advisor*; revisar en Clarity con marketing.
- **Cada cambio futuro:** rama nueva → Preview y pruebas en dev → *pull request* → migración en `aliados-prod` → fusión.
