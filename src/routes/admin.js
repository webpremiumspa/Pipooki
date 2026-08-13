'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const db = require('../db');
const config = require('../config');
const qr = require('../services/qr');
const phone = require('../services/phone');
const tokens = require('../services/tokens');
const mailer = require('../services/mailer');
const {
  SPECIES, SEXES, str, required, intOrNull, page, prefixed,
  readPetCommon, readOwnerCommon, validateOwnerCommon
} = require('../services/forms');
const { requireAdmin } = require('../middleware/auth');
const { csrf } = require('../middleware/csrf');
const { rateLimit } = require('../middleware/rateLimit');
const { photoField, removePhoto } = require('../middleware/photo-field');

const router = express.Router();

const TAG_STATUSES = ['libre', 'activa', 'pausada', 'suspendida'];

router.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.section = '';
  next();
});

// Guarda la foto que venga en el cuerpo del formulario y la deja en req.file.
router.use(photoField);
router.use(csrf);

// -------------------------------- Login -----------------------------------

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  message: 'Demasiados intentos de acceso. Espera 15 minutos.'
});

router.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect(res.locals.url('/admin'));
  res.render('admin/login', { title: 'Ingresar', error: null, email: '' });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = required(req.body.email, 190).toLowerCase();
    const password = String(req.body.password || '');

    const admin = await db.one('SELECT * FROM admins WHERE email = ? LIMIT 1', [email]);
    const valid = admin ? await bcrypt.compare(password, admin.password_hash) : false;

    if (!valid) {
      return res.status(401).render('admin/login', {
        title: 'Ingresar', error: 'Correo o clave incorrectos.', email
      });
    }

    await db.query('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [admin.id]);
    const returnTo = req.session.returnTo;

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.admin = { id: admin.id, name: admin.name, email: admin.email };
      req.session.save((err2) => {
        if (err2) return next(err2);
        res.redirect(returnTo || res.locals.url('/admin'));
      });
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => res.redirect(res.locals.url('/admin/login')));
});

router.use(requireAdmin);

// ------------------------------ Dashboard ---------------------------------

