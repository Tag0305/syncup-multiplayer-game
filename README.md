# SyncUp

Real-time "How well do you know the host?" party game for one host and one to seven players. The host creates and locks five question-and-answer pairs. Players guess each locked answer, earning 100 points for an exact normalized match. SyncUp includes authoritative rooms, anonymous reconnectable identities, WebSocket synchronization, and a 30-second reconnection window.

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

`PrivateRoomState` contains host answers, player guesses, normalized values, reconnect-token hashes, and command ledgers. `toPublicSnapshot` constructs client state field-by-field. During the question phase, players receive the current question, server clock, absolute deadline, phase/event versions, public player status, and aggregate submission progress. They never receive the host answer, another player's guess, normalized answers, future answers, or reconnect credentials. An authenticated host-only snapshot can include setup drafts or the current locked answer.

## Local multiplayer

Build the Worker once, then start the development environment:

```bash
npm run build:worker
npm run dev
```

Open `http://localhost:4173/`. Use a normal window for the host and an incognito/private window for a player so each has independent local session storage.

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

## Current game flow

The host creates exactly five questions with secret answers, reviews them, and locks the setup. Once at least one player is connected, the host starts the game. Each round uses the next host-created question in order with a server-authoritative 45-second answer phase. The server reveals the current host answer and all guesses simultaneously, awards 100 points per exact normalized match, and publishes a competitor-only leaderboard. The host never competes and is never transferred to another player. After round five, the host can keep the room and connected players while returning everyone to a new blank setup.
