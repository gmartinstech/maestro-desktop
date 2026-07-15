"""
Shipped seed playbooks: a starting strategy memory for popular sites so a fresh
install isn't fully cold on its first task there. These are FALLBACKS, the moment
a user does a real verified run on a site, the reflective distill writes a learned
playbook that supersedes the seed (and refines it). So a wrong seed bullet can only
gently mislead a first run and is self-corrected, exactly the playbook's fail-safe.

Sourced from real observation (a read-only recon pass over the top sites) plus the
stable, documented deep-URL search patterns, NOT guessed mechanics. Host keys are
canonical (no leading 'www.'); the loader strips 'www.' before matching. Kept to
the same per-site shape and caps as a learned playbook.

Coverage note: only LinkedIn carries full task mechanics (it's the one we fully
exercised). The rest carry the high-value generalizable facts a first run wants:
the deep-URL search shortcut, whether the site is usable logged-out, and where the
primary controls live. Richer per-site mechanics accrue as users actually use them.
"""

SEED_PLAYBOOKS: dict[str, list[str]] = {
    "linkedin.com": [
        "Find people via URL: linkedin.com/search/results/people/?keywords=NAME (one nav beats driving the search UI).",
        "Open a person's profile, then click Message to open the compose box for that specific person.",
        "A 1:1 thread is titled '<Other Person> and <You>'; that IS the direct thread, do NOT start a new one.",
        "In the composer, type the message then click Send; do NOT press Enter (in the rich composer it only inserts a newline).",
    ],
    "amazon.com": [
        "Search via URL: amazon.com/s?k=QUERY (spaces become +). Browsing and reading prices/ratings work logged-out.",
        "Results are cards with a product link, price, and rating; pull them in one shot with BrowserExtract.",
    ],
    "ebay.com": [
        "Search via URL: ebay.com/sch/i.html?_nkw=QUERY. Browsing works logged-out.",
    ],
    "walmart.com": [
        "Search via URL: walmart.com/search?q=QUERY. Browsing works logged-out; it can show a press-and-hold bot check on heavy use.",
    ],
    "etsy.com": [
        "Search via URL: etsy.com/search?q=QUERY. Browsing works logged-out.",
    ],
    "target.com": [
        "Search via URL: target.com/s?searchTerm=QUERY. Browsing works logged-out.",
    ],
    "bestbuy.com": [
        "Search via URL: bestbuy.com/site/searchpage.jsp?st=QUERY. A country-select splash may appear first; pick United States.",
    ],
    "aliexpress.com": [
        "Browsing works logged-out; use the top search box rather than guessing the URL (the search path changes often).",
    ],
    "craigslist.org": [
        "Listings are per-city: go to the city subdomain first (e.g. sfbay.craigslist.org), search is local, not global.",
    ],
    "airbnb.com": [
        "Drive the homepage search (Where / check-in-out / Who) then Search; the results URL params are brittle, don't hand-build them.",
    ],
    "booking.com": [
        "Search via URL: booking.com/searchresults.html?ss=DESTINATION. Browsing works logged-out.",
    ],
    "expedia.com": [
        "Drive the homepage search widget (Where to, dates, travelers); its URL is complex, don't hand-build it.",
    ],
    "yelp.com": [
        "Search via URL: yelp.com/search?find_desc=WHAT&find_loc=WHERE. Browsing works logged-out.",
    ],
    "google.com": [
        "Web search via URL: google.com/search?q=QUERY. Maps search via URL: google.com/maps/search/PLACE.",
    ],
    "doordash.com": [
        "It gates on a delivery address up front; set the address before browsing restaurants or you'll see nothing.",
    ],
    "netflix.com": [
        "Requires sign-in to browse or play. Once logged in, search via URL: netflix.com/search?q=QUERY.",
    ],
    "spotify.com": [
        "Search via URL: open.spotify.com/search/QUERY. Reading catalog works, but playing full tracks needs a logged-in session.",
    ],
    "twitch.tv": [
        "Search via URL: twitch.tv/search?term=QUERY. A channel lives at twitch.tv/CHANNELNAME.",
    ],
    "tiktok.com": [
        "Search via URL: tiktok.com/search?q=QUERY. Heavy anti-bot, expect occasional captcha or a login prompt.",
    ],
    "pinterest.com": [
        "Search pins via URL: pinterest.com/search/pins/?q=QUERY. Most actions (save, follow) need sign-in.",
    ],
    "facebook.com": [
        "Requires sign-in. The login wall appears immediately; if you aren't signed in, use RequestHumanIntervention, do not try to log in.",
    ],
    "instagram.com": [
        "Requires sign-in. The login wall appears immediately; if you aren't signed in, use RequestHumanIntervention, do not try to log in.",
    ],
    "x.com": [
        "Most actions need sign-in. Once logged in, search via URL: x.com/search?q=QUERY (twitter.com redirects here).",
        "To post: click the composer ('What is happening?'), type, then click Post; do NOT press Enter (it inserts a newline). To reply, open the tweet and use its Reply box then the Reply button.",
    ],
    "quora.com": [
        "Search via URL: quora.com/search?q=QUERY. Reading often triggers a sign-in wall after a bit of scrolling.",
    ],
    "github.com": [
        "Search via URL: github.com/search?q=QUERY&type=repositories. Public repos, issues, and code are readable logged-out.",
    ],
    "threads.net": [
        "A login overlay sits over the feed; no composer or search is reachable until signed in.",
    ],
    "web.whatsapp.com": [
        "Needs a phone-linked session via QR. In automation it often serves a 'use a supported browser' wall, treat as not reliably automatable.",
    ],
    "web.telegram.org": [
        "Web login is QR-code or passkey; if not already logged in, use RequestHumanIntervention rather than attempting it.",
    ],
    "trello.com": [
        "The landing page is marketing; the app needs sign-in. If not signed in, use RequestHumanIntervention.",
    ],
    "figma.com": [
        "The landing page is marketing; the app needs sign-in. If not signed in, use RequestHumanIntervention.",
    ],
    "youtube.com": [
        "Search via URL: youtube.com/results?search_query=QUERY. A video is youtube.com/watch?v=ID; browsing and watching work logged-out.",
        "To comment: open the video, click the 'Add a comment...' box, type, then click Comment (needs sign-in).",
    ],
    "reddit.com": [
        "Search via URL: reddit.com/search/?q=QUERY. A subreddit is reddit.com/r/NAME; most browsing works logged-out.",
        "Posting/commenting needs sign-in and the composer is bot-gated; prefer the built-in write path (BrowserApiWrite) over driving the UI composer.",
    ],
    "wikipedia.org": [
        "Read via URL: en.wikipedia.org/wiki/TITLE (spaces become _). Search via en.wikipedia.org/w/index.php?search=QUERY. Fully readable logged-out.",
    ],
    "mail.google.com": [
        "Needs sign-in. Search via URL: mail.google.com/mail/u/0/#search/QUERY. To send: click Compose, fill To then Subject then the body, then click Send.",
    ],
    "imdb.com": [
        "A title lives at imdb.com/title/ttID. Search via URL: imdb.com/find/?q=QUERY. Readable logged-out.",
    ],
    "stackoverflow.com": [
        "Search via URL: stackoverflow.com/search?q=QUERY. Questions and answers are readable logged-out; voting/answering needs sign-in.",
    ],
    "indeed.com": [
        "Job search via URL: indeed.com/jobs?q=WHAT&l=WHERE. Browsing works logged-out; applying needs sign-in and is heavily bot-gated (expect a captcha).",
    ],
    "zillow.com": [
        "Search via URL: zillow.com/homes/CITY-STATE_rb/. Heavy anti-bot: a press-and-hold or captcha wall is common on more than a few requests.",
    ],
    "news.ycombinator.com": [
        "The front page is news.ycombinator.com; an item (post + comments) is news.ycombinator.com/item?id=ID. Fully readable logged-out; commenting/voting needs sign-in.",
    ],
    "medium.com": [
        "Articles are readable but many hit a metered paywall after a few reads; search via URL: medium.com/search?q=QUERY.",
    ],
    "notion.so": [
        "The landing page is marketing; the workspace needs sign-in. If not signed in, use RequestHumanIntervention.",
    ],
    "glassdoor.com": [
        "Heavy sign-in and anti-bot walls appear quickly; treat as often not reliably automatable, and use RequestHumanIntervention on a wall rather than fighting it.",
    ],
}


def seed_for(host: str) -> list[str]:
    """Seed bullets for a host, or []. Matches with and without a leading 'www.'."""
    h = (host or "").lower().strip()
    if not h:
        return []
    bare = h[4:] if h.startswith("www.") else h
    return SEED_PLAYBOOKS.get(h) or SEED_PLAYBOOKS.get(bare) or SEED_PLAYBOOKS.get("www." + bare) or []
