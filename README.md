# Genius Square — multiplayer web game

Live at **https://genius-square.richmorgan.co.uk** (Cloudflare Workers).

Race friends to solve [Genius Square](https://www.happypuzzle.co.uk/family-puzzles-and-games/genius-square)
boards: 7 blockers go down, first to fit the 9 pieces wins. Everyone in a
room plays the same board and watches each other's pieces land live.

## Why it beats the physical game

The official dice reach only **62,208 of the 8,347,680 possible blocker
boards (0.75%)**, and the hardest dice roll has 11 solutions. We swept the
entire space with [silkyrich/gsqsolve](https://github.com/silkyrich/gsqsolve)
(`--analyze-all`, `solution-space` branch):

| boards | count |
|---|---|
| total possible | 8,347,680 |
| unsolvable | 172,440 |
| unique solution | **800** |
| dice-reachable | 62,208 |

Difficulty modes: **classic dice**, **harder than dice** (2–10 solutions),
and **expert** (the 800 unique-solution boards — puzzles the physical game
can never produce).

## Architecture

- **`public/solver.js`** — the gsqsolve bitmask DFS ported to JS
  (~0.25 ms/solve). Runs client-side: live "still solvable?" feedback after
  every placement, hints, difficulty grading.
- **`src/worker.js`** — Worker entry: static assets, `/api/me` (identity),
  `/api/rooms` (create), `/ws/:code` (WebSocket upgrade → room).
- **`src/room.js`** — one Durable Object per room (hibernation API).
  Broadcasts every placement to all players; one connection per identity
  (device lock); shared puzzle persisted in DO storage.
- **Login** — Cloudflare Access (IdP) in front of the domain; the Worker
  reads `Cf-Access-Authenticated-User-Email`. Without Access it falls back
  to guest identities, so local dev just works.
- **`public/data/unique.json`** — the 800 unique-solution boards + sweep
  stats, generated from `gsqsolve --analyze-all`.

## Develop / deploy

```sh
npm install
npm test          # solver verified against C++ ground truth
npm run dev       # local dev server
npm run deploy    # deploy to Cloudflare (needs wrangler auth)
```

Feedback and bugs: Linear project **Genius Square Web**.
