<?php

/**
 * Configuration Manager
 * Loads environment variables from .env file
 */

class Config {
    private static array $config = [];
    private static bool $loaded = false;

    public static function load(): void {
        if (self::$loaded) return;

        $envFile = dirname(__DIR__, 2) . '/.env';
        if (!file_exists($envFile)) {
            throw new RuntimeException('.env file not found. Please copy .env.example to .env and configure it.');
        }

        $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            if (str_starts_with($line, '#')) continue;
            
            $parts = explode('=', $line, 2);
            if (count($parts) === 2) {
                $key = trim($parts[0]);
                $value = trim($parts[1]);
                self::$config[$key] = $value;
            }
        }

        self::$loaded = true;
    }

    public static function get(string $key, mixed $default = null): mixed {
        if (!self::$loaded) self::load();
        return self::$config[$key] ?? $default;
    }

    public static function getInt(string $key, int $default = 0): int {
        return (int) self::get($key, $default);
    }

    public static function getArray(string $key, string $separator = ','): array {
        $value = self::get($key, '');
        return $value ? array_map('trim', explode($separator, $value)) : [];
    }
}
