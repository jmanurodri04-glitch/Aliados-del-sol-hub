// Correo «Confirmación de empresa referida» con la invitación al MEDDPICC (decisión del equipo, oct 2026; CLAUDE.md §7).
// Función pura: arma el asunto, el HTML, el texto y el «Responder a». El texto lo aprobó el equipo.
//   * Todo referido nuevo del Hub recibe la confirmación.
//   * El bloque MEDDPICC (+20) solo va si el referido aplica: perfecto, o imperfecto con ciudad.
//   * «Responder» y el botón llevan al buzón de la regional de la ciudad (lib/correo/regiones.js).
//   * Si la cuenta no está activa, avisa que los puntos quedan en espera.

import { buzonMeddpicc } from './regiones.js';

export const ASUNTO = 'Confirmación de empresa referida';
const LOGO_ALIADOS = 'https://geenera.com/wp-content/uploads/logo-aliados-del-sol.webp?v=2';
const LOGO_GEENERA = 'https://geenera.com/wp-content/uploads/logo-geenera.webp?v=2';

export const PREGUNTAS_MEDDPICC = [
  ['Métricas', '¿cuánto paga hoy de energía al mes y qué ahorro le interesaría?'],
  ['Comprador económico', '¿quién aprueba la inversión? (nombre y cargo)'],
  ['Criterios de decisión', '¿qué es lo más importante para ellos? (precio, financiación, tiempo de retorno, sostenibilidad…)'],
  ['Proceso de decisión', '¿quiénes participan en la decisión y en qué orden?'],
  ['Proceso de papeles', '¿qué piden para contratar? (comité, compras, registro de proveedores, pólizas)'],
  ['Dolor identificado', '¿qué problema quieren resolver? (factura alta, cortes, metas ambientales)'],
  ['Campeón', '¿quién dentro de la empresa impulsa el proyecto?'],
  ['Competencia', '¿están evaluando otras empresas solares u otras opciones?']
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p = (html, estilo = '') => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;${estilo}">${html}</p>`;

/** Asunto del correo que el aliado nos envía con el MEDDPICC. */
export const asuntoMeddpicc = (empresa, codigo) => `MEDDPICC · ${empresa} · ${codigo}`;

/** Enlace mailto con el asunto y las 8 preguntas listas para responder. */
export function enlaceMeddpicc(buzon, empresa, codigo) {
  const cuerpo = `Empresa referida: ${empresa}\nMi código de aliado: ${codigo}\n\n` +
    PREGUNTAS_MEDDPICC.map(([t, q], i) => `${i + 1}. ${t} (${q})\n`).join('\n');
  return `mailto:${buzon}?subject=${encodeURIComponent(asuntoMeddpicc(empresa, codigo))}&body=${encodeURIComponent(cuerpo)}`;
}

/**
 * @param {object} r fila de correos_referido_reclamar: empresa, ciudad, aplica_meddpicc, nombre_aliado, codigo_aliado, estado_aliado
 * @param {{ entorno?: string }} opciones fuera de Production el asunto lleva [PRUEBA]
 * @returns {{ asunto: string, html: string, texto: string, responderA: string|null, buzon: string|null }}
 */
export function construirConfirmacion(r, { entorno = 'production' } = {}) {
  const nombre = String(r.nombre_aliado || '').trim();
  const empresa = String(r.empresa || '').trim() || 'tu referido';
  const ciudad = String(r.ciudad || '').trim();
  const codigo = String(r.codigo_aliado || '').trim();
  const meddpicc = r.aplica_meddpicc === true;
  const destino = meddpicc ? buzonMeddpicc(ciudad) : null;
  const activa = r.estado_aliado === 'activo';
  const asunto = (entorno === 'production' ? '' : '[PRUEBA] ') + ASUNTO;

  const saludo = nombre ? `Hola, ${nombre}:` : 'Hola:';
  const recibido = `Recibimos tu referido ${empresa}${ciudad ? ` (${ciudad})` : ''}. Ya está en el Hub y nuestro equipo comercial lo revisará. ` +
    'En tu historial verás los puntos que te dio el registro.';
  const espera = 'Tu cuenta aún no está activa. Los puntos quedarán en espera y se acreditarán cuando se active.';
  const explicacion = 'MEDDPICC es un método que usan los equipos comerciales para entender cómo decide una empresa. Si nos cuentas lo ' +
    'que sabes, podemos preparar una mejor propuesta y aumentan las probabilidades de cerrar el negocio. No necesitas tener todas ' +
    'las respuestas: comparte lo que conozcas.';
  const cierre = 'Cuando el equipo lo revise te sumaremos los +20 Puntos Sol. Se otorgan una vez por empresa referida y no tienes plazo para enviarlo.';

  // Texto plano (lectores sin HTML).
  const texto = [
    saludo, '', recibido, '',
    ...(meddpicc ? [
      'GANA 20 PUNTOS SOL ADICIONALES CON EL MEDDPICC', '', explicacion, '',
      ...PREGUNTAS_MEDDPICC.map(([t, q], i) => `${i + 1}. ${t}: ${q}`), '',
      `¿Cómo enviarlo? Responde este correo con tus respuestas o escribe a ${destino.buzon} con el asunto: ${asuntoMeddpicc(empresa, codigo)}`, '',
      cierre, ''
    ] : []),
    ...(activa ? [] : [espera, '']),
    'Equipo Aliados del Sol · GEENERA'
  ].join('\n');

  const bloqueMeddpicc = !meddpicc ? '' : `
        <tr>
          <td style="padding:6px 32px 0;">
            <div style="background:#FFF8DC;border-left:4px solid #FFCA05;border-radius:8px;padding:18px 20px;">
              <h2 style="margin:0 0 10px;font-size:18px;line-height:1.3;color:#1F1F23;">Gana 20 Puntos Sol adicionales con el MEDDPICC</h2>
              ${p(esc(explicacion))}
              <ol style="margin:0 0 4px;padding-left:20px;font-size:14.5px;line-height:1.6;">
                ${PREGUNTAS_MEDDPICC.map(([t, q]) => `<li style="margin:0 0 6px;"><b>${esc(t)}:</b> ${esc(q)}</li>`).join('\n                ')}
              </ol>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px 0;">
            ${p(`<b>¿Cómo enviarlo?</b> Responde este correo con tus respuestas o usa el botón. El asunto ya va escrito: <i>${esc(asuntoMeddpicc(empresa, codigo))}</i>.`)}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:4px 32px 18px;">
            <a href="${esc(enlaceMeddpicc(destino.buzon, empresa, codigo))}" style="display:inline-block;padding:13px 26px;background:#FFCA05;color:#1F1F23;font-size:15px;font-weight:bold;text-decoration:none;border-radius:8px;">Enviar mi MEDDPICC</a>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px;">
            ${p(esc(cierre))}
          </td>
        </tr>`;

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(ASUNTO)}</title>
</head>
<body style="margin:0;padding:0;background:#F4F3F0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3F0;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:10px;border-top:4px solid #FFCA05;font-family:Arial,Helvetica,sans-serif;color:#1F1F23;">
        <tr>
          <td style="padding:22px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #ECEAE6;">
              <tr>
                <td align="left" valign="middle" style="padding:0 0 18px;"><img src="${LOGO_ALIADOS}" width="81" height="56" alt="Aliados del Sol" style="display:block;width:81px;height:56px;border:0;outline:none;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#F39200;"></td>
                <td align="right" valign="middle" style="padding:0 0 18px;"><img src="${LOGO_GEENERA}" width="126" height="52" alt="GEENERA" style="display:block;width:126px;height:52px;border:0;outline:none;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#6F6F72;"></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px 0;">
            <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1F1F23;">${esc(ASUNTO)}</h1>
            ${p(esc(saludo))}
            ${p(`Recibimos tu referido <b>${esc(empresa)}</b>${ciudad ? ` (${esc(ciudad)})` : ''}. Ya está en el Hub y nuestro equipo comercial lo revisará. En tu historial verás los puntos que te dio el registro.`)}
          </td>
        </tr>${bloqueMeddpicc}${activa ? '' : `
        <tr>
          <td style="padding:0 32px;">
            ${p(esc(espera), 'color:#8A5A00;')}
          </td>
        </tr>`}
        <tr>
          <td style="padding:4px 32px 22px;">
            ${p('Equipo Aliados del Sol · GEENERA', 'margin:0;font-weight:bold;')}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 24px;border-top:1px solid #ECEAE6;font-size:12px;line-height:1.6;color:#8A8A90;">${meddpicc
            ? 'Si respondes este correo, tu mensaje le llega al equipo comercial de GEENERA.'
            : '¿Dudas? Escríbenos a c.arenas@geenera.com.<br>Este correo se envía automáticamente; no lo respondas.'}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { asunto, html, texto, responderA: destino ? destino.buzon : null, buzon: destino ? destino.buzon : null };
}
