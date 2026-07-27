<?php

/**
 * User Controller
 *
 * Handles user-related HTTP requests with rate limiting and input validation.
 */

require_once __DIR__ . '/../services/UserService.php';
require_once __DIR__ . '/../middleware/RateLimitMiddleware.php';
require_once __DIR__ . '/../middleware/SecurityMiddleware.php';
require_once __DIR__ . '/../utils/Response.php';

class UserController {
    /**
     * GET /check?username=xxx — Check if a username is available
     *
     * Rate limited to prevent username enumeration attacks.
     */
    public static function checkUsername(): never {
        // Rate limit — prevent automated username enumeration
        RateLimitMiddleware::check(
            RateLimitMiddleware::getClientIdentifier(),
            'check_username',
            30,  // max 30 attempts
            10   // per 10 minutes
        );

        $username = $_GET['username'] ?? '';

        try {
            $available = UserService::checkUsernameAvailability($username);
            Response::success(['available' => $available, 'username' => $username]);
        } catch (InvalidArgumentException $e) {
            Response::error($e->getMessage(), 400);
        } catch (RuntimeException $e) {
            Response::error($e->getMessage(), 500);
        }
    }

    /**
     * POST /score — Submit a race score (requires auth)
     */
    public static function submitScore(): never {
        SecurityMiddleware::requireJson();
        $user = require_auth();

        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $wpm = (int) ($body['wpm'] ?? 0);

        try {
            UserService::updateScore($user['id'], $wpm);
            Response::success(['message' => 'Score submitted.']);
        } catch (InvalidArgumentException $e) {
            Response::error($e->getMessage(), 400);
        } catch (RuntimeException $e) {
            Response::error($e->getMessage(), 500);
        }
    }
}
