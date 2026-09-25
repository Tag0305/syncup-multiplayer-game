# SyncUp

Real-time social matching game for 2–8 players. SyncUp includes authoritative room creation and joining, anonymous reconnectable identities, WebSocket synchronization, a 30-second reconnection window, deterministic host transfer, and a complete five-round matching game.

## Requirements

- Node.js 20 or newer
- npm
- A Cloudflare account for deployment

## Install

```bash
npm install
```

## Test and build

```bash
npm run typecheck
npm test
npm run build
npm run build:worker
```

`npm test` runs the domain, UI, Worker, Durable Object, and WebSocket integration tests. `npm run build:worker` also performs a Wrangler dry-run validation.

## Authoritative room-code mapping

A normalized six-character code is passed to `ROOMS.idFromName(code)`. Cloudflare deterministically maps that name to one Durable Object ID. Room creation sends an atomic claim request to that object; its storage transaction succeeds only when no claim exists. A conflict makes the Worker generate another code and retry.

## Security boundary

`PrivateRoomState` contains answers, normalized values, reconnect-token hashes, and command ledgers. `toPublicSnapshot` constructs client state field-by-field. During the question phase, clients receive the question, server clock, absolute deadline, phase/event versions, public player status, and aggregate submission progress—never raw or normalized answers.

## Local multiplayer

Build the Worker once, then start the development environment:

```bash
npm run build:worker
npm run dev
```

Open `http://localhost:4173/`. Use a normal window for Player 1 and an incognito/private window for Player 2 so each has independent local session storage.

The local development runner starts an isolated Cloudflare-compatible Worker/Durable Object test runtime and a Vite UI server. API and WebSocket traffic are proxied through the same origin.

## Deploy to Cloudflare Workers

Authenticate Wrangler, build the frontend, and deploy the Worker with its static assets and Durable Object migration:

```bash
npx wrangler login
npm run build
npx wrangler deploy
```

For a separate staging Worker name:

```bash
npm run build
npx wrangler deploy --name syncup-staging
```

The deployment uses `wrangler.jsonc`, including the `ASSETS` binding, SPA fallback, `ROOMS` Durable Object binding, and SQLite Durable Object migration. Never commit `.dev.vars`, `.env` files, Wrangler local state, or access tokens.

## Current scope

The complete Phase 4 game is enabled: host-only start, five unique questions, server-authoritative 45-second answer phases, simultaneous reveal, exact normalized matching, synchronized leaderboards, tied winners, host/fallback progression, and Play Again in the same room.
