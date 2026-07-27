-- ============================================================
-- Migration: v3.0 → v3.1 (Security Hardening)
--
-- Run this on existing databases to add security features
-- without losing existing data.
-- ============================================================

USE `asl_racer`;

-- 1. Add account lockout columns (safe for existing data)
ALTER TABLE `users`
    ADD COLUMN IF NOT EXISTS `failed_logins` TINYINT UNSIGNED NOT NULL DEFAULT 0
        COMMENT 'Consecutive failed login count'
        AFTER `best_wpm`,
    ADD COLUMN IF NOT EXISTS `locked_until` DATETIME DEFAULT NULL
        COMMENT 'Account locked until this time'
        AFTER `failed_logins`,
    ADD COLUMN IF NOT EXISTS `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        AFTER `created_at`;

-- 2. Add index for lockout queries
ALTER TABLE `users`
    ADD INDEX IF NOT EXISTS `idx_locked_until` (`locked_until`);

-- 3. Clear old plain-text tokens (will be replaced by JWTs)
-- The old `token` column is kept for rollback compatibility but cleared.
UPDATE `users` SET `token` = NULL, `token_expires` = NULL;

-- 4. Create token blacklist table
CREATE TABLE IF NOT EXISTS `token_blacklist` (
    `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `jti`           VARCHAR(64)     NOT NULL COMMENT 'JWT ID (jti claim)',
    `user_id`       INT UNSIGNED    NOT NULL,
    `token_type`    ENUM('access','refresh') NOT NULL DEFAULT 'access',
    `expires_at`    DATETIME        NOT NULL COMMENT 'When this blacklist entry can be purged',
    `created_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_jti` (`jti`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_expires_at` (`expires_at`),
    CONSTRAINT `fk_blacklist_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Create refresh token families table
CREATE TABLE IF NOT EXISTS `refresh_token_families` (
    `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `family_id`     VARCHAR(64)     NOT NULL COMMENT 'Token family identifier',
    `user_id`       INT UNSIGNED    NOT NULL,
    `jti`           VARCHAR(64)     NOT NULL COMMENT 'Current valid refresh token JTI',
    `expires_at`    DATETIME        NOT NULL,
    `created_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_family_id` (`family_id`),
    UNIQUE KEY `uk_jti` (`jti`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_expires_at` (`expires_at`),
    CONSTRAINT `fk_refresh_family_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Create purge event (requires EVENT scheduler)
DROP EVENT IF EXISTS `purge_expired_blacklist`;
CREATE EVENT `purge_expired_blacklist`
ON SCHEDULE EVERY 1 HOUR
DO
BEGIN
    DELETE FROM `token_blacklist` WHERE `expires_at` < NOW();
    DELETE FROM `refresh_token_families` WHERE `expires_at` < NOW();
END;

-- Enable the event scheduler if not already enabled
SET GLOBAL event_scheduler = ON;
