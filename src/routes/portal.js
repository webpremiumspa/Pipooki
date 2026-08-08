'use strict';

// Rutas del dueno de la mascota:
//
//   /p/:code/activar     activacion de una placa libre (pide el PIN del empaque)
//   /p/:code/confirmar   ingreso del codigo OTP que confirma su correo
//   /mis-datos           pedir codigo por correo para entrar a editar
//   /mis-datos/panel     sus datos y sus mascotas, con sesion corta
//
// No hay claves ni enlaces permanentes: la unica credencial es el control del
// correo, demostrado con un codigo de un solo uso.

const express = require('express');
const db = require('../db');
const config = require('../config');
const tokens = require('../services/tokens');
const otp = require('../services/otp');
const mailer = require('../services/mailer');
const {
  SPECIES, SEXES, intOrNull, isEmail, prefixed,
  readPetCommon, readOwnerCommon, validateOwnerCommon
} = require('../services/forms');
const { rateLimit } = require('../middleware/rateLimit');
const { uploadPhoto, removePhoto } = require('../middleware/upload');

const router = express.Router();

const CODE_RE = /^[a-z1-9]{6,16}$/;
const PIN_RE = /^[A-Z2-9]{6}$/;

const formLimiter = rateLimit({ windowMs: 60_000, max: 20, message: 'Demasiadas solicitudes. Espera un minuto.' });
const submitLimiter = rateLimit({ windowMs: 15 * 60_000, max: 12, message: 'Demasiados envios. Espera unos minutos.' });
const otpLimiter = rateLimit({ windowMs: 15 * 60_000, max: 12, message: 'Demasiados intentos. Espera unos minutos.' });

function clientIp(req) {
  return (req.ip || '').replace('::ffff:', '').slice(0, 45);
}

