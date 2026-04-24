# MeetInTheMiddle

A small proof-of-concept that uses live Grab Maps APIs to find fair meetup venues for four friends.

## Run

```bash
npm install
GRABMAPS_API_KEY="bm_your_api_key_here" npm start
```

Open `http://localhost:3000`.

To start the local web app and Telegram bot together from `.env`:

```bash
./start
```

The script defaults to `PORT=3002`, serves the frontend/backend from the same Express app, and starts the Telegram bot when `TELEGRAM_BOT_TOKEN` is present. If you copy `.env.example` to `.env`, open `http://localhost:3002`.

## Telegram Bot

The bot runs locally with long polling, so it does not need ngrok or a public webhook.

1. Create a bot with BotFather and put the token in `.env` as `TELEGRAM_BOT_TOKEN`.
2. Run the web app first because the bot calls the local API:

```bash
PORT=3002 GRABMAPS_API_KEY="bm_your_api_key_here" npm start
```

3. In another terminal, start the bot:

```bash
MEET_API_BASE_URL="http://localhost:3002" npm run telegram
```

4. Message the bot:

```text
/newmeet cafe
/add Asha | car | Orchard Road Singapore
/add Ben | bicycle | Tampines Singapore
/add Chloe | bicycle | Jurong East Singapore
/add Dev | walk | Marina Bay Sands
/rank
```

Supported vibes: `cafe`, `food`, `mall`, `park`, `bar`, `dessert`, `coworking`.
Supported modes: `car`, `bicycle`, `walk`.

## What Uses Grab Maps

- Place search: friend origins and candidate venues.
- Reverse geocode: pin-style coordinate fallback through the backend API.
- Routing: every friend-to-venue ETA and route line.
- Map UI: the hosted Grab Maps library from `https://maps.grab.com/developer/assets/js/grabmaps.es.js`.
- Map overlays: route lines and markers on the underlying MapLibre map returned by `MapBuilder`.

## POC Note

The browser receives the API key through `/api/client-config` so the hosted Grab Maps library can authenticate map style and tile requests. For production, replace that with domain-restricted keys or a stricter proxy/token flow.
