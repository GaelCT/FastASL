<?php

/**
 * ASL Racer — Development server router
 *
 * Usage: php -S 127.0.0.1:8000 -t public public/router.php
 *
 * Serves existing static files from public/ directly and routes
 * everything else (including /api/*) to the front controller.
 * Never serves files outside public/.
 */

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

// Serve existing static files directly
$file = __DIR__ . $path;
if ($path !== '/' && is_file($file)) {
    return false;
}

// Route everything else to the front controller
require __DIR__ . '/index.php';
