# Deployment Guide

This project deploys as a Cloudflare Worker with Wrangler.

## 1. Install Dependencies

```bash
npm install
```

## 2. Configure Wrangler

Update `wrangler.jsonc` if you want to change the Worker name:

```jsonc
{
  "name": "terabox-worker-gateway",
  "main": "src/worker.js",
  "compatibility_date": "2026-05-24"
}
```

Non-sensitive values can live in `wrangler.jsonc` under `vars`.

## 3. Configure Secrets

Set required runtime values:

```bash
npx wrangler secret put PROXY_BASE_URL
npx wrangler secret put COOKIE_JSON
```

`PROXY_BASE_URL` can be a plain var if the URL is public and not sensitive. `COOKIE_JSON` should be a secret.

For one-shot deploys from a local env file:

```bash
npm run deploy:secrets
```

The env file should look like:

```env
PROXY_BASE_URL=https://your-proxy-worker.example.workers.dev/
COOKIE_JSON=your_ndus_cookie_value
```

## 4. Validate

```bash
npm run check
```

## 5. Deploy

```bash
npm run deploy
```

Wrangler prints the deployed `workers.dev` URL and version ID.

## 6. Smoke Test

```bash
curl https://your-worker.example.workers.dev/health
curl "https://your-worker.example.workers.dev/api"
```

The second command should return a validation error for the missing `url` or `mode` parameter. That confirms the route is live.

## Notes

- Cloudflare Worker secrets are not committed to git.
- `.dev.vars` is only for local `wrangler dev`.
- In-memory cache and rate-limit state reset when an isolate is evicted.
- Use Cloudflare KV, Durable Objects, or D1 if you need durable shared state later.
