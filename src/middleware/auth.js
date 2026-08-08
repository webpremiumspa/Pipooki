'use strict';

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  const target = req.originalUrl || '/admin';
  req.session.returnTo = target;
  return res.redirect(res.locals.url('/admin/login'));
}

module.exports = { requireAdmin };
