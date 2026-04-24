import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const grabApiKey = process.env.GRABMAPS_API_KEY;
const grabBaseUrl = "https://maps.grab.com";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function requireApiKey() {
  if (!grabApiKey) {
    const error = new Error("Missing GRABMAPS_API_KEY. Set it before starting the server.");
    error.status = 500;
    throw error;
  }
}

async function grabRequest(pathname, params = {}) {
  requireApiKey();
  const url = new URL(pathname, grabBaseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((item) => url.searchParams.append(key, item));
      return;
    }
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${grabApiKey}`,
      Accept: "application/json"
    }
  });

  const bodyText = await response.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = bodyText;
  }

  if (!response.ok) {
    const error = new Error(`Grab Maps request failed: ${response.status}`);
    error.status = response.status;
    error.details = body;
    throw error;
  }

  return body;
}

function proxiedGrabAssetUrl(value, publicOrigin = "") {
  if (typeof value !== "string") return value;
  try {
    const url = new URL(value, grabBaseUrl);
    if (url.origin !== grabBaseUrl) {
      return value;
    }

    const assetPath = url.pathname.startsWith("/api/maps/tiles/v2/")
      ? url.pathname
      : url.pathname.startsWith("/maps/tiles/v2/")
        ? `/api${url.pathname}`
        : null;

    if (!assetPath) return value;
    return `${publicOrigin}/api/grab-assets${decodeURI(assetPath)}${url.search}`;
  } catch {
    return value;
  }
}

function proxiedGrabStyle(style, publicOrigin = "") {
  const nextStyle = structuredClone(style);
  nextStyle.sprite = proxiedGrabAssetUrl(nextStyle.sprite, publicOrigin);
  nextStyle.glyphs = proxiedGrabAssetUrl(nextStyle.glyphs, publicOrigin);

  Object.values(nextStyle.sources || {}).forEach((source) => {
    if (Array.isArray(source.tiles)) {
      source.tiles = source.tiles.map((tileUrl) => proxiedGrabAssetUrl(tileUrl, publicOrigin));
    }
    if (source.url) {
      source.url = proxiedGrabAssetUrl(source.url, publicOrigin);
    }
  });

  return nextStyle;
}

async function proxyGrabAsset(req, res, next) {
  try {
    requireApiKey();
    const assetPath = req.params[0]?.startsWith("maps/tiles/v2/")
      ? `api/${req.params[0]}`
      : req.params[0];
    if (!assetPath?.startsWith("api/maps/tiles/v2/")) {
      res.status(404).json({ error: "Unsupported Grab asset path" });
      return;
    }

    const url = new URL(`/${assetPath}`, grabBaseUrl);
    Object.entries(req.query).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, item));
        return;
      }
      if (value !== undefined) url.searchParams.set(key, String(value));
    });

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${grabApiKey}`,
        Accept: req.get("accept") || "*/*"
      }
    });

    if (!response.ok) {
      res.status(response.status).send(await response.text());
      return;
    }

    const contentType = response.headers.get("content-type");
    const cacheControl = response.headers.get("cache-control") || "public, max-age=300";
    if (contentType) res.type(contentType);
    res.set("Cache-Control", cacheControl);
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    next(error);
  }
}

function routeProfile(mode) {
  return {
    car: "driving",
    driving: "driving",
    motorcycle: "motorcycle",
    bike: "cycling",
    cycling: "cycling",
    walk: "walking",
    walking: "walking"
  }[mode] || "driving";
}

function centerOf(friends) {
  const totals = friends.reduce(
    (acc, friend) => ({ lat: acc.lat + friend.lat, lng: acc.lng + friend.lng }),
    { lat: 0, lng: 0 }
  );
  return { lat: totals.lat / friends.length, lng: totals.lng / friends.length };
}

