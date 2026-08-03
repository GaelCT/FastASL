<?php

/**
 * ASL Racer — Development server router
 *
 * Usage: php -S 127.0.0.1:8000 -t public public/router.php
 *
 * The built-in server ignores .htaccess, so this router enforces the same
 * boundary as the Apache/Nginx config:
 *  - Never serves files outside public/ (symlinks are resolved and rejected)
 *  - Never serves dotfiles or hidden files
 *  - Only /api/* paths reach the front controller; everything else is 404
 */

$public = realpath(__DIR__);
if ($public === false) {
    http_response_code(500);
    exit;
}

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if ($path === false || $path === '') {
    $path = '/';
}

// Reject any path segment starting with a dot (dotfiles, .env, .htaccess, ..)
foreach (explode('/', $path) as $segment) {
    if (str_starts_with($segment, '.')) {
        http_response_code(404);
        exit;
    }
}

// Route /api and /api/* to the front controller (exact prefix boundary)
if ($path === '/api' || str_starts_with($path, '/api/')) {
    require __DIR__ . '/index.php';
    return true;
}

/**
 * Send the static-page policy that Apache applies through public/.htaccess.
 * API responses deliberately retain SecurityMiddleware's stricter policy.
 */
function sendStaticPageSecurityHeaders(string $path): void
{
    if ($path === '/race.html') {
        header("Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; connect-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
        header('Permissions-Policy: geolocation=(), microphone=(), camera=(self)');
        return;
    }

    header("Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
}

// Serve existing static files inside public/ only
$candidate = realpath($public . $path);
if ($candidate !== false && str_starts_with($candidate, $public . DIRECTORY_SEPARATOR) && is_file($candidate)) {
    // Defense in depth: reject the sensitive extensions denied by
    // public/.htaccess, and any PHP file other than the front controller.
    $extension = strtolower(pathinfo($candidate, PATHINFO_EXTENSION));
    $blockedExtensions = ['env', 'sql', 'md', 'log', 'bak', 'old', 'tmp', 'yaml', 'yml'];
    if (
        in_array($extension, $blockedExtensions, true)
        || ($extension === 'php' && $candidate !== $public . DIRECTORY_SEPARATOR . 'index.php')
    ) {
        http_response_code(404);
        exit;
    }

    // php -S discards headers set before `return false` for its static-file
    // handler. Serve only the reviewed HTML entry pages ourselves for parity.
    if (in_array($path, ['/login.html', '/dashboard.html', '/race.html'], true)) {
        sendStaticPageSecurityHeaders($path);
        header('Content-Type: text/html; charset=UTF-8');
        header('Content-Length: ' . (string) filesize($candidate));
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
            readfile($candidate);
        }
        return true;
    }

    return false;
}

// Everything else is not found
http_response_code(404);
exit;