router.get('/', async (req, res, next) => {
  try {
    const counts = await db.query('SELECT status, COUNT(*) AS total FROM tags GROUP BY status');
    const byStatus = Object.fromEntries(TAG_STATUSES.map((s) => [s, 0]));
    counts.forEach((row) => { byStatus[row.status] = row.total; });

    const [owners] = await db.query('SELECT COUNT(*) AS total FROM owners');
    const [scans30] = await db.query(
      'SELECT COUNT(*) AS total FROM scans WHERE scanned_at > DATE_SUB(NOW(), INTERVAL 30 DAY)'
    );

    const recent = await db.query(
      `SELECT s.*, p.name AS pet_name, t.code, o.name AS owner_name
         FROM scans s
         JOIN pets p ON p.id = s.pet_id
         JOIN owners o ON o.id = p.owner_id
         LEFT JOIN tags t ON t.pet_id = p.id
        ORDER BY s.scanned_at DESC
        LIMIT 10`
    );

    res.render('admin/dashboard', {
      title: 'Panel',
      section: 'dashboard',
      stats: { ...byStatus, owners: owners.total, scans30: scans30.total },
      recent,
      smtpReady: Boolean(config.smtp.host && config.smtp.user)
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------- Placas ----------------------------------

router.get('/placas', async (req, res, next) => {
  try {
    const q = str(req.query.q, 80);
    const status = TAG_STATUSES.includes(req.query.status) ? req.query.status : '';

    const where = [];
    const params = [];
    if (status) { where.push('t.status = ?'); params.push(status); }
    if (q) {
      where.push('(t.code LIKE ? OR p.name LIKE ? OR o.name LIKE ? OR o.email LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }

    const tags = await db.query(
      `SELECT t.*, p.name AS pet_name, o.id AS owner_id, o.name AS owner_name,
              b.label AS batch_label,
              (SELECT COUNT(*) FROM scans s WHERE s.pet_id = t.pet_id) AS scan_count
         FROM tags t
         LEFT JOIN pets p ON p.id = t.pet_id
         LEFT JOIN owners o ON o.id = p.owner_id
         LEFT JOIN batches b ON b.id = t.batch_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 500`,
      params
    );

    const batches = await db.query(
      `SELECT b.*, (SELECT COUNT(*) FROM tags t WHERE t.batch_id = b.id AND t.status = 'libre') AS free
         FROM batches b ORDER BY b.created_at DESC LIMIT 30`
    );

    res.render('admin/tags', {
      title: 'Placas',
      section: 'placas',
      tags, batches, q: q || '', status,
      batchSize: config.batchSize,
      config
    });
  } catch (err) {
    next(err);
  }
});

// Fabrica un lote de placas libres.
router.post('/placas/lote', async (req, res, next) => {
  try {
    const quantity = intOrNull(req.body.quantity, 1, 500) || config.batchSize;
    const label = str(req.body.label, 150) ||
      `Lote del ${new Intl.DateTimeFormat('es-CL', { dateStyle: 'short' }).format(new Date())}`;

    const batch = await db.query(
      'INSERT INTO batches (label, quantity) VALUES (?, ?)', [label, quantity]
    );

    for (let i = 0; i < quantity; i += 1) {
      const code = await tokens.uniqueTagCode();
      await db.query(
        'INSERT INTO tags (code, pin, batch_id) VALUES (?, ?, ?)',
        [code, tokens.randomPin(), batch.insertId]
      );
    }

    req.session.flash = { type: 'ok', msg: `Lote de ${quantity} placas generado. Descarga la hoja de impresion.` };
    res.redirect(res.locals.url(`/admin/placas/lote/${batch.insertId}/imprimir`));
  } catch (err) {
    next(err);
  }
});

async function loadBatch(id) {
  const batch = await db.one('SELECT * FROM batches WHERE id = ?', [id]);
  if (!batch) return null;
  const tags = await db.query(
    'SELECT * FROM tags WHERE batch_id = ? ORDER BY id ASC', [batch.id]
  );
  return { batch, tags };
}

// Hoja lista para imprimir: los QR por un lado y los insertos con el PIN por
// otro. El PIN nunca va en la placa, solo en el papel que va en el empaque.
router.get('/placas/lote/:id/imprimir', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    const data = id ? await loadBatch(id) : null;
    if (!data) return next();

    const withQr = [];
    for (const tag of data.tags) {
      withQr.push({ ...tag, qr: await qr.dataUrl(tag.code, 400), url: config.tagUrl(tag.code) });
    }

    res.render('admin/print-sheet', {
      title: `Lote ${data.batch.label}`,
      batch: data.batch,
      tags: withQr,
      brandName: config.brandName
    });
  } catch (err) {
    next(err);
  }
});

router.get('/placas/lote/:id/csv', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    const data = id ? await loadBatch(id) : null;
    if (!data) return next();

    const rows = [['codigo', 'pin', 'url', 'estado']];
    data.tags.forEach((t) => rows.push([t.code, t.pin, config.tagUrl(t.code), t.status]));
    // Punto y coma: es lo que espera Excel en configuracion regional chilena.
    const csv = rows.map((r) => r.join(';')).join('\r\n');

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="lote-${data.batch.id}.csv"`);
    res.send('﻿' + csv);
  } catch (err) {
    next(err);
  }
});

async function loadTag(id) {
  return db.one(
    `SELECT t.*, p.name AS pet_name, p.species, p.breed, p.photo,
            o.id AS owner_id, o.name AS owner_name, o.email AS owner_email,
            o.phone AS owner_phone, b.label AS batch_label
       FROM tags t
       LEFT JOIN pets p ON p.id = t.pet_id
       LEFT JOIN owners o ON o.id = p.owner_id
       LEFT JOIN batches b ON b.id = t.batch_id
      WHERE t.id = ?`,
    [id]
  );
}

router.get('/placas/:id', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    const tag = id ? await loadTag(id) : null;
    if (!tag) return next();

    const scans = tag.pet_id
      ? await db.query('SELECT * FROM scans WHERE pet_id = ? ORDER BY scanned_at DESC LIMIT 15', [tag.pet_id])
      : [];
    const claim = await db.one('SELECT email, expires_at FROM claims WHERE tag_id = ?', [tag.id]);

    res.render('admin/tag-detail', {
      title: `Placa ${tag.code}`,
      section: 'placas',
      tag, scans, claim,
      tagUrl: config.tagUrl(tag.code),
      qrPreview: await qr.dataUrl(tag.code, 400)
    });
  } catch (err) {
    next(err);
  }
});

router.get('/placas/:id/qr.png', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    const tag = id ? await db.one('SELECT code FROM tags WHERE id = ?', [id]) : null;
    if (!tag) return next();

    const buffer = await qr.pngBuffer(tag.code, req.query.size || 1024);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.set('Content-Disposition', `attachment; filename="placa-${tag.code}.png"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

router.post('/placas/:id/suspender', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    const tag = id ? await loadTag(id) : null;
    if (!tag) return next();

    const reason = str(req.body.reason, 255);
    await db.query(
      `UPDATE tags SET status = 'suspendida', suspend_reason = ? WHERE id = ?`, [reason, id]
    );

    req.session.flash = { type: 'ok', msg: 'Placa suspendida: dejo de mostrar datos.' };
    res.redirect(res.locals.url(`/admin/placas/${id}`));

    if (tag.owner_email) {
      mailer.tagSuspended({
        owner: { name: tag.owner_name, email: tag.owner_email },
        petName: tag.pet_name, reason
      }).catch((err) => console.error('[suspender] aviso fallido', err));
    }
  } catch (err) {
    next(err);
  }
});

router.post('/placas/:id/reactivar', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    const tag = id ? await db.one('SELECT * FROM tags WHERE id = ?', [id]) : null;
    if (!tag) return next();

    const status = tag.pet_id ? 'activa' : 'libre';
    await db.query('UPDATE tags SET status = ?, suspend_reason = NULL WHERE id = ?', [status, id]);
    req.session.flash = { type: 'ok', msg: 'Placa reactivada.' };
    res.redirect(res.locals.url(`/admin/placas/${id}`));
  } catch (err) {
    next(err);
  }
});

// Devuelve la placa al inventario. La mascota y el dueno no se borran: queda
// el historial, pero la placa se puede volver a vender con un PIN nuevo.
router.post('/placas/:id/liberar', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    const tag = id ? await db.one('SELECT * FROM tags WHERE id = ?', [id]) : null;
    if (!tag) return next();

    await db.query(
      `UPDATE tags SET status = 'libre', pet_id = NULL, claimed_at = NULL,
              suspend_reason = NULL, pin = ?, pin_attempts = 0
        WHERE id = ?`,
      [tokens.randomPin(), id]
    );
    await db.query('DELETE FROM claims WHERE tag_id = ?', [id]);

    req.session.flash = { type: 'warn', msg: 'Placa liberada con un PIN nuevo. Hay que imprimir el inserto de nuevo.' };
    res.redirect(res.locals.url(`/admin/placas/${id}`));
  } catch (err) {
    next(err);
  }
});