function coordinateFrom(location, ...keys) {
  for (const key of keys) {
    const value = Number(location?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return NaN;
}

function normalizePlace(place) {
  const lat = coordinateFrom(place.location, "latitude", "lat") || coordinateFrom(place, "latitude", "lat");
  const lng = coordinateFrom(place.location, "longitude", "lng", "lon") || coordinateFrom(place, "longitude", "lng", "lon");
  return {
    id: place.poi_id || place.id || `${place.name}-${place.location?.latitude}-${place.location?.longitude}`,
    name: place.name || place.short_name || "Unnamed place",
    category: place.category || place.business_type || place.categories?.[0]?.category_name || "place",
    address: place.formatted_address || [place.house, place.street, place.postcode].filter(Boolean).join(", "),
    lat,
    lng,
    raw: place
  };
}

async function searchPlaces({ keyword, location, country = "SGP", limit = 8 }) {
  const maxResults = Number(limit) || 8;
  const data = await grabRequest("/api/v1/maps/poi/v1/search", {
    keyword,
    country,
    location,
    limit: maxResults
  });
  return (data.places || [])
    .map(normalizePlace)
    .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng))
    .slice(0, maxResults);
}

async function autocompletePlaces({ keyword, location, country = "SGP", language, limit = 6 }) {
  const maxResults = Number(limit) || 6;
  const data = await grabRequest("/api/v1/maps/poi/v1/autocomplete", {
    keyword,
    country,
    location,
    language,
    limit: maxResults
  });
  return (data.places || [])
    .map(normalizePlace)
    .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng))
    .slice(0, maxResults);
}

async function suggestPlaces(params) {
  try {
    return {
      source: "autocomplete",
      places: await autocompletePlaces(params)
    };
  } catch (error) {
    if (error.status !== 404) throw error;
    return {
      source: "search-fallback",
      places: await searchPlaces(params)
    };
  }
}

async function routeBetween(origin, destination, mode) {
  const data = await grabRequest("/api/v1/maps/eta/v1/direction", {
    coordinates: [`${origin.lng},${origin.lat}`, `${destination.lng},${destination.lat}`],
    profile: routeProfile(mode),
    overview: "full"
  });

  const route = data.routes?.[0];
  if (!route) {
    throw new Error("No route returned");
  }

  return {
    distance: route.distance,
    duration: route.duration,
    geometry: route.geometry,
    trafficLight: route.traffic_light,
    mode: routeProfile(mode),
    waypoints: data.waypoints || []
  };
}

function durationStats(routes) {
  const durations = routes.map((route) => route.duration);
  const total = durations.reduce((sum, value) => sum + value, 0);
  const max = Math.max(...durations);
  const min = Math.min(...durations);
  const avg = total / durations.length;
  return { durations, total, max, min, avg, imbalance: max - min };
}

function scoreCandidate(stats, optimizeFor, capMinutes) {
  if (optimizeFor === "fastest") return stats.total;
  if (optimizeFor === "capped") {
    const capSeconds = capMinutes * 60;
    const penalty = stats.max > capSeconds ? (stats.max - capSeconds) * 10 : 0;
    return stats.max * 0.45 + stats.total * 0.25 + stats.imbalance * 0.3 + penalty;
  }
  if (optimizeFor === "social") {
    return stats.max * 0.5 + stats.imbalance * 0.35 + stats.avg * 0.15;
  }
  return stats.max * 0.55 + stats.avg * 0.25 + stats.imbalance * 0.2;
}

function fairnessScore(stats) {
  const imbalanceRatio = stats.max ? stats.imbalance / stats.max : 1;
  return Math.max(0, Math.round((1 - imbalanceRatio) * 100));
}

function explain(candidate) {
  const longest = Math.round(candidate.stats.max / 60);
  const average = Math.round(candidate.stats.avg / 60);
  const spread = Math.round(candidate.stats.imbalance / 60);
  return `Chosen because the average trip is ${average} min, the longest trip is ${longest} min, and the group spread is ${spread} min.`;
}

function roastFor(candidate, tone) {
  const worst = candidate.routes.reduce((max, route) => (route.duration > max.duration ? route : max));
  const minutes = Math.round(worst.duration / 60);
  const lines = {
    gentle: `${worst.friendName} has the longest ride at ${minutes} min, so maybe let them pick the table.`,
    spicy: `${worst.friendName} is doing the most geographic damage today with a ${minutes} min journey.`,
    unhinged: `${worst.friendName} lives like they selected their address during a system outage: ${minutes} min of consequence.`
  };
  return lines[tone] || lines.spicy;
}

