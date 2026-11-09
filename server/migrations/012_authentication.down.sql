USE oportuna;

-- Rollback exclusivo de las tablas creadas por 012_authentication.sql.
-- Ejecutar solo si se decide retirar esta fase; elimina cuentas y sesiones de autenticación.
DROP TABLE IF EXISTS legacy_company_claims;
DROP TABLE IF EXISTS company_invitations;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS app_sessions;
DROP TABLE IF EXISTS company_memberships;
DROP TABLE IF EXISTS app_users;
