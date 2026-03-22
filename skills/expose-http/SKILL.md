---
description: Expose the local dispatch-http server to the internet via a Cloudflare quick tunnel
---

## Prerequisites

- The dispatch-http server must already be running (use the `dispatch-http` skill first)
- `cloudflared` must be installed (`brew install cloudflared` on macOS)

## Start the tunnel

```bash
cloudflared tunnel --config /dev/null --url http://localhost:${PORT:-3000} $ARGUMENTS
```

Run this in the background so the conversation can continue.

Pass a custom port if the dispatch-http server is not running on the default port 3000.

## Verify

Watch the background task output for a line like:

```
https://<random>.trycloudflare.com
```

That is the public URL. Test it:

```bash
curl -s https://<random>.trycloudflare.com/health
```

Expect `{"ok":true}`.

## Gotchas

- The public URL changes on every restart.
- Anyone with the URL can access the API. Set the `API_KEY` env var on the dispatch-http server to require Bearer token auth.
- Cloudflare quick tunnels are meant for development and testing, not production.
