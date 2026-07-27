-- ============================================================
-- ASL Racer — Database Schema (v3.1 Security Hardened)
-- ============================================================

CREATE DATABASE IF NOT EXISTS `asl_racer`
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE `asl_racer`;

-- Users table
CREATE TABLE IF NOT EXISTS `users` (
    `id`                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    `username`          VARCHAR(8)    NOT NULL COMMENT '3-8 chars, alphanumeric + underscore',
    `name`              VARCHAR(64)   NOT NULL COMMENT 'Display name (1-64 chars, no HTML/special chars)',
    `password_hash`     VARCHAR(255)  NOT NULL COMMENT 'bcrypt hash',
    `scope`             VARCHAR(10)   NOT NULL DEFAULT 'global' COMMENT 'Leaderboard scope: global/local/friends',
    `best_wpm`          INT UNSIGNED  NOT NULL DEFAULT 0,
    `failed_logins`     TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Consecutive failed login count',
    `locked_until`      DATETIME      DEFAULT NULL COMMENT 'Account locked until this time',
    `created_at`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_username` (`username`),
    KEY `idx_scope_wpm` (`scope`, `best_wpm`),
    KEY `idx_locked_until` (`locked_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Token blacklist table (for revoked/expired tokens)
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

-- Active refresh token families (for refresh token rotation / reuse detection)
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

-- Scheduled event to purge expired blacklist entries
DELIMITER //
CREATE EVENT IF NOT EXISTS `purge_expired_blacklist`
ON SCHEDULE EVERY 1 HOUR
DO
BEGIN
    DELETE FROM `token_blacklist` WHERE `expires_at` < NOW();
    DELETE FROM `refresh_token_families` WHERE `expires_at` < NOW();
END//
DELIMITER ;
