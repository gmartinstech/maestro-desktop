"""Write operations: the things a logged-in human does on Reddit.

Posts, comments, edits, deletes, votes, saves, subscriptions, and DMs, all via
the user's own session. Each call goes through the rate limiter's write buckets.
"""

from backend.apps.reddit_mcp_shim.reddit_http import RedditError, api


def p_check(resp: dict) -> dict:
    """Raise on Reddit's json.errors envelope; return the inner data otherwise."""
    j = (resp or {}).get("json", resp or {})
    errors = j.get("errors") if isinstance(j, dict) else None
    if errors:
        raise RedditError("; ".join(" ".join(str(p) for p in e) for e in errors))
    return j.get("data", {}) if isinstance(j, dict) else {}


def p_dir(direction: str) -> int:
    return {"up": 1, "upvote": 1, "down": -1, "downvote": -1, "clear": 0, "none": 0, "unvote": 0}.get(
        (direction or "").lower(), 0
    )


def submit(subreddit: str, title: str, kind: str, text: str, url: str, nsfw: bool, spoiler: bool, send_replies: bool) -> dict:
    form = {
        "sr": subreddit,
        "title": title,
        "kind": "self" if kind != "link" else "link",
        "nsfw": "true" if nsfw else "false",
        "spoiler": "true" if spoiler else "false",
        "sendreplies": "true" if send_replies else "false",
        "resubmit": "true",
        "api_type": "json",
    }
    form["url" if kind == "link" else "text"] = url if kind == "link" else text
    data = p_check(api("POST", "/api/submit", form=form, action="submit"))
    return {"id": data.get("name") or data.get("id"), "url": data.get("url")}


def comment(parent_id: str, text: str) -> dict:
    data = p_check(api("POST", "/api/comment", form={"thing_id": parent_id, "text": text, "api_type": "json"}, action="comment"))
    things = data.get("things", [])
    new = things[0].get("data", {}) if things else {}
    return {"id": new.get("name"), "permalink": new.get("permalink")}


def edit(thing_id: str, text: str) -> dict:
    data = p_check(api("POST", "/api/editusertext", form={"thing_id": thing_id, "text": text, "api_type": "json"}, action="comment"))
    things = data.get("things", [])
    new = things[0].get("data", {}) if things else {}
    return {"id": new.get("name") or thing_id, "edited": True}


def delete(thing_id: str) -> dict:
    api("POST", "/api/del", form={"id": thing_id}, action="save")
    return {"id": thing_id, "deleted": True}


def vote(thing_id: str, direction: str) -> dict:
    d = p_dir(direction)
    api("POST", "/api/vote", form={"id": thing_id, "dir": d}, action="vote")
    return {"id": thing_id, "dir": d}


def save(thing_id: str, unsave: bool) -> dict:
    api("POST", "/api/unsave" if unsave else "/api/save", form={"id": thing_id}, action="save")
    return {"id": thing_id, "saved": not unsave}


def subscribe(subreddit: str, unsubscribe: bool) -> dict:
    api("POST", "/api/subscribe", form={"sr_name": subreddit, "action": "unsub" if unsubscribe else "sub"}, action="subscribe")
    return {"subreddit": subreddit, "subscribed": not unsubscribe}


def compose(to: str, subject: str, text: str) -> dict:
    p_check(api("POST", "/api/compose", form={"to": to, "subject": subject, "text": text, "api_type": "json"}, action="compose"))
    return {"to": to, "sent": True}
