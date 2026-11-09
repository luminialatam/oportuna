USE oportuna;

-- Additive identity and onboarding fields; existing accounts and companies remain valid.
ALTER TABLE app_users
  ADD COLUMN first_name VARCHAR(100) NOT NULL DEFAULT '' AFTER email_normalized,
  ADD COLUMN last_name VARCHAR(100) NOT NULL DEFAULT '' AFTER first_name;

ALTER TABLE companies
  ADD COLUMN rut_normalized VARCHAR(12) NULL AFTER nombre_comercial,
  ADD COLUMN representation_status ENUM('unverified','pending','verified') NOT NULL DEFAULT 'unverified' AFTER rut_normalized,
  ADD UNIQUE KEY uq_companies_rut_normalized (rut_normalized);

ALTER TABLE commercial_profiles
  ADD COLUMN email_contact VARCHAR(320) NULL AFTER rut,
  ADD COLUMN phone VARCHAR(40) NULL AFTER email_contact,
  ADD COLUMN address VARCHAR(255) NULL AFTER phone,
  ADD COLUMN commune VARCHAR(120) NULL AFTER address,
  ADD COLUMN primary_region VARCHAR(120) NULL AFTER commune,
  ADD COLUMN business_description TEXT NULL AFTER actividad;

ALTER TABLE company_memberships
  MODIFY COLUMN role ENUM('admin','collaborator','read_only') NOT NULL DEFAULT 'collaborator';

ALTER TABLE company_invitations
  MODIFY COLUMN role ENUM('admin','collaborator','read_only') NOT NULL DEFAULT 'collaborator';

CREATE TABLE IF NOT EXISTS company_access_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  requested_role ENUM('collaborator','read_only') NOT NULL DEFAULT 'read_only',
  message VARCHAR(1000) NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_company_access_request (company_id,user_id),
  KEY idx_access_request_status (company_id,status,created_at),
  CONSTRAINT fk_access_request_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_access_request_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_access_request_reviewer FOREIGN KEY (reviewed_by) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
