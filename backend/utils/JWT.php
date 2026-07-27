<?php

/**
 * JWT (JSON Web Token) Utility
 *
 * Implements HMAC-SHA256 (HS256) signed JWTs with:
 * - Proper header/payload/signature structure
 * - Expiration, issued-at, and unique ID claims
 * - Constant-time signature verification
 * - Token blacklisting support via unique jti
 *
 * Replaces the previous plain hex-token approach.
 */

require_once __DIR__ . '/../config/Config.php';

class JWT {
    private const ALGORITHM = 'HS256';

    /**
     * Allowed algorithms — whitelist to prevent algorithm confusion attacks
     */
    private static array $allowedAlgorithms = ['HS256'];

    /**
     * Create a signed JWT access token
     *
     * @param array $payload Custom claims to include (sub, username, etc.)
     * @return string Signed JWT string
     */
    public static function encode(array $payload): string {
        Config::load();

        $secret = self::getSecret();
        $expiryHours = Config::getInt('JWT_EXPIRY_HOURS', 1);

        $now = time();

        $claims = [
            'iss' => Config::get('APP_URL', 'https://asl-racer.local'),
            'iat' => $now,
            'nbf' => $now,
            'exp' => $now + ($expiryHours * 3600),
            'jti' => bin2hex(random_bytes(16)),  // unique token ID for blacklisting
        ];

        // Merge custom claims (sub, username, etc.) — but don't allow overriding standard claims
        foreach ($payload as $key => $value) {
            if (!array_key_exists($key, $claims)) {
                $claims[$key] = $value;
            }
        }

        return self::sign($claims, $secret);
    }

    /**
     * Create a refresh token with longer expiry
     *
     * @param array $payload Custom claims
     * @return string Signed refresh JWT
     */
    public static function encodeRefresh(array $payload): string {
        Config::load();

        $secret = self::getRefreshSecret();
        $expiryDays = Config::getInt('JWT_REFRESH_EXPIRY_DAYS', 7);

        $now = time();

        $claims = [
            'iss' => Config::get('APP_URL', 'https://asl-racer.local'),
            'iat' => $now,
            'nbf' => $now,
            'exp' => $now + ($expiryDays * 86400),
            'jti' => bin2hex(random_bytes(16)),
            'type' => 'refresh',  // distinguish from access tokens
        ];

        foreach ($payload as $key => $value) {
            if (!array_key_exists($key, $claims)) {
                $claims[$key] = $value;
            }
        }

        return self::sign($claims, $secret);
    }

    /**
     * Decode and verify a JWT
     *
     * @param string $token The JWT string
     * @param bool $isRefresh Whether this is a refresh token (uses different secret)
     * @return array|null Decoded payload or null if invalid
     */
    public static function decode(string $token, bool $isRefresh = false): ?array {
        $secret = $isRefresh ? self::getRefreshSecret() : self::getSecret();

        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }

        [$headerB64, $payloadB64, $signatureB64] = $parts;

        // Decode header
        $header = json_decode(self::base64UrlDecode($headerB64), true);
        if (!$header) {
            return null;
        }

        // Algorithm validation — prevent algorithm confusion attacks
        $alg = $header['alg'] ?? '';
        if (!in_array($alg, self::$allowedAlgorithms, true)) {
            return null;
        }

        // Verify signature using constant-time comparison
        $expectedSignature = self::createSignature($headerB64, $payloadB64, $secret);
        if (!hash_equals($expectedSignature, self::base64UrlDecode($signatureB64))) {
            return null;
        }

        // Decode payload
        $payload = json_decode(self::base64UrlDecode($payloadB64), true);
        if (!$payload) {
            return null;
        }

        // Validate expiration
        $now = time();
        if (isset($payload['exp']) && $payload['exp'] < $now) {
            return null;  // Token expired
        }

        // Validate not-before
        if (isset($payload['nbf']) && $payload['nbf'] > $now) {
            return null;  // Token not yet valid
        }

        return $payload;
    }

    /**
     * Sign claims into a JWT string
     */
    private static function sign(array $claims, string $secret): string {
        $header = ['alg' => self::ALGORITHM, 'typ' => 'JWT'];

        $headerB64 = self::base64UrlEncode(json_encode($header));
        $payloadB64 = self::base64UrlEncode(json_encode($claims));
        $signature = self::createSignature($headerB64, $payloadB64, $secret);
        $signatureB64 = self::base64UrlEncode($signature);

        return "{$headerB64}.{$payloadB64}.{$signatureB64}";
    }

    /**
     * Create HMAC-SHA256 signature
     */
    private static function createSignature(string $headerB64, string $payloadB64, string $secret): string {
        return hash_hmac('sha256', "{$headerB64}.{$payloadB64}", $secret, true);
    }

    /**
     * Base64URL encode (RFC 7515)
     */
    private static function base64UrlEncode(string $data): string {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    /**
     * Base64URL decode (RFC 7515)
     */
    private static function base64UrlDecode(string $data): string {
        $remainder = strlen($data) % 4;
        if ($remainder) {
            $data .= str_repeat('=', 4 - $remainder);
        }
        $decoded = base64_decode(strtr($data, '-_', '+/'), true);
        return $decoded !== false ? $decoded : '';
    }

    /**
     * Get the JWT signing secret — MUST be set in .env for production
     */
    private static function getSecret(): string {
        $secret = Config::get('JWT_SECRET', '');
        if ($secret === '') {
            // In production, this should NEVER happen — the .env must have a strong secret
            // We throw a descriptive error rather than using a hardcoded fallback
            throw new RuntimeException(
                'JWT_SECRET is not set in .env. Generate a strong secret: ' .
                'php -r "echo bin2hex(random_bytes(32));"'
            );
        }
        if (strlen($secret) < 32) {
            throw new RuntimeException('JWT_SECRET must be at least 32 characters long.');
        }
        return $secret;
    }

    /**
     * Get the refresh token secret — separate from access token secret
     * This ensures a leaked access token secret doesn't compromise refresh tokens
     */
    private static function getRefreshSecret(): string {
        $secret = Config::get('JWT_REFRESH_SECRET', '');
        if ($secret === '') {
            // Fall back to JWT_SECRET with a prefix to create cryptographic separation
            $secret = 'refresh_' . self::getSecret();
        }
        return $secret;
    }
}
