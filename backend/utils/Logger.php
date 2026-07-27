<?php

/**
 * Logger
 *
 * Structured error logging with log-flood protection.
 * Truncates large data payloads to prevent disk-exhaustion DoS.
 */

class Logger {
    private const LOG_FILE = __DIR__ . '/../../logs/error.log';
    private const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024; // 10MB max log file
    private const MAX_DATA_LENGTH = 2048; // Max serialized data length per entry

    public static function error(string $context, string $message, array $data = []): void {
        self::log('ERROR', $context, $message, $data);
    }

    public static function warning(string $context, string $message, array $data = []): void {
        self::log('WARNING', $context, $message, $data);
    }

    public static function info(string $context, string $message, array $data = []): void {
        self::log('INFO', $context, $message, $data);
    }

    private static function log(string $level, string $context, string $message, array $data): void {
        // Prevent log flooding — if log file is huge, rotate it
        if (file_exists(self::LOG_FILE) && filesize(self::LOG_FILE) > self::MAX_LOG_FILE_SIZE) {
            $rotated = self::LOG_FILE . '.' . date('YmdHis') . '.old';
            rename(self::LOG_FILE, $rotated);
        }

        $logDir = dirname(self::LOG_FILE);
        if (!is_dir($logDir)) {
            if (!mkdir($logDir, 0750, true)) {
                return; // Can't create log dir — silently fail
            }
        }

        // Sanitize context and message — remove newlines to prevent log injection
        $context = str_replace(["\r", "\n"], ' ', $context);
        $message = str_replace(["\r", "\n"], ' ', $message);

        // Truncate message to prevent log flooding via long messages
        if (strlen($message) > 1024) {
            $message = substr($message, 0, 1021) . '...';
        }

        // Serialize data with length limit
        $dataStr = '';
        if ($data) {
            $dataJson = json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP);
            if ($dataJson && strlen($dataJson) > self::MAX_DATA_LENGTH) {
                $dataJson = substr($dataJson, 0, self::MAX_DATA_LENGTH - 3) . '...';
            }
            $dataStr = $dataJson ? ' | Data: ' . $dataJson : '';
        }

        $timestamp = date('Y-m-d H:i:s');
        $logEntry = "[{$timestamp}] [{$level}] [{$context}] {$message}{$dataStr}\n";

        // Use LOCK_EX to prevent corruption from concurrent writes
        file_put_contents(self::LOG_FILE, $logEntry, FILE_APPEND | LOCK_EX);
    }
}
