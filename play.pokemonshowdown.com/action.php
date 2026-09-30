<?php

/**
 * Same-origin login proxy.
 *
 * The client always POSTs here. This forwards that request, unchanged, to
 * the official Pokémon Showdown login server and passes the session cookie
 * back so the browser can stay logged in.
 */

header('Content-Type: text/plain; charset=utf-8');

$server = $_GET['serverid'] ?? 'showdown';
if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9:._-]*$/', $server)) {
	http_response_code(400);
	echo 'invalid server';
	exit;
}

$target = 'https://play.pokemonshowdown.com/~~' . rawurlencode($server) . '/action.php';
$body = file_get_contents('php://input');
if ($body === false || $body === '') {
	$body = http_build_query($_POST);
}

$requestHeaders = ['Content-Type: application/x-www-form-urlencoded'];
if (!empty($_SERVER['HTTP_COOKIE'])) {
	$requestHeaders[] = 'Cookie: ' . $_SERVER['HTTP_COOKIE'];
}

if (!function_exists('curl_init')) {
	http_response_code(500);
	echo 'PHP cURL is required for the login proxy';
	exit;
}

$ch = curl_init($target);
curl_setopt_array($ch, [
	CURLOPT_POST => true,
	CURLOPT_POSTFIELDS => $body,
	CURLOPT_RETURNTRANSFER => true,
	CURLOPT_HEADER => true,
	CURLOPT_FOLLOWLOCATION => false,
	CURLOPT_HTTPHEADER => $requestHeaders,
	CURLOPT_TIMEOUT => 20,
]);
$raw = curl_exec($ch);
if ($raw === false) {
	curl_close($ch);
	http_response_code(502);
	echo 'login server unavailable';
	exit;
}
$status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);

$rawHeaders = substr($raw, 0, $headerSize);
$responseBody = substr($raw, $headerSize);
foreach (preg_split("/\r\n|\n|\r/", $rawHeaders) as $headerLine) {
	if (stripos($headerLine, 'Set-Cookie:') !== 0) continue;
	$cookie = trim(substr($headerLine, strlen('Set-Cookie:')));
	// The official cookie is scoped to play.pokemonshowdown.com and is often
	// SameSite=None; Secure. Browsers drop that on this site, so a refresh
	// no longer has a session and asks for the password again.
	$cookie = preg_replace('/;\s*Domain=[^;]*/i', '', $cookie);
	$cookie = preg_replace('/;\s*SameSite=[^;]*/i', '', $cookie);
	if (empty($_SERVER['HTTPS']) || $_SERVER['HTTPS'] === 'off') {
		$cookie = preg_replace('/;\s*Secure/i', '', $cookie);
	}
	$cookie .= '; SameSite=Lax';
	header('Set-Cookie: ' . $cookie, false);
}

http_response_code($status > 0 ? $status : 200);
echo $responseBody;
