// Levanta la app real contra una base de datos en memoria y recorre el
// circuito completo: fabricacion del lote, activacion con PIN, confirmacion
// por OTP, uso de la placa, area del dueno y acciones del administrador.
const path = require('path');
const Module = require('module');
const bcrypt = require(path.join(process.cwd(), 'node_modules', 'bcryptjs'));
const session = require(path.join(process.cwd(), 'node_modules', 'express-session'));

process.env.NODE_ENV = 'development';
process.env.PORT = '3999';
process.env.BASE_PATH = '/find';
process.env.PUBLIC_URL = 'https://pipookis.cl';
process.env.SESSION_SECRET = 'test-secret-largo-para-pruebas';
process.env.ADMIN_NOTIFY_EMAIL = 'admin@pipookis.cl';
process.env.SMTP_HOST = 'mail.pipookis.cl';
process.env.SMTP_USER = 'no-reply@pipookis.cl';
process.env.PIN_MAX_ATTEMPTS = '10';

const ADMIN_PASS = 'clave-de-prueba-123';

// ----------------------------- Base en memoria ------------------------------

const T = { admins: [], batches: [], owners: [], pets: [], tags: [], claims: [], otp_codes: [], scans: [] };
const seq = { admins: 0, batches: 0, owners: 0, pets: 0, tags: 0, claims: 0, otp_codes: 0, scans: 0 };

function insert(table, row) {
  seq[table] += 1;
  const full = { id: seq[table], created_at: new Date(), updated_at: new Date(), ...row };
  T[table].push(full);
  return { insertId: full.id, affectedRows: 1 };
}

const byId = (table, id) => T[table].find((r) => String(r.id) === String(id)) || null;
const petOf = (tag) => (tag.pet_id ? byId('pets', tag.pet_id) : null);
const ownerOfPet = (pet) => (pet ? byId('owners', pet.owner_id) : null);

T.admins.push({
  id: 1, name: 'Admin', email: 'admin@pipookis.cl',
  password_hash: bcrypt.hashSync(ADMIN_PASS, 8)
});

const PET_COLS = ['owner_id', 'name', 'species', 'breed', 'color', 'sex', 'birth_year',
  'sterilized', 'chip_number', 'photo', 'medical_notes', 'behavior_notes'];

function zip(cols, params) {
  const out = {};
  cols.forEach((c, i) => { out[c] = params[i] === undefined ? null : params[i]; });
  return out;
}

