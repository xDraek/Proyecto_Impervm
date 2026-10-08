// Correo saliente con Brevo, por su API web (el plan gratuito de Render no deja usar SMTP).
//
//   BREVO_API_KEY   clave de la API de Brevo (Ajustes → SMTP y API → Claves API)
//   MAIL_FROM       remitente verificado en Brevo (por ejemplo, tu Gmail)
//   MAIL_FROM_NAME  nombre que ve el jugador (por defecto, «Imperium»)
//
// Sin clave, los correos no se mandan: se escriben en la consola del servidor, para probar en local.

import { escapeHtml } from '../src/ui/format.js';

export const mailEnabled = () => !!process.env.BREVO_API_KEY;

/**
 * Dirección pública del juego para los enlaces de los correos. Nunca se toma de la petición
 * (alguien podría falsear la cabecera Host y colar un enlace a otra web para robar cuentas);
 * en local, sin correo de verdad, vale la del navegador.
 */
export function publicUrl(req) {
  const fixed = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (fixed) return fixed.replace(/\/+$/, '');
  if (!mailEnabled()) return `http://${req.headers.host ?? 'localhost'}`;
  throw new Error('Falta PUBLIC_URL: la dirección pública del juego para los enlaces de los correos.');
}

/** Un correo sencillo con el estilo del juego y un botón con el enlace. */
function template({ title, lines, button, link, foot }) {
  const p = (t) => `<p style="margin:0 0 14px;line-height:1.5">${t}</p>`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#1d1813;font-family:Georgia,serif;color:#f3ead8">
  <div style="max-width:520px;margin:0 auto;background:#28211a;border:1px solid #5a4a2a;border-radius:12px;padding:28px">
    <h1 style="margin:0 0 18px;font-size:24px;color:#f2c94c;letter-spacing:1px">⚜ Imperium</h1>
    <h2 style="margin:0 0 14px;font-size:18px;color:#f3ead8">${escapeHtml(title)}</h2>
    ${lines.map((l) => p(l)).join('')}
    <p style="margin:22px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#e0b23e;color:#2b2014;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px;font-family:Arial,sans-serif">${escapeHtml(button)}</a></p>
    <p style="margin:0 0 14px;font-size:12px;color:#b9ab90;line-height:1.5">Si el botón no funciona, copia esta dirección en el navegador:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
    <p style="margin:0;font-size:12px;color:#b9ab90">${foot}</p>
  </div></body></html>`;
  const text = `Imperium\n\n${title}\n\n${lines.map((l) => l.replace(/<[^>]+>/g, '')).join('\n\n')}\n\n${button}: ${link}\n\n${foot.replace(/<[^>]+>/g, '')}`;
  return { html, text };
}

export const MAILS = {
  registro: ({ username, link }) => ({
    subject: 'Confirma tu cuenta de Imperium',
    ...template({
      title: `¡Bienvenido, ${username}!`,
      lines: ['Solo falta un paso para fundar tu ciudad: confirma que este correo es tuyo.', 'El enlace vale durante 24 horas.'],
      button: 'Confirmar mi cuenta',
      link,
      foot: 'Si no has creado ninguna cuenta en Imperium, no hagas nada: sin confirmar, se borra sola.',
    }),
  }),
  correo: ({ username, link }) => ({
    subject: 'Confirma tu correo en Imperium',
    ...template({
      title: `Hola, ${username}`,
      lines: ['Has pedido usar este correo en tu cuenta de Imperium. Confírmalo con el botón.', 'El enlace vale durante 24 horas.'],
      button: 'Confirmar el correo',
      link,
      foot: 'Si no has sido tú, no hagas nada: el correo de tu cuenta no cambiará.',
    }),
  }),
  clave: ({ username, link }) => ({
    subject: 'Cambia tu contraseña de Imperium',
    ...template({
      title: `Hola, ${username}`,
      lines: ['Alguien (seguramente tú) ha pedido una contraseña nueva para tu cuenta.', 'El enlace vale durante 1 hora y solo se puede usar una vez.'],
      button: 'Poner una contraseña nueva',
      link,
      foot: 'Si no lo has pedido tú, no hagas nada: tu contraseña sigue igual.',
    }),
  }),
};

/** Manda un correo (o, sin Brevo, lo escribe en la consola). */
export async function sendMail(to, { subject, html, text }) {
  if (!mailEnabled()) {
    console.log(`\n✉️  [correo sin mandar: falta BREVO_API_KEY] Para: ${to}\n   ${subject}\n${text.replace(/^/gm, '   ')}\n`);
    return;
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM, name: process.env.MAIL_FROM_NAME || 'Imperium' },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  if (!res.ok) {
    console.error('Brevo no ha aceptado el correo', res.status, await res.text().catch(() => ''));
    throw new Error('mail');
  }
}
