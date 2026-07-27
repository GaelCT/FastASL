<?php

/**
 * Database Connection Manager
 * Singleton pattern with PDO prepared statements
 */

require_once __DIR__ . '/../config/Config.php';

class Database {
    private static ?PDO $pdo = null;

    public static function getConnection(): PDO {
        if (self::$pdo === null) {
            Config::load();
            
            $host = Config::get('DB_HOST', 'localhost');
            $dbname = Config::get('DB_NAME', 'asl_racer');
            $user = Config::get('DB_USER', 'root');
            $pass = Config::get('DB_PASS', '');
            $charset = Config::get('DB_CHARSET', 'utf8mb4');

            $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', $host, $dbname, $charset);
            
            self::$pdo = new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::ATTR_TIMEOUT           => 30,
            ]);
        }
        return self::$pdo;
    }

    public static function beginTransaction(): bool {
        return self::getConnection()->beginTransaction();
    }

    public static function commit(): bool {
        return self::getConnection()->commit();
    }

    public static function rollback(): bool {
        return self::getConnection()->rollBack();
    }

    public static function inTransaction(): bool {
        return self::getConnection()->inTransaction();
    }
}
