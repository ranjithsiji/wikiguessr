<?php
// Cache static assets for 1 hour; the HTML itself no-cache so game.js updates propagate.
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
readfile(__DIR__ . '/index.html');
