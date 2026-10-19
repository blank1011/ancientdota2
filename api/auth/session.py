from http.server import BaseHTTPRequestHandler

from auth_utils import handle_auth_request


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.respond("GET")

    def respond(self, method):
        status, headers, body = handle_auth_request(self.path, method, self.headers)
        self.send_response(status)
        for name, value in headers.items():
            for header_value in value if isinstance(value, list) else [value]:
                self.send_header(name, header_value)
        self.end_headers()
        self.wfile.write(body)
