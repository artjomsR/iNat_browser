"""Static server for this repo — the bare `python -m http.server` plus the two cache
headers the update behaviour rests on. Run `python serve.py` (port 8731); `.claude/launch.json`
already does. See CLAUDE.md, "No service worker".

There is no service worker, so every update is the browser asking for a file and taking
what it is given. Two headers make that dependable:

- HTML gets `no-cache`: a page is revalidated on every navigation, so an edit shows up on
  the next reload rather than whenever the browser's heuristic freshness runs out.
- `sw.js` gets `no-cache, no-store`: it is the defuse stub, and a browser still holding
  the old shell must always look it up fresh — iOS Safari trusts the header over a
  registration's own update options.

Everything else keeps SimpleHTTPRequestHandler's ordinary Last-Modified / conditional
handling, which is what the app's own files always relied on. """

import http.server
import os

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        path = self.path.split("?", 1)[0]
        if path == "/sw.js":
            self.send_header("Cache-Control", "no-cache, no-store")
        elif path.endswith(".html") or path.endswith("/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("", 8731), Handler).serve_forever()
