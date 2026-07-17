#!/usr/bin/env python3
"""Tiny dev server — static files + writable filters.json."""
import json, os, sys
from http.server import SimpleHTTPRequestHandler, HTTPServer
from pathlib import Path

os.chdir(Path(__file__).resolve().parent)

class Handler(SimpleHTTPRequestHandler):
    MAX_BODY = 1_000_000  # filters.json is tiny; cap writes from the network

    def do_POST(self):
        if self.path == '/filters.json':
            try:
                length = int(self.headers.get('Content-Length', 0))
            except ValueError:
                self.send_error(400, 'Invalid Content-Length')
                return
            if length < 0:
                # A negative length would make rfile.read(-1) block until the
                # client closes the connection.
                self.send_error(400, 'Invalid Content-Length')
                return
            if length > self.MAX_BODY:
                self.send_error(413, 'Payload too large')
                return
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_error(400, 'Invalid JSON')
                return
            Path('filters.json').write_text(json.dumps(data, indent=2) + '\n')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        else:
            self.send_error(404)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 0)) or (int(sys.argv[1]) if len(sys.argv) > 1 else 8000)
    # Loopback only — the filters endpoint is an unauthenticated write, so it
    # must not be reachable from the LAN. Set HOST to opt out deliberately.
    host = os.environ.get('HOST', '127.0.0.1')
    print(f'http://127.0.0.1:{port}')
    HTTPServer((host, port), Handler).serve_forever()
