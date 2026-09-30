#!/usr/bin/env node
/**
 * Local stand-in for the hosted client.
 *
 * Serves play.pokemonshowdown.com, forwards login to the official server,
 * and returns the client HTML for room URLs such as /lobby so a refresh works.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../play.pokemonshowdown.com');
const indexFile = path.join(root, 'caches/index-new.html');
const port = Number(process.env.PORT) || 8766;
const types = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.json': 'application/json',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
};

function rewriteCookie(cookie) {
	return cookie
		.replace(/;\s*Domain=[^;]*/ig, '')
		.replace(/;\s*SameSite=[^;]*/ig, '')
		.replace(/;\s*Secure/ig, '') + '; SameSite=Lax';
}

function serveFile(res, file) {
	fs.readFile(file, (err, data) => {
		if (err) {
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			res.end('missing');
			return;
		}
		res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
		res.end(data);
	});
}

const server = http.createServer((req, res) => {
	const url = new URL(req.url, 'http://127.0.0.1');
	if (req.method === 'POST' && url.pathname === '/action.php') {
		const chunks = [];
		req.on('data', chunk => chunks.push(chunk));
		req.on('end', () => {
			const body = Buffer.concat(chunks);
			const serverId = url.searchParams.get('serverid') || 'showdown';
			const headers = {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Content-Length': body.length,
			};
			if (req.headers.cookie) headers.Cookie = req.headers.cookie;
			const upstream = https.request({
				hostname: 'play.pokemonshowdown.com',
				path: '/~~' + encodeURIComponent(serverId) + '/action.php',
				method: 'POST',
				headers,
			}, upstreamRes => {
				const cookies = upstreamRes.headers['set-cookie'];
				const out = { 'Content-Type': 'text/plain; charset=utf-8' };
				if (cookies) out['Set-Cookie'] = cookies.map(rewriteCookie);
				res.writeHead(upstreamRes.statusCode || 200, out);
				upstreamRes.pipe(res);
			});
			upstream.on('error', error => {
				res.writeHead(502, { 'Content-Type': 'text/plain' });
				res.end(String(error));
			});
			upstream.end(body);
		});
		return;
	}

	const pathname = decodeURIComponent(url.pathname);
	const file = pathname === '/' ? indexFile : path.join(root, pathname);
	if (!file.startsWith(root)) {
		res.writeHead(403);
		res.end();
		return;
	}
	fs.stat(file, (err, stat) => {
		if (!err && stat.isFile()) {
			serveFile(res, file);
			return;
		}
		// Room links (/lobby, /battles, /view-...) are client routes, not files.
		if (!path.extname(pathname)) {
			serveFile(res, indexFile);
			return;
		}
		res.writeHead(404, { 'Content-Type': 'text/plain' });
		res.end('missing');
	});
});

server.listen(port, () => {
	console.log(`http://127.0.0.1:${port}/`);
});
