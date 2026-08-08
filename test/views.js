// Renderiza todas las vistas con datos falsos para detectar errores de EJS.
process.env.BASE_PATH = '/find';
process.env.PUBLIC_URL = 'https://pipookis.cl';

const path = require('path');
const ejs = require(path.join(process.cwd(), 'node_modules', 'ejs'));
const phone = require(path.join(process.cwd(), 'src', 'services', 'phone'));
const config = require(path.join(process.cwd(), 'src', 'config'));

const VIEWS = path.join(process.cwd(), 'views');
const SPECIES = ['perro', 'gato', 'otro'];
const SEXES = ['macho', 'hembra', ''];

const base = {
  url: (p) => `/find${p}` || '/',
  brand: 'Pipooki',
  admin: { id: 1, name: 'Daniel', email: 'contacto@webpremium.cl' },
  flash: { type: 'ok', msg: 'Guardado.' },
  csrfToken: 'tok',
  section: 'placas',
  title: 'Prueba'
};

const owner = {
  id: 1, name: 'Maria Perez', phone: '+56 9 8765 4321', phone_alt: '229887766',
  email: 'maria@ejemplo.cl', address: 'Los Olmos 123', comuna: 'Nunoa', city: 'Santiago',
  notes: 'Cliente de prueba', pet_count: 2, email_verified_at: new Date(),
  consent_at: new Date(), consent_ip: '190.1.1.1', consent_version: '2026-08',
  created_at: new Date()
};

const pet = {
  id: 7, owner_id: 1, name: 'Rocky', species: 'perro', breed: 'Quiltro',
  color: 'Cafe con blanco', sex: 'macho', birth_year: 2020, sterilized: 1,
  chip_number: '9900123', photo: null, medical_notes: 'Toma medicamento diario.',
  behavior_notes: 'Es asustadizo.', reward_note: 'Hay recompensa.',
  owner_name: owner.name, code: 'a7f3k9x2', tag_id: 3, tag_status: 'activa',
  scan_count: 3, created_at: new Date(), updated_at: new Date()
};

// Fila que devuelve loadTag() en la pagina publica.
const tagRow = {
  tag_id: 3, code: 'a7f3k9x2', status: 'activa', claimed_at: new Date(),
  pet_id: 7, pet_name: 'Rocky', species: 'perro', breed: 'Quiltro',
  color: 'Cafe con blanco', sex: 'macho', birth_year: 2020, sterilized: 1,
  chip_number: '9900123', photo: null, medical_notes: 'Toma medicamento diario.',
  behavior_notes: 'Es asustadizo.', reward_note: 'Hay recompensa.',
  owner_id: 1, owner_name: owner.name, owner_phone: owner.phone,
  owner_phone_alt: owner.phone_alt, owner_email: owner.email,
  owner_address: owner.address, owner_comuna: owner.comuna, owner_city: owner.city
};

// Fila que ve el panel en el inventario.
const adminTag = {
  id: 3, code: 'a7f3k9x2', pin: 'K7M2P9', batch_id: 1, status: 'activa',
  pet_id: 7, claimed_at: new Date(), suspend_reason: null, pin_attempts: 0,
  pet_name: 'Rocky', species: 'perro', breed: 'Quiltro', photo: null,
  owner_id: 1, owner_name: owner.name, owner_email: owner.email,
  owner_phone: owner.phone, batch_label: 'Lote de agosto', scan_count: 4,
  created_at: new Date()
};

const scan = {
  id: 1, pet_id: 7, tag_id: 3, code: 'a7f3k9x2', scanned_at: new Date(),
  lat: -33.45, lng: -70.66, accuracy_m: 22, address_revealed: 1,
  notified_scan: 1, notified_location: 1, pet_name: 'Rocky', owner_name: owner.name
};

const batch = { id: 1, label: 'Lote de agosto', quantity: 10, free: 6, created_at: new Date() };

