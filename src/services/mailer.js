'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!config.smtp.host || !config.smtp.user) return null;
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.password }
  });
  return transporter;
}

// El envio de correo nunca debe romper la pagina publica: si el SMTP falla,
// se registra el error y la persona que encontro la mascota sigue pudiendo
// contactar al dueno por telefono o WhatsApp.
async function send({ to, subject, html, text }) {
  if (!to) return { ok: false, skipped: 'sin destinatario' };
  const tx = getTransporter();
  if (!tx) {
    console.warn('[mailer] SMTP no configurado, se omite el envio a', to);
    return { ok: false, skipped: 'smtp no configurado' };
  }
  try {
    const info = await tx.sendMail({ from: config.smtp.from, to, subject, html, text });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('[mailer] error enviando a', to, err.message);
    return { ok: false, error: err.message };
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout(title, bodyHtml) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f5f7;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1f2430;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e6ec;">
      <tr><td style="background:#0f766e;padding:18px 24px;color:#ffffff;font-size:16px;font-weight:bold;">${escapeHtml(config.brandName)} · Alerta de placa QR</td></tr>
      <tr><td style="padding:24px;">
        <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;">${escapeHtml(title)}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e3e6ec;font-size:12px;color:#6b7280;">
        Este aviso es automatico. Lo envia el sistema de placas QR de ${escapeHtml(config.brandName)}.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function fmtDate(date) {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Santiago'
  }).format(date);
}

// Aviso 1: alguien abrio la pagina del QR.
async function notifyScan({ owner, pet, when }) {
  const date = fmtDate(when || new Date());
  const subject = `Escanearon la placa de ${pet.name}`;
  const html = layout(`Alguien escaneo la placa de ${pet.name}`, `
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
      Hola ${escapeHtml(owner.name)}, se acaba de abrir la pagina de identificacion de
      <strong>${escapeHtml(pet.name)}</strong>.
    </p>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
      <strong>Fecha:</strong> ${escapeHtml(date)}
    </p>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
      Si la persona comparte su ubicacion, te llegara un segundo correo con el mapa.
      Manten el telefono a mano por si te llaman o te escriben por WhatsApp.
    </p>`);
  const text = `Alguien escaneo la placa de ${pet.name} el ${date}. Si comparten su ubicacion recibiras otro correo con el mapa.`;
  return send({ to: owner.email, subject, html, text });
}

// Aviso 2: ademas compartieron coordenadas.
async function notifyLocation({ owner, pet, lat, lng, accuracy, when }) {
  const date = fmtDate(when || new Date());
  const maps = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const subject = `Ubicacion de ${pet.name} compartida`;
  const html = layout(`Compartieron la ubicacion de ${pet.name}`, `
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
      Hola ${escapeHtml(owner.name)}, la persona que escaneo la placa de
      <strong>${escapeHtml(pet.name)}</strong> compartio su ubicacion.
    </p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">
      <strong>Fecha:</strong> ${escapeHtml(date)}<br>
      <strong>Coordenadas:</strong> ${escapeHtml(lat)}, ${escapeHtml(lng)}<br>
      ${accuracy ? `<strong>Precision aproximada:</strong> ${escapeHtml(accuracy)} metros` : ''}
    </p>
    <p style="margin:0 0 18px;">
      <a href="${maps}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:bold;">Ver en Google Maps</a>
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
      Si el boton no funciona, copia este enlace: ${maps}
    </p>`);
  const text = `Compartieron la ubicacion de ${pet.name} el ${date}.\nCoordenadas: ${lat}, ${lng}\nMapa: ${maps}`;
  return send({ to: owner.email, subject, html, text });
}

// ---------------------------- Codigos OTP -----------------------------------

function codeBlock(code) {
  return `<p style="margin:0 0 18px;text-align:center;">
    <span style="display:inline-block;background:#f1f5f4;border:1px solid #cfe2e0;border-radius:12px;
                 padding:16px 28px;font-size:34px;font-weight:bold;letter-spacing:.28em;
                 font-family:ui-monospace,Menlo,Consolas,monospace;color:#0b5b55;">${escapeHtml(code)}</span>
  </p>
  <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.6;text-align:center;">
    El codigo vence en ${config.otpMinutes} minutos y sirve una sola vez.
  </p>`;
}