const handlers = [
  // ------------------------------ tags --------------------------------------
  [/^SELECT id FROM tags WHERE code = \?/, (p) => T.tags.filter((t) => t.code === p[0])],
  [/^SELECT code FROM tags WHERE id = \?/, (p) => [byId('tags', p[0])].filter(Boolean)],
  [/^SELECT \* FROM tags WHERE code = \?/, (p) => T.tags.filter((t) => t.code === p[0])],
  [/^SELECT \* FROM tags WHERE batch_id = \?/, (p) =>
    T.tags.filter((t) => String(t.batch_id) === String(p[0]))],
  [/^SELECT \* FROM tags WHERE id = \?/, (p) => [byId('tags', p[0])].filter(Boolean)],
  [/^SELECT t\.\* FROM tags t JOIN pets p ON p\.id = t\.pet_id WHERE t\.id = \? AND p\.owner_id = \?/, (p) => {
    const tag = byId('tags', p[0]);
    const pet = tag && petOf(tag);
    return pet && String(pet.owner_id) === String(p[1]) ? [tag] : [];
  }],
  [/^INSERT INTO tags/, (p) => insert('tags', {
    code: p[0], pin: p[1], batch_id: p[2], status: 'libre',
    pet_id: null, claimed_at: null, suspend_reason: null, pin_attempts: 0
  })],
  [/^UPDATE tags SET pin_attempts = pin_attempts \+ 1/, (p) => {
    const t = byId('tags', p[0]); if (t) t.pin_attempts += 1; return { affectedRows: 1 };
  }],
  [/^UPDATE tags SET pin_attempts = 0/, (p) => {
    const t = byId('tags', p[0]); if (t) t.pin_attempts = 0; return { affectedRows: 1 };
  }],
  [/^UPDATE tags SET status = 'activa', pet_id = \?/, (p) => {
    const t = byId('tags', p[1]);
    if (t) Object.assign(t, { status: 'activa', pet_id: p[0], claimed_at: new Date(), pin_attempts: 0 });
    return { affectedRows: 1 };
  }],
  [/^UPDATE tags SET status = 'suspendida'/, (p) => {
    const t = byId('tags', p[1]);
    if (t) Object.assign(t, { status: 'suspendida', suspend_reason: p[0] });
    return { affectedRows: 1 };
  }],
  [/^UPDATE tags SET status = 'libre', pet_id = NULL/, (p) => {
    const t = byId('tags', p[1]);
    if (t) Object.assign(t, {
      status: 'libre', pet_id: null, claimed_at: null,
      suspend_reason: null, pin: p[0], pin_attempts: 0
    });
    return { affectedRows: 1 };
  }],
  [/^UPDATE tags SET status = \?, suspend_reason = NULL/, (p) => {
    const t = byId('tags', p[1]);
    if (t) Object.assign(t, { status: p[0], suspend_reason: null });
    return { affectedRows: 1 };
  }],
  [/^UPDATE tags SET status = \? WHERE id = \?/, (p) => {
    const t = byId('tags', p[1]); if (t) t.status = p[0]; return { affectedRows: 1 };
  }],
  [/^SELECT status, COUNT\(\*\) AS total FROM tags GROUP BY status/, () => {
    const acc = {};
    T.tags.forEach((t) => { acc[t.status] = (acc[t.status] || 0) + 1; });
    return Object.entries(acc).map(([status, total]) => ({ status, total }));
  }],

  // Pagina publica: tag + pet + owner
  [/FROM tags t LEFT JOIN pets p ON p\.id = t\.pet_id LEFT JOIN owners o .* WHERE t\.code = \?/s, (p) => {
    const tag = T.tags.find((t) => t.code === p[0]);
    if (!tag) return [];
    const pet = petOf(tag) || {};
    const owner = ownerOfPet(petOf(tag)) || {};
    return [{
      tag_id: tag.id, code: tag.code, status: tag.status, claimed_at: tag.claimed_at,
      pet_id: tag.pet_id, pet_name: pet.name, species: pet.species, breed: pet.breed,
      color: pet.color, sex: pet.sex, birth_year: pet.birth_year, sterilized: pet.sterilized,
      chip_number: pet.chip_number, photo: pet.photo, medical_notes: pet.medical_notes,
      behavior_notes: pet.behavior_notes, reward_note: pet.reward_note,
      owner_id: owner.id, owner_name: owner.name, owner_phone: owner.phone,
      owner_phone_alt: owner.phone_alt, owner_email: owner.email,
      owner_address: owner.address, owner_comuna: owner.comuna, owner_city: owner.city
    }];
  }],
  // Panel: detalle de una placa
  [/FROM tags t LEFT JOIN pets p ON p\.id = t\.pet_id LEFT JOIN owners o .* WHERE t\.id = \?/s, (p) => {
    const tag = byId('tags', p[0]);
    if (!tag) return [];
    const pet = petOf(tag) || {};
    const owner = ownerOfPet(petOf(tag)) || {};
    const batch = tag.batch_id ? byId('batches', tag.batch_id) : null;
    return [{
      ...tag, pet_name: pet.name, species: pet.species, breed: pet.breed, photo: pet.photo,
      owner_id: owner.id, owner_name: owner.name, owner_email: owner.email,
      owner_phone: owner.phone, batch_label: batch ? batch.label : null
    }];
  }],
  // Panel: inventario
  [/FROM tags t LEFT JOIN pets p ON p\.id = t\.pet_id LEFT JOIN owners o .* LEFT JOIN batches b/s, () =>
    T.tags.map((tag) => {
      const pet = petOf(tag) || {};
      const owner = ownerOfPet(petOf(tag)) || {};
      return {
        ...tag, pet_name: pet.name, owner_id: owner.id, owner_name: owner.name,
        batch_label: null,
        scan_count: T.scans.filter((s) => String(s.pet_id) === String(tag.pet_id)).length
      };
    })],
  // Area del dueno: sus placas
  [/FROM tags t JOIN pets p ON p\.id = t\.pet_id WHERE p\.owner_id = \?/s, (p) =>
    T.tags.filter((t) => t.pet_id && String((petOf(t) || {}).owner_id) === String(p[0]))
      .map((t) => {
        const pet = petOf(t);
        return {
          tag_id: t.id, code: t.code, status: t.status, claimed_at: t.claimed_at,
          pet_id: pet.id, pet_name: pet.name, species: pet.species, breed: pet.breed, photo: pet.photo
        };
      })],

  // ----------------------------- batches ------------------------------------
  [/^INSERT INTO batches/, (p) => insert('batches', { label: p[0], quantity: p[1] })],
  [/^SELECT \* FROM batches WHERE id = \?/, (p) => [byId('batches', p[0])].filter(Boolean)],
  [/FROM batches b ORDER BY/, () => T.batches.map((b) => ({
    ...b, free: T.tags.filter((t) => t.batch_id === b.id && t.status === 'libre').length
  }))],

  // ------------------------------ claims ------------------------------------
  [/^SELECT id, photo FROM claims WHERE expires_at < NOW\(\)/, () =>
    T.claims.filter((c) => c.expires_at < new Date())],
  [/^DELETE FROM claims WHERE expires_at < NOW\(\)/, () => {
    T.claims = T.claims.filter((c) => c.expires_at >= new Date());
    return { affectedRows: 1 };
  }],
  [/^SELECT email FROM claims WHERE tag_id = \?/, (p) =>
    T.claims.filter((c) => String(c.tag_id) === String(p[0]))],
  [/^SELECT email, expires_at FROM claims WHERE tag_id = \?/, (p) =>
    T.claims.filter((c) => String(c.tag_id) === String(p[0]))],
  [/^SELECT id, photo FROM claims WHERE tag_id = \?/, (p) =>
    T.claims.filter((c) => String(c.tag_id) === String(p[0]))],
  [/^SELECT \* FROM claims WHERE tag_id = \?/, (p) =>
    T.claims.filter((c) => String(c.tag_id) === String(p[0]))],
  [/^INSERT INTO claims/, (p) => insert('claims', {
    tag_id: p[0], email: p[1], payload: p[2], photo: p[3], code_hash: p[4],
    attempts: 0, expires_at: new Date(Date.now() + p[5] * 3600_000)
  })],
  [/^UPDATE claims SET code_hash = \?/, (p) => {
    const c = byId('claims', p[2]);
    if (c) Object.assign(c, { code_hash: p[0], attempts: 0, expires_at: new Date(Date.now() + p[1] * 3600_000) });
    return { affectedRows: 1 };
  }],
  [/^UPDATE claims SET attempts = attempts \+ 1/, (p) => {
    const c = byId('claims', p[0]); if (c) c.attempts += 1; return { affectedRows: 1 };
  }],
  [/^DELETE FROM claims WHERE id = \?/, (p) => {
    T.claims = T.claims.filter((c) => String(c.id) !== String(p[0]));
    return { affectedRows: 1 };
  }],
  [/^DELETE FROM claims WHERE tag_id = \?/, (p) => {
    T.claims = T.claims.filter((c) => String(c.tag_id) !== String(p[0]));
    return { affectedRows: 1 };
  }],

  // ----------------------------- otp_codes ----------------------------------
  [/^UPDATE otp_codes SET consumed_at = NOW\(\) WHERE email = \?/, (p) => {
    T.otp_codes.filter((o) => o.email === p[0] && !o.consumed_at)
      .forEach((o) => { o.consumed_at = new Date(); });
    return { affectedRows: 1 };
  }],
  [/^INSERT INTO otp_codes/, (p) => insert('otp_codes', {
    email: p[0], code_hash: p[1], expires_at: p[2], ip: p[3], attempts: 0, consumed_at: null
  })],
  [/^SELECT \* FROM otp_codes WHERE email = \? AND consumed_at IS NULL/, (p) => {
    const rows = T.otp_codes.filter((o) => o.email === p[0] && !o.consumed_at);
    return rows.length ? [rows[rows.length - 1]] : [];
  }],
  [/^UPDATE otp_codes SET attempts = attempts \+ 1/, (p) => {
    const o = byId('otp_codes', p[0]); if (o) o.attempts += 1; return { affectedRows: 1 };
  }],
  [/^UPDATE otp_codes SET consumed_at = NOW\(\) WHERE id = \?/, (p) => {
    const o = byId('otp_codes', p[0]); if (o) o.consumed_at = new Date(); return { affectedRows: 1 };
  }],

  // ------------------------------ owners ------------------------------------
  [/^SELECT \* FROM owners WHERE email = \?/, (p) => T.owners.filter((o) => o.email === p[0])],
  [/^SELECT id FROM owners WHERE email = \? AND id <> \?/, (p) =>
    T.owners.filter((o) => o.email === p[0] && String(o.id) !== String(p[1]))],
  [/^SELECT id FROM owners WHERE email = \?/, (p) => T.owners.filter((o) => o.email === p[0])],
  [/^SELECT \* FROM owners WHERE id = \?/, (p) => [byId('owners', p[0])].filter(Boolean)],
  [/^SELECT id, name, email FROM owners/, () => T.owners],
  [/^INSERT INTO owners .*email_verified_at, consent_at/s, (p) => insert('owners', {
    name: p[0], phone: p[1], phone_alt: p[2], email: p[3], address: p[4], comuna: p[5],
    city: p[6], email_verified_at: new Date(), consent_at: new Date(),
    consent_ip: p[7], consent_version: p[8], notes: null
  })],
  [/^INSERT INTO owners \(name, phone, phone_alt, email, address, comuna, city, notes\)/, (p) =>
    insert('owners', {
      name: p[0], phone: p[1], phone_alt: p[2], email: p[3], address: p[4],
      comuna: p[5], city: p[6], notes: p[7], email_verified_at: null, consent_at: null
    })],
  [/^UPDATE owners SET name = \?, phone = \?, phone_alt = \?, address = \?, comuna = \?, city = \?, email_verified_at = NOW\(\)/s, (p) => {
    const o = byId('owners', p[8]);
    if (o) Object.assign(o, {
      name: p[0], phone: p[1], phone_alt: p[2], address: p[3], comuna: p[4], city: p[5],
      email_verified_at: new Date(), consent_at: new Date(), consent_ip: p[6], consent_version: p[7]
    });
    return { affectedRows: 1 };
  }],
  [/^UPDATE owners SET name = \?, phone = \?, phone_alt = \?, email = \?, address = \?, comuna = \?, city = \?, notes = \?/s, (p) => {
    const o = byId('owners', p[8]);
    if (o) Object.assign(o, {
      name: p[0], phone: p[1], phone_alt: p[2], email: p[3],
      address: p[4], comuna: p[5], city: p[6], notes: p[7]
    });
    return { affectedRows: 1 };
  }],
  [/^UPDATE owners SET name = \?, phone = \?, phone_alt = \?, address = \?, comuna = \?, city = \? WHERE id = \?/s, (p) => {
    const o = byId('owners', p[6]);
    if (o) Object.assign(o, {
      name: p[0], phone: p[1], phone_alt: p[2], address: p[3], comuna: p[4], city: p[5]
    });
    return { affectedRows: 1 };
  }],
  [/FROM owners o (WHERE|ORDER)/, () => T.owners.map((o) => ({
    ...o, pet_count: T.pets.filter((p) => p.owner_id === o.id).length
  }))],
  [/^DELETE FROM owners WHERE id = \?/, (p) => {
    const petIds = T.pets.filter((x) => String(x.owner_id) === String(p[0])).map((x) => x.id);
    T.pets = T.pets.filter((x) => String(x.owner_id) !== String(p[0]));
    T.owners = T.owners.filter((o) => String(o.id) !== String(p[0]));
    T.tags.filter((t) => petIds.includes(t.pet_id))
      .forEach((t) => Object.assign(t, { pet_id: null, status: 'libre', claimed_at: null }));
    return { affectedRows: 1 };
  }],

  // ------------------------------- pets -------------------------------------
  [/^INSERT INTO pets .*reward_note\)/s, (p) => insert('pets', {
    ...zip(PET_COLS, p), reward_note: p[12]
  })],
  [/^INSERT INTO pets/, (p) => insert('pets', { ...zip(PET_COLS, p), reward_note: null })],
  [/^SELECT \* FROM pets WHERE id = \? AND owner_id = \?/, (p) =>
    T.pets.filter((r) => String(r.id) === String(p[0]) && String(r.owner_id) === String(p[1]))],
  [/^SELECT \* FROM pets WHERE id = \?/, (p) => [byId('pets', p[0])].filter(Boolean)],
  [/^SELECT photo FROM pets WHERE owner_id = \?/, (p) =>
    T.pets.filter((r) => String(r.owner_id) === String(p[0]))],
  [/^SELECT photo FROM pets WHERE id = \?/, (p) => [byId('pets', p[0])].filter(Boolean)],
  [/FROM pets p LEFT JOIN tags t ON t\.pet_id = p\.id WHERE p\.id = \?/s, (p) => {
    const pet = byId('pets', p[0]);
    if (!pet) return [];
    const tag = T.tags.find((t) => String(t.pet_id) === String(pet.id));
    return [{ ...pet, code: tag ? tag.code : null, tag_id: tag ? tag.id : null }];
  }],
  [/FROM pets p LEFT JOIN tags t ON t\.pet_id = p\.id WHERE p\.owner_id = \?/s, (p) =>
    T.pets.filter((r) => String(r.owner_id) === String(p[0])).map((pet) => {
      const tag = T.tags.find((t) => String(t.pet_id) === String(pet.id));
      return { ...pet, code: tag ? tag.code : null, tag_status: tag ? tag.status : null, tag_id: tag ? tag.id : null };
    })],
  [/FROM pets p JOIN owners o ON o\.id = p\.owner_id LEFT JOIN tags t/s, () =>
    T.pets.map((pet) => {
      const tag = T.tags.find((t) => String(t.pet_id) === String(pet.id));
      return {
        ...pet, owner_name: (byId('owners', pet.owner_id) || {}).name,
        code: tag ? tag.code : null, tag_status: tag ? tag.status : null,
        tag_id: tag ? tag.id : null,
        scan_count: T.scans.filter((s) => String(s.pet_id) === String(pet.id)).length
      };
    })],
  [/^UPDATE pets SET name = \?.*WHERE id = \? AND owner_id = \?/s, (p) => {
    const r = byId('pets', p[11]);
    if (r) Object.assign(r, zip(PET_COLS.slice(1), p));
    return { affectedRows: 1 };
  }],
  [/^UPDATE pets SET name = \?.*reward_note = \? WHERE id = \?/s, (p) => {
    const r = byId('pets', p[12]);
    if (r) Object.assign(r, { ...zip(PET_COLS.slice(1), p), reward_note: p[11] });
    return { affectedRows: 1 };
  }],
  [/^DELETE FROM pets WHERE id = \?/, (p) => {
    T.pets = T.pets.filter((r) => String(r.id) !== String(p[0]));
    T.tags.filter((t) => String(t.pet_id) === String(p[0]))
      .forEach((t) => Object.assign(t, { pet_id: null, status: 'libre', claimed_at: null }));
    return { affectedRows: 1 };
  }],

  // ------------------------------- scans ------------------------------------
  [/^SELECT id FROM scans WHERE pet_id = \? AND notified_scan = 1/, (p) =>
    T.scans.filter((s) => String(s.pet_id) === String(p[0]) && s.notified_scan === 1 && s.scanned_at > p[1])],
  [/^INSERT INTO scans .*notified_scan\)/s, (p) => insert('scans', {
    pet_id: p[0], ip: p[1], user_agent: p[2], notified_scan: p[3], scanned_at: new Date(),
    lat: null, lng: null, accuracy_m: null, address_revealed: 0, notified_location: 0
  })],
  [/^INSERT INTO scans .*notified_location\)/s, (p) => insert('scans', {
    pet_id: p[0], ip: p[1], user_agent: p[2], lat: p[3], lng: p[4], accuracy_m: p[5],
    scanned_at: new Date(), location_at: new Date(), address_revealed: 0,
    notified_scan: 0, notified_location: 1
  })],
  [/^SELECT id FROM scans WHERE id = \? AND pet_id = \?/, (p) =>
    T.scans.filter((s) => String(s.id) === String(p[0]) && String(s.pet_id) === String(p[1]))],
  [/^UPDATE scans SET lat = \?/, (p) => {
    const s = byId('scans', p[3]);
    if (s) Object.assign(s, { lat: p[0], lng: p[1], accuracy_m: p[2], location_at: new Date(), notified_location: 1 });
    return { affectedRows: 1 };
  }],
  [/^UPDATE scans SET address_revealed = 1/, (p) => {
    const s = byId('scans', p[0]); if (s) s.address_revealed = 1; return { affectedRows: 1 };
  }],
  [/^SELECT \* FROM scans WHERE pet_id = \?/, (p) =>
    T.scans.filter((s) => String(s.pet_id) === String(p[0]))],
  [/FROM scans s JOIN pets p/s, () => T.scans.map((s) => {
    const pet = byId('pets', s.pet_id) || {};
    const tag = T.tags.find((t) => String(t.pet_id) === String(s.pet_id));
    return {
      ...s, pet_name: pet.name, owner_name: (byId('owners', pet.owner_id) || {}).name,
      code: tag ? tag.code : null, tag_id: tag ? tag.id : null
    };
  })],

  // ------------------------------ admins ------------------------------------
  [/FROM admins WHERE email = \?/, (p) => T.admins.filter((a) => a.email === p[0])],
  [/^SELECT \* FROM admins WHERE id = \?/, (p) => T.admins.filter((a) => String(a.id) === String(p[0]))],
  [/^UPDATE admins/, () => ({ affectedRows: 1 })],
  [/COUNT\(\*\) AS total FROM owners/, () => [{ total: T.owners.length }]],
  [/COUNT\(\*\) AS total FROM scans/, () => [{ total: T.scans.length }]]
];

