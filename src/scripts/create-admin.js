'use strict';

// Crea o actualiza un administrador.
//
// Igual que setup-db, corre en el terminal y no ve las variables que cPanel
// inyecta a la aplicacion. Hay que pasarlas en la misma linea:
//
//   DB_NAME=usuario_base DB_USER=usuario_x DB_PASSWORD='clave' \
//     node src/scripts/create-admin.js --email tu@correo.cl --password "clave"

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const email = (arg('email') || '').toLowerCase().trim();
  if (!email) {
    console.error('Falta --email');
    process.exit(1);
  }
  const name = arg('name') || email.split('@')[0];
  const password = arg('password') || crypto.randomBytes(9).toString('base64url');
  const hash = await bcrypt.hash(password, 12);

  const existing = await db.one('SELECT id FROM admins WHERE email = ?', [email]);
  if (existing) {
    await db.query('UPDATE admins SET name = ?, password_hash = ? WHERE id = ?', [name, hash, existing.id]);
    console.log(`Administrador ${email} actualizado.`);
  } else {
    await db.query('INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)', [name, email, hash]);
    console.log(`Administrador ${email} creado.`);
  }
  console.log('Clave: ' + password);
  await db.pool.end();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
