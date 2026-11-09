USE oportuna;

CREATE TABLE IF NOT EXISTS company_alerts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  alert_type ENUM('closing_72h','closing_48h','closing_24h','closing_overdue','followup_upcoming','followup_today','followup_overdue') NOT NULL,
  alert_key VARCHAR(190) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  due_at DATETIME NOT NULL,
  read_at DATETIME NULL,
  dismissed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_company_alert_key (company_id,alert_key),
  KEY idx_company_alert_unread (company_id,dismissed_at,read_at,created_at),
  KEY idx_company_alert_opportunity (company_id,opportunity_id,dismissed_at),
  CONSTRAINT fk_company_alert_company FOREIGN KEY (company_id)
    REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_company_alert_opportunity FOREIGN KEY (opportunity_id,company_id)
    REFERENCES company_opportunity_tracking (id,company_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
