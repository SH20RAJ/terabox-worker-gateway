# TeraBox Worker Gateway

An open-source Cloudflare Worker API for reading TeraBox share metadata through a compatible upstream proxy service.

This repository is Worker-only. It is designed to be small, deployable with Wrangler, and easy to fork.

> This is an independent community project. It is not affiliated with, endorsed by, or sponsored by TeraBox.

## Features

- Cloudflare Worker module syntax
- `GET /api` for share metadata and proxy-mode passthrough
- `GET /api2` for metadata plus resolved direct links when available
- `GET /health` for uptime checks
- `GET /help` for runtime API hints
- Lightweight in-memory cache
- Per-IP sliding-window rate limiting
- CORS headers for browser clients
- Secret-friendly configuration through Wrangler

## Requirements

- Node.js 20 or newer
- npm
- Cloudflare account
- Wrangler, installed by this project through `npm install`
- A compatible upstream proxy URL exposed as `PROXY_BASE_URL`

## Quick Start

Install dependencies:

```bash
npm install
```

Create local development secrets:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```env
PROXY_BASE_URL=https://your-proxy-worker.example.workers.dev/
COOKIE_JSON=your_ndus_cookie_value
```

Run locally:

```bash
npm run dev
```

Validate the Worker bundle:

```bash
npm run check
```

Deploy:

```bash
npm run deploy
```

Deploy while uploading secrets from `.env`:

```bash
npm run deploy:secrets
```

## Configuration

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `PROXY_BASE_URL` | Yes | None | Base URL for a compatible upstream proxy Worker or API. |
| `COOKIE_JSON` | Recommended | None | TeraBox cookie data. Accepts a raw `ndus` value or a JSON object. |
| `TERABOX_COOKIES_JSON` | No | None | Alternative cookie JSON binding. |
| `RATE_LIMIT` | No | `30` | Max requests per IP during the rate window. |
| `RATE_WINDOW` | No | `60` | Rate limit window in seconds. |
| `CACHE_TTL` | No | `60` | In-memory cache TTL in seconds. |
| `CACHE_MAX_SIZE` | No | `500` | Maximum in-memory cache entries per Worker isolate. |

For deployed Workers, keep cookies as secrets:

```bash
npx wrangler secret put COOKIE_JSON
```

You can store non-sensitive values, such as `RATE_LIMIT`, in `wrangler.jsonc`.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | API metadata. |
| `GET` | `/health` | Health check. |
| `GET` | `/help` | Runtime API documentation. |
| `GET` | `/api?url=...` | Fetch share file metadata. |
| `GET` | `/api?mode=...` | Pass supported proxy modes to the upstream proxy. |
| `GET` | `/api2?url=...` | Fetch share metadata and attempt direct link resolution. |
| `GET` | `/v1` | Versioned metadata namespace. |
| `GET` | `/v1/health` | Versioned health check. |
| `GET` | `/v1/echo` | Debug endpoint for query and selected headers. |

More detail is available in [docs/API.md](docs/API.md).

## Project Structure

```text
.
├── src/worker.js
├── docs/
│   ├── API.md
│   └── DEPLOYMENT.md
├── .dev.vars.example
├── wrangler.jsonc
├── package.json
├── package-lock.json
├── CONTRIBUTING.md
├── SECURITY.md
└── LICENSE
```

## Development Notes

- This project intentionally does not commit `.env`, `.dev.vars`, `.wrangler`, or `node_modules`.
- `PROXY_BASE_URL` has no public default. Bring your own compatible proxy endpoint.
- In-memory cache and rate-limit state are per Worker isolate and are not durable storage.
- Use this project responsibly and comply with the terms of any third-party service you access.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening issues or pull requests.

## Security

Please do not open public issues for sensitive reports. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
