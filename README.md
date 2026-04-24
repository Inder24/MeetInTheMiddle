# MeetInTheMiddle

A small proof-of-concept that uses live Grab Maps APIs to find fair meetup venues for four friends.

## Run

```bash
npm install
GRABMAPS_API_KEY="bm_your_api_key_here" npm start
```

Open `http://localhost:3000`.

## What Uses Grab Maps

- Place search: friend origins and candidate venues.
- Reverse geocode: pin-style coordinate fallback through the backend API.
- Routing: every friend-to-venue ETA and route line.
- Map UI: the hosted Grab Maps library from `https://maps.grab.com/developer/assets/js/grabmaps.es.js`.
- Map overlays: route lines and markers on the underlying MapLibre map returned by `MapBuilder`.

## POC Note

The browser receives the API key through `/api/client-config` so the hosted Grab Maps library can authenticate map style and tile requests. For production, replace that with domain-restricted keys or a stricter proxy/token flow.
