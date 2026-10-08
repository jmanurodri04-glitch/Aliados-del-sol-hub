// Microsoft Clarity (mapas de calor y grabaciones de sesión para el equipo de marketing; CLAUDE.md §10).
// Solo se carga en Production: GET /api/config entrega clarityProjectId únicamente ahí (variable CLARITY_PROJECT_ID).
// Privacidad: las sesiones son anónimas (no se llama a identify ni se envían etiquetas con datos del aliado); el Hub,
// los formularios y el login llevan data-clarity-mask="true" (texto tapado) y en el proyecto de Clarity el enmascarado
// está en «Strict». No se carga si la dirección trae un código (confirmación de correo, recuperación, invitación o QR),
// para que nunca llegue a Clarity. admin.html y canje.html no incluyen este archivo.

const ID_VALIDO = /^[a-z0-9]{6,20}$/i;

// Cualquier «=» en el hash o en la búsqueda es un parámetro (access_token, token_hash, recuperacion=…, q=…, code=…).
function urlConCodigo() {
  return window.location.hash.includes('=') || window.location.search.includes('=');
}

async function iniciar() {
  if (urlConCodigo()) return;
  let id = null;
  try {
    const r = await fetch('/api/config', { headers: { accept: 'application/json' } });
    if (r.ok) id = (await r.json()).clarityProjectId || null;
  } catch { return; }
  if (!id || !ID_VALIDO.test(id)) return;

  // Fragmento oficial de instalación manual de Clarity, con el id del proyecto desde la configuración.
  window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.clarity.ms/tag/' + encodeURIComponent(id);
  document.head.appendChild(s);
}

iniciar();