// Descarta un registro a medio hacer para desbloquear la placa.
router.post('/placas/:id/descartar-registro', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    if (!id) return next();
    const claim = await db.one('SELECT id, photo FROM claims WHERE tag_id = ?', [id]);
    if (claim) {
      await db.query('DELETE FROM claims WHERE id = ?', [claim.id]);
      removePhoto(claim.photo);
    }
    await db.query('UPDATE tags SET pin_attempts = 0 WHERE id = ?', [id]);
    req.session.flash = { type: 'ok', msg: 'Registro pendiente descartado. La placa vuelve a estar disponible.' };
    res.redirect(res.locals.url(`/admin/placas/${id}`));
  } catch (err) {
    next(err);
  }
});

// ---------------------- Activacion manual (por telefono) --------------------

router.get('/placas/:id/activar', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    const tag = id ? await db.one('SELECT * FROM tags WHERE id = ?', [id]) : null;
    if (!tag) return next();
    if (tag.status !== 'libre') {
      req.session.flash = { type: 'warn', msg: 'Esa placa ya esta activada.' };
      return res.redirect(res.locals.url(`/admin/placas/${id}`));
    }

    res.render('admin/tag-activate', {
      title: `Activar placa ${tag.code}`,
      section: 'placas',
      tag,
      owners: await db.query('SELECT id, name, email FROM owners ORDER BY name ASC'),
      owner: {}, pet: { species: 'perro' }, errors: [], SPECIES, SEXES
    });
  } catch (err) {
    next(err);
  }
});

