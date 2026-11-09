USE oportuna;

CREATE TABLE IF NOT EXISTS app_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email_normalized VARCHAR(320) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  platform_role ENUM('user','admin') NOT NULL DEFAULT 'user',
  status ENUM('active','suspended') NOT NULL DEFAULT 'active',
  email_verified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_app_user_email (email_normalized)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS company_memberships (
  user_id BIGINT UNSIGNED NOT NULL,
  company_id BIGINT UNSIGNED NOT NULL,
  role ENUM('admin','collaborator') NOT NULL DEFAULT 'collaborator',
  status ENUM('invited','active','suspended') NOT NULL DEFAULT 'invited',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id,company_id),
  UNIQUE KEY uq_membership_company_user (company_id,user_id),
  KEY idx_membership_company_status (company_id,status,role),
  CONSTRAINT fk_membership_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_membership_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS app_sessions (
  id BINARY(16) NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  active_company_id BIGINT UNSIGNED NULL,
  token_hash BINARY(32) NOT NULL,
  csrf_hash BINARY(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  UNIQUE KEY uq_app_session_token (token_hash),
  KEY idx_app_session_user_expiry (user_id,revoked_at,expires_at),
  KEY idx_app_session_company (active_company_id),
  CONSTRAINT fk_app_session_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_app_session_membership FOREIGN KEY (user_id,active_company_id)
    REFERENCES company_memberships(user_id,company_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash BINARY(32) NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  KEY idx_password_reset_user_expiry (user_id,expires_at,used_at),
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS company_invitations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  invited_email VARCHAR(320) NOT NULL,
  role ENUM('admin','collaborator') NOT NULL DEFAULT 'collaborator',
  token_hash BINARY(32) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  accepted_at DATETIME NULL,
  UNIQUE KEY uq_company_invitation_token (token_hash),
  KEY idx_company_invitation_email (company_id,invited_email,accepted_at,expires_at),
  CONSTRAINT fk_company_invitation_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_company_invitation_creator FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS legacy_company_claims (
  singleton_id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL UNIQUE,
  claimed_by BIGINT UNSIGNED NOT NULL,
  claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_legacy_claim_singleton CHECK (singleton_id=1),
  CONSTRAINT fk_legacy_claim_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_legacy_claim_user FOREIGN KEY (claimed_by) REFERENCES app_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
