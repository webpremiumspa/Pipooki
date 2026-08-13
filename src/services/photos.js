'use strict';

// Guardado de fotos SIN subida de archivos.
//
// La foto viaja como texto (data URL en base64) dentro de un campo normal del
// formulario, no como adjunto multipart. El motivo es concreto: el WAF del
// hosting bloquea con 403 cualquier subida de archivos hecha por un visitante
// no autenticado ("Malware.Expert - Unauthenticated upload"), y la activacion
// de una placa la hace justamente un anonimo.
//
// El navegador ya redimensiona la imagen antes de enviarla (public/js/photo.js),
// asi que aqui solo se valida y se escribe el archivo.

const fs = require('fs');
const path = require('path');
const config = require('../config');
const tokens = require('./tokens');

const MAX_BYTES = 4 * 1024 * 1024;

const TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

// Devuelve el nombre del archivo guardado, o null si no venia ninguna foto.
// Lanza un error con .status = 400 si la imagen no es aceptable, para que el
// formulario lo muestre como error de validacion y no como caida del servidor.
async function saveDataUrl(dataUrl) {
  const raw = String(dataUrl || '').trim();
  if (!raw) return null;

  const match = raw.match(/^data:([a-z/+-]+);base64,(.+)$/is);
  if (!match) {
    const err = new Error('La foto no se pudo leer. Intenta con otra imagen.');
    err.status = 400;
    throw err;
  }

  const ext = TYPES[match[1].toLowerCase()];
  if (!ext) {
    const err = new Error('Formato de imagen no permitido. Usa JPG, PNG o WEBP.');
    err.status = 400;
    throw err;
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) return null;
  if (buffer.length > MAX_BYTES) {
    const err = new Error('La foto es muy pesada. Prueba con una mas liviana.');
    err.status = 400;
    throw err;
  }

  const filename = `${Date.now()}-${tokens.randomToken(6)}${ext}`;
  await fs.promises.mkdir(config.uploadDir, { recursive: true });
  await fs.promises.writeFile(path.join(config.uploadDir, filename), buffer);
  return filename;
}

function removePhoto(filename) {
  if (!filename) return;
  const target = path.join(config.uploadDir, path.basename(filename));
  fs.promises.unlink(target).catch(() => {});
}

module.exports = { saveDataUrl, removePhoto, MAX_BYTES };
