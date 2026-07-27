<?php

/**
 * Leaderboard Controller
 *
 * Handles leaderboard HTTP requests with validated query parameters.
 */

require_once __DIR__ . '/../services/LeaderboardService.php';
require_once __DIR__ . '/../utils/Validator.php';
require_once __DIR__ . '/../utils/Response.php';

class LeaderboardController {
    /**
     * GET /leaderboard?scope=global&page=1&limit=10
     */
    public static function getLeaderboard(): never {
        $scope = $_GET['scope'] ?? 'global';
        $page = (int) ($_GET['page'] ?? 1);
        $limit = (int) ($_GET['limit'] ?? 10);

        // Validate and sanitize pagination
        Validator::validatePagination($page, $limit);

        try {
            $data = LeaderboardService::getLeaderboard($scope, $page, $limit);
            Response::success($data);
        } catch (InvalidArgumentException $e) {
            Response::error($e->getMessage(), 400);
        } catch (RuntimeException $e) {
            Response::error($e->getMessage(), 500);
        }
    }
}
