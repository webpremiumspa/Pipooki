'use strict';

// Crea las tablas y, si no existe ningun administrador, el primero.
// Uso:  npm run setup
//       npm run setup -- --email tu@correo.cl --password "clave" --name "Tu Nombre"

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('../config');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: true
  });

  console.log(`Conectado a ${config.db.database} en ${config.db.host}`);

  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await connection.query(schema);
  console.log('Tablas creadas / verificadas.');

  const [admins] = await connection.query('SELECT COUNT(*) AS total FROM admins');
  if (admins[0].total > 0) {
    console.log(`Ya existen ${admins[0].total} administrador(es). No se crea ninguno nuevo.`);
    console.log('Para agregar otro: npm run create-admin -- --email x@y.cl --password "clave"');
    await connection.end();
    return;
  }

  const email = (arg('email') || 'admin@pipookis.cl').toLowerCase();
  const name = arg('name') || 'Administrador';
  const password = arg('password') || crypto.randomBytes(9).toString('base64url');
  const hash = await bcrypt.hash(password, 12);

  await connection.query(
    'INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)',
    [name, email, hash]
  );

  console.log('\n--------------------------------------------------');
  console.log('Administrador creado');
  console.log('  Correo : ' + email);
  console.log('  Clave  : ' + password);
  console.log('Guarda esta clave: no se vuelve a mostrar.');
  console.log('--------------------------------------------------\n');

  await connection.end();
}

main().catch((err) => {
  console.error('Error en el setup:', err.message);
  process.exit(1);
});