router.post('/placas/:id/activar', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    const tag = id ? await db.one('SELECT * FROM tags WHERE id = ?', [id]) : null;
    if (!tag) { if (req.file) removePhoto(req.file.filename); return next(); }
    if (tag.status !== 'libre') {
      if (req.file) removePhoto(req.file.filename);
      return res.redirect(res.locals.url(`/admin/placas/${id}`));
    }

    const existingId = intOrNull(req.body.owner_id, 1, 2 ** 31);
    const ownerData = readOwnerCommon(req.body);
    // Los campos de la mascota van con prefijo pet_ para no chocar con el
    // "name" del dueno en el mismo formulario.
    const petData = readPetCommon(prefixed(req.body, 'pet_'));
    const errors = [];

    let owner = existingId ? await db.one('SELECT * FROM owners WHERE id = ?', [existingId]) : null;
    if (existingId && !owner) errors.push('El dueno seleccionado no existe.');
    if (!existingId) errors.push(...validateOwnerCommon(ownerData));
    if (!petData.name) errors.push('El nombre de la mascota es obligatorio.');

    if (!existingId && ownerData.email) {
      const dup = await db.one('SELECT id FROM owners WHERE email = ? LIMIT 1', [ownerData.email]);
      if (dup) errors.push('Ya existe un dueno con ese correo. Seleccionalo de la lista.');
    }

    if (errors.length) {
      if (req.file) removePhoto(req.file.filename);
      return res.status(400).render('admin/tag-activate', {
        title: `Activar placa ${tag.code}`,
        section: 'placas', tag,
        owners: await db.query('SELECT id, name, email FROM owners ORDER BY name ASC'),
        owner: { ...ownerData, id: existingId }, pet: petData, errors, SPECIES, SEXES
      });
    }

    if (!owner) {
      // Alta manual: el consentimiento no se registra porque no lo firmo en
      // linea. Queda en blanco a proposito, para no inventar una aceptacion.
      const inserted = await db.query(
        `INSERT INTO owners (name, phone, phone_alt, email, address, comuna, city, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [ownerData.name, ownerData.phone, ownerData.phone_alt, ownerData.email,
          ownerData.address, ownerData.comuna, ownerData.city, str(req.body.notes, 2000)]
      );
      owner = { id: inserted.insertId, ...ownerData };
    }

    const pet = await db.query(
      `INSERT INTO pets (owner_id, name, species, breed, color, sex, birth_year,
                         sterilized, chip_number, photo, medical_notes, behavior_notes, reward_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [owner.id, petData.name, petData.species, petData.breed, petData.color, petData.sex,
        petData.birth_year, petData.sterilized, petData.chip_number,
        req.file ? req.file.filename : null, petData.medical_notes, petData.behavior_notes,
        str(req.body.reward_note, 255)]
    );

    await db.query(
      `UPDATE tags SET status = 'activa', pet_id = ?, claimed_at = NOW() WHERE id = ?`,
      [pet.insertId, tag.id]
    );

    req.session.flash = { type: 'ok', msg: `Placa ${tag.code} activada para ${petData.name}.` };
    res.redirect(res.locals.url(`/admin/placas/${id}`));
  } catch (err) {
    if (req.file) removePhoto(req.file.filename);
    next(err);
  }
});

// -------------------------------- Duenos ----------------------------------

router.get('/duenos', async (req, res, next) => {
  try {
    const q = str(req.query.q, 80);
    const params = [];
    let where = '';
    if (q) {
      where = 'WHERE o.name LIKE ? OR o.phone LIKE ? OR o.email LIKE ? OR o.comuna LIKE ?';
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    const owners = await db.query(
      `SELECT o.*, (SELECT COUNT(*) FROM pets p WHERE p.owner_id = o.id) AS pet_count
         FROM owners o ${where}
        ORDER BY o.name ASC`,
      params
    );
    res.render('admin/owners', { title: 'Duenos', section: 'duenos', owners, q: q || '', phone });
  } catch (err) {
    next(err);
  }
});

router.get('/duenos/:id', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    const owner = id ? await db.one('SELECT * FROM owners WHERE id = ?', [id]) : null;
    if (!owner) return next();

    const pets = await db.query(
      `SELECT p.*, t.code, t.status AS tag_status, t.id AS tag_id
         FROM pets p LEFT JOIN tags t ON t.pet_id = p.id
        WHERE p.owner_id = ? ORDER BY p.name ASC`,
      [owner.id]
    );
    res.render('admin/owner-detail', {
      title: owner.name, section: 'duenos', owner, pets, phone, config
    });
  } catch (err) {
    next(err);
  }
});

