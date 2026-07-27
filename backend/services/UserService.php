<?php

/**
 * User Service
 *
 * Handles user-related operations with validated inputs.
 */

require_once __DIR__ . '/../utils/Database.php';
require_once __DIR__ . '/../utils/Validator.php';
require_once __DIR__ . '/../utils/Logger.php';

class UserService {
    /**
     * Check if a username is available for registration.
     *
     * @throws InvalidArgumentException for invalid username format
     * @throws RuntimeException for database errors
     */
    public static function checkUsernameAvailability(string $username): bool {
        $username = Validator::clean($username);

        if ($error = Validator::validateUsername($username)) {
            throw new InvalidArgumentException($error);
        }

        try {
            $db = Database::getConnection();
            $stmt = $db->prepare('SELECT COUNT(*) FROM users WHERE username = :u');
            $stmt->execute([':u' => $username]);
            return (int) $stmt->fetchColumn() === 0;
        } catch (PDOException $e) {
            Logger::error('CheckUsername', 'Database error', ['error' => $e->getMessage()]);
            throw new RuntimeException('Username check failed. Please try again.');
        }
    }

    /**
     * Update a user's best WPM score.
     * Uses GREATEST() to only update if the new score is higher.
     *
     * @throws InvalidArgumentException for invalid WPM value
     * @throws RuntimeException for database errors
     */
    public static function updateScore(int $userId, int $wpm): void {
        if ($wpm <= 0) {
            throw new InvalidArgumentException('WPM must be greater than 0.');
        }
        if ($wpm > 1000) {
            throw new InvalidArgumentException('WPM value is unrealistic.');
        }

        try {
            $db = Database::getConnection();
            $stmt = $db->prepare('
                UPDATE users
                SET best_wpm = GREATEST(best_wpm, :wpm)
                WHERE id = :id
            ');
            $stmt->execute([':wpm' => $wpm, ':id' => $userId]);

            Logger::info('UpdateScore', 'Score updated', [
                'user_id' => $userId,
                'wpm' => $wpm
            ]);
        } catch (PDOException $e) {
            Logger::error('UpdateScore', 'Database error', ['error' => $e->getMessage()]);
            throw new RuntimeException('Score update failed. Please try again.');
        }
    }
}
