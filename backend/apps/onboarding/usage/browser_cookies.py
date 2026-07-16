"""Read the user's own logged-in provider cookies from their real browser, so
onboarding can harvest their actual chat history at first run without an in-app login.

macOS + Chromium only for now (Chrome/Arc/Brave/Edge). We first find WHICH store holds
the session by counting cookie names in the SQLite (no decryption, no keychain), then
decrypt only that one store, so the "Safe Storage" keychain is touched at most once per
browser (cached for the process). Values are v10/v11 AES-CBC. Fails open to {} on
anything (no browser, app-bound v20 cookies, denied keychain, Safari-only user), so
prep just falls back to the local scan.

Only ever reads the specific provider domain asked for; never a general cookie sweep.
The values are session secrets: used in-process for the harvest, never logged or stored.
"""

import hashlib
import os
import shutil
import sqlite3
import subprocess
import tempfile
from typing import Dict, List, Optional, Tuple

from typeguard import typechecked

CHROMIUM_ROOTS = {
    "Chrome": "Library/Application Support/Google/Chrome",
    "Arc": "Library/Application Support/Arc/User Data",
    "Brave": "Library/Application Support/BraveSoftware/Brave-Browser",
    "Edge": "Library/Application Support/Microsoft Edge",
}
KEYCHAIN_SERVICE = {
    "Chrome": "Chrome Safe Storage",
    "Arc": "Arc Safe Storage",
    "Brave": "Brave Safe Storage",
    "Edge": "Microsoft Edge Safe Storage",
}
PROFILES = ["Default"] + [f"Profile {i}" for i in range(1, 12)]

# One keychain read per browser per process; "Always Allow" then never re-prompts.
p_key_cache: Dict[str, Optional[bytes]] = {}


@typechecked
def p_safe_storage_key(browser: str) -> Optional[bytes]:
    if browser in p_key_cache:
        return p_key_cache[browser]
    key: Optional[bytes] = None
    try:
        r = subprocess.run(
            ["security", "find-generic-password", "-w", "-s", KEYCHAIN_SERVICE[browser]],
            capture_output=True, text=True, timeout=20,
        )
        pw = r.stdout.strip()
        if pw:
            key = hashlib.pbkdf2_hmac("sha1", pw.encode(), b"saltysalt", 1003, 16)
    except Exception:
        key = None
    p_key_cache[browser] = key
    return key


@typechecked
def p_count_domain(db_path: str, domain: str) -> int:
    tmp = tempfile.mktemp()
    try:
        shutil.copy2(db_path, tmp)
        con = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
        cur = con.cursor()
        cur.execute("SELECT count(*) FROM cookies WHERE host_key LIKE ?", (f"%{domain}",))
        n = int(cur.fetchone()[0])
        con.close()
        return n
    except Exception:
        return 0
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


@typechecked
def p_best_store(domain: str) -> Optional[Tuple[str, str]]:
    """The (browser, db_path) holding the most cookies for `domain`, found WITHOUT the keychain."""
    home = os.path.expanduser("~")
    best: Optional[Tuple[str, str]] = None
    best_score = (0, -1.0)
    for browser, rel in CHROMIUM_ROOTS.items():
        base = os.path.join(home, rel)
        if not os.path.isdir(base):
            continue
        for prof in PROFILES:
            for sub in ("Cookies", "Network/Cookies"):
                path = os.path.join(base, prof, sub)
                if not os.path.isfile(path):
                    continue
                n = p_count_domain(path, domain)
                if n:
                    score = (n, os.path.getmtime(path))
                    if score > best_score:
                        best, best_score = (browser, path), score
    return best


@typechecked
def p_decrypt(enc: bytes, key: bytes) -> Optional[str]:
    if enc[:3] not in (b"v10", b"v11"):
        return None  # v20 = app-bound encryption, out of reach without the browser
    try:
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

        c = Cipher(algorithms.AES(key), modes.CBC(b" " * 16), backend=default_backend())
        d = c.decryptor()
        dec = d.update(enc[3:]) + d.finalize()
        dec = dec[: -dec[-1]]  # strip PKCS7 padding
        for cut in (0, 32):  # newer Chromium prepends a 32-byte domain hash
            try:
                return dec[cut:].decode("utf-8")
            except UnicodeDecodeError:
                continue
    except Exception:
        return None
    return None


@typechecked
def read_provider_cookies(domain: str) -> Dict[str, str]:
    """Decrypted cookie jar for `domain`, from whichever browser store actually has the session. At most one keychain touch (that store's browser), cached for the process."""
    store = p_best_store(domain)
    if store is None:
        return {}
    browser, db_path = store
    key = p_safe_storage_key(browser)
    if key is None:
        return {}
    jar: Dict[str, str] = {}
    tmp = tempfile.mktemp()
    try:
        shutil.copy2(db_path, tmp)
        con = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
        cur = con.cursor()
        cur.execute("SELECT name, encrypted_value FROM cookies WHERE host_key LIKE ?", (f"%{domain}",))
        for name, enc in cur.fetchall():
            if not enc:
                continue
            val = p_decrypt(bytes(enc), key)
            if val:
                jar[str(name)] = val
        con.close()
    except Exception:
        pass
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    return jar


@typechecked
def cookie_header(jar: Dict[str, str]) -> str:
    return "; ".join(f"{k}={v}" for k, v in jar.items())


@typechecked
def logged_in_providers() -> List[str]:
    """Which providers have a readable session, WITHOUT decrypting or touching the keychain: safe for a UI presence check."""
    out: List[str] = []
    for provider, domain in (("codex", "chatgpt.com"), ("claude", "claude.ai"), ("gemini", "gemini.google.com")):
        if p_best_store(domain) is not None:
            out.append(provider)
    return out
