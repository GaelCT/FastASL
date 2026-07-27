<?php

/**
 * Authentication Middleware
 *
 * Validates JWT access tokens on protected routes.
 * Returns decoded token payload with user data and token metadata.
 *
 * Security features:
 * - JWT signature verification (HS256)
 * - Expiration and nbf validation
 * - Token blacklist check (for logged-out tokens)
 * - Algorithm whitelist (prevents algorithm confusion)
 * - Strict Bearer header parsing
 */

require_once __DIR__ . '/../utils/Database.php';
require_once __DIR__ . '/../utils/JWT.php';
require_once __DIR__ . '/../utils/Response.php';
require_once __DIR__ . '/../services/AuthService.php';

class AuthMiddleware {
    /**
     * Authenticate the request — returns user array or exits with 401
     *
     * @return array{id: int, username: string, name: string, jti: string, family: string|null}
     */
    public static function authenticate(): array {
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

        // Strict Bearer token extraction — only allow exact "Bearer <token>" format
        if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $matches)) {
            Response::error('Missing or malformed authorization header. Expected: Bearer <token>', 401);
        }

        $token = trim($matches[1]);

        // Reject empty tokens
        if ($token === '') {
            Response::error('Authorization token is empty.', 401);
        }

        // Verify JWT signature and claims
        $payload = JWT::decode($token);
        if ($payload === null) {
            Response::error('Invalid or expired token.', 401);
        }

        // Validate token type
        if (($payload['type'] ?? '') !== 'access') {
            Response::error('Invalid token type. Use an access token.', 401);
        }

        // Check blacklist (logout invalidation)
        $jti = $payload['jti'] ?? '';
        if ($jti !== '' && AuthService::isTokenBlacklisted($jti)) {
            Response::error('Token has been revoked.', 401);
        }

        // Validate required claims
        if (empty($payload['sub'])) {
            Response::error('Invalid token: missing subject.', 401);
        }

        return [
            'id'       => (int) $payload['sub'],
            'username' => $payload['username'] ?? '',
            'jti'      => $jti,
            'family'   => $payload['family'] ?? null,
        ];
    }

    /**
     * Authenticate and require a valid token — alias for authenticate()
     */
    public static function requireAuth(): array {
        return self::authenticate();
    }

    /**
     * Authenticate with a refresh token (for /refresh endpoint)
     *
     * @return array{id: int, username: string, jti: string, family: string}
     */
    public static function authenticateRefresh(): array {
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

        if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $matches)) {
            Response::error('Missing or malformed authorization header. Expected: Bearer <refresh_token>', 401);
        }

        $token = trim($matches[1]);

        if ($token === '') {
            Response::error('Authorization token is empty.', 401);
        }

        // Verify as refresh token (uses refresh secret)
        $payload = JWT::decode($token, true);
        if ($payload === null) {
            Response::error('Invalid or expired refresh token.', 401);
        }

        // Validate token type
        if (($payload['type'] ?? '') !== 'refresh') {
            Response::error('Invalid token type. Use a refresh token.', 401);
        }

        // Check blacklist
        $jti = $payload['jti'] ?? '';
        if ($jti !== '' && AuthService::isTokenBlacklisted($jti)) {
            Response::error('Refresh token has been revoked.', 401);
        }

        if (empty($payload['sub']) || empty($payload['family'])) {
            Response::error('Invalid refresh token: missing required claims.', 401);
        }

        return [
            'id'       => (int) $payload['sub'],
            'username' => $payload['username'] ?? '',
            'jti'      => $jti,
            'family'   => $payload['family'],
        ];
    }
}