router.get('/duenos/:id/editar', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    const owner = id ? await db.one('SELECT * FROM owners WHERE id = ?', [id]) : null;
    if (!owner) return next();
    res.render('admin/owner-form', {
      title: `Editar ${owner.name}`, section: 'duenos', owner, errors: []
    });
  } catch (err) {
    next(err);
  }
});

router.post('/duenos/:id/editar', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    const existing = id ? await db.one('SELECT * FROM owners WHERE id = ?', [id]) : null;
    if (!existing) return next();

    const owner = { ...readOwnerCommon(req.body), notes: str(req.body.notes, 2000) };
    const errors = validateOwnerCommon(owner);

    if (owner.email && owner.email !== existing.email) {
      const dup = await db.one('SELECT id FROM owners WHERE email = ? AND id <> ? LIMIT 1', [owner.email, id]);
      if (dup) errors.push('Ya hay otro dueno con ese correo.');
    }

    if (errors.length) {
      return res.status(400).render('admin/owner-form', {
        title: 'Editar dueno', section: 'duenos', owner: { ...owner, id }, errors
      });
    }

    // Cambiar el correo le devuelve el acceso al dueno: es la unica forma de
    // recuperarlo si perdio el buzon con el que se registro.
    await db.query(
      `UPDATE owners SET name = ?, phone = ?, phone_alt = ?, email = ?, address = ?,
              comuna = ?, city = ?, notes = ?
        WHERE id = ?`,
      [owner.name, owner.phone, owner.phone_alt, owner.email, owner.address,
        owner.comuna, owner.city, owner.notes, id]
    );

    req.session.flash = { type: 'ok', msg: 'Datos del dueno actualizados.' };
    res.redirect(res.locals.url(`/admin/duenos/${id}`));
  } catch (err) {
    next(err);
  }
});

router.post('/duenos/:id/eliminar', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    if (!id) return next();
    const pets = await db.query('SELECT photo FROM pets WHERE owner_id = ?', [id]);
    await db.query('DELETE FROM owners WHERE id = ?', [id]);
    pets.forEach((p) => removePhoto(p.photo));
    req.session.flash = { type: 'ok', msg: 'Dueno eliminado. Sus placas volvieron al inventario.' };
    res.redirect(res.locals.url('/admin/duenos'));
  } catch (err) {
    next(err);
  }
});

// ------------------------------- Mascotas ---------------------------------

router.get('/mascotas', async (req, res, next) => {
  try {
    const q = str(req.query.q, 80);
    const params = [];
    let where = '';
    if (q) {
      where = 'WHERE p.name LIKE ? OR t.code LIKE ? OR o.name LIKE ? OR p.chip_number LIKE ?';
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    const pets = await db.query(
      `SELECT p.*, o.name AS owner_name, t.code, t.status AS tag_status, t.id AS tag_id,
              (SELECT COUNT(*) FROM scans s WHERE s.pet_id = p.id) AS scan_count
         FROM pets p
         JOIN owners o ON o.id = p.owner_id
         LEFT JOIN tags t ON t.pet_id = p.id
         ${where}
        ORDER BY p.created_at DESC`,
      params
    );
    res.render('admin/pets', { title: 'Mascotas', section: 'mascotas', pets, q: q || '' });
  } catch (err) {
    next(err);
  }
});

router.get('/mascotas/:id/editar', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    const pet = id
      ? await db.one(
        `SELECT p.*, t.code, t.id AS tag_id FROM pets p
           LEFT JOIN tags t ON t.pet_id = p.id WHERE p.id = ?`, [id])
      : null;
    if (!pet) return next();
    res.render('admin/pet-form', {
      title: `Editar ${pet.name}`, section: 'mascotas', pet, errors: [], SPECIES, SEXES
    });
  } catch (err) {
    next(err);
  }
});

