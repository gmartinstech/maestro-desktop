"""One-shot CLI: print the user's provider cookie records as JSON for a domain.

Electron main spawns `python -m backend.apps.onboarding.usage.dump_cookies <domain>`
to get the session cookies to inject into its offscreen browser (real Chrome TLS to
beat Cloudflare). Kept as a spawned one-shot, not an HTTP endpoint, so a token-holding
agent can never reach it: only the trusted app shell can invoke it. Prints [] on
anything (bad domain, no session, denied keychain). Never logs the cookie values.
"""

import json
import sys

from backend.apps.onboarding.usage.browser_cookies import read_provider_cookie_records

ALLOWED_DOMAINS = {"chatgpt.com", "claude.ai", "gemini.google.com"}


def main() -> None:
    domain = sys.argv[1] if len(sys.argv) > 1 else ""
    records = read_provider_cookie_records(domain) if domain in ALLOWED_DOMAINS else []
    sys.stdout.write(json.dumps(records))


if __name__ == "__main__":
    main()
