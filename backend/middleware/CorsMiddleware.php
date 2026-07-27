<?php

/**
 * CORS Middleware
 *
 * Restricts Cross-Origin Resource Sharing to explicitly configured origins.
 * - When CORS_ALLOWED_ORIGINS is set, only those origins are allowed
 * - Never allows wildcard (*) with credentials (violates CORS spec)
 * - Validates origin format to prevent header injection
 */

require_once __DIR__ . '/../config/Config.php';

class CorsMiddleware {
    public static function handle(): void {
        Config::load();

        $allowedOrigins = Config::getArray('CORS_ALLOWED_ORIGINS');
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

        // If no origin header, this is a same-origin request — allow it
        if ($origin === '') {
            // Same-origin: no Access-Control-Allow-Origin needed
            if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
                http_response_code(204);
                exit;
            }
            return;
        }

        // Validate the origin is a proper URL to prevent header injection
        if (!self::isValidOrigin($origin)) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Invalid origin.'], JSON_HEX_TAG);
            exit;
        }

        // Check if origin is allowed
        $allowed = false;
        if (empty($allowedOrigins)) {
            // No origins configured — in development, allow localhost
            // In production, set CORS_ALLOWED_ORIGINS explicitly in .env
            if (preg_match('/^https?:\/\/localhost(:\d+)?$/', $origin)) {
                $allowed = true;
            }
        } else {
            $allowed = in_array($origin, $allowedOrigins, true);
        }

        if ($allowed) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Access-Control-Allow-Credentials: true');
        }
        // If not allowed, we don't set CORS headers — browser will block the response

        header('Access-Control-Allow-Methods: GET, POST, OPTIONS, DELETE');
        header('Access-Control-Allow-Headers: Content-Type, Authorization');
        header('Access-Control-Max-Age: 86400');

        // Handle preflight
        if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
            http_response_code(204);
            exit;
        }
    }

    /**
     * Validate that an origin string is a valid HTTP(S) origin.
     * Prevents header injection via malformed origins.
     */
    private static function isValidOrigin(string $origin): bool {
        // Must start with http:// or https://
        if (!preg_match('#^https?://#', $origin)) {
            return false;
        }

        // Parse the origin
        $parts = parse_url($origin);
        if (!$parts || empty($parts['host'])) {
            return false;
        }

        // Must not contain newlines, carriage returns, or null bytes
        if (preg_match('/[\r\n\0]/', $origin)) {
            return false;
        }

        return true;
    }
}