router.post('/mascotas/:id/editar', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    const current = id ? await db.one('SELECT * FROM pets WHERE id = ?', [id]) : null;
    if (!current) {
      if (req.file) removePhoto(req.file.filename);
      return next();
    }

    const pet = readPetCommon(req.body);
    if (!pet.name) {
      if (req.file) removePhoto(req.file.filename);
      return res.status(400).render('admin/pet-form', {
        title: 'Editar mascota', section: 'mascotas',
        pet: { ...current, ...pet }, errors: ['El nombre de la mascota es obligatorio.'],
        SPECIES, SEXES
      });
    }

    const removeCurrent = Boolean(req.body.remove_photo) && !req.file;
    const photo = req.file ? req.file.filename : (removeCurrent ? null : current.photo);

    await db.query(
      `UPDATE pets SET name = ?, species = ?, breed = ?, color = ?, sex = ?, birth_year = ?,
              sterilized = ?, chip_number = ?, photo = ?, medical_notes = ?,
              behavior_notes = ?, reward_note = ?
        WHERE id = ?`,
      [pet.name, pet.species, pet.breed, pet.color, pet.sex, pet.birth_year,
        pet.sterilized, pet.chip_number, photo, pet.medical_notes, pet.behavior_notes,
        str(req.body.reward_note, 255), id]
    );

    if (current.photo && current.photo !== photo) removePhoto(current.photo);

    req.session.flash = { type: 'ok', msg: 'Mascota actualizada.' };
    res.redirect(res.locals.url('/admin/mascotas'));
  } catch (err) {
    if (req.file) removePhoto(req.file.filename);
    next(err);
  }
});

router.post('/mascotas/:id/eliminar', async (req, res, next) => {
  try {
    const id = intOrNull(req.params.id, 1, 2 ** 31);
    const pet = id ? await db.one('SELECT photo FROM pets WHERE id = ?', [id]) : null;
    if (!pet) return next();
    await db.query('DELETE FROM pets WHERE id = ?', [id]);
    removePhoto(pet.photo);
    req.session.flash = { type: 'ok', msg: 'Mascota eliminada. Su placa volvio al inventario.' };
    res.redirect(res.locals.url('/admin/mascotas'));
  } catch (err) {
    next(err);
  }
});

// -------------------------------- Escaneos --------------------------------

router.get('/escaneos', async (req, res, next) => {
  try {
    const perPage = 50;
    const current = page(req.query.page);
    const offset = (current - 1) * perPage;

    const [{ total }] = await db.query('SELECT COUNT(*) AS total FROM scans');
    const scans = await db.query(
      `SELECT s.*, p.name AS pet_name, t.code, t.id AS tag_id, o.name AS owner_name
         FROM scans s
         JOIN pets p ON p.id = s.pet_id
         JOIN owners o ON o.id = p.owner_id
         LEFT JOIN tags t ON t.pet_id = p.id
        ORDER BY s.scanned_at DESC
        LIMIT ${perPage} OFFSET ${offset}`
    );

    res.render('admin/scans', {
      title: 'Escaneos',
      section: 'escaneos',
      scans, current,
      pages: Math.max(1, Math.ceil(total / perPage)),
      total
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------- Cuenta ----------------------------------

router.get('/cuenta', (req, res) => {
  res.render('admin/account', { title: 'Mi cuenta', section: 'cuenta', errors: [], done: false });
});

router.post('/cuenta', async (req, res, next) => {
  try {
    const currentPass = String(req.body.current_password || '');
    const next1 = String(req.body.new_password || '');
    const next2 = String(req.body.new_password2 || '');
    const errors = [];

    const admin = await db.one('SELECT * FROM admins WHERE id = ?', [req.session.admin.id]);
    if (!admin || !(await bcrypt.compare(currentPass, admin.password_hash))) {
      errors.push('La clave actual no es correcta.');
    }
    if (next1.length < 10) errors.push('La clave nueva debe tener al menos 10 caracteres.');
    if (next1 !== next2) errors.push('La confirmacion no coincide con la clave nueva.');

    if (errors.length) {
      return res.status(400).render('admin/account', {
        title: 'Mi cuenta', section: 'cuenta', errors, done: false
      });
    }

    const hash = await bcrypt.hash(next1, 12);
    await db.query('UPDATE admins SET password_hash = ? WHERE id = ?', [hash, admin.id]);
    res.render('admin/account', { title: 'Mi cuenta', section: 'cuenta', errors: [], done: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
