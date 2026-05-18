"""Module entrypoint so `python -m backend.apps.instagram_mcp` works.

Spawned by OpenSwarm when an agent invokes an Instagram tool. Authentication
happens before this server starts — the backend's /credentials/instagram/*
endpoints validate the user's credentials, dump an instagrapi session to
~/.instagram_dm_mcp/sessions/<username>_session.json, and set
INSTAGRAM_USERNAME in the env that this server inherits.
"""
from backend.apps.instagram_mcp.server import main

if __name__ == "__main__":
    main()
