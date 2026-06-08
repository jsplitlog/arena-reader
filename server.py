#!/usr/bin/env python3
"""Tiny dev server — static files + writable filters.json."""
import json, os, sys
from http.server import SimpleHTTPRequestHandler, HTTPServer
from pathlib import Path

os.chdir(Path(__file__).resolve().parent)

class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/filters.json':
            length = int(self.headers.get('Content-Length', 0))
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
    print(f'http://localhost:{port}')
    HTTPServer(('', port), Handler).serve_forever()
