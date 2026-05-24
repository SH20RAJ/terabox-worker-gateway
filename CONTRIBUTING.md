# Contributing

Thanks for helping improve TeraBox Worker Gateway.

## Ground Rules

- Keep the repository Worker-only.
- Do not commit secrets, cookies, generated cache folders, or local Wrangler state.
- Do not add personal upstream proxy URLs as defaults.
- Keep dependencies minimal.
- Prefer small pull requests with focused changes.

## Local Setup

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Before opening a pull request:

```bash
node --check src/worker.js
npm run check
```

## Issues

When filing a bug, include:

- Expected behavior
- Actual behavior
- Endpoint and query shape, with private tokens removed
- Worker logs or Wrangler output when useful
- Your Wrangler version

## Pull Requests

Good pull requests include:

- A clear description of what changed
- Why the change is useful
- Any configuration or deployment impact
- Validation commands you ran

## Security Reports

Do not disclose secrets, cookies, or exploitable behavior in a public issue. Follow [SECURITY.md](SECURITY.md).
