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
 * the file contents (200), and must never leak the canary marker.
 */
final class ExposureTest extends TestCase
{
    private const HOST = '127.0.0.1';
    private const PORT = 8899;
    private const BASE_URL = 'http://127.0.0.1:8899';
    private const CANARY_MARKER = 'ASL_CANARY_8f3k';
    private const CANARY_FILE = 'secret-canary.txt';
    private const SYMLINK_NAME = 'canary-link';

    /** @var resource|null */
    private static $serverProcess = null;

    private static bool $envCreated = false;
    private static bool $symlinkReady = false;

    public static function setUpBeforeClass(): void
    {
        $root = dirname(__DIR__, 2);
        $public = $root . '/public';

        self::provisionEnvFile($root);
        self::createSymlinkCanary($root);

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
     * Tracks creation so the generated file is removed afterwards.
     */
    private static function provisionEnvFile(string $root): void
    {
        if (file_exists($root . '/.env')) {
            return;
        }

        $example = $root . '/.env.example';
        if (file_exists($example)) {
            copy($example, $root . '/.env');
            self::$envCreated = true;
        }
    }

    /**
     * Creates a marker file outside public/ and a symlink to it inside
     * public/. The router must never serve it. Skipped when the platform
     * (e.g. Windows without developer mode) cannot create symlinks.
     */
    private static function createSymlinkCanary(string $root): void
    {
        $canary = $root . '/' . self::CANARY_FILE;
        $link = $root . '/public/' . self::SYMLINK_NAME;

        if (!@file_put_contents($canary, self::CANARY_MARKER)) {
            return;
        }
        if (!@symlink($canary, $link)) {
            @unlink($canary);
            return;
        }
        self::$symlinkReady = true;
    }

    public static function tearDownAfterClass(): void
    {
        if (is_resource(self::$serverProcess)) {
            proc_terminate(self::$serverProcess);
            proc_close(self::$serverProcess);
        }

        $root = dirname(__DIR__, 2);
        if (self::$envCreated) {
            @unlink($root . '/.env');
        }
        if (self::$symlinkReady) {
            @unlink($root . '/public/' . self::SYMLINK_NAME);
            @unlink($root . '/' . self::CANARY_FILE);
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

    /**
     * @return array{int, string} [status, body]
     */
    private static function httpResponse(string $path): array
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
            return [0, ''];
        }

        $statusLine = $http_response_header[0] ?? '';
        if (preg_match('#\s(\d{3})\s#', $statusLine, $matches)) {
            return [(int) $matches[1], $body];
        }
        return [0, ''];
    }

    private static function httpStatus(string $path): int
    {
        return self::httpResponse($path)[0];
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function sensitivePathProvider(): iterable
    {
        yield 'env file' => ['/.env'];
        yield 'env example' => ['/.env.example'];
        yield 'public htaccess' => ['/.htaccess'];
        yield 'git config' => ['/.git/config'];
        yield 'composer manifest' => ['/composer.json'];
        yield 'composer lockfile' => ['/composer.lock'];
        yield 'vendor autoload' => ['/vendor/autoload.php'];
        yield 'vendor composer metadata' => ['/vendor/composer/installed.json'];
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
        yield 'encoded dotdot env' => ['/%2e%2e/.env'];
        yield 'encoded slash dotdot' => ['/..%2f.env'];
        yield 'double-encoded dotdot' => ['/%252e%252e/.env'];
    }

    #[DataProvider('sensitivePathProvider')]
    public function testSensitivePathIsNotExposed(string $path): void
    {
        [$status, $body] = self::httpResponse($path);

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
        $this->assertStringNotContainsString(
            self::CANARY_MARKER,
            $body,
            "Sensitive path {$path} leaked the canary marker in its body."
        );
    }

    public function testSymlinkEscapeIsNotServed(): void
    {
        if (!self::$symlinkReady) {
            $this->markTestSkipped('Symlink creation is not permitted on this platform.');
        }

        [$status, $body] = self::httpResponse('/' . self::SYMLINK_NAME);

        $this->assertNotSame(200, $status, 'Symlink escape was served with HTTP 200.');
        $this->assertStringNotContainsString(
            self::CANARY_MARKER,
            $body,
            'Symlink escape leaked the canary marker in its body.'
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

    public function testUnprefixedApiPathIsRejected(): void
    {
        $this->assertNotSame(200, self::httpStatus('/login'));
    }
}