function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!domain) return '';
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${'*'.repeat(Math.max(user.length - visible.length, 1))}@${domain}`;
}

// Descarta los registros a medio hacer que ya vencieron y devuelve sus placas
// al estado libre. Se ejecuta al pasar por el formulario, para no depender de
// una tarea programada en el servidor.
async function sweepClaims() {
  const expired = await db.query('SELECT id, photo FROM claims WHERE expires_at < NOW()');
  if (!expired.length) return;
  await db.query('DELETE FROM claims WHERE expires_at < NOW()');
  expired.forEach((c) => removePhoto(c.photo));
}

async function loadTagByCode(code) {
  return db.one('SELECT * FROM tags WHERE code = ? LIMIT 1', [code]);
}

// ---------------------------- Activacion ------------------------------------

function renderActivate(res, status, { code, owner, pet, errors, pinError }) {
  return res.status(status).render('portal/activate', {
    title: 'Activa la placa de tu mascota',
    code, owner, pet, errors, pinError,
    consent: config.consent,
    SPECIES, SEXES
  });
}

router.get('/p/:code/activar', formLimiter, async (req, res, next) => {
  try {
    await sweepClaims();
    const code = String(req.params.code || '').toLowerCase();
    if (!CODE_RE.test(code)) {
      return res.status(404).render('public/not-found', { title: 'Placa no encontrada' });
    }

    const tag = await loadTagByCode(code);
    if (!tag) {
      return res.status(404).render('public/not-found', { title: 'Placa no encontrada' });
    }
    if (tag.status !== 'libre') {
      return res.redirect(config.basePath + '/p/' + code);
    }

    // Si dejo un registro a medio hacer, se le ofrece retomarlo.
    const claim = await db.one('SELECT email FROM claims WHERE tag_id = ?', [tag.id]);
    if (claim) {
      return res.redirect(config.basePath + '/p/' + code + '/confirmar');
    }

    renderActivate(res, 200, { code, owner: {}, pet: { species: 'perro' }, errors: [], pinError: null });
  } catch (err) {
    next(err);
  }
});

router.post('/p/:code/activar', submitLimiter, uploadPhoto, async (req, res, next) => {
  try {
    await sweepClaims();
    const code = String(req.params.code || '').toLowerCase();
    const tag = CODE_RE.test(code) ? await loadTagByCode(code) : null;

    if (!tag) {
      if (req.file) removePhoto(req.file.filename);
      return res.status(404).render('public/not-found', { title: 'Placa no encontrada' });
    }
    if (tag.status !== 'libre') {
      if (req.file) removePhoto(req.file.filename);
      return res.redirect(config.basePath + '/p/' + code);
    }
    if (tag.pin_attempts >= config.pinMaxAttempts) {
      if (req.file) removePhoto(req.file.filename);
      return renderActivate(res, 429, {
        code, owner: readOwnerCommon(req.body), pet: readPetCommon(prefixed(req.body, 'pet_')),
        errors: [], pinError: 'Se agotaron los intentos de PIN para esta placa. Escribenos para desbloquearla.'
      });
    }

    const pin = String(req.body.pin || '').trim().toUpperCase().replace(/[\s-]/g, '');
    const owner = readOwnerCommon(req.body);
    const pet = readPetCommon(prefixed(req.body, 'pet_'));

    // El PIN se revisa primero y por separado: es lo que impide que alguien se
    // apropie de una placa que vio colgada en una tienda.
    if (!PIN_RE.test(pin) || pin !== String(tag.pin).toUpperCase()) {
      await db.query('UPDATE tags SET pin_attempts = pin_attempts + 1 WHERE id = ?', [tag.id]);
      if (req.file) removePhoto(req.file.filename);
      const left = config.pinMaxAttempts - (tag.pin_attempts + 1);
      return renderActivate(res, 400, {
        code, owner, pet, errors: [],
        pinError: `El PIN no coincide. Revisa el inserto que venia con la placa.` +
          (left <= 3 && left > 0 ? ` Te quedan ${left} intentos.` : '')
      });
    }

    // El PIN era correcto: se reinicia el contador aqui mismo. Si se hiciera
    // mas abajo, a quien acierta el PIN pero olvida marcar la autorizacion le
    // quedarian acumulados los intentos fallidos anteriores.
    await db.query('UPDATE tags SET pin_attempts = 0 WHERE id = ?', [tag.id]);

    const errors = validateOwnerCommon(owner);
    if (!pet.name) errors.push('El nombre de la mascota es obligatorio.');
    if (!req.body.consent) {
      errors.push('Necesitamos tu autorizacion para publicar tus datos de contacto en la placa.');
    }

    if (errors.length) {
      if (req.file) removePhoto(req.file.filename);
      return renderActivate(res, 400, { code, owner, pet, errors, pinError: null });
    }

    // Un intento nuevo reemplaza al anterior que no alcanzo a confirmarse.
    const previous = await db.one('SELECT id, photo FROM claims WHERE tag_id = ?', [tag.id]);
    if (previous) {
      await db.query('DELETE FROM claims WHERE id = ?', [previous.id]);
      removePhoto(previous.photo);
    }

    const code6 = tokens.otpCode();
    await db.query(
      `INSERT INTO claims (tag_id, email, payload, photo, code_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
      [tag.id, owner.email, JSON.stringify({ owner, pet, consentIp: clientIp(req) }),
        req.file ? req.file.filename : null, otp.hash(code6), config.claimHours]
    );

    res.redirect(config.basePath + '/p/' + code + '/confirmar');

    mailer.verifyEmailCode({
      to: owner.email, name: owner.name, petName: pet.name, code: code6
    }).catch((err) => console.error('[activar] envio de OTP fallido', err));
  } catch (err) {
    if (req.file) removePhoto(req.file.filename);
    next(err);
  }
});

// ------------------------- Confirmacion del correo --------------------------

