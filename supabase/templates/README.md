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

## Cómo se pega

1. Copiar el contenido completo del archivo y pegarlo en *Message body* (vista de código).
2. Escribir el asunto de la tabla.
3. *Save* y enviarse una prueba (Parte 6 de la configuración, `docs/GUIA_HUB.md` §10).

## Reglas

- **Sin marketing, sin imágenes y con un solo enlace** (el botón; la dirección en texto es el mismo enlace).
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
