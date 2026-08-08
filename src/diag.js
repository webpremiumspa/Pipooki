'use strict';

// Pagina de diagnostico del despliegue.
//
// Responde en cualquier ruta que termine en /_diag/<DIAG_TOKEN>, y se monta
// como el PRIMER middleware, antes de la normalizacion del BASE_PATH y antes
// de la sesion. Eso es deliberado: tiene que contestar aunque la aplicacion
// este mal montada, que es justo cuando hace falta.
//
// El token no es una clave: solo evita que la pagina quede a la vista de
// cualquiera. No se muestra ninguna credencial, unicamente si esta definida.

const fs = require('fs');
const path = require('path');
const os = require('os');

const DIAG_TOKEN = 'r7k2wq9m';

// Variables cuya PRESENCIA se informa. Los valores nunca se muestran, salvo
// los que no son secretos y hacen falta para diagnosticar.
const EXPECTED = [
  'NODE_ENV', 'PORT', 'BASE_PATH', 'PUBLIC_URL', 'SESSION_SECRET',
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'ADMIN_NOTIFY_EMAIL'
];
const SAFE_TO_SHOW = ['NODE_ENV', 'BASE_PATH', 'PUBLIC_URL', 'DB_HOST', 'DB_PORT', 'SMTP_HOST'];

// Lee el commit desplegado directamente de .git, para saber sin ambiguedad que
// version esta corriendo el servidor.
function deployedCommit(rootDir) {
  try {
    const head = fs.readFileSync(path.join(rootDir, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head.slice(0, 7);
    const ref = head.replace('ref:', '').trim();
    const sha = fs.readFileSync(path.join(rootDir, '.git', ref), 'utf8').trim();
    return sha.slice(0, 7);
  } catch (err) {
    return 'desconocido (' + err.code + ')';
  }
}

function build(config, pool, req) {
  const envReport = {};
  EXPECTED.forEach((name) => {
    const value = process.env[name];
    if (value === undefined) envReport[name] = 'NO DEFINIDA';
    else if (value === '') envReport[name] = 'definida pero VACIA';
    else if (SAFE_TO_SHOW.includes(name)) envReport[name] = value;
    else envReport[name] = 'definida (' + value.length + ' caracteres)';
  });

  return {
    despliegue: {
      commit: deployedCommit(config.rootDir),
      rutaDeLaApp: config.rootDir,
      node: process.version,
      servidor: os.hostname(),
      arrancadaHace: Math.round(process.uptime()) + ' s',
      cwd: process.cwd()
    },
    configuracionEfectiva: {
      entorno: config.env,
      basePath: config.basePath || '(vacio: montada en la raiz)',
      publicUrl: config.publicUrl,
      urlDeEjemploDeUnQR: config.tagUrl('ejemplo01'),
      baseDeDatos: `${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`,
      smtp: config.smtp.host ? `${config.smtp.host} como ${config.smtp.user}` : 'SIN CONFIGURAR'
    },
    variablesDeEntorno: envReport,
    peticion: {
      // Si urlRecibida ya viene sin el prefijo, Passenger lo esta quitando.
      urlRecibida: req.originalUrl,
      host: req.headers.host,
      protocolo: req.headers['x-forwarded-proto'] || req.protocol
    }
  };
}

function middleware(config, pool) {
  const suffix = '/_diag/' + DIAG_TOKEN;

  return function diag(req, res, next) {
    const pathOnly = String(req.url || '').split('?')[0];
    if (pathOnly !== suffix && !pathOnly.endsWith(suffix)) return next();

    const report = build(config, pool, req);

    pool.query('SELECT 1')
      .then(() => { report.baseDeDatos = 'CONEXION CORRECTA'; })
      .catch((err) => { report.baseDeDatos = `ERROR: ${err.code || ''} ${err.message}`; })
      .then(() => {
        res.set('Content-Type', 'application/json; charset=utf-8');
        res.set('Cache-Control', 'no-store');
        res.status(200).send(JSON.stringify(report, null, 2));
      });
  };
}

module.exports = { middleware, DIAG_TOKEN };