const fakeDb = {
  // El pool responde al SELECT 1 con que la app comprueba la base al arrancar.
  pool: { end: async () => {}, query: async () => [[{ 1: 1 }], []] },
  async query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    for (const [re, fn] of handlers) {
      if (re.test(s)) return fn(params, s);
    }
    throw new Error('SQL no simulado: ' + s.slice(0, 130));
  },
  async one(sql, params) {
    const rows = await fakeDb.query(sql, params);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }
};

function stub(request, exportsValue) {
  const resolved = require.resolve(request, { paths: [process.cwd()] });
  const m = new Module(resolved, null);
  m.filename = resolved;
  m.loaded = true;
  m.exports = exportsValue;
  require.cache[resolved] = m;
}

// Se intercepta el transporte, no el mailer: asi se ejercita el codigo real de
// armado de los correos y se captura lo que habria salido a la red.
const sent = [];

stub('./src/db', fakeDb);
stub('express-mysql-session', () => session.MemoryStore);
stub('nodemailer', {
  createTransport: () => ({
    sendMail: async (msg) => { sent.push(msg); return { messageId: 'test-' + sent.length }; }
  })
});

function lastCodeTo(email) {
  for (let i = sent.length - 1; i >= 0; i -= 1) {
    if (sent[i].to === email) {
      const m = String(sent[i].text || '').match(/\b(\d{6})\b/);
      if (m) return m[1];
    }
  }
  return null;
}

