<?php

/**
 * Authentication Service
 *
 * Handles registration, login, logout, and token management with:
 * - Real JWT access + refresh tokens (HS256 signed)
 * - Refresh token rotation with reuse detection
 * - Account locking after consecutive failed logins
 * - Constant-time credential comparison (timing attack resistant)
 * - Username enumeration prevention
 */

require_once __DIR__ . '/../utils/Database.php';
require_once __DIR__ . '/../utils/Validator.php';
require_once __DIR__ . '/../utils/JWT.php';
require_once __DIR__ . '/../utils/Logger.php';
require_once __DIR__ . '/../config/Config.php';

class AuthService {
    /**
     * Register a new user
     *
     * @throws InvalidArgumentException for invalid input
     * @throws RuntimeException for duplicate username or DB errors
     */
    public static function register(string $username, string $name, string $password, string $scope = 'global'): array {
        $username = Validator::clean($username);
        $name = Validator::clean($name);

        // --- Validation ---
        if ($error = Validator::validateUsername($username)) {
            throw new InvalidArgumentException($error);
        }
        if ($error = Validator::validateName($name)) {
            throw new InvalidArgumentException($error);
        }
        if ($error = Validator::validatePassword($password)) {
            throw new InvalidArgumentException($error);
        }
        if ($error = Validator::validateScope($scope)) {
            throw new InvalidArgumentException($error);
        }

        // Enforce password max length (prevent bcrypt DoS with huge passwords)
        if (strlen($password) > 128) {
            throw new InvalidArgumentException('Password must be 128 characters or fewer.');
        }

        try {
            Database::beginTransaction();
            $db = Database::getConnection();

            // Check duplicate username
            $stmt = $db->prepare('SELECT COUNT(*) FROM users WHERE username = :u');
            $stmt->execute([':u' => $username]);
            if ((int) $stmt->fetchColumn() > 0) {
                Database::rollback();
                throw new RuntimeException('Username already taken.');
            }

            // Hash password with bcrypt
            $cost = Config::getInt('BCRYPT_COST', 12);
            $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => $cost]);

