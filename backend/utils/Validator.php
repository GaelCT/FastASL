<?php

/**
 * Input Validator
 *
 * Centralized validation with strict allowlist-based regex patterns.
 * All inputs MUST match a known-good pattern — anything else is rejected.
 *
 * Security principle: deny by default, allow only what's explicitly permitted.
 */

class Validator {
    // Username: 3-8 chars, alphanumeric + underscore only (no special chars, no unicode)
    private const USERNAME_MIN = 3;
    private const USERNAME_MAX = 8;
    private const USERNAME_REGEX = '/^[a-zA-Z0-9_]{3,8}$/';

    // Display name: 1-64 chars, alphanumeric + limited safe punctuation
    // Explicitly excludes: < > & " ' ` = ; ( ) { } [ ] \ / * % # @ ! ~ ^ | and all control chars
    private const NAME_MIN = 1;
    private const NAME_MAX = 64;
    private const NAME_REGEX = '/^[a-zA-Z0-9_\-\s\.]{1,64}$/';

    // Password: minimum 8 characters, must contain at least:
    // - One uppercase letter
    // - One lowercase letter
    // - One digit
    private const PASSWORD_MIN = 8;
    private const PASSWORD_MAX = 128;

    /**
     * Clean input: strip HTML/PHP tags and whitespace.
     * This is the FIRST line of defense — validation afterwards ensures the result
     * still matches expected patterns.
     */
    public static function clean(string $data): string {
        // Strip HTML and PHP tags
        $cleaned = strip_tags($data);
        // Remove null bytes (used in poison null byte attacks)
        $cleaned = str_replace("\0", '', $cleaned);
        // Trim whitespace
        return trim($cleaned);
    }

    /**
     * Strict clean: only keep explicitly allowed characters.
     * Use for output contexts where even safe chars could be misinterpreted.
     */
    public static function strictClean(string $data, string $allowedPattern = '/[^a-zA-Z0-9_\-\s\.]/'): string {
        return preg_replace($allowedPattern, '', self::clean($data));
    }

    // --- Username validation ---

    public static function isValidUsername(string $username): bool {
        $len = strlen($username);
        return $len >= self::USERNAME_MIN
            && $len <= self::USERNAME_MAX
            && (bool) preg_match(self::USERNAME_REGEX, $username);
    }

    public static function validateUsername(string $username): ?string {
        if ($username === '') {
            return 'Username is required.';
        }
        if (!self::isValidUsername($username)) {
            return 'Username must be 3-8 characters: letters, numbers, underscores only.';
        }
        return null; // Valid
    }

    // --- Display name validation ---

    public static function isValidName(string $name): bool {
        $len = strlen($name);
        return $len >= self::NAME_MIN
            && $len <= self::NAME_MAX
            && (bool) preg_match(self::NAME_REGEX, $name);
    }

    public static function validateName(string $name): ?string {
        if ($name === '') {
            return 'Name is required.';
        }
        if (!self::isValidName($name)) {
            return 'Name must be 1-64 characters: letters, numbers, spaces, hyphens, underscores, dots only.';
        }
        return null; // Valid
    }

    // --- Password validation (strengthened) ---

    public static function isValidPassword(string $password): bool {
        $len = strlen($password);
        if ($len < self::PASSWORD_MIN || $len > self::PASSWORD_MAX) {
            return false;
        }
        // Require at least one uppercase, one lowercase, and one digit
        if (!preg_match('/[A-Z]/', $password)) return false;
        if (!preg_match('/[a-z]/', $password)) return false;
        if (!preg_match('/[0-9]/', $password)) return false;
        return true;
    }

    public static function validatePassword(string $password): ?string {
        if ($password === '') {
            return 'Password is required.';
        }
        if (strlen($password) < self::PASSWORD_MIN) {
            return 'Password must be at least ' . self::PASSWORD_MIN . ' characters.';
        }
        if (strlen($password) > self::PASSWORD_MAX) {
            return 'Password must be ' . self::PASSWORD_MAX . ' characters or fewer.';
        }
        if (!preg_match('/[A-Z]/', $password)) {
            return 'Password must contain at least one uppercase letter.';
        }
        if (!preg_match('/[a-z]/', $password)) {
            return 'Password must contain at least one lowercase letter.';
        }
        if (!preg_match('/[0-9]/', $password)) {
            return 'Password must contain at least one digit.';
        }
        return null; // Valid
    }

    // --- WPM validation ---

    public static function validateWpm(int $wpm): ?string {
        if ($wpm <= 0) {
            return 'WPM must be greater than 0.';
        }
        if ($wpm > 1000) {
            return 'WPM seems unrealistic (max 1000).';
        }
        return null;
    }

    // --- Scope validation (whitelist) ---

    public static function validateScope(string $scope): ?string {
        $validScopes = ['global', 'local', 'friends'];
        if (!in_array($scope, $validScopes, true)) {
            return 'Invalid scope. Must be one of: ' . implode(', ', $validScopes);
        }
        return null;
    }

    // --- Generic input safety checks ---

    /**
     * Check if a string contains any characters commonly used in injection attacks.
     * Returns the offending character description, or null if clean.
     */
    public static function containsDangerousChars(string $input): ?string {
        // Check for SQL comment sequences
        if (str_contains($input, '--') || str_contains($input, '/*') || str_contains($input, '*/')) {
            return 'Input contains forbidden character sequences.';
        }
        // Check for null bytes
        if (str_contains($input, "\0")) {
            return 'Input contains null bytes.';
        }
        // Check for HTML/XML tag characters (should have been stripped by clean(), defense in depth)
        if (preg_match('/<[^>]*>/', $input)) {
            return 'Input contains HTML/XML tags.';
        }
        // Check for JavaScript event handlers
        if (preg_match('/\bon\w+\s*=/i', $input)) {
            return 'Input contains forbidden patterns.';
        }
        // Check for protocol handlers in data
        if (preg_match('/^(javascript|data|vbscript):/i', $input)) {
            return 'Input contains forbidden protocol handlers.';
        }
        return null;
    }

    /**
     * Validate pagination parameters — ensure they're safe integers
     */
    public static function validatePagination(int &$page, int &$limit, int $maxLimit = 100, int $defaultLimit = 10): void {
        if ($page < 1) $page = 1;
        if ($limit < 1) $limit = $defaultLimit;
        if ($limit > $maxLimit) $limit = $maxLimit;
    }
}