// ------------------------------- Utilidades ---------------------------------

const BASE = 'http://127.0.0.1:3999';
let cookie = '';

async function req(method, url, { json, form } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let body;
  if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }

  const res = await fetch(BASE + url, { method, headers, body, redirect: 'manual' });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const type = res.headers.get('content-type') || '';
  const payload = type.includes('application/json')
    ? await res.json()
    : (type.startsWith('image/') ? Buffer.from(await res.arrayBuffer()) : await res.text());
  return { status: res.status, headers: res.headers, body: payload };
}

async function csrfFrom(url) {
  const p = await req('GET', url);
  return (String(p.body).match(/name="_csrf" value="([^"]+)"/) || [])[1];
}

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('  OK   ' + name); }
  else { fail += 1; console.log('  FALLA ' + name + (extra ? ' -> ' + extra : '')); }
}

// --------------------------------- Pruebas ----------------------------------

(async () => {
  require(path.join(process.cwd(), 'app.js'));
  await new Promise((r) => setTimeout(r, 600));

  console.log('\n[1] Panel y fabricacion del lote');
  const loginPage = await req('GET', '/find/admin/login');
  const csrf = (loginPage.body.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  check('el login carga con token CSRF', loginPage.status === 200 && !!csrf);
  check('el panel exige sesion', (await req('GET', '/find/admin')).status === 302);
  check('sin token CSRF responde 403',
    (await req('POST', '/find/admin/login', { form: { email: 'admin@pipookis.cl', password: ADMIN_PASS } })).status === 403);

  const csrf2 = await csrfFrom('/find/admin/login');
  check('login correcto redirige',
    (await req('POST', '/find/admin/login', {
      form: { _csrf: csrf2, email: 'admin@pipookis.cl', password: ADMIN_PASS }
    })).status === 302);

  const lote = await req('POST', '/find/admin/placas/lote', {
    form: { _csrf: await csrfFrom('/find/admin/placas'), quantity: '10', label: 'Lote de prueba' }
  });
  check('se fabrica el lote de 10 placas', lote.status === 302 && T.tags.length === 10, T.tags.length);
  check('todas nacen libres y sin mascota',
    T.tags.every((t) => t.status === 'libre' && t.pet_id === null));
  check('los codigos son unicos', new Set(T.tags.map((t) => t.code)).size === 10);
  check('los PIN son unicos y de 6 caracteres',
    T.tags.every((t) => /^[A-Z2-9]{6}$/.test(t.pin)) && new Set(T.tags.map((t) => t.pin)).size === 10);

  const sheet = await req('GET', `/find/admin/placas/lote/${T.batches[0].id}/imprimir`);
  check('la hoja de impresion carga', sheet.status === 200, sheet.status);
  check('ADVIERTE QUE EL PIN NO VA EN LA PLACA',
    sheet.body.includes('El PIN no debe ir grabado en la placa'));
  check('trae los 10 QR', (sheet.body.match(/data:image\/png/g) || []).length >= 10);
  check('trae los insertos con el PIN', sheet.body.includes(T.tags[0].pin));

  const csv = await req('GET', `/find/admin/placas/lote/${T.batches[0].id}/csv`);
  check('el CSV se descarga', csv.status === 200 && csv.body.includes(T.tags[0].code));

  console.log('\n[2] Placa libre escaneada');
  const tag = T.tags[0];
  const free = await req('GET', '/find/p/' + tag.code);
  check('lleva a la pantalla de activacion', free.status === 200 && free.body.includes('sin activar'), free.status);
  check('no filtra el PIN en la pagina publica', !free.body.includes(tag.pin));
  check('un codigo inexistente responde 404', (await req('GET', '/find/p/zzzzzzzz')).status === 404);

  console.log('\n[3] El PIN protege la activacion');
  const datos = {
    name: 'Maria Perez', phone: '+56 9 8765 4321', email: 'maria@ejemplo.cl',
    address: 'Los Olmos 123', comuna: 'Nunoa', city: 'Santiago',
    pet_name: 'Rocky', pet_species: 'perro', pet_breed: 'Quiltro',
    pet_medical_notes: 'Toma medicamento diario.', consent: '1'
  };

  const badPin = await req('POST', '/find/p/' + tag.code + '/activar', { form: { ...datos, pin: 'XXXXXX' } });
  check('CON EL PIN EQUIVOCADO NO SE ACTIVA', badPin.status === 400 && badPin.body.includes('PIN no coincide'), badPin.status);
  check('cuenta el intento fallido', tag.pin_attempts === 1, tag.pin_attempts);
  check('no crea nada en la base', T.claims.length === 0 && T.owners.length === 0);

  const noConsent = await req('POST', '/find/p/' + tag.code + '/activar', {
    form: { ...datos, pin: tag.pin, consent: '' }
  });
  check('sin la autorizacion no continua', noConsent.status === 400 && noConsent.body.includes('autorizacion'));
  check('el PIN correcto reinicia el contador de intentos', tag.pin_attempts === 0);
  check('sigue sin crear nada', T.claims.length === 0 && T.owners.length === 0);

  console.log('\n[4] Registro y confirmacion del correo');
  const started = await req('POST', '/find/p/' + tag.code + '/activar', { form: { ...datos, pin: tag.pin } });
  check('el formulario correcto lleva a confirmar', started.status === 302, started.status);
  check('queda un registro pendiente', T.claims.length === 1);
  check('TODAVIA NO SE CREA EL DUENO NI LA MASCOTA', T.owners.length === 0 && T.pets.length === 0);
  check('la placa sigue libre', T.tags[0].status === 'libre');
  check('se envio el codigo al correo', sent.some((m) => m.to === 'maria@ejemplo.cl' && /codigo para activar/.test(m.subject)));

  const early = await req('GET', '/find/p/' + tag.code);
  check('la placa no muestra datos antes de confirmar', !early.body.includes('8765 4321'));
  check('el endpoint de escaneo tambien la bloquea',
    (await req('POST', '/find/p/' + tag.code + '/scan', { json: {} })).status === 404);

  const wrongOtp = await req('POST', '/find/p/' + tag.code + '/confirmar', { form: { code: '000000' } });
  check('un codigo OTP equivocado no activa', wrongOtp.status === 400 && T.owners.length === 0);
  check('cuenta el intento de OTP', T.claims[0].attempts === 1);

  const otpCode = lastCodeTo('maria@ejemplo.cl');
  check('el codigo es de 6 digitos', /^\d{6}$/.test(otpCode || ''), otpCode);

  const confirmed = await req('POST', '/find/p/' + tag.code + '/confirmar', { form: { code: otpCode } });
  check('el codigo correcto activa la placa', confirmed.status === 302, confirmed.status);
  check('se creo el dueno con el correo verificado',
    T.owners.length === 1 && Boolean(T.owners[0].email_verified_at));
  check('se creo la mascota', T.pets.length === 1 && T.pets[0].name === 'Rocky');
  check('la placa quedo activa y enlazada',
    T.tags[0].status === 'activa' && T.tags[0].pet_id === T.pets[0].id);
  check('el registro pendiente se limpio', T.claims.length === 0);
  check('QUEDA REGISTRADO EL CONSENTIMIENTO con fecha, IP y version',
    Boolean(T.owners[0].consent_at) && Boolean(T.owners[0].consent_ip) &&
    T.owners[0].consent_version === '2026-08');
  check('se le avisa al dueno', sent.some((m) => /quedo activa/.test(m.subject || '')));
  check('se le avisa al administrador',
    sent.some((m) => m.to === 'admin@pipookis.cl' && /Placa activada/.test(m.subject)));

  console.log('\n[5] La placa ya funciona');
  cookie = ''; // se simula a otra persona, la que encuentra la mascota
  const page = await req('GET', '/find/p/' + tag.code);
  check('la pagina del QR responde 200', page.status === 200, page.status);
  check('muestra el nombre de la mascota', page.body.includes('Rocky'));
  check('muestra el telefono', page.body.includes('+56 9 8765 4321'));
  check('muestra las notas medicas', page.body.includes('Toma medicamento diario'));
  check('LA DIRECCION NO VIAJA EN EL HTML', !page.body.includes('Los Olmos'));
  check('el correo del dueno no viaja en el HTML', !page.body.includes('maria@ejemplo.cl'));
  check('link de WhatsApp normalizado', page.body.includes('wa.me/56987654321'));

  const scan = await req('POST', '/find/p/' + tag.code + '/scan', { json: {} });
  check('registra el escaneo', scan.status === 200 && !!scan.body.scanId);
  check('avisa al dueno del escaneo', sent.some((m) => /Escanearon la placa/.test(m.subject || '')));
  check('el segundo escaneo seguido no repite el correo',
    (await req('POST', '/find/p/' + tag.code + '/scan', { json: {} })).status === 200 &&
    sent.filter((m) => /Escanearon la placa/.test(m.subject || '')).length === 1);

  const loc = await req('POST', '/find/p/' + tag.code + '/location', {
    json: { scanId: scan.body.scanId, lat: -33.4489, lng: -70.6693, accuracy: 18 }
  });
  check('acepta la ubicacion y manda el mapa',
    loc.status === 200 && sent.some((m) => /Ubicacion de Rocky/.test(m.subject || '')));
  check('rechaza coordenadas invalidas',
    (await req('POST', '/find/p/' + tag.code + '/location', { json: { lat: 999, lng: 0 } })).status === 400);

  const addr = await req('POST', '/find/p/' + tag.code + '/direccion', { json: { scanId: scan.body.scanId } });
  check('entrega la direccion solo al pedirla',
    addr.body.address === 'Los Olmos 123, Nunoa, Santiago', JSON.stringify(addr.body));
  check('entrega el correo solo al pedirlo',
    (await req('POST', '/find/p/' + tag.code + '/correo', { json: {} })).body.email === 'maria@ejemplo.cl');

  console.log('\n[6] Segunda placa, mismo dueno');
  const tag2 = T.tags[1];
  const started2 = await req('POST', '/find/p/' + tag2.code + '/activar', {
    form: { ...datos, pin: tag2.pin, pet_name: 'Luna', pet_species: 'gato', address: '' }
  });
  check('arranca el registro de la segunda placa', started2.status === 302);
  const otp2 = lastCodeTo('maria@ejemplo.cl');
  await req('POST', '/find/p/' + tag2.code + '/confirmar', { form: { code: otp2 } });
  check('NO SE DUPLICA EL DUENO', T.owners.length === 1, T.owners.length);
  check('se enlaza a la cuenta existente',
    T.pets.length === 2 && T.pets[1].owner_id === T.owners[0].id);
  check('no borra la direccion que dejo en blanco', T.owners[0].address === 'Los Olmos 123');

  console.log('\n[7] Area del dueno con OTP');
  cookie = '';
  const unknown = await req('POST', '/find/mis-datos', { form: { email: 'nadie@ejemplo.cl' } });
  check('un correo desconocido responde igual', unknown.status === 302, unknown.status);
  check('pero no se le envia ningun codigo', !sent.some((m) => m.to === 'nadie@ejemplo.cl'));

  await req('POST', '/find/mis-datos', { form: { email: 'maria@ejemplo.cl' } });
  const accessCode = lastCodeTo('maria@ejemplo.cl');
  check('se envia el codigo de acceso', sent.some((m) => /codigo de acceso/.test(m.subject || '')));

  const badAccess = await req('POST', '/find/mis-datos/codigo', { form: { code: '111111' } });
  check('un codigo equivocado no entra', badAccess.status === 400 && badAccess.body.includes('no coincide'));
  check('el panel sigue cerrado', (await req('GET', '/find/mis-datos/panel')).status === 302);

  const entered = await req('POST', '/find/mis-datos/codigo', { form: { code: accessCode } });
  check('el codigo correcto abre la sesion', entered.status === 302, entered.status);

  const panel = await req('GET', '/find/mis-datos/panel');
  check('el panel del dueno carga', panel.status === 200, panel.status);
  check('lista sus dos placas', panel.body.includes('Rocky') && panel.body.includes('Luna'));

  // Se abre una sesion limpia y se pide un codigo nuevo: el anterior, ya usado
  // y ademas reemplazado, no debe servir.
  const savedCookie = cookie;
  cookie = '';
  await req('POST', '/find/mis-datos', { form: { email: 'maria@ejemplo.cl' } });
  check('UN CODIGO YA USADO NO SIRVE DE NUEVO',
    (await req('POST', '/find/mis-datos/codigo', { form: { code: accessCode } })).status === 400);
  check('y esa sesion queda cerrada', (await req('GET', '/find/mis-datos/panel')).status === 302);
  cookie = savedCookie;

  const upd = await req('POST', '/find/mis-datos/panel', {
    form: {
      name: 'Maria Perez Soto', phone: '+56 9 1111 2222', email: 'otro@ejemplo.cl',
      address: 'Los Olmos 456', comuna: 'Nunoa', city: 'Santiago'
    }
  });
  check('guarda los cambios', upd.status === 302 && T.owners[0].phone === '+56 9 1111 2222');
  check('NO DEJA CAMBIAR EL CORREO DESDE EL PANEL', T.owners[0].email === 'maria@ejemplo.cl');

  const pause = await req('POST', `/find/mis-datos/placa/${T.tags[0].id}/estado`, { form: {} });
  check('el dueno puede pausar su placa', pause.status === 302 && T.tags[0].status === 'pausada');
  check('la placa pausada deja de mostrar datos',
    (await req('GET', '/find/p/' + tag.code)).status === 410);
  await req('POST', `/find/mis-datos/placa/${T.tags[0].id}/estado`, { form: { activar: '1' } });
  check('y puede reactivarla', T.tags[0].status === 'activa');

  const foreign = await req('POST', `/find/mis-datos/placa/${T.tags[5].id}/estado`, { form: {} });
  check('no puede tocar una placa ajena', foreign.status === 302 && T.tags[5].status === 'libre');

  console.log('\n[8] Acciones del administrador');
  cookie = '';
  await req('POST', '/find/admin/login', {
    form: { _csrf: await csrfFrom('/find/admin/login'), email: 'admin@pipookis.cl', password: ADMIN_PASS }
  });

  const tagId = T.tags[0].id;
  const susp = await req('POST', `/find/admin/placas/${tagId}/suspender`, {
    form: { _csrf: await csrfFrom(`/find/admin/placas/${tagId}`), reason: 'Contenido inapropiado' }
  });
  check('el administrador puede suspender', susp.status === 302 && T.tags[0].status === 'suspendida');
  check('la placa suspendida no muestra datos',
    (await req('GET', '/find/p/' + tag.code)).status === 410);
  check('se le avisa al dueno de la suspension',
    sent.some((m) => /fue suspendida/.test(m.subject || '')));

  await req('POST', `/find/admin/placas/${tagId}/reactivar`, {
    form: { _csrf: await csrfFrom(`/find/admin/placas/${tagId}`) }
  });
  check('y reactivarla', T.tags[0].status === 'activa');

  const oldPin = T.tags[0].pin;
  await req('POST', `/find/admin/placas/${tagId}/liberar`, {
    form: { _csrf: await csrfFrom(`/find/admin/placas/${tagId}`) }
  });
  check('liberar devuelve la placa al inventario',
    T.tags[0].status === 'libre' && T.tags[0].pet_id === null);
  check('LIBERAR GENERA UN PIN NUEVO', T.tags[0].pin !== oldPin);
  check('el dueno y la mascota no se borran', T.owners.length === 1 && T.pets.length === 2);
  check('el PIN viejo ya no activa la placa',
    (await req('POST', '/find/p/' + tag.code + '/activar', { form: { ...datos, pin: oldPin } })).status === 400);

  console.log('\n[9] Bloqueo por intentos de PIN');
  const victim = T.tags[8];
  for (let i = 0; i < 10; i += 1) {
    await req('POST', '/find/p/' + victim.code + '/activar', { form: { ...datos, pin: 'ZZZZZZ' } });
  }
  const blocked = await req('POST', '/find/p/' + victim.code + '/activar', { form: { ...datos, pin: victim.pin } });
  check('tras 10 intentos fallidos se bloquea la activacion',
    blocked.status === 429 && victim.status === 'libre', blocked.status);
  check('ni siquiera con el PIN correcto', T.claims.length === 0);

  console.log('\n[10] Codigos y rutas');
  const cfg = require(path.join(process.cwd(), 'src', 'config'));
  check('la URL del QR apunta a pipookis.cl/find',
    cfg.tagUrl('a7f3k9x2') === 'https://pipookis.cl/find/p/a7f3k9x2', cfg.tagUrl('a7f3k9x2'));
  const png = await req('GET', `/find/admin/placas/${T.tags[1].id}/qr.png?size=512`);
  check('descarga el PNG del QR',
    png.status === 200 && Buffer.isBuffer(png.body) && png.body.slice(1, 4).toString() === 'PNG');

  const phone = require(path.join(process.cwd(), 'src', 'services', 'phone'));
  [['+56 9 8765 4321', '56987654321'], ['987654321', '56987654321'],
    ['09 8765 4321', '56987654321'], ['22 988 7766', '56229887766']]
    .forEach(([input, expected]) => {
      check(`wa "${input}" -> ${expected}`, phone.toWhatsApp(input) === expected, phone.toWhatsApp(input));
    });

  check('funciona sin el prefijo /find (Passenger que ya lo quita)',
    (await req('GET', '/p/zzzzzzzz')).status === 404);

  const token = require(path.join(process.cwd(), 'src', 'diag')).DIAG_TOKEN;
  const d1 = await req('GET', '/find/_diag/' + token);
  check('el diagnostico responde con el prefijo', d1.status === 200 && !!d1.body.despliegue, d1.status);
  const d2 = await req('GET', '/_diag/' + token);
  check('y tambien sin el prefijo', d2.status === 200, d2.status);
  check('el diagnostico NO muestra ninguna clave',
    !JSON.stringify(d2.body).includes(process.env.SESSION_SECRET));
  check('informa el basePath efectivo', d2.body.configuracionEfectiva.basePath === '/find');

  console.log(`\n${pass} pruebas OK, ${fail} fallas`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error('ERROR EN EL ARNES:', err); process.exit(1); });
