USE oportuna;

CREATE TABLE IF NOT EXISTS company_offer_drafts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  codigo_externo VARCHAR(100) NOT NULL,
  draft_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_company_offer_draft_owner (company_id,user_id,codigo_externo),
  KEY idx_company_offer_draft_listing (codigo_externo,updated_at),
  CONSTRAINT fk_company_offer_draft_company FOREIGN KEY (company_id)
    REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_company_offer_draft_user FOREIGN KEY (user_id)
    REFERENCES app_users (id) ON DELETE CASCADE,
  CONSTRAINT fk_company_offer_draft_listing FOREIGN KEY (codigo_externo)
    REFERENCES licitaciones (codigo_externo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
