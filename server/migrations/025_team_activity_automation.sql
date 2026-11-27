-- Run against the already selected Oportuna application schema. No schema switch or data changes are performed.
-- Team ownership and participants are scoped to one company and one local listing.
CREATE TABLE IF NOT EXISTS company_opportunity_teams (
  company_id BIGINT UNSIGNED NOT NULL,
  codigo_externo VARCHAR(100) NOT NULL,
  assigned_user_id BIGINT UNSIGNED NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id,codigo_externo),
  KEY idx_opportunity_team_assignee (company_id,assigned_user_id),
  CONSTRAINT fk_opportunity_team_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_opportunity_team_listing FOREIGN KEY (codigo_externo) REFERENCES licitaciones(codigo_externo) ON DELETE CASCADE,
  CONSTRAINT fk_opportunity_team_assignee FOREIGN KEY (assigned_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_opportunity_team_updater FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS company_opportunity_team_members (
  company_id BIGINT UNSIGNED NOT NULL,
  codigo_externo VARCHAR(100) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  added_by_user_id BIGINT UNSIGNED NULL,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id,codigo_externo,user_id),
  CONSTRAINT fk_opportunity_team_member_team FOREIGN KEY (company_id,codigo_externo) REFERENCES company_opportunity_teams(company_id,codigo_externo) ON DELETE CASCADE,
  CONSTRAINT fk_opportunity_team_member_membership FOREIGN KEY (user_id,company_id) REFERENCES company_memberships(user_id,company_id) ON DELETE CASCADE,
  CONSTRAINT fk_opportunity_team_member_actor FOREIGN KEY (added_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS company_activity_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  codigo_externo VARCHAR(100) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(40) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_company_activity_listing (company_id,codigo_externo,created_at,id),
  CONSTRAINT fk_company_activity_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_company_activity_listing FOREIGN KEY (codigo_externo) REFERENCES licitaciones(codigo_externo) ON DELETE CASCADE,
  CONSTRAINT fk_company_activity_actor FOREIGN KEY (actor_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Shared collaborative view of an offer; legacy per-user drafts remain intact and are imported lazily.
CREATE TABLE IF NOT EXISTS company_offer_workspaces (
  company_id BIGINT UNSIGNED NOT NULL,
  codigo_externo VARCHAR(100) NOT NULL,
  draft_json JSON NOT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (company_id,codigo_externo),
  KEY idx_offer_workspace_listing (codigo_externo,updated_at),
  CONSTRAINT fk_offer_workspace_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_offer_workspace_listing FOREIGN KEY (codigo_externo) REFERENCES licitaciones(codigo_externo) ON DELETE CASCADE,
  CONSTRAINT fk_offer_workspace_creator FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_offer_workspace_updater FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS company_automation_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  trigger_type ENUM('new_match','closing_soon') NOT NULL,
  conditions_json JSON NOT NULL,
  actions_json JSON NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  last_run_at DATETIME NULL,
  last_error VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_company_automation_due (enabled,company_id,last_run_at),
  CONSTRAINT fk_company_automation_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_company_automation_creator FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS company_automation_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  rule_id BIGINT UNSIGNED NOT NULL,
  event_key VARCHAR(220) NOT NULL,
  event_code VARCHAR(100) NOT NULL,
  status ENUM('running','completed','failed') NOT NULL,
  error_summary VARCHAR(500) NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  UNIQUE KEY uq_company_automation_event (company_id,rule_id,event_key),
  KEY idx_company_automation_runs (company_id,rule_id,started_at),
  CONSTRAINT fk_company_automation_run_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_company_automation_run_rule FOREIGN KEY (rule_id) REFERENCES company_automation_rules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS company_automation_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  rule_id BIGINT UNSIGNED NOT NULL,
  listing_code VARCHAR(100) NOT NULL,
  event_key VARCHAR(220) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  read_at DATETIME NULL,
  dismissed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_company_automation_notification_event (company_id,rule_id,event_key),
  KEY idx_company_automation_notification (company_id,dismissed_at,read_at,created_at),
  CONSTRAINT fk_company_automation_notification_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_company_automation_notification_rule FOREIGN KEY (rule_id) REFERENCES company_automation_rules(id) ON DELETE CASCADE,
  CONSTRAINT fk_company_automation_notification_listing FOREIGN KEY (listing_code) REFERENCES licitaciones(codigo_externo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
