'use strict';

const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 8,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  dateStrings: false,
  timezone: 'local'
});

async function query(sql, params) {
  const [rows] = await pool.execute(sql, params === undefined ? [] : params);
  return rows;
}

async function one(sql, params) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

module.exports = { pool, query, one };
