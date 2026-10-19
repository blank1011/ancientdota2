import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from http.cookies import SimpleCookie
from urllib.error import URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen


STEAM_OPENID = "https://steamcommunity.com/openid/login"
STATE_COOKIE = "ancient_state"
SESSION_COOKIE = "ancient_session"
STATE_MAX_AGE = 900
SESSION_MAX_AGE = 86400
_LOCAL_SECRET = secrets.token_bytes(48)


def _base_url(headers):
    configured_url = os.environ.get("APP_URL")
    if configured_url:
        parsed = urlparse(configured_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path not in {"", "/"} or parsed.params or parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError("APP_URL must contain only the site's origin, such as https://ancientdota2.vercel.app")
        if os.environ.get("VERCEL") and parsed.scheme != "https":
            raise ValueError("APP_URL must use HTTPS on Vercel")
        return configured_url.rstrip("/")

    if os.environ.get("VERCEL"):
        host = headers.get("x-forwarded-host") or headers.get("host", "")
        if not re.fullmatch(r"[a-zA-Z0-9.-]+\.vercel\.app", host):
            raise ValueError("Set APP_URL to your public HTTPS deployment URL")
        return f"https://{host.lower()}"

    port = os.environ.get("PORT", "8000")
    return f"http://127.0.0.1:{port}"


def _secret():
    value = os.environ.get("SESSION_SECRET")
    if value:
        if len(value.encode("utf-8")) < 32:
            raise ValueError("SESSION_SECRET must contain at least 32 bytes")
        return value.encode("utf-8")
    if os.environ.get("VERCEL"):
        raise ValueError("SESSION_SECRET is required in the Vercel environment")
    return _LOCAL_SECRET


def _encode_token(payload):
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")).rstrip(b"=")
    signature = hmac.new(_secret(), body, hashlib.sha256).digest()
    return f"{body.decode('ascii')}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode('ascii')}"


def _decode_token(token, max_age):
    try:
        body_text, signature_text = token.split(".", 1)
        body = body_text.encode("ascii")
        signature = base64.urlsafe_b64decode(signature_text + "=" * (-len(signature_text) % 4))
        expected = hmac.new(_secret(), body, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(base64.urlsafe_b64decode(body + b"=" * (-len(body) % 4)))
        issued = payload.get("iat")
        if not isinstance(issued, int) or issued > time.time() + 60 or time.time() - issued > max_age:
            return None
        return payload
    except (ValueError, TypeError, UnicodeError, json.JSONDecodeError):
        return None


def _cookie_value(headers, name):
    cookie = SimpleCookie(headers.get("Cookie", ""))
    morsel = cookie.get(name)
    return morsel.value if morsel else None


def _set_cookie(name, value, max_age, secure):
    cookie = f"{name}={value}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}"
    return f"{cookie}; Secure" if secure else cookie


def _clear_cookie(name, secure):
    return _set_cookie(name, "", 0, secure)


def _json_response(status, payload):
    return status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    }, json.dumps(payload).encode("utf-8")


def _redirect(location, cookies=()):
    headers = {"Location": location, "Cache-Control": "no-store"}
    if cookies:
        headers["Set-Cookie"] = list(cookies)
    return 302, headers, b""


def _error_redirect(reason, secure):
    return _redirect(f"/?error={reason}", (_clear_cookie(STATE_COOKIE, secure),))


def _handle_login(headers, base_url, secure):
    callback_url = f"{base_url}/api/auth/callback"
    state = _encode_token({"iat": int(time.time()), "nonce": secrets.token_urlsafe(24), "base_url": base_url})
    params = {
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.return_to": callback_url,
        "openid.realm": f"{base_url}/",
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    }
    return _redirect(f"{STEAM_OPENID}?{urlencode(params)}", (_set_cookie(STATE_COOKIE, state, STATE_MAX_AGE, secure),))


def _handle_callback(path, headers, base_url, secure):
    state_token = _cookie_value(headers, STATE_COOKIE)
    state = _decode_token(state_token, STATE_MAX_AGE) if state_token else None
    if not state or state.get("base_url") != base_url:
        return _error_redirect("steam", secure)

    params = parse_qs(urlparse(path).query, keep_blank_values=True)
    fields = {key: values[0] for key, values in params.items() if values}
    claimed_id = fields.get("openid.claimed_id", "")
    identity = fields.get("openid.identity", "")
    account_match = re.fullmatch(r"https://steamcommunity\.com/openid/id/(\d{17})", claimed_id)
    callback_url = f"{base_url}/api/auth/callback"
    if (
        fields.get("openid.mode") != "id_res"
        or fields.get("openid.return_to") != callback_url
        or fields.get("openid.op_endpoint") != STEAM_OPENID
        or identity != claimed_id
        or not account_match
    ):
        return _error_redirect("steam", secure)

    fields["openid.mode"] = "check_authentication"
    request = Request(
        STEAM_OPENID,
        data=urlencode(fields).encode("ascii"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            verification = response.read(4096).decode("utf-8", "replace")
    except (URLError, TimeoutError, OSError) as error:
        print(f"Steam OpenID verification failed: {error}")
        return _error_redirect("steam", secure)
    if "is_valid:true" not in verification.splitlines():
        return _error_redirect("steam", secure)

    account_id = str(int(account_match.group(1)) - 76561197960265728)
    session = _encode_token({"iat": int(time.time()), "account_id": account_id})
    cookies = (
        _clear_cookie(STATE_COOKIE, secure),
        _set_cookie(SESSION_COOKIE, session, SESSION_MAX_AGE, secure),
    )
    return _redirect("/", cookies)


def handle_auth_request(path, method, headers):
    route = urlparse(path).path
    base_url = _base_url(headers)
    secure = base_url.startswith("https://")

    if route == "/api/auth/session" and method == "GET":
        session_token = _cookie_value(headers, SESSION_COOKIE)
        session = _decode_token(session_token, SESSION_MAX_AGE) if session_token else None
        return _json_response(200, {"account_id": session.get("account_id") if session else None})
    if route == "/api/auth/login" and method == "GET":
        return _handle_login(headers, base_url, secure)
    if route == "/api/auth/callback" and method == "GET":
        return _handle_callback(path, headers, base_url, secure)
    if route == "/api/auth/logout" and method == "POST":
        return 200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Set-Cookie": _clear_cookie(SESSION_COOKIE, secure),
        }, json.dumps({"ok": True}).encode("utf-8")
    if route.startswith("/api/auth/"):
        return _json_response(404, {"error": "Not found"})
    return _json_response(405, {"error": "Method not allowed"})
