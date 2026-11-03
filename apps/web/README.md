# Resource Hub: Next.js front end

The front-end half of a two-repo headless WordPress demo, written fresh as a demonstration of the pattern. It is a Next.js 16 App Router app in TypeScript that will render a resources library from the WordPress REST API and rebuild pages on demand when the CMS says so. The CMS half (the WordPress plugin and wp-env) lives in a sibling repo, `resource-hub-wp`.

This is a demo of a pattern, not production code.

## Running it

Requires Node 24 and pnpm (the version is pinned in `package.json`).

```bash
pnpm install
cp .env.example .env.local   # fill in WP_API_URL and REVALIDATE_SECRET
pnpm dev                     # http://localhost:3000
```

Checks:

```bash
pnpm typecheck   # next typegen && tsc --noEmit
pnpm lint        # eslint
pnpm build       # next build
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `WP_API_URL` | Base URL of the CMS's REST API (`/wp-json`). Locally, wp-env serves it at `http://localhost:8888/wp-json`. |
| `REVALIDATE_SECRET` | Shared secret the CMS sends as a bearer token to `POST /api/revalidate`. |

Both live in `.env.local` (gitignored) and in Vercel project settings, never in git.

## Status

Scaffold only. The resources pages, data layer, revalidation route, tests, CI, architecture diagram, and decision records (`docs/adr/`) are coming in later pull requests. See `CLAUDE.md` for the project brief and the contract with the CMS.