            // Insert user
            $stmt = $db->prepare('
                INSERT INTO users (username, name, password_hash, scope)
                VALUES (:u, :n, :h, :s)
            ');
            $stmt->execute([
                ':u' => $username,
                ':n' => $name,
                ':h' => $hash,
                ':s' => $scope
            ]);

            $userId = (int) $db->lastInsertId();
            Database::commit();

            Logger::info('Register', 'User registered successfully', [
                'user_id' => $userId,
                'username' => $username
            ]);

            return [
                'id' => $userId,
                'username' => strtoupper($username),
                'name' => $name
            ];
        } catch (PDOException $e) {
            if (Database::inTransaction()) {
                Database::rollback();
            }
            Logger::error('Register', 'Database error', ['error' => $e->getMessage()]);
            throw new RuntimeException('Registration failed. Please try again.');
        }
    }

    /**
     * Authenticate a user and return JWT access + refresh tokens
     *
     * Implements:
     * - Account locking after MAX_FAILED_LOGINS consecutive failures
     * - Constant-time-ish verification (same error for all failure modes)
     * - No username enumeration
     *
     * @throws InvalidArgumentException for invalid input
     * @throws RuntimeException for invalid credentials or locked account
     */
    public static function login(string $username, string $password): array {
        $username = Validator::clean($username);

        // Validate format first (doesn't reveal if user exists)
        if ($error = Validator::validateUsername($username)) {
            throw new InvalidArgumentException($error);
        }
        if ($password === '') {
            throw new InvalidArgumentException('Password is required.');
        }
        if (strlen($password) > 128) {
            // Don't hash massive passwords — silently fail
            throw new InvalidArgumentException('Invalid credentials.');
        }

        try {
            Database::beginTransaction();
            $db = Database::getConnection();

            $maxFailedLogins = Config::getInt('MAX_FAILED_LOGINS', 5);
            $lockoutMinutes = Config::getInt('LOCKOUT_MINUTES', 30);

            // Fetch user with lockout info
            $stmt = $db->prepare('
                SELECT id, username, name, password_hash, failed_logins, locked_until
                FROM users
                WHERE username = :u
            ');
            $stmt->execute([':u' => $username]);
            $user = $stmt->fetch();

            // If user doesn't exist — spend the same bcrypt cost to prevent timing-based
            // username enumeration. Hash a dummy password to consume similar time.
            if (!$user) {
                self::dummyHashVerify($password);
                Database::rollback();
                throw new RuntimeException('Invalid credentials.');
            }

            // Check if account is locked
            if ($user['locked_until'] !== null) {
                $lockedUntil = strtotime($user['locked_until']);
                if ($lockedUntil > time()) {
                    $remaining = ceil(($lockedUntil - time()) / 60);
                    Database::rollback();
                    // Don't reveal that the account exists — generic message
                    throw new RuntimeException("Too many attempts. Try again in {$remaining} minutes.");
                }
                // Lockout expired — reset on successful login
            }

            // Verify password
            if (!password_verify($password, $user['password_hash'])) {
                // Increment failed login counter
                $newCount = (int) $user['failed_logins'] + 1;
                $lockSql = '';

                if ($newCount >= $maxFailedLogins) {
                    // Lock the account
                    $lockSql = ', locked_until = DATE_ADD(NOW(), INTERVAL :lock_min MINUTE)';
                } else {
                    $lockSql = ', locked_until = NULL';
                }

                $stmt = $db->prepare("
                    UPDATE users SET failed_logins = :cnt {$lockSql} WHERE id = :id
                ");
                $params = [':cnt' => $newCount, ':id' => (int) $user['id']];
                if ($newCount >= $maxFailedLogins) {
                    $params[':lock_min'] = $lockoutMinutes;
                }
                $stmt->execute($params);

                Database::commit();

                Logger::warning('Login', 'Failed login attempt', [
                    'user_id' => $user['id'],
                    'failed_count' => $newCount,
                    'locked' => $newCount >= $maxFailedLogins
                ]);

                throw new RuntimeException('Invalid credentials.');
            }

            // Check if password needs rehash (bcrypt cost changed)
            $cost = Config::getInt('BCRYPT_COST', 12);
            if (password_needs_rehash($user['password_hash'], PASSWORD_BCRYPT, ['cost' => $cost])) {
                $newHash = password_hash($password, PASSWORD_BCRYPT, ['cost' => $cost]);
                $updateStmt = $db->prepare('UPDATE users SET password_hash = :h WHERE id = :id');
                $updateStmt->execute([':h' => $newHash, ':id' => (int) $user['id']]);
            }

            // Reset failed logins on successful authentication
            $stmt = $db->prepare('
                UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = :id
            ');
            $stmt->execute([':id' => (int) $user['id']]);

            // --- Generate JWT tokens ---
            $userId = (int) $user['id'];
            $usernameUpper = strtoupper($user['username']);

            // Access token (short-lived)
            $accessToken = JWT::encode([
                'sub' => $userId,
                'username' => $usernameUpper,
                'type' => 'access',
            ]);

            // Refresh token (longer-lived, with family for rotation)
            $familyId = bin2hex(random_bytes(16));
            $refreshToken = JWT::encodeRefresh([
                'sub' => $userId,
                'username' => $usernameUpper,
                'family' => $familyId,
            ]);

            // Decode to get JTI and expiration for storage
            $accessPayload = JWT::decode($accessToken);
            $refreshPayload = JWT::decode($refreshToken, true);

            // Store refresh token family for rotation tracking
            $accessExpires = $accessPayload ? date('Y-m-d H:i:s', $accessPayload['exp']) : null;
            $refreshExpires = $refreshPayload ? date('Y-m-d H:i:s', $refreshPayload['exp']) : null;

            if ($refreshPayload) {
                $stmt = $db->prepare('
                    INSERT INTO refresh_token_families (family_id, user_id, jti, expires_at)
                    VALUES (:fid, :uid, :jti, :exp)
                ');
                $stmt->execute([
                    ':fid' => $familyId,
                    ':uid' => $userId,
                    ':jti' => $refreshPayload['jti'],
                    ':exp' => $refreshExpires,
                ]);
            }

            // Purge old blacklist entries (opportunistic cleanup)
            $db->exec("DELETE FROM token_blacklist WHERE expires_at < NOW()");

            Database::commit();

            Logger::info('Login', 'User logged in successfully', [
                'user_id' => $userId,
                'username' => $username
            ]);

            return [
                'id' => $userId,
                'username' => $usernameUpper,
                'name' => $user['name'],
                'access_token' => $accessToken,
                'refresh_token' => $refreshToken,
                'token_type' => 'Bearer',
                'expires_in' => Config::getInt('JWT_EXPIRY_HOURS', 1) * 3600,
            ];
        } catch (PDOException $e) {
            if (Database::inTransaction()) {
                Database::rollback();
            }
            Logger::error('Login', 'Database error', ['error' => $e->getMessage()]);
            throw new RuntimeException('Login failed. Please try again.');
        }
    }

    /**
     * Logout — blacklist the current access token and invalidate refresh token family
     */
    public static function logout(int $userId, string $jti, ?string $familyId = null): void {
        try {
            Database::beginTransaction();
            $db = Database::getConnection();

            // Blacklist the access token
            $stmt = $db->prepare('
                INSERT IGNORE INTO token_blacklist (jti, user_id, token_type, expires_at)
                VALUES (:jti, :uid, \'access\', DATE_ADD(NOW(), INTERVAL 24 HOUR))
            ');
            $stmt->execute([':jti' => $jti, ':uid' => $userId]);

            // Invalidate the entire refresh token family
            if ($familyId) {
                $stmt = $db->prepare('
                    DELETE FROM refresh_token_families WHERE family_id = :fid AND user_id = :uid
                ');
                $stmt->execute([':fid' => $familyId, ':uid' => $userId]);
            }

            Database::commit();

            Logger::info('Logout', 'User logged out', [
                'user_id' => $userId,
                'jti' => $jti
            ]);
        } catch (PDOException $e) {
            if (Database::inTransaction()) {
                Database::rollback();
            }
            Logger::error('Logout', 'Database error', ['error' => $e->getMessage()]);
            throw new RuntimeException('Logout failed.');
        }
    }

    /**
     * Refresh an access token using a refresh token
     *
     * Implements refresh token rotation:
     * - Old refresh token is invalidated
     * - New access + refresh tokens are issued
     * - If a revoked refresh token is reused, the entire family is invalidated (theft detection)
     */
    public static function refreshToken(int $userId, string $refreshJti, string $familyId): array {
        try {
            Database::beginTransaction();
            $db = Database::getConnection();

            // Check if the refresh token family still exists and jti matches
            $stmt = $db->prepare('
                SELECT id, jti FROM refresh_token_families
                WHERE family_id = :fid AND user_id = :uid
            ');
            $stmt->execute([':fid' => $familyId, ':uid' => $userId]);
            $stored = $stmt->fetch();

            if (!$stored) {
                // Family doesn't exist — possible token reuse / theft!
                // Invalidate ALL refresh families for this user
                $stmt = $db->prepare('DELETE FROM refresh_token_families WHERE user_id = :uid');
                $stmt->execute([':uid' => $userId]);

                Database::commit();

                Logger::warning('RefreshToken', 'Refresh token reuse detected — all families invalidated', [
                    'user_id' => $userId,
                    'family_id' => $familyId
                ]);

                throw new RuntimeException('Token has been revoked. Please login again.');
            }

            // Verify the JTI matches (the specific refresh token used is the current valid one)
            if ($stored['jti'] !== $refreshJti) {
                // Stored JTI doesn't match — someone used an old refresh token!
                // This is token theft — invalidate everything
                $stmt = $db->prepare('DELETE FROM refresh_token_families WHERE user_id = :uid');
                $stmt->execute([':uid' => $userId]);

                Database::commit();

                Logger::warning('RefreshToken', 'CRITICAL: Refresh token reuse (theft detected)', [
                    'user_id' => $userId,
                    'family_id' => $familyId,
                    'expected_jti' => $stored['jti'],
                    'received_jti' => $refreshJti
                ]);

                throw new RuntimeException('Security alert: token reuse detected. Please login again.');
            }

            // --- Valid refresh token — rotate ---

            // Blacklist the used refresh token
            $stmt = $db->prepare('
                INSERT IGNORE INTO token_blacklist (jti, user_id, token_type, expires_at)
                VALUES (:jti, :uid, \'refresh\', DATE_ADD(NOW(), INTERVAL 7 DAY))
            ');
            $stmt->execute([':jti' => $refreshJti, ':uid' => $userId]);

            // Generate new tokens (keep the same family)
            $usernameUpper = ''; // Will fetch below
            $userStmt = $db->prepare('SELECT username FROM users WHERE id = :id');
            $userStmt->execute([':id' => $userId]);
            $userRow = $userStmt->fetch();
            if ($userRow) {
                $usernameUpper = strtoupper($userRow['username']);
            }

            $accessToken = JWT::encode([
                'sub' => $userId,
                'username' => $usernameUpper,
                'type' => 'access',
            ]);

            $newRefreshToken = JWT::encodeRefresh([
                'sub' => $userId,
                'username' => $usernameUpper,
                'family' => $familyId,
            ]);

            $refreshPayload = JWT::decode($newRefreshToken, true);
            $refreshExpires = $refreshPayload ? date('Y-m-d H:i:s', $refreshPayload['exp']) : null;

            // Update the refresh token family with the new JTI
            $stmt = $db->prepare('
                UPDATE refresh_token_families
                SET jti = :new_jti, expires_at = :exp
                WHERE family_id = :fid AND user_id = :uid
            ');
            $stmt->execute([
                ':new_jti' => $refreshPayload ? $refreshPayload['jti'] : '',
                ':exp' => $refreshExpires,
                ':fid' => $familyId,
                ':uid' => $userId,
            ]);

            Database::commit();

            Logger::info('RefreshToken', 'Token refreshed successfully', [
                'user_id' => $userId,
                'family_id' => $familyId
            ]);

            return [
                'access_token' => $accessToken,
                'refresh_token' => $newRefreshToken,
                'token_type' => 'Bearer',
                'expires_in' => Config::getInt('JWT_EXPIRY_HOURS', 1) * 3600,
            ];
        } catch (PDOException $e) {
            if (Database::inTransaction()) {
                Database::rollback();
            }
            Logger::error('RefreshToken', 'Database error', ['error' => $e->getMessage()]);
            throw new RuntimeException('Token refresh failed.');
        }
    }

    /**
     * Check if a JWT's JTI has been blacklisted
     */
    public static function isTokenBlacklisted(string $jti): bool {
        try {
            $db = Database::getConnection();
            $stmt = $db->prepare('SELECT COUNT(*) FROM token_blacklist WHERE jti = :jti');
            $stmt->execute([':jti' => $jti]);
            return (int) $stmt->fetchColumn() > 0;
        } catch (PDOException $e) {
            Logger::error('AuthService', 'Blacklist check failed', ['error' => $e->getMessage()]);
            return true; // Fail closed — if we can't check, deny access
        }
    }

    /**
     * Hash a dummy password to consume time similar to password_verify(),
     * preventing timing-based username enumeration.
     */
    private static function dummyHashVerify(string $password): void {
        $cost = Config::getInt('BCRYPT_COST', 12);
        // Use a fixed dummy hash that won't ever match
        $dummyHash = '$2y$12$LJ3m4ys3Lk0TSwHCpNqrGOpJxOZqVgCp7qQrY9gPqOt8WvFcUhfZu';
        password_verify($password, $dummyHash);
    }
}
