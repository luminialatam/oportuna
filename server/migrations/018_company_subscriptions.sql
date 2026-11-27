USE oportuna;

CREATE TABLE IF NOT EXISTS company_subscriptions (
  company_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  plan ENUM('crece','vuela','brilla') NOT NULL DEFAULT 'crece',
  changed_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_company_subscription_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_company_subscription_admin FOREIGN KEY (changed_by) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO company_subscriptions (company_id,plan)
SELECT id,'crece' FROM companies;

CREATE TABLE IF NOT EXISTS company_plan_analysis_usage (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  codigo_externo VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_plan_analysis_month (company_id,created_at),
  KEY idx_plan_analysis_user (company_id,user_id,created_at),
  CONSTRAINT fk_plan_analysis_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_analysis_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_analysis_listing FOREIGN KEY (codigo_externo) REFERENCES licitaciones(codigo_externo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
