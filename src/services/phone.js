'use strict';

// Normaliza numeros chilenos a formato internacional sin signos, que es lo
// que necesita el link wa.me. Acepta "+56 9 1234 5678", "9 1234 5678",
// "091234567", etc. Si no logra interpretarlo, devuelve solo los digitos.
function toWhatsApp(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('56')) return digits;
  digits = digits.replace(/^0+/, '');
  // Movil chileno: 9 + 8 digitos. Fijo Santiago: 2 + 8 digitos.
  if (digits.length === 9 || digits.length === 8) return '56' + digits;
  return digits;
}

// Formato legible: +56 9 1234 5678
function pretty(raw) {
  const d = toWhatsApp(raw);
  if (d.startsWith('56') && d.length === 11) {
    return `+56 ${d[2]} ${d.slice(3, 7)} ${d.slice(7)}`;
  }
  if (d.startsWith('56') && d.length === 10) {
    return `+56 ${d[2]} ${d.slice(3, 6)} ${d.slice(6)}`;
  }
  return raw ? String(raw).trim() : '';
}

// Link para marcar desde el telefono.
function toTel(raw) {
  const d = toWhatsApp(raw);
  return d ? '+' + d : '';
}

module.exports = { toWhatsApp, pretty, toTel };
