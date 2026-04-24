# OnlyFriends

Find the fairest place for a group to meet, then make the decision funny enough to share.

OnlyFriends is a GrabMaps-powered proof of concept for planning meetups from real locations, real travel modes, and real route ETAs. Instead of using a naive geometric midpoint, it ranks venues by how painful the trip is for each person.

## Why This Exists

Group plans usually fail for one very human reason: someone gets sacrificed by distance.

Most meetup tools ask, “What is central?” OnlyFriends asks a better question:

> Where can everyone arrive with the least drama?

That means the app looks at actual road/path routing, different travel modes, traffic-adjusted ETAs, and walking pain. A 20-minute walk is not treated the same as a 20-minute drive.

## What It Does

- Adds a crew with individual origins and travel modes.
- Searches origins with live GrabMaps place search.
- Supports drop-pin origin selection with reverse geocoding.
- Lets the group choose a venue vibe like Coffee Date, Sweet Tooth, Touch Grass, or After Hours.
- Uses GrabMaps routing to calculate traffic-adjusted ETA from each friend to each venue.
- Ranks Hot Picks by fairness, arrival time, proximity, intent fit, and mode-aware pain.
- Shows map routes, pins, fairness ring, venue cards, route bars, traffic-light counts, and a playful Fairness Court verdict.
- Supports a local Telegram bot for planning from chat.

## The Hackathon Hook

OnlyFriends is not just “find nearby places.” The unique bit is the social fairness engine.

Standout pieces:

- **Fairness over geometry:** The chosen place is based on route ETAs, not latitude/longitude midpoint.
- **Mode-aware scoring:** Walking is penalized harder than driving/cycling when routes become painful.
- **Traffic-adjusted language:** GrabMaps route durations are surfaced as traffic-adjusted ETAs.
- **Intent-aware discovery:** “quiet cheap cafe” changes candidate discovery, not just UI copy.
- **Sweet Tooth guardrails:** Dessert mode filters for dessert-like places instead of generic shops.
- **Fairness Court:** The app explains the verdict and lightly roasts the friend causing the most travel chaos.
- **Chat-native planning:** Telegram commands let a group build and rank a meetup without opening the web UI first.

## GrabMaps Usage

This project uses live GrabMaps data. No mocked venue or route data is used for ranking.

- **Map rendering:** `grabmaps.es.js` with GrabMaps style/tiles.
- **Keyword search:** origin search and venue intent search.
- **Nearby search:** local candidate discovery around the fair center.
- **Reverse geocode:** drop-pin origin selection.
- **Directions/routing:** per-friend route geometry, distance, traffic-adjusted duration, traffic lights, and mode-specific routes.

Supported route modes in the UI:

- `car` maps to GrabMaps `driving`
- `bike` maps to GrabMaps `cycling`
- `walk` maps to GrabMaps `walking`

## Venue Vibes

| UI vibe | Backend category | GrabMaps keyword |
|---|---|---|
| Coffee Date | `cafe` | `cafe coffee` |
| Feast Mode | `food` | `restaurant food` |
| Retail Therapy | `mall` | `shopping mall` |
| Touch Grass | `park` | `park nature trail garden` |
| After Hours | `bar` | `bar pub` |
| Sweet Tooth | `dessert` | `dessert ice cream bakery` |
| Hustle Spot | `coworking` | `coworking workspace` |

Freeform plan text can add intent signals:

| User text | Added signal |
|---|---|
| quiet, calm, chill, cozy | `quiet cozy` |
| cheap, budget, affordable | `cheap affordable` |
| late, night, open | `late night` |
| aircon, indoor | `indoor aircon` |
| date, romantic | `romantic date` |
| work, laptop, wifi | `wifi workspace` |
| dessert, sweet, ice cream, bakery | `dessert bakery` |
| dinner, lunch, meal | `restaurant food` |

## Ranking Logic

Hot Picks are not sorted by rating. They are ranked by a custom fairness score using GrabMaps route data.

The ranking considers:

