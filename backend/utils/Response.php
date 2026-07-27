<?php

/**
 * Response Helper
 *
 * Standardized JSON responses with security-focused defaults:
 * - JSON_HEX_TAG: Escapes < and > to prevent HTML injection in JSON consumers
 * - JSON_HEX_AMP: Escapes & to prevent entity injection
 * - JSON_HEX_APOS: Escapes ' to prevent attribute injection
 * - JSON_HEX_QUOT: Escapes " to prevent attribute injection
 *
 * Note: We intentionally do NOT use JSON_UNESCAPED_UNICODE because it can allow
 * Unicode-based XSS vectors through JSON consumers that render HTML.
 */

class Response {
    /**
     * JSON encoding flags — escape special HTML chars to prevent XSS in JSON consumers
     */
    private const JSON_FLAGS = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT;

    /**
     * Send a JSON response and terminate
     */
    public static function json(array $data, int $code = 200): never {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, self::JSON_FLAGS);
        exit;
    }

    /**
     * Send a success response: {"success": true, ...$data}
     */
    public static function success(array $data = [], int $code = 200): never {
        self::json(['success' => true, ...$data], $code);
    }

    /**
     * Send an error response: {"success": false, "error": $message}
     */
    public static function error(string $message, int $code = 400): never {
        self::json(['success' => false, 'error' => $message], $code);
    }

    /**
     * Send a validation error with field name: {"success": false, "error": $message, "field": $field}
     */
    public static function validationError(string $field, string $message): never {
        self::json(['success' => false, 'error' => $message, 'field' => $field], 400);
    }
}
