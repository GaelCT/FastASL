<?php

/**
 * Security Middleware
 *
 * Adds HTTP security headers and performs request validation.
 * Configurable via .env for production hardening.
 */

require_once __DIR__ . '/../config/Config.php';

class SecurityMiddleware {
    /**
     * Apply all security headers and validations
     */
    public static function handle(): void {
        Config::load();

        // === Security Headers ===

        // Prevent MIME type sniffing
        header('X-Content-Type-Options: nosniff');

        // Prevent clickjacking
        header('X-Frame-Options: DENY');

        // Enable browser XSS filter
        header('X-XSS-Protection: 1; mode=block');

        // Referrer policy — only send origin for same-origin, none for cross-origin downgrades
        header('Referrer-Policy: strict-origin-when-cross-origin');

        // Disable potentially dangerous browser features
        header('Permissions-Policy: geolocation=(), microphone=(), camera=(), usb=(), payment=()');

        // Content Security Policy (default: restrict to self, no inline scripts)
        // Override via .env: CSP_DEFAULT_SRC
        $cspDefault = Config::get('CSP_DEFAULT_SRC', "'self'");
        header("Content-Security-Policy: default-src {$cspDefault}; "
            . "script-src 'self'; "
            . "style-src 'self' 'unsafe-inline'; "
            . "img-src 'self' data:; "
            . "font-src 'self'; "
            . "connect-src 'self'; "
            . "frame-ancestors 'none'; "
            . "base-uri 'self'; "
            . "form-action 'self';");

        // HTTP Strict Transport Security (enable in production when behind HTTPS)
        $hstsEnabled = Config::get('HSTS_ENABLED', 'false');
        if ($hstsEnabled === 'true') {
            $hstsMaxAge = Config::getInt('HSTS_MAX_AGE', 31536000);
            header("Strict-Transport-Security: max-age={$hstsMaxAge}; includeSubDomains");
        }

        // === Request Validation ===

        // Request size limit (prevent DoS via oversized payloads)
        $maxSize = Config::getInt('MAX_REQUEST_SIZE', 1048576); // 1MB default
        $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($contentLength > $maxSize) {
            http_response_code(413);
            echo json_encode(['success' => false, 'error' => 'Request entity too large.'], JSON_HEX_TAG);
            exit;
        }

        // Block requests with unexpected HTTP methods
        $allowedMethods = ['GET', 'POST', 'OPTIONS', 'DELETE', 'HEAD'];
        $requestMethod = $_SERVER['REQUEST_METHOD'] ?? '';
        if (!in_array($requestMethod, $allowedMethods, true)) {
            http_response_code(405);
            echo json_encode(['success' => false, 'error' => 'Method not allowed.'], JSON_HEX_TAG);
            exit;
        }
    }

    /**
     * Require Content-Type: application/json for POST endpoints
     */
    public static function requireJson(): void {
        $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
        // Strip charset suffix for comparison
        $contentType = strtolower(trim(explode(';', $contentType)[0]));

        if ($contentType !== 'application/json') {
            http_response_code(415);
            echo json_encode([
                'success' => false,
                'error' => 'Content-Type must be application/json.'
            ], JSON_HEX_TAG);
            exit;
        }
    }
}
