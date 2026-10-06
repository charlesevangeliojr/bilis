<?php
declare(strict_types=1);

require_once __DIR__ . '/../../src/Response.php';

if (isset($_GET['empty'])) {
    Response::noCache();
    header('Content-Type: text/plain');
} else {
    Response::json(['t' => (int) (microtime(true) * 1000)]);
}
