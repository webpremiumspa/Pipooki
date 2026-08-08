-- Pipooki Find - esquema de base de datos (MariaDB 10.4+ / MySQL 8)
-- Se ejecuta con: npm run setup
--
-- Modelo: la PLACA existe antes que la mascota. Se fabrican lotes de placas
-- genericas (tabla tags) con un codigo para el QR y un PIN que va en el
-- empaque. El dueno escanea, ingresa el PIN, llena sus datos y confirma su
-- correo con un codigo OTP. Recien ahi la placa queda enlazada a una mascota.

CREATE TABLE IF NOT EXISTS admins (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(120)  NOT NULL,
  email         VARCHAR(190)  NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,
  last_login_at DATETIME      NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lote de fabricacion. Sirve para imprimir todas las placas de una tirada.
CREATE TABLE IF NOT EXISTS batches (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  label      VARCHAR(150)     NULL,
  quantity   SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS owners (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name              VARCHAR(150) NOT NULL,
  phone             VARCHAR(40)  NOT NULL,
  phone_alt         VARCHAR(40)      NULL,
  -- El correo es la identidad del dueno: con el pide el OTP para editar.
  email             VARCHAR(190) NOT NULL,
  address           VARCHAR(255)     NULL,
  comuna            VARCHAR(120)     NULL,
  city              VARCHAR(120)     NULL,
  notes             TEXT             NULL,
  email_verified_at DATETIME         NULL,
  consent_at        DATETIME         NULL,
  consent_ip        VARCHAR(45)      NULL,
  consent_version   VARCHAR(20)      NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_owners_email (email),
  KEY idx_owners_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pets (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id        INT UNSIGNED NOT NULL,
  name            VARCHAR(120) NOT NULL,
  species         VARCHAR(30)  NOT NULL DEFAULT 'perro',
  breed           VARCHAR(120)     NULL,
  color           VARCHAR(120)     NULL,
  sex             VARCHAR(10)      NULL,
  birth_year      SMALLINT UNSIGNED NULL,
  sterilized      TINYINT(1)   NOT NULL DEFAULT 0,
  chip_number     VARCHAR(60)      NULL,
  photo           VARCHAR(190)     NULL,
  medical_notes   TEXT             NULL,
  behavior_notes  TEXT             NULL,
  reward_note     VARCHAR(255)     NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pets_owner (owner_id),
  CONSTRAINT fk_pets_owner FOREIGN KEY (owner_id) REFERENCES owners (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La placa fisica. Una placa = una mascota.
--   libre       recien fabricada, esperando que alguien la active
--   activa      enlazada a una mascota y mostrando sus datos
--   pausada     el dueno la apago
--   suspendida  el administrador la apago (el dueno no puede revertirlo)
CREATE TABLE IF NOT EXISTS tags (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code             VARCHAR(16)  NOT NULL,
  -- Va impreso en el inserto del empaque, NUNCA en la placa: es lo que impide
  -- que alguien se apropie de una placa colgada en la vitrina de una tienda.
  pin              VARCHAR(12)  NOT NULL,
  batch_id         INT UNSIGNED     NULL,
  status           VARCHAR(12)  NOT NULL DEFAULT 'libre',
  pet_id           INT UNSIGNED     NULL,
  claimed_at       DATETIME         NULL,
  suspend_reason   VARCHAR(255)     NULL,
  pin_attempts     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tags_code (code),
  UNIQUE KEY uq_tags_pet (pet_id),
  KEY idx_tags_status (status),
  KEY idx_tags_batch (batch_id),
  CONSTRAINT fk_tags_pet FOREIGN KEY (pet_id) REFERENCES pets (id) ON DELETE SET NULL,
  CONSTRAINT fk_tags_batch FOREIGN KEY (batch_id) REFERENCES batches (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Registro a medio hacer: ya paso el PIN pero todavia no confirma el correo.
-- Nada se escribe en owners ni pets hasta que el OTP se valida, para que un
-- correo mal tecleado no deje la placa inutilizable.
CREATE TABLE IF NOT EXISTS claims (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tag_id     INT UNSIGNED NOT NULL,
  email      VARCHAR(190) NOT NULL,
  payload    LONGTEXT     NOT NULL,
  photo      VARCHAR(190)     NULL,
  code_hash  CHAR(64)     NOT NULL,
  attempts   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME     NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_claims_tag (tag_id),
  KEY idx_claims_expires (expires_at),
  CONSTRAINT fk_claims_tag FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Codigos de un solo uso para que el dueno entre a editar sus datos.
CREATE TABLE IF NOT EXISTS otp_codes (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email       VARCHAR(190) NOT NULL,
  code_hash   CHAR(64)     NOT NULL,
  attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at  DATETIME     NOT NULL,
  consumed_at DATETIME         NULL,
  ip          VARCHAR(45)      NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_otp_email (email, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scans (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  pet_id            INT UNSIGNED NOT NULL,
  scanned_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip                VARCHAR(45)      NULL,
  user_agent        VARCHAR(255)     NULL,
  lat               DECIMAL(10, 7)   NULL,
  lng               DECIMAL(10, 7)   NULL,
  accuracy_m        INT UNSIGNED     NULL,
  location_at       DATETIME         NULL,
  address_revealed  TINYINT(1) NOT NULL DEFAULT 0,
  notified_scan     TINYINT(1) NOT NULL DEFAULT 0,
  notified_location TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_scans_pet_date (pet_id, scanned_at),
  CONSTRAINT fk_scans_pet FOREIGN KEY (pet_id) REFERENCES pets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
