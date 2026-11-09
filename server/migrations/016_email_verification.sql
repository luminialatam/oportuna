USE oportuna;

-- Preserve existing accounts and their legitimate sessions; only accounts
-- created after this migration start in the unverified state.
UPDATE app_users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  invitation_id BIGINT UNSIGNED NULL,
  token_hash BINARY(32) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_verification_token_hash (token_hash),
  KEY ix_email_verification_user (user_id, used_at, expires_at),
  CONSTRAINT fk_email_verification_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_email_verification_invitation FOREIGN KEY (invitation_id) REFERENCES company_invitations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
