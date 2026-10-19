import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from auth_utils import handle_auth_request


HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8000"))
BASE_URL = f"http://{HOST}:{PORT}"
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}")

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/api/auth/"):
            self._respond_auth("GET")
            return
        if path.startswith("/auth/"):
            self.send_error(404)
            return
        if path not in {"/", "/index.html", "/styles.css", "/app.js"}:
            self.send_error(404)
            return
        if path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/auth/logout":
            self.send_error(404)
            return
        self._respond_auth("POST")

    def _respond_auth(self, method):
        status, headers, body = handle_auth_request(self.path, method, self.headers)
        self.send_response(status)
        for name, value in headers.items():
            for header_value in value if isinstance(value, list) else [value]:
                self.send_header(name, header_value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print(f"Ancient is running at {BASE_URL}")
    print("Sign in with Steam to load your OpenDota profile.")
    ThreadingHTTPServer((HOST, PORT), AppHandler).serve_forever()