- **Everyone-arrives ETA:** the longest individual route, because friends travel in parallel.
- **Average trip time:** useful for understanding overall effort.
- **Travel spread:** difference between shortest and longest route.
- **Proximity to fair center:** avoids far-but-equally-painful venues.
- **Intent fit:** penalizes fallback venues that do not match the chosen vibe.
- **Mode pain:** long walks are penalized more heavily than long drives or bike trips.

The UI still shows combined travel effort, but it is not treated as meetup duration.

## Local Setup

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Add your keys:

```bash
GRABMAPS_API_KEY="bm_your_api_key_here"
PORT=3002
MEET_API_BASE_URL="http://localhost:3002"
TELEGRAM_BOT_TOKEN="optional_telegram_bot_token"
```

Install and run:

```bash
npm install
npm start
```

Open:

```text
http://localhost:3002
```

Do not open `public/index.html` directly with `file://`; the app needs the Express backend for GrabMaps proxy routes and API calls.

## Start Everything

To run the web app and Telegram bot together:

```bash
./start
```

The script:

- Loads `.env`
- Defaults to `PORT=3002`
- Starts the Express web/API server
- Starts the Telegram bot only when `TELEGRAM_BOT_TOKEN` is set
- Stops both services on `Ctrl+C`

## How To Use The Web App

1. Choose one or more venue vibes.
2. Optionally type a plan, like `quiet cheap cafe with aircon`.
3. Click **Lock Gameplan**.
4. Add friends, origins, and travel modes.
5. Use search or **Drop pin** to set origins from GrabMaps.
6. Click **Launch meetup plan**.
7. Review Hot Picks, route bars, map routes, traffic-adjusted ETAs, and Fairness Court.

## Telegram Bot

The bot runs locally with long polling, so it does not need ngrok or a public webhook.

Start the web app first:

```bash
PORT=3002 npm start
```

Start the bot in another terminal:

```bash
MEET_API_BASE_URL="http://localhost:3002" npm run telegram
```

Example chat flow:

```text
/newmeet cafe fastest quiet cheap
/add Asha | car | Orchard Road Singapore
/add Ben | bicycle | Tampines Singapore
/add Chloe | bicycle | Jurong East Singapore
/add Dev | walk | Marina Bay Sands
/rank
```

Useful commands:

```text
/newmeet cafe quiet cheap
/vibe dessert
/optimize fair
/cap 25
/add Name | car/bicycle/walk | location
/me bike at Tampines Singapore
/list
/remove Name
/clear
/rank
```

## API Overview

The frontend and Telegram bot both call the local Express API.

```text
GET  /api/health
GET  /api/client-config
GET  /api/style.json
GET  /api/search
GET  /api/suggest
GET  /api/reverse
POST /api/route
POST /api/recommend
POST /api/roast
```

`POST /api/recommend` is the core endpoint. It accepts:

```json
{
  "friends": [
    { "name": "Asha", "lat": 1.304, "lng": 103.836, "mode": "car" },
    { "name": "Ben", "lat": 1.353, "lng": 103.945, "mode": "bike" }
  ],
  "categories": ["cafe"],
  "intent": "quiet cheap",
  "optimizeFor": "fair",
  "candidateLimit": 20
}
```

## Production Notes

This is a hackathon POC. For production:

- Use domain-restricted GrabMaps keys.
- Avoid exposing unrestricted API keys to browsers.
- Add persistent sessions and shared links.
- Add stronger Telegram auth/group management.
- Add venue open-hours handling when available.
- Add caching/rate limiting for route matrix style workloads.

## Demo Script

1. Start with four friends across Singapore.
2. Pick **Sweet Tooth** or **Coffee Date**.
3. Set one friend to **Walk**.
4. Launch the plan and show how the walking route changes the winner.
5. Open Fairness Court and point out traffic-adjusted ETA, spread, and roast.
6. Repeat the same flow through Telegram to show chat-native planning.

The punchline:

> OnlyFriends does not find the middle. It finds the least unfair place to make your friends show up.
