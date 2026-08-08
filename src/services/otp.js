'use strict';

const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const tokens = require('./tokens');

// Los codigos no se guardan en claro: en la base queda solo el HMAC. Aunque
// sean de un solo uso y duren minutos, no hay razon para almacenarlos.
function hash(code) {
  return crypto.createHmac('sha256', config.sessionSecret)
    .update(String(code).trim())
    .digest('hex');
}

function matches(code, storedHash) {
  const a = Buffer.from(hash(code), 'hex');
  const b = Buffer.from(String(storedHash || ''), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function expiry() {
  return new Date(Date.now() + config.otpMinutes * 60_000);
}

// ------------------------- Acceso del dueno (editar) ------------------------

// Devuelve el codigo en claro para enviarlo por correo. Se invalidan los
// anteriores para que solo sirva el ultimo que recibio.
async function issueAccessCode(email, ip) {
  await db.query(
    'UPDATE otp_codes SET consumed_at = NOW() WHERE email = ? AND consumed_at IS NULL',
    [email]
  );
  const code = tokens.otpCode();
  await db.query(
    'INSERT INTO otp_codes (email, code_hash, expires_at, ip) VALUES (?, ?, ?, ?)',
    [email, hash(code), expiry(), ip || null]
  );
  return code;
}

// Devuelve { ok } o { ok: false, reason }.
async function checkAccessCode(email, code) {
  const row = await db.one(
    `SELECT * FROM otp_codes
      WHERE email = ? AND consumed_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [email]
  );

  if (!row) return { ok: false, reason: 'sin-codigo' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'vencido' };
  if (row.attempts >= config.otpMaxAttempts) return { ok: false, reason: 'bloqueado' };

  if (!matches(code, row.code_hash)) {
    await db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    const left = config.otpMaxAttempts - (row.attempts + 1);
    return { ok: false, reason: 'incorrecto', attemptsLeft: Math.max(left, 0) };
  }

  await db.query('UPDATE otp_codes SET consumed_at = NOW() WHERE id = ?', [row.id]);
  return { ok: true };
}

module.exports = { hash, matches, expiry, issueAccessCode, checkAccessCode };