router.get('/p/:code/confirmar', formLimiter, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').toLowerCase();
    const tag = CODE_RE.test(code) ? await loadTagByCode(code) : null;
    if (!tag) return res.status(404).render('public/not-found', { title: 'Placa no encontrada' });

    const claim = await db.one('SELECT * FROM claims WHERE tag_id = ?', [tag.id]);
    if (!claim) return res.redirect(config.basePath + '/p/' + code);

    res.render('portal/confirm', {
      title: 'Confirma tu correo',
      code,
      maskedEmail: maskEmail(claim.email),
      error: null,
      resent: req.query.reenviado === '1'
    });
  } catch (err) {
    next(err);
  }
});

router.post('/p/:code/confirmar/reenviar', otpLimiter, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').toLowerCase();
    const tag = CODE_RE.test(code) ? await loadTagByCode(code) : null;
    if (!tag) return res.status(404).render('public/not-found', { title: 'Placa no encontrada' });

    const claim = await db.one('SELECT * FROM claims WHERE tag_id = ?', [tag.id]);
    if (!claim) return res.redirect(config.basePath + '/p/' + code);

    const payload = JSON.parse(claim.payload);
    const code6 = tokens.otpCode();
    await db.query(
      `UPDATE claims SET code_hash = ?, attempts = 0,
              expires_at = DATE_ADD(NOW(), INTERVAL ? HOUR)
        WHERE id = ?`,
      [otp.hash(code6), config.claimHours, claim.id]
    );

    res.redirect(config.basePath + '/p/' + code + '/confirmar?reenviado=1');

    mailer.verifyEmailCode({
      to: claim.email, name: payload.owner.name, petName: payload.pet.name, code: code6
    }).catch((err) => console.error('[confirmar] reenvio fallido', err));
  } catch (err) {
    next(err);
  }
});

