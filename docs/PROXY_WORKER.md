# Upstream Proxy Worker

The gateway Worker calls a `PROXY_BASE_URL` to resolve TeraBox share pages and API responses. This repository includes a compatible upstream proxy in `proxy-worker/`.

## Files

```text
proxy-worker/
├── worker.js
└── wrangler.jsonc
```

## Local Development

```bash
npm run proxy:dev
```

Use `.dev.vars` or `.env` for cookie values:

```env
COOKIE_JSON=your_ndus_cookie_value
```

## Deploy

```bash
npm run proxy:deploy
```

Or deploy while uploading secrets from `.env`:

```bash
npm run proxy:deploy:secrets
```

Wrangler prints a URL like:

```text
https://terabox-upstream-proxy.<your-subdomain>.workers.dev
```

Set that URL as `PROXY_BASE_URL` for the gateway Worker.

## Modes

| Mode | Required parameters | Description |
| --- | --- | --- |
| `resolve` | `surl` | Fetches the share page, extracts `jsToken`, calls the share API, and returns metadata. |
| `page` | `surl` | Returns the raw share page HTML. |
| `api` | `jsToken`, `shorturl` | Calls the share API directly. |
| `stream` | `surl` | Attempts to find and rewrite an HLS playlist URL from upstream metadata. |
| `segment` | `url` | Fetches an individual media segment. |

## Examples

```bash
curl "https://your-proxy.example.workers.dev/?mode=resolve&surl=EXAMPLE"
curl "https://your-proxy.example.workers.dev/?mode=resolve&surl=EXAMPLE&raw=1"
curl "https://your-proxy.example.workers.dev/?mode=page&surl=EXAMPLE"
```

## Notes

- The proxy accepts cookies from the incoming request first, then falls back to `COOKIE_JSON`.
- `COOKIE_JSON` can be a raw `ndus` value or a JSON object.
- `stream` mode depends on whether the upstream metadata contains an HLS playlist URL.
- `segment` mode accepts HTTP and HTTPS URLs. Do not expose this Worker in environments where open proxy behavior is unacceptable.
