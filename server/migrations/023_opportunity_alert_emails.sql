USE oportuna;

-- Email notifications are opt-in per company member. The recipient is always
-- resolved from that member's verified account email at delivery time.
CREATE TABLE IF NOT EXISTS company_alert_email_preferences (
  company_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id,user_id),
  KEY idx_alert_email_enabled(company_id,enabled),
  CONSTRAINT fk_alert_email_membership FOREIGN KEY (user_id,company_id)
    REFERENCES company_memberships(user_id,company_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One digest per user and proactive-search pass avoids one message per tender
-- and makes retries idempotent.
CREATE TABLE IF NOT EXISTS company_alert_email_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  batch_key CHAR(36) NOT NULL,
  listings JSON NOT NULL,
  status ENUM('queued','sending','sent','failed') NOT NULL DEFAULT 'queued',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error_code VARCHAR(40) NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_alert_email_batch(company_id,user_id,batch_key),
  KEY idx_alert_email_outbox(status,next_attempt_at,id),
  CONSTRAINT fk_alert_email_outbox_membership FOREIGN KEY (user_id,company_id)
    REFERENCES company_memberships(user_id,company_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
