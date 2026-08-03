<?php

/**
 * Leaderboard Service
 *
 * Handles leaderboard queries with file-based caching and pagination.
 *
 * Security:
 * - Cache files use .php extension to prevent direct access
 * - Cache data is validated before use
 * - Atomic writes prevent cache corruption
 */

require_once __DIR__ . '/../utils/Database.php';
require_once __DIR__ . '/../utils/Validator.php';
require_once __DIR__ . '/../utils/Logger.php';
require_once __DIR__ . '/../config/Config.php';

class LeaderboardService {
    private const CACHE_DIR = __DIR__ . '/../../var/cache/leaderboard';

    public static function getLeaderboard(string $scope = 'global', int $page = 1, int $limit = 10): array {
        if ($error = Validator::validateScope($scope)) {
            throw new InvalidArgumentException($error);
        }

        // Ensure safe defaults
        if ($limit < 1) $limit = Config::getInt('LEADERBOARD_DEFAULT_LIMIT', 10);
        $maxLimit = Config::getInt('LEADERBOARD_MAX_LIMIT', 100);
        if ($limit > $maxLimit) $limit = $maxLimit;
        if ($page < 1) $page = 1;

        $offset = ($page - 1) * $limit;
        $cacheTtl = Config::getInt('CACHE_LEADERBOARD_TTL', 300);

        // Try cache first (only if TTL > 0)
        if ($cacheTtl > 0) {
            $cached = self::getCached($scope, $page, $limit, $cacheTtl);
            if ($cached !== null) {
                return $cached;
            }
        }

        // Fetch from database
        try {
            $db = Database::getConnection();

            // Get total count
            $stmt = $db->prepare('SELECT COUNT(*) FROM users WHERE scope = :s');
            $stmt->execute([':s' => $scope]);
            $total = (int) $stmt->fetchColumn();

            // Get paginated results — use bindValue for LIMIT/OFFSET (must be INT)
            $stmt = $db->prepare('
                SELECT username, name, best_wpm
                FROM users
                WHERE scope = :s
                ORDER BY best_wpm DESC
                LIMIT :limit OFFSET :offset
            ');
            $stmt->bindValue(':s', $scope, PDO::PARAM_STR);
            $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
            $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
            $stmt->execute();
            $entries = $stmt->fetchAll();

            $result = [
                'entries' => $entries,
                'pagination' => [
                    'page' => $page,
                    'limit' => $limit,
                    'total' => $total,
                    'pages' => $total > 0 ? (int) ceil($total / $limit) : 0,
                ]
            ];

            // Cache result
            if ($cacheTtl > 0) {
                self::setCached($scope, $page, $limit, $result);
            }

            return $result;
        } catch (PDOException $e) {
            Logger::error('Leaderboard', 'Database error', ['error' => $e->getMessage()]);
            throw new RuntimeException('Leaderboard query failed.');
        }
    }

    /**
     * Get cached leaderboard data if valid
     */
    private static function getCached(string $scope, int $page, int $limit, int $ttl): ?array {
        $cacheFile = self::getCacheFilePath($scope, $page, $limit);

        if (!file_exists($cacheFile)) {
            return null;
        }

        // Check TTL
        if (time() - filemtime($cacheFile) >= $ttl) {
            return null;
        }

        // Read and validate cache
        $contents = @file_get_contents($cacheFile);
        if ($contents === false) {
            return null;
        }

        $data = json_decode($contents, true);
        if (!is_array($data) || !isset($data['timestamp']) || !isset($data['data'])) {
            // Invalid cache format — delete it
            @unlink($cacheFile);
            return null;
        }

        // Validate the cached data structure
        $cachedData = $data['data'];
        if (!isset($cachedData['entries']) || !is_array($cachedData['entries'])) {
            @unlink($cacheFile);
            return null;
        }

        return $cachedData;
    }

    /**
     * Write leaderboard data to cache
     */
    private static function setCached(string $scope, int $page, int $limit, array $data): void {
        $cacheDir = self::CACHE_DIR;
        if (!is_dir($cacheDir)) {
            if (!mkdir($cacheDir, 0750, true)) {
                return; // Can't create cache dir
            }
        }

        $cacheFile = self::getCacheFilePath($scope, $page, $limit);

        $cacheData = json_encode([
            'timestamp' => time(),
            'data' => $data,
        ]);

        if ($cacheData === false) {
            return;
        }

        // Atomic write: write to temp file then rename
        $tmpFile = $cacheFile . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (@file_put_contents($tmpFile, $cacheData, LOCK_EX) === false) {
            return;
        }
        @rename($tmpFile, $cacheFile);
    }

    /**
     * Get cache file path — uses .php extension to prevent direct access
     * (PHP files execute; .json files are served raw)
     */
    private static function getCacheFilePath(string $scope, int $page, int $limit): string {
        $hash = hash('sha256', "{$scope}:{$page}:{$limit}");
        return self::CACHE_DIR . '/' . $hash . '.cache';
    }

    /**
     * Invalidate leaderboard cache
     */
    public static function invalidateCache(?string $scope = null): void {
        $cacheDir = self::CACHE_DIR;
        if (!is_dir($cacheDir)) return;

        // Clear all cache files
        $files = glob($cacheDir . '/*.cache') ?: [];
        foreach ($files as $file) {
            @unlink($file);
        }
        // Also clean tmp files
        $tmpFiles = glob($cacheDir . '/*.tmp') ?: [];
        foreach ($tmpFiles as $file) {
            @unlink($file);
        }
    }
}
