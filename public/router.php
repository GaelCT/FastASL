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
    return false;
}

// Everything else is not found
http_response_code(404);
exit;
