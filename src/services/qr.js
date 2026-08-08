'use strict';

const QRCode = require('qrcode');
const config = require('../config');

// Nivel Q: tolera hasta ~25% de dano. Importante en una placa de collar que
// se raya, se moja y recibe golpes.
const BASE_OPTIONS = {
  errorCorrectionLevel: 'Q',
  type: 'png',
  margin: 3,
  color: { dark: '#000000', light: '#FFFFFF' }
};

async function pngBuffer(code, size = 1024) {
  const px = Math.min(Math.max(parseInt(size, 10) || 1024, 128), 2048);
  return QRCode.toBuffer(config.tagUrl(code), { ...BASE_OPTIONS, width: px });
}

async function dataUrl(code, size = 320) {
  const px = Math.min(Math.max(parseInt(size, 10) || 320, 128), 1024);
  return QRCode.toDataURL(config.tagUrl(code), { ...BASE_OPTIONS, width: px });
}

module.exports = { pngBuffer, dataUrl };
