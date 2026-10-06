<?php
declare(strict_types=1);

return [
    // Max bytes allowed per download request (100 MB)
    'max_download_bytes' => 100 * 1024 * 1024,
    'default_download_bytes' => 10 * 1024 * 1024,

    // Max bytes accepted per upload request (100 MB)
    'max_upload_bytes' => 100 * 1024 * 1024,

    // Chunk size for streaming (1 MB)
    'chunk_bytes' => 1024 * 1024,

    // LibreSpeed measurement settings. Durations exclude connection warm-up.
    'test' => [
        'download_seconds' => 15,
        'upload_seconds' => 15,
        'ping_samples' => 10,
        'download_streams' => 6,
        'upload_streams' => 3,
        'upload_megabytes' => 20,
        'adaptive_duration' => true,
    ],

    // Public backends from https://librespeed.org/backend-servers/servers.php.
    // Lowest latency wins automatically. Set [] for your own hosting server.
    // Each entry: name, server (HTTPS base URL), dlURL, ulURL, pingURL, getIpURL.
    'test_servers' => json_decode(file_get_contents(__DIR__ . '/servers.json'), true, 512, JSON_THROW_ON_ERROR),
];
