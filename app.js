'use strict';

// La configuracion se toma solo de las variables de entorno del sistema. En
// produccion las define cPanel en "Environment variables" de la aplicacion
// Node.js. Para desarrollo local: npm run dev, que usa --env-file.
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

const config = require('./src/config');
const { pool } = require('./src/db');
const publicRoutes = require('./src/routes/public');
const portalRoutes = require('./src/routes/portal');
const adminRoutes = require('./src/routes/admin');

const app = express();

// Passenger (cPanel) puede entregar la ruta con o sin el prefijo del
// "Application URL". Normalizamos para que las rutas internas se definan
// siempre desde la raiz y funcionen en los dos casos.
if (config.basePath) {
  app.use((req, res, next) => {
    const bp = config.basePath;
    if (req.url === bp) {
      req.url = '/';
    } else if (req.url.startsWith(bp + '/') || req.url.startsWith(bp + '?')) {
      req.url = req.url.slice(bp.length) || '/';
    }
    next();
  });
}

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(config.rootDir, 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  // El QR y las fotos deben poder mostrarse aunque se abran desde otro origen.
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

fs.mkdirSync(config.uploadDir, { recursive: true });
app.use(express.static(path.join(config.rootDir, 'public'), { maxAge: '7d' }));

app.use(session({
  name: 'pipooki.sid',
  secret: config.sessionSecret,
  store: new MySQLStore({ createDatabaseTable: true, clearExpired: true }, pool),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: config.basePath || '/',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

// Helpers disponibles en todas las vistas.
app.use((req, res, next) => {
  res.locals.url = (p) => `${config.basePath}${p}` || '/';
  res.locals.brand = config.brandName;
  res.locals.admin = req.session && req.session.admin ? req.session.admin : null;
  res.locals.flash = null;
  next();
});

app.use('/admin', adminRoutes);
app.use('/', portalRoutes);
app.use('/', publicRoutes);

app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Pagina no encontrada' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  const status = err.status || 500;
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).render('errors/500', {
      title: 'Archivo muy grande',
      message: 'La foto supera el tamano maximo permitido (4 MB).'
    });
  }
  res.status(status).render('errors/500', {
    title: 'Error',
    message: config.isProd ? null : err.message
  });
});

// Resumen de arranque. En cPanel el log es lo unico a lo que se puede recurrir
// cuando algo no levanta, asi que conviene que diga con que configuracion
// quedo realmente el proceso. No se imprime ninguna clave.
function logStartup() {
  const lines = [
    `puerto ${config.port} · entorno ${config.env}`,
    `base "${config.basePath || '/'}" · publico ${config.publicUrl}`,
    `mysql ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`,
    `smtp ${config.smtp.host ? config.smtp.host + ' como ' + config.smtp.user : 'SIN CONFIGURAR'}`
  ];
  lines.forEach((l) => console.log('[pipooki-find] ' + l));

  // Si faltan variables, la app arranca igual pero se comporta mal de formas
  // dificiles de diagnosticar. Conviene que el log lo diga en voz alta.
  const missing = ['BASE_PATH', 'PUBLIC_URL', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'SESSION_SECRET']
    .filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`[pipooki-find] FALTAN variables de entorno: ${missing.join(', ')}. ` +
      'Definelas en "Environment variables" de la aplicacion en cPanel y pulsa SAVE, no solo RESTART.');
  }
}

// Se comprueba la base al arrancar. Sin esto, un error de credenciales solo
// aparece cuando alguien intenta entrar al panel, y confunde el diagnostico.
async function checkDatabase() {
  try {
    await pool.query('SELECT 1');
    console.log('[pipooki-find] conexion a mysql correcta');
  } catch (err) {
    console.error(`[pipooki-find] ERROR de conexion a mysql: ${err.code || ''} ${err.message}`);
  }
}

app.listen(config.port, () => {
  logStartup();
  checkDatabase();
});

module.exports = app;