// Confirmacion del correo durante la activacion de una placa.
async function verifyEmailCode({ to, name, petName, code }) {
  const subject = `${code} es tu codigo para activar la placa de ${petName}`;
  const html = layout('Confirma tu correo', `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">
      Hola ${escapeHtml(name)}, ingresa este codigo para terminar de activar la
      placa de <strong>${escapeHtml(petName)}</strong>.
    </p>
    ${codeBlock(code)}
    <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#6b7280;">
      Confirmamos tu correo porque es donde te avisaremos si alguien escanea la
      placa. Si te equivocaste al escribirlo, vuelve a la pagina y corrigelo.
    </p>
    <p style="margin:12px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">
      Si no fuiste tu, ignora este correo: sin el codigo la placa no se activa.
    </p>`);
  const text = `Tu codigo para activar la placa de ${petName} es ${code}. Vence en ${config.otpMinutes} minutos.`;
  return send({ to, subject, html, text });
}

// Codigo para entrar a editar los datos.
async function accessCode({ to, name, code }) {
  const subject = `${code} es tu codigo de acceso`;
  const html = layout('Tu codigo de acceso', `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">
      ${name ? 'Hola ' + escapeHtml(name) + ', i' : 'I'}ngresa este codigo para
      entrar a editar tus datos.
    </p>
    ${codeBlock(code)}
    <p style="margin:12px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">
      Si no lo pediste tu, ignora este correo. Nadie puede entrar sin el codigo.
    </p>`);
  const text = `Tu codigo de acceso es ${code}. Vence en ${config.otpMinutes} minutos.`;
  return send({ to, subject, html, text });
}

// ------------------------- Activacion de la placa ---------------------------

async function tagActivated({ owner, petName, tagCode, areaUrl }) {
  const subject = `La placa de ${petName} quedo activa`;
  const html = layout(`La placa de ${petName} ya funciona`, `
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
      Listo, ${escapeHtml(owner.name)}. La placa <strong>${escapeHtml(tagCode)}</strong>
      quedo enlazada a <strong>${escapeHtml(petName)}</strong>.
    </p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">
      Desde ahora, si alguien escanea el QR de su collar vera como contactarte y
      podra enviarte su ubicacion. A ti te llegara un aviso a este correo al
      instante.
    </p>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
      <strong>Manten tus datos al dia.</strong> Si cambias de telefono, la placa
      deja de servir. Para editarlos entra a ${escapeHtml(areaUrl)} y pide un
      codigo con este mismo correo.
    </p>
    <p style="margin:0;font-size:14px;line-height:1.6;color:#6b7280;">
      Prueba el QR ahora con la camara de tu celular, antes de que haga falta.
    </p>`);
  const text = `La placa ${tagCode} quedo enlazada a ${petName}. Para editar tus datos entra a ${areaUrl} y pide un codigo con este correo.`;
  return send({ to: owner.email, subject, html, text });
}

// Aviso al administrador de que se activo una placa del inventario.
async function tagActivatedForAdmin({ to, owner, petName, tagCode, reviewUrl }) {
  const subject = `Placa activada: ${tagCode} (${petName})`;
  const html = layout('Se activo una placa', `
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
      <strong>${escapeHtml(owner.name)}</strong> activo la placa
      <strong>${escapeHtml(tagCode)}</strong> para <strong>${escapeHtml(petName)}</strong>.
    </p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">
      Telefono: ${escapeHtml(owner.phone)}<br>
      Correo: ${escapeHtml(owner.email)}
    </p>
    <p style="margin:0 0 18px;">
      <a href="${reviewUrl}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:bold;">Ver la placa</a>
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
      Ya esta publicada. Si el contenido tiene algun problema, suspendela desde el panel.
    </p>`);
  const text = `${owner.name} activo la placa ${tagCode} para ${petName}. Ver: ${reviewUrl}`;
  return send({ to, subject, html, text });
}

async function tagSuspended({ owner, petName, reason }) {
  const subject = `La placa de ${petName} fue suspendida`;
  const html = layout('Suspendimos tu placa', `
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
      Hola ${escapeHtml(owner.name)}, suspendimos la placa de
      <strong>${escapeHtml(petName)}</strong>: por ahora no muestra tus datos de contacto.
    </p>
    ${reason ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;"><strong>Motivo:</strong> ${escapeHtml(reason)}</p>` : ''}
    <p style="margin:0;font-size:15px;line-height:1.6;">
      Si crees que es un error, respondenos este correo.
    </p>`);
  const text = `Suspendimos la placa de ${petName}.${reason ? ' Motivo: ' + reason : ''}`;
  return send({ to: owner.email, subject, html, text });
}

module.exports = {
  send,
  notifyScan,
  notifyLocation,
  verifyEmailCode,
  accessCode,
  tagActivated,
  tagActivatedForAdmin,
  tagSuspended,
  escapeHtml
};

