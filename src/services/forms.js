'use strict';

// Helpers de lectura y validacion compartidos por el panel y el formulario
// publico, para que las dos vias guarden exactamente lo mismo.

const SPECIES = ['perro', 'gato', 'otro'];
const SEXES = ['macho', 'hembra', ''];

function str(value, max) {
  const v = String(value == null ? '' : value).trim();
  return v ? v.slice(0, max) : null;
}

function required(value, max) {
  return str(value, max) || '';
}

function intOrNull(value, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function page(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || ''));
}

// Cuenta los digitos: un telefono chileno valido tiene 8 o 9 sin el pais,
// 11 con el +56.
function looksLikePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

// Extrae los campos de un prefijo y los devuelve sin el. Lo necesita el
// formulario de registro, donde conviven los datos del dueno y los de la
// mascota y los dos tienen un campo "name".
function prefixed(body, prefix) {
  const out = {};
  Object.keys(body || {}).forEach((key) => {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = body[key];
  });
  return out;
}

// Campos de la mascota que puede llenar tanto el administrador como el dueno.
function readPetCommon(body) {
  return {
    name: required(body.name, 120),
    species: SPECIES.includes(body.species) ? body.species : 'perro',
    breed: str(body.breed, 120),
    color: str(body.color, 120),
    sex: SEXES.includes(body.sex) ? (body.sex || null) : null,
    birth_year: intOrNull(body.birth_year, 1990, new Date().getFullYear()),
    sterilized: body.sterilized ? 1 : 0,
    chip_number: str(body.chip_number, 60),
    medical_notes: str(body.medical_notes, 2000),
    behavior_notes: str(body.behavior_notes, 2000)
  };
}

// Datos de contacto que puede llenar tanto el administrador como el dueno.
function readOwnerCommon(body) {
  return {
    name: required(body.name, 150),
    phone: required(body.phone, 40),
    phone_alt: str(body.phone_alt, 40),
    email: str(body.email, 190),
    address: str(body.address, 255),
    comuna: str(body.comuna, 120),
    city: str(body.city, 120)
  };
}

function validateOwnerCommon(owner) {
  const errors = [];
  if (!owner.name) errors.push('El nombre es obligatorio.');
  if (owner.name && !owner.name.includes(' ')) {
    errors.push('Escribe el nombre y el apellido.');
  }
  if (!owner.phone) {
    errors.push('El telefono es obligatorio.');
  } else if (!looksLikePhone(owner.phone)) {
    errors.push('El telefono no parece valido. Ejemplo: +56 9 1234 5678');
  }
  if (!owner.email) {
    errors.push('El correo es obligatorio: ahi llegan los avisos cuando escanean el QR.');
  } else if (!isEmail(owner.email)) {
    errors.push('El correo no tiene un formato valido.');
  }
  if (owner.phone_alt && !looksLikePhone(owner.phone_alt)) {
    errors.push('El telefono alternativo no parece valido.');
  }
  return errors;
}

module.exports = {
  SPECIES,
  SEXES,
  str,
  required,
  intOrNull,
  page,
  isEmail,
  looksLikePhone,
  prefixed,
  readPetCommon,
  readOwnerCommon,
  validateOwnerCommon
};
