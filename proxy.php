<?php
/**
 * Server-side proxy for Wikidata SPARQL and Wikimedia Commons API calls.
 *
 * Allowed endpoints:
 *   ?endpoint=wikidata  — proxies to https://query.wikidata.org/sparql
 *   ?endpoint=commons   — proxies to https://commons.wikimedia.org/w/api.php
 *
 * The client passes the full query string (everything after the base URL) in ?q=
 * For wikidata: proxy.php?endpoint=wikidata&q=<url-encoded query string>
 * For commons:  proxy.php?endpoint=commons&q=<url-encoded query string>
 */

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$endpoint = $_GET['endpoint'] ?? '';
$queryString = $_GET['q'] ?? '';

if ($queryString === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Missing q parameter']);
    exit;
}

if ($endpoint === 'wikidata') {
    $url = 'https://query.wikidata.org/sparql?' . $queryString;
    $headers = [
        'Accept: application/json',
        'User-Agent: WikiGuessr/1.0 (https://wikiguessr.toolforge.org; ranjith.sajeev@gmail.com)'
    ];
} elseif ($endpoint === 'commons') {
    $url = 'https://commons.wikimedia.org/w/api.php?' . $queryString;
    $headers = [
        'Accept: application/json',
        'User-Agent: WikiGuessr/1.0 (https://wikiguessr.toolforge.org; ranjith.sajeev@gmail.com)'
    ];
} else {
    http_response_code(400);
    echo json_encode(['error' => 'Unknown endpoint']);
    exit;
}

$ctx = stream_context_create([
    'http' => [
        'method'          => 'GET',
        'header'          => implode("\r\n", $headers),
        'timeout'         => 15,
        'follow_location' => 1,
        'ignore_errors'   => true,
    ],
    'ssl' => [
        'verify_peer'      => true,
        'verify_peer_name' => true,
    ],
]);

$response = file_get_contents($url, false, $ctx);

if ($response === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Upstream request failed']);
    exit;
}

// Relay upstream HTTP status code.
$statusLine = $http_response_header[0] ?? 'HTTP/1.1 200 OK';
if (preg_match('/HTTP\/\d\.\d\s+(\d{3})/', $statusLine, $m)) {
    http_response_code((int)$m[1]);
}

echo $response;
