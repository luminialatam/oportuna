USE oportuna;

CREATE TABLE IF NOT EXISTS company_user_opportunity_states (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  codigo_externo VARCHAR(100) NOT NULL,
  first_recommended_at DATETIME NULL,
  read_at DATETIME NULL,
  dismissed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_company_user_listing_state (company_id,user_id,codigo_externo),
  KEY idx_company_recommendation_week (company_id,first_recommended_at,codigo_externo),
  KEY idx_user_unread_opportunities (company_id,user_id,read_at,dismissed_at),
  KEY idx_user_discarded_opportunities (company_id,user_id,dismissed_at),
  CONSTRAINT fk_user_opportunity_state_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_opportunity_state_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_opportunity_state_listing FOREIGN KEY (codigo_externo) REFERENCES licitaciones(codigo_externo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
