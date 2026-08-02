<?php

namespace App\Tests\Integration;

use PHPUnit\Framework\TestCase;

abstract class ApiTestCase extends TestCase
{
    private array $server;

    protected function setUp(): void
    {
        $this->server = [
            'HTTP_HOST' => 'localhost',
            'SERVER_NAME' => 'localhost',
            'SERVER_PORT' => '80',
            'REQUEST_URI' => '/',
            'REQUEST_METHOD' => 'GET',
            'CONTENT_TYPE' => 'application/json',
        ];
    }

    protected function get(string $uri, array $headers = []): array
    {
        return $this->request('GET', $uri, headers: $headers);
    }

    protected function post(string $uri, array $body = [], array $headers = []): array
    {
        return $this->request('POST', $uri, $body, $headers);
    }

    protected function request(string $method, string $uri, array $body = [], array $headers = []): array
    {
        $this->server['REQUEST_METHOD'] = $method;
        $this->server['REQUEST_URI'] = $uri;

        foreach ($headers as $key => $value) {
            $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $key));
            $this->server[$serverKey] = $value;
        }

        return [
            'body' => json_encode($body),
            'server' => $this->server,
        ];
    }
}
