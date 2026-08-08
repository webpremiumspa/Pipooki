'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const phone = require('../services/phone');
const mailer = require('../services/mailer');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const CODE_RE = /^[a-z1-9]{6,16}$/;

// Frena el escaneo automatizado de codigos al azar.
const scanLimiter = rateLimit({ windowMs: 60_000, max: 20, message: 'Demasiadas solicitudes. Espera un minuto.' });
const pageLimiter = rateLimit({ windowMs: 60_000, max: 40, message: 'Demasiadas solicitudes. Espera un minuto.' });

function clientIp(req) {
  return (req.ip || '').replace('::ffff:', '').slice(0, 45);
}

// Carga la placa con la mascota y el dueno enlazados, si es que los tiene.
async function loadTag(code) {
  return db.one(
    `SELECT t.id AS tag_id, t.code, t.status, t.claimed_at,
            p.id AS pet_id, p.name AS pet_name, p.species, p.breed, p.color, p.sex,
            p.birth_year, p.sterilized, p.chip_number, p.photo,
            p.medical_notes, p.behavior_notes, p.reward_note,
            o.id AS owner_id, o.name AS owner_name, o.phone AS owner_phone,
            o.phone_alt AS owner_phone_alt, o.email AS owner_email,
            o.address AS owner_address, o.comuna AS owner_comuna, o.city AS owner_city
       FROM tags t
       LEFT JOIN pets p ON p.id = t.pet_id
       LEFT JOIN owners o ON o.id = p.owner_id
      WHERE t.code = ?
      LIMIT 1`,
    [code]
  );
}

// Una placa muestra datos solo si esta activa y tiene mascota enlazada.
function isLive(tag) {
  return Boolean(tag) && tag.status === 'activa' && Boolean(tag.pet_id);
}

function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || '';
}

// Resuelve la placa para los endpoints JSON, o responde 404.
async function liveTagOr404(req, res) {
  const code = String(req.params.code || '').toLowerCase();
  if (!CODE_RE.test(code)) {
    res.status(404).json({ ok: false });
    return null;
  }
  const tag = await loadTag(code);
  if (!isLive(tag)) {
    res.status(404).json({ ok: false });
    return null;
  }
  return tag;
}

// ----------------------------- Landing -----------------------------------

router.get('/', (req, res) => {
  res.render('public/home', { title: `${config.brandName} · Placas QR para mascotas` });
});

// -------------------------- Pagina del QR ---------------------------------

// La misma URL sirve antes y despues de activar la placa: si esta libre lleva
// al registro, y si ya esta activa muestra los datos de la mascota.
router.get('/p/:code', pageLimiter, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').toLowerCase();
    if (!CODE_RE.test(code)) {
      return res.status(404).render('public/not-found', { title: 'Placa no encontrada' });
    }

    const tag = await loadTag(code);
    if (!tag) {
      return res.status(404).render('public/not-found', { title: 'Placa no encontrada' });
    }

    if (tag.status === 'libre') {
      return res.render('public/tag-free', {
        title: `Activa tu placa · ${config.brandName}`,
        code,
        activated: req.query.ok === '1'
      });
    }

    if (!isLive(tag)) {
      return res.status(410).render('public/inactive', {
        title: 'Placa desactivada',
        suspended: tag.status === 'suspendida'
      });
    }

    res.render('public/pet', {
      title: `${tag.pet_name} esta perdido · ${config.brandName}`,
      tag,
      code,
      justActivated: req.query.ok === '1',
      ownerFirstName: firstName(tag.owner_name),
      phonePretty: phone.pretty(tag.owner_phone),
      phoneTel: phone.toTel(tag.owner_phone),
      phoneWa: phone.toWhatsApp(tag.owner_phone),
      phoneAltPretty: tag.owner_phone_alt ? phone.pretty(tag.owner_phone_alt) : null,
      phoneAltTel: tag.owner_phone_alt ? phone.toTel(tag.owner_phone_alt) : null,
      ownerEmail: tag.owner_email || null
    });
  } catch (err) {
    next(err);
  }
});

