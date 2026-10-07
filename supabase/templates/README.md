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

El encabezado lleva el logo de Aliados del Sol (izquierda) y el de GEENERA (derecha). Los archivos están en
`img/` a doble resolución (se muestran a 81×56 y 126×52 px), en **PNG con fondo blanco sólido** (sin
transparencia), y deben estar publicados en una dirección pública y permanente, porque el correo los descarga
al abrirse: los Preview de Vercel están protegidos y no sirven. Se publican en el sitio de GEENERA:
`https://geenera.com/wp-content/uploads/logo-aliados-del-sol.png` y
`https://geenera.com/wp-content/uploads/logo-geenera.png`.

**Por qué PNG con fondo blanco** (oct 2026): la primera versión usaba WebP con fondo transparente. Varios lectores
de correo pintan la transparencia de negro (las letras oscuras del logo casi no se leían) y Outlook de escritorio
para Windows no muestra WebP. Un PNG sin transparencia se ve igual en todos, sobre la tarjeta blanca del correo.
**Primero se suben los PNG a geenera.com y después se pegan las plantillas**; si no, el correo mostraría el texto
alternativo ("Aliados del Sol" y "GEENERA"), que también es lo que se ve si el lector bloquea las imágenes.

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
