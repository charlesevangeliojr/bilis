<?php
declare(strict_types=1);

require_once __DIR__ . '/../../src/Response.php';

$config = require __DIR__ . '/../../config/config.php';

$bytes = isset($_GET['bytes']) ? (int) $_GET['bytes'] :
    (isset($_GET['ckSize']) ? (int) ((float) $_GET['ckSize'] * 1048576) : $config['default_download_bytes']);
$bytes = max(1024, min($bytes, $config['max_download_bytes']));
$chunk = $config['chunk_bytes'];

set_time_limit(0);
while (ob_get_level() > 0) {
    ob_end_clean();
}

Response::noCache();
header('Content-Type: application/octet-stream');
header('Content-Length: ' . $bytes);
header('Accept-Ranges: none');
// Bypass server buffering / compression so speed is not affected
header('X-Accel-Buffering: no');
if (function_exists('apache_setenv')) {
    @apache_setenv('no-gzip', '1');
}
@ini_set('zlib.output_compression', 'Off');
@ini_set('output_buffering', 'Off');

$remaining = $bytes;
// Reuse an incompressible buffer to avoid measuring random generation speed.
$buffer = random_bytes(min($chunk, $bytes));
while ($remaining > 0) {
    $size = min($chunk, $remaining);
    echo $size === strlen($buffer) ? $buffer : substr($buffer, 0, $size);
    $remaining -= $size;
    if (connection_aborted()) {
        break;
    }
    flush();
}
