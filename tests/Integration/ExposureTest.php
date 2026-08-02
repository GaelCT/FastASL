<?php

namespace App\Tests\Integration;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * HTTP exposure tests — verify that only public/ is served.
 *
 * Starts the PHP built-in server with the production-style layout:
 *   php -S 127.0.0.1:8899 -t public public/router.php
 *
 * Every sensitive path must return 403 or 404 and must never return
 * the file contents (200).
 */
final class ExposureTest extends TestCase
{
    private const HOST = '127.0.0.1';
    private const PORT = 8899;
    private const BASE_URL = 'http://127.0.0.1:8899';

    /** @var resource|null */
    private static $serverProcess = null;

    public static function setUpBeforeClass(): void
    {
        $root = dirname(__DIR__, 2);
        $public = $root . '/public';

        self::provisionEnvFile($root);

        $command = sprintf(
            'php -S %s:%d -t %s %s',
            self::HOST,
            self::PORT,
            escapeshellarg($public),
            escapeshellarg($public . '/router.php')
        );

        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];

        self::$serverProcess = proc_open($command, $descriptors, $pipes, $root);
        if (!is_resource(self::$serverProcess)) {
            self::fail('Could not start the PHP built-in server for exposure tests.');
        }

        self::waitForServerReady();
    }

    /**
     * Config::load() throws when .env is missing, so CI needs a
     * minimal .env provisioned from .env.example before the server starts.
     */
    private static function provisionEnvFile(string $root): void
    {
        if (file_exists($root . '/.env')) {
            return;
        }

        $example = $root . '/.env.example';
        if (file_exists($example)) {
            copy($example, $root . '/.env');
        }
    }

    public static function tearDownAfterClass(): void
    {
        if (is_resource(self::$serverProcess)) {
            proc_terminate(self::$serverProcess);
            proc_close(self::$serverProcess);
        }
    }

    private static function waitForServerReady(): void
    {
        $deadline = microtime(true) + 15.0;
        while (microtime(true) < $deadline) {
            $status = self::httpStatus('/api/');
            if ($status === 200) {
                return;
            }
            usleep(100_000);
        }
        self::fail('PHP built-in server did not become ready in time.');
    }

    private static function httpStatus(string $path): int
    {
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'ignore_errors' => true,
                'timeout' => 5,
            ],
        ]);

        $body = @file_get_contents(self::BASE_URL . $path, false, $context);
        if ($body === false) {
            return 0;
        }

        $statusLine = $http_response_header[0] ?? '';
        if (preg_match('#\s(\d{3})\s#', $statusLine, $matches)) {
            return (int) $matches[1];
        }
        return 0;
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function sensitivePathProvider(): iterable
    {
        yield 'env file' => ['/.env'];
        yield 'env example' => ['/.env.example'];
        yield 'git config' => ['/.git/config'];
        yield 'composer manifest' => ['/composer.json'];
        yield 'composer lockfile' => ['/composer.lock'];
        yield 'npm manifest' => ['/package.json'];
        yield 'npm lockfile' => ['/package-lock.json'];
        yield 'database schema' => ['/database/db.sql'];
        yield 'database migration' => ['/database/migrate_v3_to_v31.sql'];
        yield 'remediation tracker' => ['/docs/AUDIT_REMEDIATION_TRACKER.md'];
        yield 'project audit' => ['/ASL_Revive_Project_Audit.md'];
        yield 'backend openapi' => ['/backend/openapi.yaml'];
        yield 'backend source' => ['/backend/services/AuthService.php'];
        yield 'backend config' => ['/backend/config/Config.php'];
        yield 'backend htaccess' => ['/backend/.htaccess'];
        yield 'runtime log' => ['/var/log/error.log'];
        yield 'runtime cache' => ['/var/cache/leaderboard'];
        yield 'old pages directory' => ['/pages/login.html'];
        yield 'old JS directory' => ['/JS/login.js'];
        yield 'old style directory' => ['/style/main.css'];
        yield 'phpunit config' => ['/phpunit.xml.dist'];
    }

    #[DataProvider('sensitivePathProvider')]
    public function testSensitivePathIsNotExposed(string $path): void
    {
        $status = self::httpStatus($path);

        $this->assertNotSame(
            200,
            $status,
            "Sensitive path {$path} was served with HTTP 200. It must return 403 or 404."
        );
        $this->assertContains(
            $status,
            [403, 404],
            "Sensitive path {$path} returned unexpected status {$status}. Expected 403 or 404."
        );
    }

    public function testPublicPageIsServed(): void
    {
        $this->assertSame(200, self::httpStatus('/login.html'));
    }

    public function testPublicAssetIsServed(): void
    {
        $this->assertSame(200, self::httpStatus('/assets/css/main.css'));
    }

    public function testApiHealthIsServed(): void
    {
        $status = self::httpStatus('/api/');
        $this->assertSame(200, $status);
    }
}
