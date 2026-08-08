'use strict';

// Limitador simple en memoria. Suficiente para un unico proceso de Passenger;
// su objetivo es frenar fuerza bruta y scraping de tokens, no trafico masivo.
const buckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref();

function rateLimit({ windowMs = 60_000, max = 30, key = null, message = 'Demasiados intentos. Espera un momento.' } = {}) {
  return function limiter(req, res, next) {
    const id = (key ? key(req) : req.ip) + '|' + req.baseUrl + req.path;
    const now = Date.now();
    let entry = buckets.get(id);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(id, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retry = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retry));
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(429).json({ ok: false, error: message });
      }
      const err = new Error(message);
      err.status = 429;
      return next(err);
    }
    next();
  };
}

module.exports = { rateLimit };