const cases = [
  ['public/home', {}],
  ['public/not-found', {}],
  ['public/inactive', { suspended: false }],
  ['public/inactive', { suspended: true }],
  ['public/tag-free', { code: 'a7f3k9x2', activated: false }],
  ['errors/404', {}],
  ['errors/404', { detail: 'POST /find/p/abc/activar  ->  ruta buscada: /p/abc/activar' }],
  ['errors/500', { message: 'detalle' }],
  ['public/pet', {
    tag: tagRow, code: 'a7f3k9x2', justActivated: false, ownerFirstName: 'Maria',
    phonePretty: phone.pretty(owner.phone), phoneTel: phone.toTel(owner.phone),
    phoneWa: phone.toWhatsApp(owner.phone), phoneAltPretty: phone.pretty(owner.phone_alt),
    phoneAltTel: phone.toTel(owner.phone_alt), ownerEmail: owner.email
  }],
  ['public/pet', {
    tag: tagRow, code: 'a7f3k9x2', justActivated: true, ownerFirstName: 'Maria',
    phonePretty: '', phoneTel: '', phoneWa: '', phoneAltPretty: null,
    phoneAltTel: null, ownerEmail: null
  }],

  ['portal/activate', {
    code: 'a7f3k9x2', owner: {}, pet: { species: 'perro' },
    errors: [], pinError: null, consent: config.consent, SPECIES, SEXES
  }],
  ['portal/activate', {
    code: 'a7f3k9x2', owner, pet, errors: ['Falta la autorizacion'],
    pinError: 'El PIN no coincide.', consent: config.consent, SPECIES, SEXES
  }],
  ['portal/confirm', { code: 'a7f3k9x2', maskedEmail: 'ma****@ejemplo.cl', error: null, resent: true }],
  ['portal/confirm', { code: 'a7f3k9x2', maskedEmail: 'ma****@ejemplo.cl', error: 'El codigo no coincide.', resent: false }],
  ['portal/login', { email: '', error: null, expired: true }],
  ['portal/login', { email: 'x@y.cl', error: 'Escribe un correo valido.', expired: false }],
  ['portal/login-code', { maskedEmail: 'ma****@ejemplo.cl', error: null }],
  ['portal/home', {
    owner,
    tags: [
      { tag_id: 3, code: 'a7f3k9x2', status: 'activa', pet_id: 7, pet_name: 'Rocky', photo: null },
      { tag_id: 4, code: 'b2k4m8n1', status: 'pausada', pet_id: 8, pet_name: 'Luna', photo: 'x.jpg' },
      { tag_id: 5, code: 'c3p5q7r2', status: 'suspendida', pet_id: 9, pet_name: 'Nube', photo: null }
    ],
    saved: true, errors: []
  }],
  ['portal/home', { owner, tags: [], saved: false, errors: ['El telefono no parece valido.'] }],
  ['portal/pet-form', { owner, pet: { ...pet, photo: 'x.jpg' }, errors: [], SPECIES, SEXES }],

  ['admin/login', { error: 'Credenciales invalidas', email: 'a@b.cl' }],
  ['admin/dashboard', {
    stats: { libre: 6, activa: 3, pausada: 1, suspendida: 0, owners: 3, scans30: 12 },
    recent: [scan], smtpReady: false
  }],
  ['admin/dashboard', {
    stats: { libre: 0, activa: 10, pausada: 0, suspendida: 0, owners: 9, scans30: 40 },
    recent: [], smtpReady: true
  }],
  ['admin/tags', {
    tags: [adminTag, { ...adminTag, id: 4, code: 'b2k4m8n1', status: 'libre', pet_id: null, pet_name: null, owner_id: null }],
    batches: [batch], q: '', status: '', batchSize: 10, config
  }],
  ['admin/tag-detail', {
    tag: adminTag, scans: [scan], claim: null,
    tagUrl: config.tagUrl('a7f3k9x2'), qrPreview: 'data:image/png;base64,AAAA'
  }],
  ['admin/tag-detail', {
    tag: { ...adminTag, status: 'libre', pet_id: null, pet_name: null, pin_attempts: 3 },
    scans: [], claim: { email: 'maria@ejemplo.cl', expires_at: new Date() },
    tagUrl: config.tagUrl('a7f3k9x2'), qrPreview: 'data:image/png;base64,AAAA'
  }],
  ['admin/tag-detail', {
    tag: { ...adminTag, status: 'suspendida', suspend_reason: 'Contenido inapropiado' },
    scans: [], claim: null,
    tagUrl: config.tagUrl('a7f3k9x2'), qrPreview: 'data:image/png;base64,AAAA'
  }],
  ['admin/tag-activate', {
    tag: { id: 4, code: 'b2k4m8n1' }, owners: [owner],
    owner: {}, pet: { species: 'perro' }, errors: [], SPECIES, SEXES
  }],
  ['admin/print-sheet', {
    batch,
    tags: [
      { code: 'a7f3k9x2', pin: 'K7M2P9', qr: 'data:image/png;base64,AAAA', url: config.tagUrl('a7f3k9x2') },
      { code: 'b2k4m8n1', pin: 'X4T8W2', qr: 'data:image/png;base64,AAAA', url: config.tagUrl('b2k4m8n1') }
    ],
    brandName: 'Pipooki'
  }],
  ['admin/owners', { owners: [owner], q: '', phone }],
  ['admin/owner-form', { owner, errors: ['Falta el nombre'] }],
  ['admin/owner-detail', { owner, pets: [pet, { ...pet, id: 8, code: null, tag_id: null, tag_status: null }], phone, config }],
  ['admin/pets', { pets: [pet, { ...pet, id: 9, tag_id: null, code: null, tag_status: null }], q: 'roc' }],
  ['admin/pet-form', { pet: { ...pet, photo: 'x.jpg' }, errors: [], SPECIES, SEXES }],
  ['admin/scans', { scans: [scan], current: 2, pages: 4, total: 180 }],
  ['admin/account', { errors: [], done: true }]
];

let failed = 0;
(async () => {
  for (const [view, locals] of cases) {
    try {
      const html = await ejs.renderFile(path.join(VIEWS, view + '.ejs'), { ...base, ...locals });
      if (!html || html.length < 50) throw new Error('salida vacia');
      console.log(`OK   ${view}  (${html.length} bytes)`);
    } catch (err) {
      failed += 1;
      console.log(`FALLA ${view}: ${err.message.split('\n')[0]}`);
    }
  }
  console.log(failed ? `\n${failed} vista(s) con error` : '\nTodas las vistas renderizan');
  process.exit(failed ? 1 : 0);
})();
