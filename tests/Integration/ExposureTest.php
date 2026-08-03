<?php

namespace App\Tests\Integration;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * HTTP exposure tests — verify that only public/ is served.
 *
 * Starts the PHP built-in server with the production-style layout:
 *   php -d expose_php=0 -S 127.0.0.1:8899 -t public public/router.php
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

    /** @var list<string> Files created inside public/ by this test run. */
    private static array $exposureFiles = [];

    public static function setUpBeforeClass(): void
    {
        $root = dirname(__DIR__, 2);
        $public = $root . '/public';

        self::provisionEnvFile($root);
        self::createSymlinkCanary($root);
        self::createExposureFiles($public);

        $command = sprintf(
            'php -d expose_php=0 -S %s:%d -t %s %s',
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

    /**
     * Places canary files with sensitive extensions directly inside
     * public/. They must be refused even though they are physically
     * within the document root (defense in depth, mirrors .htaccess).
     * Setup is mandatory and non-destructive: a pre-existing file or
     * symlink (including a dangling one) or a failed write fails the
     * suite instead of silently false-passing. The generated path is
     * registered for cleanup before its contents are verified, so a
     * marker mismatch cannot leave the file behind.
     */
    private static function createExposureFiles(string $public): void
    {
        // Distinct basenames: on case-insensitive filesystems (Windows,
        // default macOS) exposure-canary.php and exposure-canary.PHP would
        // collide, so the uppercase variant uses its own name.
        $canaries = [
            'exposure-canary.sql',
            'exposure-canary.log',
            'exposure-canary.bak',
            'exposure-canary.php',
            'exposure-uppercase.PHP',
        ];

        foreach ($canaries as $name) {
            $file = $public . '/' . $name;

            if (file_exists($file) || is_link($file)) {
                self::fail("Exposure test path already exists: {$file}");
            }

            if (file_put_contents($file, self::CANARY_MARKER) === false) {
                if (file_exists($file) || is_link($file)) {
                    unlink($file);
                }
                self::fail("Could not create exposure test file: {$file}");
            }

            self::$exposureFiles[] = $file;

            if (file_get_contents($file) !== self::CANARY_MARKER) {
                self::fail("Exposure test file does not contain the expected marker: {$file}");
            }
        }
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
        foreach (self::$exposureFiles as $file) {
            @unlink($file);
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
     * @return array{int, list<string>, string} [status, headers, body]
     */
    private static function httpResponse(string $path, string $method = 'GET', ?string $requestBody = null): array
    {
        $options = [
            'method' => $method,
            'ignore_errors' => true,
            'timeout' => 5,
        ];
        if ($requestBody !== null) {
            $options['header'] = "Content-Type: application/json\r\n";
            $options['content'] = $requestBody;
        }
        $context = stream_context_create(['http' => $options]);
        unset($http_response_header);
        $body = @file_get_contents(self::BASE_URL . $path, false, $context);
        $headers = $http_response_header ?? [];
        $statusLine = $headers[0] ?? '';
        $status = 0;
        if (preg_match('#\s(\d{3})\s#', $statusLine, $matches)) {
            $status = (int) $matches[1];
        }
        return [$status, $headers, $body === false ? '' : $body];
    }

    private static function httpStatus(string $path): int
    {
        return self::httpResponse($path)[0];
    }

    private function assertNoPoweredBy(string $path, array $headers): void
    {
        $matches = array_values(array_filter($headers, static fn (string $header): bool => preg_match('/^X-Powered-By\\s*:/i', $header) === 1));
        $this->assertSame([], $matches, "Route {$path} disclosed X-Powered-By. Headers: " . implode(' | ', $headers));
    }

    /**
     * @return array<string, mixed>
     */
    private function assertJsonResponse(string $path, int $expectedStatus): array
    {
        [$status, $headers, $body] = self::httpResponse($path);
        $this->assertSame($expectedStatus, $status, "Unexpected status for {$path}.");
        $this->assertNoPoweredBy($path, $headers);
        $contentTypes = array_values(array_filter($headers, static fn (string $header): bool => stripos($header, 'Content-Type: application/json') === 0));
        $this->assertNotSame([], $contentTypes, "Route {$path} did not return JSON.");
        $decoded = json_decode($body, true);
        $this->assertIsArray($decoded, "Route {$path} did not return valid JSON: {$body}");
        return $decoded;
    }

    private function assertHealth(string $path): void
    {
        [$status, $headers, $body] = self::httpResponse($path);
        $this->assertSame(200, $status, "Unexpected health status for {$path}.");
        $this->assertNoPoweredBy($path, $headers);
        $contentTypes = array_values(array_filter($headers, static fn (string $header): bool => stripos($header, 'Content-Type: application/json') === 0));
        $this->assertNotSame([], $contentTypes, "Health route {$path} did not return JSON.");
        $decoded = json_decode($body, true);
        $this->assertIsArray($decoded);
        $keys = array_keys($decoded);
        sort($keys);
        $this->assertSame(['message', 'success', 'timestamp'], $keys, "Unexpected health keys for {$path}.");
        $this->assertArrayNotHasKey('version', $decoded);
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
        yield 'exposure sql in root' => ['/exposure-canary.sql'];
        yield 'exposure log in root' => ['/exposure-canary.log'];
        yield 'exposure backup in root' => ['/exposure-canary.bak'];
        yield 'exposure php script in root' => ['/exposure-canary.php'];
        yield 'exposure uppercase php in root' => ['/exposure-uppercase.PHP'];
    }

    #[DataProvider('sensitivePathProvider')]
    public function testSensitivePathIsNotExposed(string $path): void
    {
        [$status, $headers, $body] = self::httpResponse($path);
        $this->assertNoPoweredBy($path, $headers);

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

        [$status, $headers, $body] = self::httpResponse('/' . self::SYMLINK_NAME);
        $this->assertNoPoweredBy('/' . self::SYMLINK_NAME, $headers);

        $this->assertContains(
            $status,
            [403, 404],
            "Symlink escape returned unexpected HTTP {$status}. Expected 403 or 404."
        );
        $this->assertStringNotContainsString(
            self::CANARY_MARKER,
            $body,
            'Symlink escape leaked the canary marker in its body.'
        );
    }

    public function testPublicPageIsServedWithoutPoweredBy(): void
    {
        [$status, $headers] = self::httpResponse('/login.html');
        $this->assertSame(200, $status);
        $this->assertNoPoweredBy('/login.html', $headers);
    }

    public function testPublicAssetIsServedWithoutPoweredBy(): void
    {
        [$status, $headers] = self::httpResponse('/assets/css/main.css');
        $this->assertSame(200, $status);
        $this->assertNoPoweredBy('/assets/css/main.css', $headers);
    }

    public function testApiHealthIsMinimalAndHeaderSafe(): void
    {
        $this->assertHealth('/api');
        $this->assertHealth('/api/');
    }

    public function testJsonErrorIsExactAndHeaderSafe(): void
    {
        $this->assertSame(
            ['success' => false, 'error' => 'Not found.'],
            $this->assertJsonResponse('/api/nope', 404)
        );
    }

    public function testDisallowedPhpPathIsExactAndHeaderSafe(): void
    {
        [$status, $headers, $body] = self::httpResponse('/index.php/extra');
        $this->assertSame(404, $status);
        $this->assertNoPoweredBy('/index.php/extra', $headers);
        $this->assertStringNotContainsString('<?php', $body);
    }

    public function testHealthSchemaMatchesRuntimeKeys(): void
    {
        $this->assertHealth('/api');
        $spec = file_get_contents(dirname(__DIR__, 2) . '/backend/openapi.yaml');
        $this->assertNotFalse($spec);
        $start = strpos($spec, "  /:\n");
        $end = strpos($spec, "\n  /validate:", $start === false ? 0 : $start);
        $this->assertNotFalse($start);
        $this->assertNotFalse($end);
        $healthSchema = substr($spec, $start, $end - $start);
        preg_match_all('/^ {18}([A-Za-z][A-Za-z0-9_-]*):\\s*$/m', $healthSchema, $matches);
        $schemaKeys = array_values(array_unique($matches[1]));
        sort($schemaKeys);
        $this->assertSame(['message', 'success', 'timestamp'], $schemaKeys);
        $this->assertStringNotContainsString('version:', $healthSchema);
    }

    /**
     * @return iterable<string, array{string, int}>
     */
    public static function apiRoutingProvider(): iterable
    {
        yield 'exact api root' => ['/api', 200];
        yield 'api with trailing slash' => ['/api/', 200];
        yield 'api unknown route' => ['/api/nope', 404];
        yield 'api-prefixed non-route' => ['/apix', 404];
        yield 'unprefixed frontend path' => ['/login', 404];
    }

    #[DataProvider('apiRoutingProvider')]
    public function testApiRoutingExactness(string $path, int $expected): void
    {
        $this->assertSame($expected, self::httpStatus($path), "Unexpected status for {$path}.");
    }
}
