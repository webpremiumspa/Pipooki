'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../config');
const tokens = require('../services/tokens');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '').toLowerCase().match(/^\.(jpe?g|png|webp)$/) || ['.jpg'])[0];
    cb(null, `${Date.now()}-${tokens.randomToken(6)}${ext}`);
  }
});

const uploadPhoto = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Formato de imagen no permitido. Usa JPG, PNG o WEBP.'));
  }
}).single('photo');

function removePhoto(filename) {
  if (!filename) return;
  const target = path.join(config.uploadDir, path.basename(filename));
  fs.promises.unlink(target).catch(() => {});
}

module.exports = { uploadPhoto, removePhoto };
