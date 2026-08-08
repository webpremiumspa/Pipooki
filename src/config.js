'use strict';

const path = require('path');

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

// '/find' -> '/find' | '/find/' -> '/find' | '' | '/' -> ''
function normalizeBasePath(value) {
  let p = (value || '').trim();
  if (!p || p === '/') return '';
  if (!p.startsWith('/')) p = '/' + p;
  return p.replace(/\/+$/, '');
}

const rootDir = path.join(__dirname, '..');
// El dominio y el subdirectorio son constantes de este despliegue, no secretos.
// Van con valor por defecto para que la aplicacion quede bien montada aunque
// el servidor no alcance a inyectar las variables de entorno: sin esto, un
// BASE_PATH vacio hace que todas las rutas respondan 404 y que los enlaces
// apunten a la raiz del dominio.
// El operador ?? respeta BASE_PATH="" para montarla en la raiz en desarrollo.
const DEFAULT_BASE_PATH = '/find';
const DEFAULT_PUBLIC_URL = 'https://pipookis.cl';

const basePath = normalizeBasePath(process.env.BASE_PATH ?? DEFAULT_BASE_PATH);

module.exports = {
  rootDir,
  env: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: int(process.env.PORT, 3000),

  basePath,
  publicUrl: (process.env.PUBLIC_URL || DEFAULT_PUBLIC_URL).replace(/\/+$/, ''),

  sessionSecret: process.env.SESSION_SECRET || 'pipooki-dev-secret-cambiar',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pipooki_find'
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 465),
    secure: bool(process.env.SMTP_SECURE, true),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || ''
  },

  notifyCooldownMinutes: int(process.env.NOTIFY_COOLDOWN_MINUTES, 10),

  // A donde llega el aviso de "activaron una placa nueva".
  adminNotifyEmail: process.env.ADMIN_NOTIFY_EMAIL || '',

  // Minutos de validez de un codigo OTP.
  otpMinutes: int(process.env.OTP_MINUTES, 15),

  // Intentos permitidos por codigo OTP antes de invalidarlo.
  otpMaxAttempts: int(process.env.OTP_MAX_ATTEMPTS, 5),

  // Horas que se guarda un registro a medio hacer antes de descartarlo y
  // devolver la placa al estado libre.
  claimHours: int(process.env.CLAIM_HOURS, 24),

  // Duracion de la sesion del dueno despues de validar su OTP.
  ownerSessionMinutes: int(process.env.OWNER_SESSION_MINUTES, 30),

  // Intentos de PIN por placa antes de bloquear la activacion.
  pinMaxAttempts: int(process.env.PIN_MAX_ATTEMPTS, 10),

  // Placas por lote al fabricar.
  batchSize: int(process.env.BATCH_SIZE, 10),

  uploadDir: path.join(rootDir, 'public', 'uploads'),
  brandName: process.env.BRAND_NAME || 'Pipooki',

  // Texto exacto que el dueno acepta al registrarse. Se guarda la version junto
  // con la fecha y la IP, para poder acreditar que consintio esto y no otra
  // cosa si el texto cambia mas adelante.
  consent: {
    version: '2026-08',
    text: 'Autorizo que mi nombre y mi telefono se muestren publicamente a ' +
      'cualquier persona que escanee el codigo QR de la placa de mi mascota, y ' +
      'que mi direccion se entregue a quien la solicite desde esa misma pagina. ' +
      'Entiendo que puedo modificar mis datos o pedir la baja de la placa en ' +
      'cualquier momento.'
  },

  // URL que se codifica en el QR de la placa. Es la misma antes y despues de
  // activarla: si la placa esta libre lleva al registro, y si ya esta activa
  // muestra los datos de la mascota.
  tagUrl(code) {
    return `${this.publicUrl}${this.basePath}/p/${code}`;
  },

  // Donde el dueno pide su codigo para editar sus datos.
  ownerAreaUrl() {
    return `${this.publicUrl}${this.basePath}/mis-datos`;
  }
};
