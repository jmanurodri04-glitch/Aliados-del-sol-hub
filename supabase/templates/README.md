# Plantillas de correo de Supabase Auth

Plantillas en español de los correos que envía Supabase Auth por el SMTP propio (Resend, remitente
`Aliados del Sol · GEENERA <no-reply@notificaciones.geenera.com>`). Son la fuente de verdad: se pegan en el
panel de cada proyecto (`aliados-dev` y `aliados-prod`) y `supabase/config.toml` las usa en la base local.

| Archivo | Panel: Authentication → Emails → | Asunto |
|---|---|---|
| `confirmacion.html` | Templates → **Confirm sign up** | `Confirma tu correo · Aliados del Sol` |
| `recuperacion.html` | Templates → **Reset password** | `Restablece tu contraseña · Aliados del Sol` |
| `cambio_correo.html` | Templates → **Change email address** | `Confirma el cambio de correo · Aliados del Sol` |
| `contrasena_cambiada.html` | Security notifications → **Password changed** (activarla) | `Tu contraseña cambió · Aliados del Sol` |

Las demás plantillas (Invite user, Magic link, Reauthentication) no se usan: el Hub no envía invitaciones
ni enlaces mágicos por correo (la invitación de operadores de la fase 11 es un enlace que el panel muestra).

## Logos

El encabezado lleva el logo de Aliados del Sol (izquierda) y el de GEENERA (derecha). Los archivos fuente están
en `img/` a doble resolución (se muestran a 81×56 y 126×52 px) en **PNG con fondo blanco sólido** (sin
transparencia). Deben estar publicados en una dirección pública y permanente, porque el correo los descarga al
abrirse (los Preview de Vercel están protegidos y no sirven). Las plantillas usan las direcciones del sitio de
GEENERA:

- `https://geenera.com/wp-content/uploads/logo-aliados-del-sol.webp`
- `https://geenera.com/wp-content/uploads/logo-geenera.webp`

**Por qué WebP y no PNG** (oct 2026): al subir los PNG por la Biblioteca de medios, WordPress los convierte a WebP
(lo hace el sitio, no el Hub), así que la dirección pública queda en `.webp`. Lo importante es que el archivo
publicado **no tenga transparencia**: la primera versión era transparente y varios lectores de correo pintaban
el fondo de negro (las letras oscuras del logo casi no se leían). Con fondo blanco se ve bien sobre la tarjeta del
correo. **Límite conocido:** Outlook de escritorio para Windows no muestra WebP y muestra el texto alternativo
("Aliados del Sol" y "GEENERA"); para cubrirlo habría que publicar el PNG sin convertir (desactivar la
conversión del plugin para estos dos archivos o subirlos por el administrador de archivos del hosting) y cambiar
la extensión en las cuatro plantillas.

**`?v=2` al final de cada dirección:** los lectores de correo del celular (y el proxy de imágenes de Gmail)
guardan la imagen por su dirección. Como los WebP nuevos quedaron con el mismo nombre que los transparentes, el
celular seguía mostrando la copia vieja. Cambiar el número obliga a descargar la nueva; si se vuelve a reemplazar
un logo con el mismo nombre, hay que subir el número (`?v=3`) en las cuatro plantillas.

**Resolución:** el celular tiene pantallas de 3× o más, así que conviene que el archivo tenga al menos 4 veces el
tamaño en que se muestra. El de Aliados del Sol ya está a 4× (323×224, generado de `assets/logo-aliados.png`); el de
GEENERA sigue a 2× (252×104) porque el repositorio no tiene una versión más grande del logo completo.

**Cómo comprobar:** abrir las dos direcciones en el navegador. Deben verse con fondo blanco. Si se ven con fondo
transparente (cuadros grises o negro), el sitio conservó los archivos anteriores: hay que borrarlos de la
Biblioteca de medios y volver a subir los de `img/`.

## Cómo se pega

1. Copiar el contenido completo del archivo y pegarlo en *Message body* (vista de código).
2. Escribir el asunto de la tabla.
3. *Save* y enviarse una prueba (Parte 6 de la configuración, `docs/GUIA_HUB.md` §10).

## Reglas

- **Sin marketing, solo los dos logos como imágenes y con un solo enlace** (el botón; la dirección en texto es el mismo enlace).
  Así lo recomienda Supabase para que los correos no caigan en spam.
- **Vigencia:** el texto dice "vence en 24 horas" porque *Email OTP Expiration* = `86400` en ambos proyectos.
  Si se cambia ese valor, hay que cambiar el texto de las plantillas y el del panel (`js/admin.js`, enlace
  de operadores).
- **Recuperación de contraseña:** el enlace no es el `{{ .ConfirmationURL }}` de Supabase sino
  `{{ .RedirectTo }}#recuperacion={{ .TokenHash }}`. El Hub solo gasta el código (`verifyOtp`) cuando la
  persona guarda la contraseña nueva, así un antivirus de correo (p. ej. Microsoft Defender Safe Links) o
  una vista previa que abra el enlace no lo invalida. Es el mismo patrón de la invitación de operadores
  (`js/canje.js`).
- **Confirmación de registro** usa `{{ .ConfirmationURL }}`: si un antivirus abre el enlace, el correo
  igual queda confirmado, y el Hub ya explica qué hacer si el enlace se vio "usado".
- `{{ .Data.nombre_completo }}` sale de los metadatos del registro; si no existe, el saludo es "Hola:".
- Contacto: `c.arenas@geenera.com`. No hay *Reply-To* porque el panel de Supabase no lo permite.
