<?php

/**
 * Login-server proxy for self-hosted clients.
 *
 * The official login server lives on play.pokemonshowdown.com. Self-hosted
 * clients forward /~~serverid/action.php requests here so browsers can log
 * in without cross-origin restrictions.
 */

header('Content-Type: text/plain; charset=utf-8');

$server = $_GET['serverid'] ?? $_GET['server'] ?? 'showdown';
if (!preg_match('/^[\w][\w:.\-]*$/', $server)) {
	http_response_code(400);
	die('invalid server');
}

$target = 'https://play.pokemonshowdown.com/~~' . rawurlencode($server) . '/action.php';
$post = http_build_query($_POST);

if (function_exists('curl_init')) {
	$ch = curl_init($target);
	curl_setopt_array($ch, [
		CURLOPT_POST => true,
		CURLOPT_POSTFIELDS => $post,
		CURLOPT_RETURNTRANSFER => true,
		CURLOPT_FOLLOWLOCATION => true,
		CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
	]);
	$response = curl_exec($ch);
	$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
	curl_close($ch);
	if ($response === false) {
		http_response_code(502);
		die('proxy error');
	}
	http_response_code($code ?: 200);
	echo $response;
} else {
	$context = stream_context_create([
		'http' => [
			'method' => 'POST',
			'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
			'content' => $post,
			'ignore_errors' => true,
		],
	]);
	$response = file_get_contents($target, false, $context);
	if ($response === false) {
		http_response_code(502);
		die('proxy error');
	}
	echo $response;
}
