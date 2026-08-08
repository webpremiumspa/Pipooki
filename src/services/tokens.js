'use strict';

const crypto = require('crypto');
const db = require('../db');

// Alfabeto del codigo de la placa: minusculas sin caracteres ambiguos
// (se excluyen i, l, o y el 0). Va dentro de la URL del QR.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz123456789';
const LENGTH = 8;

// Alfabeto del PIN: mayusculas, porque va impreso en el inserto del empaque y
// alguien lo va a teclear a mano mirandolo.
const PIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PIN_LENGTH = 6;

function pick(alphabet, length) {
  let out = '';
  while (out.length < length) {
    const bytes = crypto.randomBytes(length * 2);
    for (const byte of bytes) {
      // Se descartan los valores que sesgarian el alfabeto.
      if (byte >= 256 - (256 % alphabet.length)) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

function randomToken(length = LENGTH) {
  return pick(ALPHABET, length);
}

function randomPin() {
  return pick(PIN_ALPHABET, PIN_LENGTH);
}

async function uniqueTagCode() {
  for (let i = 0; i < 12; i += 1) {
    const code = randomToken();
    const existing = await db.one('SELECT id FROM tags WHERE code = ? LIMIT 1', [code]);
    if (!existing) return code;
  }
  throw new Error('No fue posible generar un codigo de placa unico.');
}

// Codigo OTP de 6 digitos. Se usan digitos y no letras porque en el celular
// abre el teclado numerico y se copia mejor desde el correo.
function otpCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

module.exports = {
  randomToken,
  randomPin,
  uniqueTagCode,
  otpCode,
  ALPHABET,
  LENGTH,
  PIN_ALPHABET,
  PIN_LENGTH
};