function sortAndShape(candidates, optimizeFor, capMinutes, tone) {
  return candidates
    .map((candidate) => {
      const stats = durationStats(candidate.routes);
      const scored = {
        ...candidate,
        stats,
        score: scoreCandidate(stats, optimizeFor, capMinutes),
        fairnessScore: fairnessScore(stats)
      };
      return {
        ...scored,
        explanation: explain(scored),
        roast: roastFor(scored, tone)
      };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, hasGrabMapsKey: Boolean(grabApiKey) });
});

app.get("/api/client-config", (req, res, next) => {
  try {
    requireApiKey();
    res.json({
      grabMapsApiKey: grabApiKey,
      grabMapsBaseUrl: "https://maps.grab.com"
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/style.json", async (req, res, next) => {
  try {
    const style = await grabRequest("/api/style.json", { theme: req.query.theme || "basic" });
    const publicOrigin = `${req.protocol}://${req.get("host")}`;
    res.json(proxiedGrabStyle(style, publicOrigin));
  } catch (error) {
    next(error);
  }
});

app.get("/api/grab-assets/*", proxyGrabAsset);

app.get("/api/search", async (req, res, next) => {
  try {
    const places = await searchPlaces({
      keyword: req.query.keyword,
      location: req.query.location,
      country: req.query.country || "SGP",
      limit: req.query.limit || 8
    });
    res.json({ places });
  } catch (error) {
    next(error);
  }
});

app.get("/api/suggest", async (req, res, next) => {
  try {
    const keyword = String(req.query.keyword || "").trim();
    if (keyword.length < 2) {
      res.json({ places: [] });
      return;
    }

    const suggestionResult = await suggestPlaces({
      keyword,
      location: req.query.location,
      country: req.query.country || "SGP",
      language: req.query.language,
      limit: req.query.limit || 6
    });
    res.json(suggestionResult);
  } catch (error) {
    next(error);
  }
});

app.get("/api/reverse", async (req, res, next) => {
  try {
    const data = await grabRequest("/api/v1/maps/poi/v1/reverse-geo", {
      location: req.query.location,
      type: req.query.type
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

app.post("/api/route", async (req, res, next) => {
  try {
    const route = await routeBetween(req.body.origin, req.body.destination, req.body.mode);
    res.json({ route });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recommend", async (req, res, next) => {
  try {
    const friends = (req.body.friends || []).filter(
      (friend) => Number.isFinite(friend.lat) && Number.isFinite(friend.lng)
    );
    if (friends.length < 2) {
      res.status(400).json({ error: "At least two friends with coordinates are required." });
      return;
    }

    const center = centerOf(friends);
    const category = req.body.category || "cafe";
    const optimizeFor = req.body.optimizeFor || "fair";
    const capMinutes = Number(req.body.capMinutes || 25);
    const tone = req.body.tone || "spicy";
    const venuePlaces = await searchPlaces({
      keyword: category,
      location: `${center.lat},${center.lng}`,
      country: req.body.country || "SGP",
      limit: req.body.candidateLimit || 18
    });

    const uniquePlaces = [...new Map(venuePlaces.map((place) => [place.id, place])).values()].slice(0, 12);
    const candidates = [];

    for (const venue of uniquePlaces) {
      const routeResults = await Promise.allSettled(
        friends.map(async (friend) => ({
          friendName: friend.name,
          origin: { lat: friend.lat, lng: friend.lng },
          ...await routeBetween(friend, venue, friend.mode)
        }))
      );
      const routes = routeResults
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);

      if (routes.length === friends.length) {
        candidates.push({ venue, routes });
      }
    }

    res.json({
      center,
      category,
      generatedAt: new Date().toISOString(),
      results: sortAndShape(candidates, optimizeFor, capMinutes, tone)
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.message || "Unexpected server error",
    details: error.details
  });
});

app.listen(port, () => {
  console.log(`Meet Me Halfway POC running at http://localhost:${port}`);
});
