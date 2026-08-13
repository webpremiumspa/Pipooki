'use strict';

// Recibe la foto como texto en el campo photo_data y la guarda en disco.
//
// Sustituye a la subida multipart: el WAF del hosting responde 403 a cualquier
// adjunto enviado por un visitante no autenticado, y la activacion de una placa
// la hace precisamente un anonimo.
//
// Deja el resultado en req.file con la misma forma que usaba multer, para que
// el resto de las rutas no tenga que cambiar.

const photos = require('../services/photos');

async function photoField(req, res, next) {
  try {
    const filename = await photos.saveDataUrl(req.body && req.body.photo_data);
    if (filename) req.file = { filename };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { photoField, removePhoto: photos.removePhoto };
