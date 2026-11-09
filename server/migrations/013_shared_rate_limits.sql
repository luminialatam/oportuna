-- Apply only through the reviewed deployment migration procedure.
-- Shared fixed-window counters for API instances; expired rows are safe to prune.
CREATE TABLE IF NOT EXISTS app_rate_limits (
  key_hash CHAR(64) NOT NULL,
  window_start_ms BIGINT NOT NULL,
  hit_count INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (key_hash, window_start_ms),
  KEY idx_app_rate_limits_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
