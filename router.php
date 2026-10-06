<?php
declare(strict_types=1);

// Support the README command without requiring an explicit public docroot.
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/');
$root = realpath(__DIR__ . '/public');
$file = realpath($root . ($path === '/' ? '/index.html' : $path));
if ($file === false || !str_starts_with($file, $root . DIRECTORY_SEPARATOR) || !is_file($file)) {
    http_response_code(404);
    echo 'Not found';
    return true;
}
$extension = pathinfo($file, PATHINFO_EXTENSION);
$types = ['html' => 'text/html; charset=utf-8', 'css' => 'text/css; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'svg' => 'image/svg+xml'];
if (!isset($types[$extension]) && !in_array($path, ['/api/ping.php', '/api/download.php', '/api/upload.php', '/api/settings.php'], true)) {
    http_response_code(404);
    echo 'Not found';
    return true;
}
if ($extension === 'php') {
    require $file;
} else {
    header('Content-Type: ' . $types[$extension]);
    readfile($file);
}
return true;
