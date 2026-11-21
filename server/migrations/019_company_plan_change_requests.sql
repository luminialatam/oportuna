USE oportuna;

ALTER TABLE company_subscriptions
  ADD COLUMN billing_period ENUM('monthly','annual') NOT NULL DEFAULT 'monthly' AFTER plan;

CREATE TABLE IF NOT EXISTS company_plan_change_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  requested_plan ENUM('crece','vuela','brilla') NOT NULL,
  billing_period ENUM('monthly','annual') NOT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  decision_note VARCHAR(500) NULL,
  KEY idx_company_plan_requests_status (status,requested_at),
  KEY idx_company_plan_requests_company (company_id,requested_at),
  CONSTRAINT fk_plan_request_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_requester FOREIGN KEY (requested_by) REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_plan_request_reviewer FOREIGN KEY (reviewed_by) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
