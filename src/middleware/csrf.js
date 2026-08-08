'use strict';

const crypto = require('crypto');

// CSRF por token en sesion. Suficiente para un panel de un solo administrador
// y sin dependencias extra.
function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
    if (!sent || sent !== req.session.csrfToken) {
      const err = new Error('Token de seguridad invalido. Recarga la pagina e intenta de nuevo.');
      err.status = 403;
      return next(err);
    }
  }
  next();
}

module.exports = { csrf };
