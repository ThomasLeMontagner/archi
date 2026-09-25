"""Read-only, loopback-only explorer host (UX-01/02/03/05, CLI-01).

Serve a fixed asset allowlist and an immutable analysis snapshot. Repository
files are never exposed through an HTTP filesystem handler.
"""

import errno
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
import json
from pathlib import Path
from urllib.parse import urlsplit
import webbrowser

from archi import __version__
from archi.model import Graph

DEFAULT_PORT = 8765
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/app.css": ("app.css", "text/css; charset=utf-8"),
    "/app.js.LEGAL.txt": ("app.js.LEGAL.txt", "text/plain; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
}


def create_server(root: Path, graph: Graph, port: int = DEFAULT_PORT,
                  analysis_seconds: float = 0.0) -> ThreadingHTTPServer:
    if not 0 <= port <= 65535:
        raise ValueError("Port must be between 0 and 65535 (0 selects a free port)")
    assets = {}
    for route, (filename, content_type) in ASSETS.items():
        try:
            assets[route] = (files("archi").joinpath("static", filename).read_bytes(), content_type)
        except FileNotFoundError as exc:
            raise ValueError("Explorer assets are missing; reinstall the wheel or run 'npm run build' in ui/") from exc
    assets["/api/graph"] = (graph.to_json().encode("utf-8"), "application/json; charset=utf-8")
    assets["/api/project"] = (json.dumps({
        "name": root.name, "root": str(root.resolve()), "version": __version__,
        "analysis_seconds": round(analysis_seconds, 6),
    }).encode("utf-8"), "application/json; charset=utf-8")

    class Handler(BaseHTTPRequestHandler):
        server_version = "Archi"
        sys_version = ""

        def log_message(self, *args) -> None:
            pass

        def do_HEAD(self) -> None:
            self.do_GET()

        def do_GET(self) -> None:
            expected = f"127.0.0.1:{self.server.server_port}"
            host = self.headers.get("Host")
            origin = self.headers.get("Origin")
            if host != expected or (origin is not None and origin != f"http://{expected}"):
                self._respond(403, b"This explorer accepts only same-origin loopback requests.\n", "text/plain")
                return
            path = urlsplit(self.path).path
            item = assets.get(path)
            if item is None:
                self._respond(404, b"Not found\n", "text/plain")
                return
            body, content_type = item
            self._respond(200, body, content_type)

        def _respond(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; "
                             "style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; "
                             "font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
            self.end_headers()
            if self.command != "HEAD":
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

    try:
        return ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as exc:
        if exc.errno != errno.EADDRINUSE or port == 0:
            raise
        return ThreadingHTTPServer(("127.0.0.1", 0), Handler)


def serve(root: Path, graph: Graph, *, port: int = DEFAULT_PORT,
          open_browser: bool = True, analysis_seconds: float = 0.0) -> int:
    with create_server(root, graph, port, analysis_seconds) as server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(f"Archi explorer: {url}", flush=True)
        print(f"Repository: {root.resolve()}", flush=True)
        if port and port != server.server_port:
            print(f"Port {port} is occupied; selected free port {server.server_port}.", flush=True)
        if not graph.complete:
            print("Analysis incomplete; valid results and issues are available in the explorer.", flush=True)
        print("Press Ctrl+C to stop.", flush=True)
        if open_browser:
            try:
                opened = webbrowser.open(url)
            except webbrowser.Error:
                opened = False
            if not opened:
                print("Could not open a browser automatically; open the URL above.", flush=True)
        try:
            server.serve_forever(poll_interval=0.2)
        except KeyboardInterrupt:
            print("\nExplorer stopped.", flush=True)
    return 0