router.post('/p/:code/confirmar', otpLimiter, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').toLowerCase();
    const tag = CODE_RE.test(code) ? await loadTagByCode(code) : null;
    if (!tag) return res.status(404).render('public/not-found', { title: 'Placa no encontrada' });

    const claim = await db.one('SELECT * FROM claims WHERE tag_id = ?', [tag.id]);
    if (!claim) return res.redirect(config.basePath + '/p/' + code);

    const view = (error) => res.status(400).render('portal/confirm', {
      title: 'Confirma tu correo',
      code, maskedEmail: maskEmail(claim.email), error, resent: false
    });

    if (new Date(claim.expires_at) < new Date()) {
      await db.query('DELETE FROM claims WHERE id = ?', [claim.id]);
      removePhoto(claim.photo);
      return view('El registro vencio. Vuelve a llenar el formulario.');
    }
    if (claim.attempts >= config.otpMaxAttempts) {
      return view('Se agotaron los intentos. Pide un codigo nuevo.');
    }

    const entered = String(req.body.code || '').trim().replace(/\s/g, '');
    if (!otp.matches(entered, claim.code_hash)) {
      await db.query('UPDATE claims SET attempts = attempts + 1 WHERE id = ?', [claim.id]);
      const left = config.otpMaxAttempts - (claim.attempts + 1);
      return view(`El codigo no coincide.${left > 0 ? ` Te quedan ${left} intentos.` : ''}`);
    }

    // --- Codigo correcto: recien aqui se escriben los datos definitivos.
    const payload = JSON.parse(claim.payload);
    const ownerData = payload.owner;
    const petData = payload.pet;

    let owner = await db.one('SELECT * FROM owners WHERE email = ? LIMIT 1', [claim.email]);

    if (owner) {
      // Ya tenia otra placa. Se completan los campos que venga llenando ahora
      // y se conservan los que dejo en blanco, para no borrar datos buenos.
      const merged = {
        name: ownerData.name || owner.name,
        phone: ownerData.phone || owner.phone,
        phone_alt: ownerData.phone_alt || owner.phone_alt,
        address: ownerData.address || owner.address,
        comuna: ownerData.comuna || owner.comuna,
        city: ownerData.city || owner.city
      };
      await db.query(
        `UPDATE owners SET name = ?, phone = ?, phone_alt = ?, address = ?, comuna = ?, city = ?,
                email_verified_at = NOW(), consent_at = NOW(), consent_ip = ?, consent_version = ?
          WHERE id = ?`,
        [merged.name, merged.phone, merged.phone_alt, merged.address, merged.comuna,
          merged.city, payload.consentIp, config.consent.version, owner.id]
      );
      owner = { ...owner, ...merged };
    } else {
      const inserted = await db.query(
        `INSERT INTO owners (name, phone, phone_alt, email, address, comuna, city,
                             email_verified_at, consent_at, consent_ip, consent_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?)`,
        [ownerData.name, ownerData.phone, ownerData.phone_alt, claim.email, ownerData.address,
          ownerData.comuna, ownerData.city, payload.consentIp, config.consent.version]
      );
      owner = { id: inserted.insertId, ...ownerData, email: claim.email };
    }

    const petResult = await db.query(
      `INSERT INTO pets (owner_id, name, species, breed, color, sex, birth_year,
                         sterilized, chip_number, photo, medical_notes, behavior_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [owner.id, petData.name, petData.species, petData.breed, petData.color, petData.sex,
        petData.birth_year, petData.sterilized, petData.chip_number, claim.photo,
        petData.medical_notes, petData.behavior_notes]
    );

    await db.query(
      `UPDATE tags SET status = 'activa', pet_id = ?, claimed_at = NOW(), pin_attempts = 0
        WHERE id = ?`,
      [petResult.insertId, tag.id]
    );
    await db.query('DELETE FROM claims WHERE id = ?', [claim.id]);

    // Queda con sesion abierta para que pueda revisar lo que quedo publicado.
    req.session.ownerId = owner.id;
    req.session.ownerUntil = Date.now() + config.ownerSessionMinutes * 60_000;
    req.session.save(() => res.redirect(config.basePath + '/p/' + code + '?ok=1'));

    mailer.tagActivated({
      owner, petName: petData.name, tagCode: tag.code, areaUrl: config.ownerAreaUrl()
    }).catch((err) => console.error('[activar] aviso al dueno fallido', err));

    if (config.adminNotifyEmail) {
      mailer.tagActivatedForAdmin({
        to: config.adminNotifyEmail,
        owner, petName: petData.name, tagCode: tag.code,
        reviewUrl: `${config.publicUrl}${config.basePath}/admin/placas?q=${tag.code}`
      }).catch((err) => console.error('[activar] aviso al admin fallido', err));
    }
  } catch (err) {
    next(err);
  }
});

// ------------------------ Area del dueno (por OTP) --------------------------

function ownerSessionValid(req) {
  return Boolean(req.session.ownerId) && Number(req.session.ownerUntil || 0) > Date.now();
}

async function requireOwner(req, res, next) {
  try {
    if (!ownerSessionValid(req)) {
      delete req.session.ownerId;
      delete req.session.ownerUntil;
      return res.redirect(config.basePath + '/mis-datos?expirada=1');
    }
    const owner = await db.one('SELECT * FROM owners WHERE id = ?', [req.session.ownerId]);
    if (!owner) {
      delete req.session.ownerId;
      return res.redirect(config.basePath + '/mis-datos');
    }
    // Cada accion renueva la ventana de la sesion.
    req.session.ownerUntil = Date.now() + config.ownerSessionMinutes * 60_000;
    req.owner = owner;
    next();
  } catch (err) {
    next(err);
  }
}

router.get('/mis-datos', formLimiter, (req, res) => {
  if (ownerSessionValid(req)) return res.redirect(config.basePath + '/mis-datos/panel');
  res.render('portal/login', {
    title: 'Mis datos',
    email: '',
    error: null,
    expired: req.query.expirada === '1'
  });
});

router.post('/mis-datos', otpLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 190);
    if (!isEmail(email)) {
      return res.status(400).render('portal/login', {
        title: 'Mis datos', email, error: 'Escribe un correo valido.', expired: false
      });
    }

    const owner = await db.one('SELECT * FROM owners WHERE email = ? LIMIT 1', [email]);

    // La respuesta es la misma exista o no la cuenta: de lo contrario esta
    // pagina serviria para averiguar quien tiene placa.
    req.session.otpEmail = email;
    req.session.save(() => res.redirect(config.basePath + '/mis-datos/codigo'));

    if (owner) {
      const code = await otp.issueAccessCode(email, clientIp(req));
      mailer.accessCode({ to: email, name: owner.name, code })
        .catch((err) => console.error('[acceso] envio de OTP fallido', err));
    }
  } catch (err) {
    next(err);
  }
});

router.get('/mis-datos/codigo', formLimiter, (req, res) => {
  if (!req.session.otpEmail) return res.redirect(config.basePath + '/mis-datos');
  res.render('portal/login-code', {
    title: 'Ingresa tu codigo',
    maskedEmail: maskEmail(req.session.otpEmail),
    error: null
  });
});

router.post('/mis-datos/codigo', otpLimiter, async (req, res, next) => {
  try {
    const email = req.session.otpEmail;
    if (!email) return res.redirect(config.basePath + '/mis-datos');

    const entered = String(req.body.code || '').trim().replace(/\s/g, '');
    const result = await otp.checkAccessCode(email, entered);

    if (!result.ok) {
      const messages = {
        'sin-codigo': 'No hay ningun codigo pendiente. Pide uno nuevo.',
        vencido: 'El codigo vencio. Pide uno nuevo.',
        bloqueado: 'Se agotaron los intentos. Pide un codigo nuevo.',
        incorrecto: `El codigo no coincide.${result.attemptsLeft ? ` Te quedan ${result.attemptsLeft} intentos.` : ''}`
      };
      return res.status(400).render('portal/login-code', {
        title: 'Ingresa tu codigo',
        maskedEmail: maskEmail(email),
        error: messages[result.reason] || 'No pudimos validar el codigo.'
      });
    }

    const owner = await db.one('SELECT id FROM owners WHERE email = ? LIMIT 1', [email]);
    if (!owner) {
      return res.status(400).render('portal/login-code', {
        title: 'Ingresa tu codigo',
        maskedEmail: maskEmail(email),
        error: 'No encontramos ninguna placa con ese correo.'
      });
    }

    // Sesion nueva para que un identificador viejo no quede reutilizable.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.ownerId = owner.id;
      req.session.ownerUntil = Date.now() + config.ownerSessionMinutes * 60_000;
      req.session.save(() => res.redirect(config.basePath + '/mis-datos/panel'));
    });
  } catch (err) {
    next(err);
  }
});

router.post('/mis-datos/salir', (req, res) => {
  req.session.destroy(() => res.redirect(config.basePath + '/mis-datos'));
});

async function loadOwnerTags(ownerId) {
  return db.query(
    `SELECT t.id AS tag_id, t.code, t.status, t.claimed_at,
            p.id AS pet_id, p.name AS pet_name, p.species, p.breed, p.photo
       FROM tags t
       JOIN pets p ON p.id = t.pet_id
      WHERE p.owner_id = ?
      ORDER BY p.name ASC`,
    [ownerId]
  );
}

router.get('/mis-datos/panel', formLimiter, requireOwner, async (req, res, next) => {
  try {
    res.render('portal/home', {
      title: 'Mis datos',
      owner: req.owner,
      tags: await loadOwnerTags(req.owner.id),
      saved: req.query.ok === '1',
      errors: []
    });
  } catch (err) {
    next(err);
  }
});

router.post('/mis-datos/panel', submitLimiter, requireOwner, async (req, res, next) => {
  try {
    const data = readOwnerCommon(req.body);
    // El correo es la identidad de la cuenta: cambiarlo requiere verificarlo de
    // nuevo, asi que aqui no se toca.
    data.email = req.owner.email;
    const errors = validateOwnerCommon(data);

    if (errors.length) {
      return res.status(400).render('portal/home', {
        title: 'Mis datos',
        owner: { ...req.owner, ...data },
        tags: await loadOwnerTags(req.owner.id),
        saved: false,
        errors
      });
    }

    await db.query(
      `UPDATE owners SET name = ?, phone = ?, phone_alt = ?, address = ?, comuna = ?, city = ?
        WHERE id = ?`,
      [data.name, data.phone, data.phone_alt, data.address, data.comuna, data.city, req.owner.id]
    );

    res.redirect(config.basePath + '/mis-datos/panel?ok=1');
  } catch (err) {
    next(err);
  }
});

async function loadOwnPet(ownerId, petId) {
  const id = intOrNull(petId, 1, 2 ** 31);
  if (!id) return null;
  return db.one('SELECT * FROM pets WHERE id = ? AND owner_id = ?', [id, ownerId]);
}

router.get('/mis-datos/mascota/:petId', formLimiter, requireOwner, async (req, res, next) => {
  try {
    const pet = await loadOwnPet(req.owner.id, req.params.petId);
    if (!pet) return res.redirect(config.basePath + '/mis-datos/panel');
    res.render('portal/pet-form', {
      title: 'Editar ' + pet.name,
      owner: req.owner, pet, errors: [], SPECIES, SEXES
    });
  } catch (err) {
    next(err);
  }
});

router.post('/mis-datos/mascota/:petId', submitLimiter, requireOwner, uploadPhoto, async (req, res, next) => {
  try {
    const current = await loadOwnPet(req.owner.id, req.params.petId);
    if (!current) {
      if (req.file) removePhoto(req.file.filename);
      return res.redirect(config.basePath + '/mis-datos/panel');
    }

    const data = readPetCommon(req.body);
    if (!data.name) {
      if (req.file) removePhoto(req.file.filename);
      return res.status(400).render('portal/pet-form', {
        title: 'Editar mascota',
        owner: req.owner, pet: { ...current, ...data },
        errors: ['El nombre de la mascota es obligatorio.'], SPECIES, SEXES
      });
    }

    const removeCurrent = Boolean(req.body.remove_photo) && !req.file;
    const photo = req.file ? req.file.filename : (removeCurrent ? null : current.photo);

    await db.query(
      `UPDATE pets SET name = ?, species = ?, breed = ?, color = ?, sex = ?, birth_year = ?,
              sterilized = ?, chip_number = ?, photo = ?, medical_notes = ?, behavior_notes = ?
        WHERE id = ? AND owner_id = ?`,
      [data.name, data.species, data.breed, data.color, data.sex, data.birth_year,
        data.sterilized, data.chip_number, photo, data.medical_notes, data.behavior_notes,
        current.id, req.owner.id]
    );

    if (current.photo && current.photo !== photo) removePhoto(current.photo);

    res.redirect(config.basePath + '/mis-datos/panel?ok=1');
  } catch (err) {
    if (req.file) removePhoto(req.file.filename);
    next(err);
  }
});

// Pausa o reactiva una placa. Una placa suspendida por el administrador no se
// puede reactivar desde aqui.
router.post('/mis-datos/placa/:tagId/estado', submitLimiter, requireOwner, async (req, res, next) => {
  try {
    const tagId = intOrNull(req.params.tagId, 1, 2 ** 31);
    const tag = tagId
      ? await db.one(
        `SELECT t.* FROM tags t JOIN pets p ON p.id = t.pet_id
          WHERE t.id = ? AND p.owner_id = ? LIMIT 1`,
        [tagId, req.owner.id])
      : null;

    if (tag && (tag.status === 'activa' || tag.status === 'pausada')) {
      const next_ = req.body.activar ? 'activa' : 'pausada';
      await db.query('UPDATE tags SET status = ? WHERE id = ?', [next_, tag.id]);
    }
    res.redirect(config.basePath + '/mis-datos/panel?ok=1');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
