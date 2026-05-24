# Security Policy

## Supported Versions

The `main` branch is the supported development line.

## Reporting A Vulnerability

Please report sensitive issues privately to the repository owner through GitHub security advisories or another private channel provided by the maintainer.

Do not include live cookies, account tokens, or private share links in public issues.

## Secrets

This project may use TeraBox cookies through `COOKIE_JSON`.

- Store cookies with `wrangler secret put COOKIE_JSON`.
- Use `.dev.vars` only for local development.
- Never commit `.env`, `.dev.vars`, Wrangler state, or screenshots containing tokens.

## Responsible Use

This project is intended for lawful, authorized use. Follow the terms of any third-party service you connect to or proxy through.
