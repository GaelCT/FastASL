<?php

/**
 * Rate Limiting Middleware
 *
 * Protects against brute force and DoS attacks using file-based storage.
 *
 * Features:
 * - IP-based rate limiting (with X-Forwarded-For support for proxies)
 * - Account-based rate limiting (for login attempts on specific usernames)
 * - Configurable windows and attempt limits
 * - Atomic file operations to prevent race conditions
 */

require_once __DIR__ . '/../config/Config.php';
require_once __DIR__ . '/../utils/Response.php';

class RateLimitMiddleware {
    private const RATE_LIMIT_DIR = __DIR__ . '/../../cache/ratelimit';

    /**
     * Check rate limit by identifier (IP or username)
     *
     * @param string $identifier Client IP or username
     * @param string $action Action being rate-limited (e.g., 'login', 'register', 'check')
     * @param int|null $maxAttempts Override default max attempts
     * @param int|null $windowMinutes Override default window
     */
    public static function check(
        string $identifier,
        string $action = 'default',
        ?int $maxAttempts = null,
        ?int $windowMinutes = null
    ): void {
        Config::load();

        $maxAttempts = $maxAttempts ?? Config::getInt('RATE_LIMIT_ATTEMPTS', 5);
        $windowMinutes = $windowMinutes ?? Config::getInt('RATE_LIMIT_WINDOW_MINUTES', 15);

        $rateLimitDir = self::RATE_LIMIT_DIR;
        if (!is_dir($rateLimitDir)) {
            if (!mkdir($rateLimitDir, 0750, true)) {
                // Can't create rate limit dir — fail open with a warning? No, fail closed.
                Response::error('Rate limiting is temporarily unavailable.', 503);
            }
        }

        $file = $rateLimitDir . '/' . md5($identifier . ':' . $action) . '.json';
        $now = time();
        $windowStart = $now - ($windowMinutes * 60);

        // Read current state with lock
        $data = self::readRateFile($file);

        // Filter out expired attempts
        $data = array_values(array_filter($data, fn($t) => $t > $windowStart));

        if (count($data) >= $maxAttempts) {
            $oldestAttempt = min($data);
            $retryAfter = max(1, ceil(($oldestAttempt + $windowMinutes * 60 - $now) / 60));
            Response::error(
                "Too many attempts. Please try again in {$retryAfter} minute(s).",
                429
            );
        }

        // Add current attempt and write back
        $data[] = $now;
        self::writeRateFile($file, $data);
    }

    /**
     * Get the client identifier (IP address) with proxy support
     *
     * Checks X-Forwarded-For header if the app is behind a trusted proxy.
     * Set TRUSTED_PROXIES in .env to enable (comma-separated CIDR ranges).
     */
    public static function getClientIdentifier(): string {
        $remoteAddr = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';

        // Check if request came through a trusted proxy
        $trustedProxies = Config::getArray('TRUSTED_PROXIES');
        if (!empty($trustedProxies)) {
            foreach ($trustedProxies as $proxy) {
                if (self::ipInRange($remoteAddr, trim($proxy))) {
                    // Extract real IP from X-Forwarded-For (rightmost non-trusted IP)
                    $forwardedFor = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
                    if ($forwardedFor !== '') {
                        $ips = array_map('trim', explode(',', $forwardedFor));
                        // Take the leftmost IP (original client)
                        $clientIp = $ips[0];
                        if (filter_var($clientIp, FILTER_VALIDATE_IP)) {
                            return $clientIp;
                        }
                    }
                    break;
                }
            }
        }

        return $remoteAddr;
    }

    /**
     * Check if an IP is within a CIDR range
     */
    private static function ipInRange(string $ip, string $range): bool {
        // Simple exact match
        if ($ip === $range) return true;

        // CIDR notation
        if (str_contains($range, '/')) {
            [$subnet, $bits] = explode('/', $range, 2);
            $bits = (int) $bits;

            $ipLong = ip2long($ip);
            $subnetLong = ip2long($subnet);

            if ($ipLong === false || $subnetLong === false) return false;

            $mask = -1 << (32 - $bits);
            return ($ipLong & $mask) === ($subnetLong & $mask);
        }

        return false;
    }

    /**
     * Read the rate limit file with shared lock
     */
    private static function readRateFile(string $file): array {
        if (!file_exists($file)) {
            return [];
        }

        $contents = @file_get_contents($file);
        if ($contents === false) {
            return [];
        }

        $data = json_decode($contents, true);
        return is_array($data) ? $data : [];
    }

    /**
     * Write the rate limit file with exclusive lock
     */
    private static function writeRateFile(string $file, array $data): void {
        $tmpFile = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
        $written = @file_put_contents(
            $tmpFile,
            json_encode($data),
            LOCK_EX
        );

        if ($written === false) {
            return; // Silently fail — don't block the request
        }

        // Atomic rename (prevents partial reads)
        if (!@rename($tmpFile, $file)) {
            @unlink($tmpFile);
        }
    }

    /**
     * Clean up expired rate limit files (should be called periodically via cron)
     */
    public static function cleanup(int $maxAgeMinutes = 60): int {
        $rateLimitDir = self::RATE_LIMIT_DIR;
        if (!is_dir($rateLimitDir)) return 0;

        $cleaned = 0;
        $cutoff = time() - ($maxAgeMinutes * 60);

        foreach (glob($rateLimitDir . '/*.json') as $file) {
            if (filemtime($file) < $cutoff) {
                @unlink($file);
                $cleaned++;
            }
        }

        // Also clean up orphaned .tmp files
        foreach (glob($rateLimitDir . '/*.tmp') as $file) {
            if (filemtime($file) < time() - 300) { // 5 min old tmp files
                @unlink($file);
            }
        }

        return $cleaned;
    }
}
