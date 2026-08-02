<?php

/**
 * ASL Racer — Backend API v3.1
 * Front controller — the only PHP file exposed publicly.
 */

header('Content-Type: application/json; charset=utf-8');

// ==================== MIDDLEWARE ====================
require_once __DIR__ . '/../backend/middleware/CorsMiddleware.php';
require_once __DIR__ . '/../backend/middleware/SecurityMiddleware.php';

CorsMiddleware::handle();
SecurityMiddleware::handle();

// ==================== DEPENDENCIES ====================
require_once __DIR__ . '/../backend/controllers/AuthController.php';
require_once __DIR__ . '/../backend/controllers/UserController.php';
require_once __DIR__ . '/../backend/controllers/LeaderboardController.php';
require_once __DIR__ . '/../backend/utils/Validator.php';
require_once __DIR__ . '/../backend/utils/Response.php';

// ==================== ROUTING ====================
$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

// Strip exactly one leading /api prefix (anchored, no unrestricted str_replace)
if (str_starts_with($path, '/api')) {
    $path = substr($path, 4);
}
$path = rtrim($path, '/') ?: '/';

// ==================== PUBLIC ENDPOINTS ====================

// GET / — Health check
if ($method === 'GET' && $path === '/') {
    Response::success([
        'message' => 'ASL Racer API',
        'version' => '3.1.0',
        'timestamp' => date('c'),
    ]);
}

// POST /validate — Validate username format (no DB, just format check)
if ($method === 'POST' && $path === '/validate') {
    SecurityMiddleware::requireJson();
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $username = Validator::clean($body['username'] ?? '');

    if ($error = Validator::validateUsername($username)) {
        Response::error($error);
    }

    // Also run the dangerous chars check
    if ($error = Validator::containsDangerousChars($username)) {
        Response::error($error);
    }

    Response::success(['valid' => true, 'username' => $username]);
}

// POST /register — Create user account
if ($method === 'POST' && $path === '/register') {
    AuthController::register();
}

// POST /login — Authenticate and get JWT tokens
if ($method === 'POST' && $path === '/login') {
    AuthController::login();
}

// GET /check?username=xxx — Check username availability (rate-limited)
if ($method === 'GET' && $path === '/check') {
    UserController::checkUsername();
}

// GET /leaderboard?scope=global&page=1&limit=10 — Public leaderboard
if ($method === 'GET' && $path === '/leaderboard') {
    LeaderboardController::getLeaderboard();
}

// ==================== PROTECTED ENDPOINTS ====================

// POST /logout — Invalidate tokens (requires valid access token)
if ($method === 'POST' && $path === '/logout') {
    AuthController::logout();
}

// POST /refresh — Exchange refresh token for new access + refresh tokens
if ($method === 'POST' && $path === '/refresh') {
    AuthController::refreshToken();
}

// POST /score — Submit race score (requires valid access token)
if ($method === 'POST' && $path === '/score') {
    UserController::submitScore();
}

// ==================== 404 ====================
Response::error('Not found.', 404);
