<?php
declare(strict_types=1);

require_once __DIR__ . '/../../src/Response.php';

$config = require __DIR__ . '/../../config/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('POST required', 405);
    exit;
}

set_time_limit(0);
@ini_set('zlib.output_compression', 'Off');
if (function_exists('apache_setenv')) {
    @apache_setenv('no-gzip', '1');
}
header('X-Accel-Buffering: no');

$received = 0;
$max = $config['max_upload_bytes'];
$in = fopen('php://input', 'rb');

if ($in === false) {
    Response::error('Cannot read input', 500);
    exit;
}

while (!feof($in)) {
    $data = fread($in, 64 * 1024);
    if ($data === false) {
        fclose($in);
        Response::error('Cannot read upload', 500);
        exit;
    }
    $received += strlen($data);
    if ($received > $max) {
        fclose($in);
        Response::error('Payload too large', 413);
        exit;
    }
}
fclose($in);

Response::json(['received' => $received]);