// Registra el escaneo. Se llama por JS desde el navegador y no al renderizar,
// para que las previsualizaciones de enlaces de WhatsApp y los bots no
// generen avisos falsos al dueno.
router.post('/p/:code/scan', scanLimiter, async (req, res, next) => {
  try {
    const tag = await liveTagOr404(req, res);
    if (!tag) return;

    const cutoff = new Date(Date.now() - config.notifyCooldownMinutes * 60_000);
    const recent = await db.one(
      'SELECT id FROM scans WHERE pet_id = ? AND notified_scan = 1 AND scanned_at > ? LIMIT 1',
      [tag.pet_id, cutoff]
    );
    const shouldNotify = !recent && Boolean(tag.owner_email);

    const result = await db.query(
      'INSERT INTO scans (pet_id, ip, user_agent, notified_scan) VALUES (?, ?, ?, ?)',
      [tag.pet_id, clientIp(req), String(req.get('user-agent') || '').slice(0, 255), shouldNotify ? 1 : 0]
    );

    res.json({ ok: true, scanId: result.insertId });

    if (shouldNotify) {
      mailer.notifyScan({
        owner: { name: tag.owner_name, email: tag.owner_email },
        pet: { name: tag.pet_name },
        when: new Date()
      }).catch((err) => console.error('[scan] aviso fallido', err));
    }
  } catch (err) {
    next(err);
  }
});

// Guarda las coordenadas y avisa al dueno con el link al mapa.
router.post('/p/:code/location', scanLimiter, async (req, res, next) => {
  try {
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.status(400).json({ ok: false, error: 'Coordenadas invalidas.' });
    }
    const accuracy = Number.isFinite(Number(req.body.accuracy))
      ? Math.min(Math.round(Number(req.body.accuracy)), 100000)
      : null;

    const tag = await liveTagOr404(req, res);
    if (!tag) return;

    const scanId = parseInt(req.body.scanId, 10);
    let targetId = null;
    if (Number.isFinite(scanId)) {
      const owned = await db.one('SELECT id FROM scans WHERE id = ? AND pet_id = ? LIMIT 1', [scanId, tag.pet_id]);
      if (owned) targetId = owned.id;
    }

    if (targetId) {
      await db.query(
        `UPDATE scans SET lat = ?, lng = ?, accuracy_m = ?, location_at = NOW(), notified_location = 1
          WHERE id = ?`,
        [lat, lng, accuracy, targetId]
      );
    } else {
      const inserted = await db.query(
        `INSERT INTO scans (pet_id, ip, user_agent, lat, lng, accuracy_m, location_at, notified_location)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), 1)`,
        [tag.pet_id, clientIp(req), String(req.get('user-agent') || '').slice(0, 255), lat, lng, accuracy]
      );
      targetId = inserted.insertId;
    }

    res.json({ ok: true, scanId: targetId });

    if (tag.owner_email) {
      mailer.notifyLocation({
        owner: { name: tag.owner_name, email: tag.owner_email },
        pet: { name: tag.pet_name },
        lat, lng, accuracy, when: new Date()
      }).catch((err) => console.error('[location] aviso fallido', err));
    }
  } catch (err) {
    next(err);
  }
});

// El correo no viaja en el HTML, para que no quede a la vista de cualquiera
// que mire el codigo fuente. Se entrega solo cuando la persona elige ese canal.
router.post('/p/:code/correo', scanLimiter, async (req, res, next) => {
  try {
    const tag = await liveTagOr404(req, res);
    if (!tag) return;
    res.json({ ok: true, email: tag.owner_email || null });
  } catch (err) {
    next(err);
  }
});

// La direccion tampoco viaja en el HTML: se entrega solo cuando la persona la
// pide explicitamente, y queda registrado que se mostro.
router.post('/p/:code/direccion', scanLimiter, async (req, res, next) => {
  try {
    const tag = await liveTagOr404(req, res);
    if (!tag) return;

    const scanId = parseInt(req.body.scanId, 10);
    if (Number.isFinite(scanId)) {
      await db.query(
        'UPDATE scans SET address_revealed = 1 WHERE id = ? AND pet_id = ?',
        [scanId, tag.pet_id]
      );
    }

    const parts = [tag.owner_address, tag.owner_comuna, tag.owner_city].filter(Boolean);
    res.json({
      ok: true,
      address: parts.length ? parts.join(', ') : null,
      mapsUrl: parts.length
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(', ') + ', Chile')}`
        : null
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
