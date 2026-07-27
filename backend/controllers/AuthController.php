<?php

/**
 * Authentication Controller
 *
 * Handles auth-related HTTP requests with JWT token-based auth.
 */

require_once __DIR__ . '/../services/AuthService.php';
require_once __DIR__ . '/../middleware/RateLimitMiddleware.php';
require_once __DIR__ . '/../middleware/SecurityMiddleware.php';
require_once __DIR__ . '/../utils/Response.php';

/**
 * Require authentication and return the validated user array.
 * Helper used by protected endpoints.
 */
function require_auth(): array {
    require_once __DIR__ . '/../middleware/AuthMiddleware.php';
    return AuthMiddleware::requireAuth();
}

class AuthController {
    /**
     * POST /register — Create a new user account
     */
    public static function register(): never {
        SecurityMiddleware::requireJson();
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $username = $body['username'] ?? '';
        $name = $body['name'] ?? '';
        $password = $body['password'] ?? '';
        $scope = $body['scope'] ?? 'global';

        // Rate limit registration attempts
        RateLimitMiddleware::check(RateLimitMiddleware::getClientIdentifier(), 'register');

        try {
            $user = AuthService::register($username, $name, $password, $scope);
            Response::success(['user' => $user], 201);
        } catch (InvalidArgumentException $e) {
            Response::error($e->getMessage(), 400);
        } catch (RuntimeException $e) {
            Response::error($e->getMessage(), 409);
        }
    }

    /**
     * POST /login — Authenticate and return JWT access + refresh tokens
     */
    public static function login(): never {
        SecurityMiddleware::requireJson();
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $username = $body['username'] ?? '';
        $password = $body['password'] ?? '';

        // Rate limit login attempts (IP-based)
        RateLimitMiddleware::check(RateLimitMiddleware::getClientIdentifier(), 'login');

        try {
            $result = AuthService::login($username, $password);
            Response::success(['user' => $result]);
        } catch (InvalidArgumentException $e) {
            Response::error($e->getMessage(), 400);
        } catch (RuntimeException $e) {
            // Always return 401 for auth failures — prevents username enumeration
            $msg = $e->getMessage();
            $code = str_contains($msg, 'Too many attempts') ? 429 : 401;
            Response::error($msg, $code);
        }
    }

    /**
     * POST /logout — Blacklist current access token, invalidate refresh family
     */
    public static function logout(): never {
        $user = require_auth();

        try {
            AuthService::logout($user['id'], $user['jti'], $user['family'] ?? null);
            Response::success(['message' => 'Logged out successfully.']);
        } catch (RuntimeException $e) {
            Response::error($e->getMessage(), 500);
        }
    }

    /**
     * POST /refresh — Exchange a valid refresh token for new access + refresh tokens
     *
     * Uses Authorization: Bearer <refresh_token>
     * Implements refresh token rotation with theft detection.
     */
    public static function refreshToken(): never {
        require_once __DIR__ . '/../middleware/AuthMiddleware.php';
        $tokenData = AuthMiddleware::authenticateRefresh();

        try {
            $result = AuthService::refreshToken(
                $tokenData['id'],
                $tokenData['jti'],
                $tokenData['family']
            );
            Response::success($result);
        } catch (RuntimeException $e) {
            $msg = $e->getMessage();
            $code = str_contains($msg, 'Security alert') ? 401 : 500;
            Response::error($msg, $code);
        }
    }
}
