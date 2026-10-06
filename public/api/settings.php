<?php
declare(strict_types=1);

require_once __DIR__ . '/../../src/Response.php';
$config = require __DIR__ . '/../../config/config.php';
$test = $config['test'];
$servers = $config['test_servers'];

// Windows' PHP development server is single-threaded: extra streams queue.
// Public backends and Apache/PHP-FPM can use the configured parallel streams.
$localDevelopment = PHP_SAPI === 'cli-server';
$localDefault = $localDevelopment && count($servers) === 0;
Response::json([
    'parameters' => [
        'time_dl_max' => $test['download_seconds'],
        'time_ul_max' => $test['upload_seconds'],
        'time_auto' => $test['adaptive_duration'],
        'count_ping' => $test['ping_samples'],
        'xhr_dlMultistream' => $localDefault ? 1 : $test['download_streams'],
        'xhr_ulMultistream' => $localDefault ? 1 : $test['upload_streams'],
        'xhr_ul_blob_megabytes' => $test['upload_megabytes'],
        'garbagePhp_chunkSize' => (int) ($config['max_download_bytes'] / 1048576),
    ],
    'servers' => $servers,
    'localDevelopment' => $localDevelopment,
]);
