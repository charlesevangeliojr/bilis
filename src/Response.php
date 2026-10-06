<?php
declare(strict_types=1);

final class Response
{
    public static function noCache(): void
    {
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        header('Pragma: no-cache');
        header('Expires: 0');
        header('X-Content-Type-Options: nosniff');
    }

    public static function json(array $data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json');
        self::noCache();
        echo json_encode($data);
    }

    public static function error(string $message, int $status = 400): void
    {
        self::json(['error' => $message], $status);
    }
}
