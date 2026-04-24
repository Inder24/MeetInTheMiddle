import "dotenv/config";
import express from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const grabApiKey = process.env.GRABMAPS_API_KEY;
const openAiApiKey = process.env.OPENAI_API_KEY;
const openAiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
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

function requireOpenAiKey() {
  if (!openAiApiKey) {
    const error = new Error("Missing OPENAI_API_KEY. Set it before using roast mode.");
    error.status = 500;
    throw error;
  }
}

function runRoastAgent({ intent, tone = "spicy" }) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "ai-agent", "roast_agent.py");
    const child = spawn("python3", [scriptPath], {
      env: {
        ...process.env,
        OPENAI_MODEL: openAiModel
      }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const error = new Error(stderr.trim() || "Roast agent failed.");
        error.status = 502;
        reject(error);
        return;
      }

      try {
        const parsed = JSON.parse(stdout || "{}");
        if (!parsed.roast) {
          throw new Error("Roast agent returned an empty response.");
        }
        resolve(parsed);
      } catch (error) {
        error.status = 502;
        reject(error);
      }
    });

    child.stdin.write(JSON.stringify({ intent, tone }));
    child.stdin.end();
  });
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
    motorbike: "motorcycle",
    bike: "cycling",
    bicycle: "cycling",
    cycling: "cycling",
    walk: "walking",
    walking: "walking"
  }[mode] || "driving";
}

function venueKeywordForCategory(category) {
  const normalized = String(category || "").toLowerCase();
  return {
    cafe: "cafe coffee",
    food: "restaurant food",
    mall: "shopping mall",
    park: "park nature trail garden",
    bar: "bar pub",
    dessert: "dessert ice cream bakery",
    coworking: "coworking workspace"
  }[normalized] || "";
}

function intentSignals(intent = "") {
  const text = String(intent).toLowerCase();
  const signals = [];
  const matchers = [
    { tokens: ["quiet", "calm", "chill", "cozy"], keyword: "quiet cozy" },
    { tokens: ["cheap", "budget", "affordable"], keyword: "cheap affordable" },
    { tokens: ["late", "night", "open"], keyword: "late night" },
    { tokens: ["aircon", "air con", "air-conditioned", "air conditioned", "indoor"], keyword: "indoor aircon" },
    { tokens: ["date", "romantic"], keyword: "romantic date" },
    { tokens: ["work", "laptop", "wifi", "cowork"], keyword: "wifi workspace" },
    { tokens: ["dessert", "sweet", "ice cream", "bakery"], keyword: "dessert bakery" },
    { tokens: ["food", "dinner", "lunch", "meal"], keyword: "restaurant food" },
    { tokens: ["coffee", "cafe"], keyword: "cafe coffee" },
    { tokens: ["drink", "bar", "pub"], keyword: "bar pub" },
    { tokens: ["park", "outdoor", "grass"], keyword: "park garden" }
  ];

  for (const matcher of matchers) {
    if (matcher.tokens.some((token) => text.includes(token))) {
      signals.push(matcher.keyword);
    }
  }

  return [...new Set(signals)].slice(0, 4);
}

function venueSearchKeywords({ categories = [], intent = "" }) {
  const categoryKeywords = categories
    .map((category) => venueKeywordForCategory(category))
    .filter(Boolean);
  const baseKeywords = categoryKeywords.length ? categoryKeywords : ["cafe coffee"];
  const signals = intentSignals(intent).filter((signal) => !baseKeywords.includes(signal));
  const directIntent = String(intent || "").trim();
  const keywords = [
    ...baseKeywords.flatMap((base) => [
      [signals[0], base].filter(Boolean).join(" "),
      base,
      ...signals.map((signal) => `${signal} ${base}`)
    ]),
    directIntent
  ].filter(Boolean);
  return [...new Set(keywords)].slice(0, 6);
}

function venueSearchKeyword(args) {
  return venueSearchKeywords(args)[0] || "cafe coffee";
}

function categoryTerms(category) {
  const normalized = String(category || "cafe").toLowerCase();
  return {
    cafe: ["cafe", "coffee", "bakery", "food", "beverage"],
    food: ["restaurant", "food", "meal", "dining", "beverage"],
    mall: ["mall", "shopping", "retail"],
    park: ["park", "garden", "trail", "nature"],
    bar: ["bar", "pub", "drink", "beverage"],
    dessert: ["dessert", "ice cream", "gelato", "bakery", "cake", "pastry", "sweet", "chocolate", "waffle"],
    coworking: ["cowork", "workspace", "office", "business"]
  }[normalized] || ["place"];
}

function normalizedPlaceText(place) {
  return [
    place.name,
    place.category,
    place.address,
    place.raw?.category,
    place.raw?.business_type,
    ...(place.raw?.categories || []).map((item) => item.category_name)
  ].filter(Boolean).join(" ").toLowerCase();
}

function placeMatchesCategory(place, category) {
  const normalized = String(category || "").toLowerCase();
  const haystack = normalizedPlaceText(place);
  if (normalized === "dessert") {
    const dessertWords = categoryTerms("dessert");
    return dessertWords.some((term) => haystack.includes(term));
  }
  return categoryTerms(normalized).some((term) => haystack.includes(term));
}

function placeMatchesCategories(place, categories = []) {
  if (!categories.length) return true;
  return categories.some((category) => placeMatchesCategory(place, category));
}

function isUsefulVenueFallback(place) {
  const haystack = [
    place.category,
    place.raw?.category,
    place.raw?.business_type,
    ...(place.raw?.categories || []).map((category) => category.category_name)
  ].filter(Boolean).join(" ").toLowerCase();
  const blockedTerms = ["residential", "commercial building", "parking", "school", "education", "bus stop", "transit"];
  return !blockedTerms.some((term) => haystack.includes(term));
}

function centerOf(friends) {
  const totals = friends.reduce(
    (acc, friend) => ({ lat: acc.lat + friend.lat, lng: acc.lng + friend.lng }),
    { lat: 0, lng: 0 }
  );
  return { lat: totals.lat / friends.length, lng: totals.lng / friends.length };
}

function distanceMeters(a, b) {
  const earthRadius = 6371000;
  const toRadians = (value) => value * Math.PI / 180;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const haversine = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function candidateRadiusKm(friends, center) {
  const farthestOriginKm = Math.max(
    0,
    ...friends.map((friend) => distanceMeters(center, friend) / 1000)
  );
  if (farthestOriginKm <= 1.5) return 2.5;
  if (farthestOriginKm <= 5) return 4;
  return 6;
}

function coordinateFrom(location, ...keys) {
  for (const key of keys) {
    const value = Number(location?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return NaN;
}

function areaFromPlace(place) {
  const areas = Array.isArray(place.administrative_areas) ? place.administrative_areas : [];
  return (
    areas.find((area) => area.type === "Neighborhood")?.name ||
    areas.find((area) => area.type === "Municipality")?.name ||
    place.street ||
    place.city ||
    ""
  );
}

function normalizePlace(place) {
  const lat = coordinateFrom(place.location, "latitude", "lat") || coordinateFrom(place, "latitude", "lat");
  const lng = coordinateFrom(place.location, "longitude", "lng", "lon") || coordinateFrom(place, "longitude", "lng", "lon");
  return {
    id: place.poi_id || place.id || `${place.name}-${place.location?.latitude}-${place.location?.longitude}`,
    name: place.name || place.short_name || "Unnamed place",
    category: place.category || place.business_type || place.categories?.[0]?.category_name || "place",
    address: place.formatted_address || [place.house, place.street, place.postcode].filter(Boolean).join(", "),
    area: areaFromPlace(place),
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

async function nearbyPlaces({ location, radius = 2, rankBy = "distance", language, limit = 10 }) {
  const maxResults = Number(limit) || 10;
  const data = await grabRequest("/api/v1/maps/place/v2/nearby", {
    location,
    radius,
    rankBy,
    language,
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
  const profile = routeProfile(mode);
  const data = await grabRequest("/api/v1/maps/eta/v1/direction", {
    coordinates: [`${origin.lng},${origin.lat}`, `${destination.lng},${destination.lat}`],
    profile,
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
    trafficLight: route.traffic_light || 0,
    fee: route.fee || null,
    legs: route.legs || [],
    mode: profile,
    requestedMode: mode,
    waypoints: data.waypoints || []
  };
}

function durationStats(routes) {
  const durations = routes.map((route) => route.duration);
  const walkingDurations = routes
    .filter((route) => route.mode === "walking")
    .map((route) => route.duration);
  const total = durations.reduce((sum, value) => sum + value, 0);
  const max = Math.max(...durations);
  const min = Math.min(...durations);
  const avg = total / durations.length;
  const walkingMax = walkingDurations.length ? Math.max(...walkingDurations) : 0;
  const walkingAvg = walkingDurations.length
    ? walkingDurations.reduce((sum, value) => sum + value, 0) / walkingDurations.length
    : 0;
  return { durations, total, max, min, avg, imbalance: max - min, walkingMax, walkingAvg, walkingCount: walkingDurations.length };
}

function scoreCandidate(stats, optimizeFor, capMinutes, centerDistanceMeters = 0, intentFit = true) {
  const proximityPenalty = centerDistanceMeters * 0.08;
  const intentPenalty = intentFit === false ? 900 : 0;
  const walkingComfortSeconds = 12 * 60;
  const walkingHardCapSeconds = 20 * 60;
  const walkingSoftPenalty = Math.max(0, stats.walkingMax - walkingComfortSeconds) * 1.8;
  const walkingHardPenalty = Math.max(0, stats.walkingMax - walkingHardCapSeconds) * 7;
  const walkingPenalty = stats.walkingCount ? walkingSoftPenalty + walkingHardPenalty : 0;
  if (optimizeFor === "fastest") return stats.max * 0.85 + stats.avg * 0.1 + stats.imbalance * 0.05 + proximityPenalty + intentPenalty;
  if (optimizeFor === "capped") {
    const capSeconds = (capMinutes || 25) * 60;
    const penalty = stats.max > capSeconds ? (stats.max - capSeconds) * 10 : 0;
    return stats.max * 0.45 + stats.total * 0.25 + stats.imbalance * 0.3 + penalty + walkingPenalty + proximityPenalty + intentPenalty;
  }
  if (optimizeFor === "social") {
    return stats.max * 0.5 + stats.imbalance * 0.35 + stats.avg * 0.15 + walkingPenalty + proximityPenalty + intentPenalty;
  }
  return stats.max * 0.55 + stats.avg * 0.25 + stats.imbalance * 0.2 + walkingPenalty + proximityPenalty + intentPenalty;
}

function fairnessScore(stats) {
  const imbalanceRatio = stats.max ? stats.imbalance / stats.max : 1;
  return Math.max(0, Math.round((1 - imbalanceRatio) * 100));
}

function explain(candidate) {
  const longest = Math.round(candidate.stats.max / 60);
  const average = Math.round(candidate.stats.avg / 60);
  const spread = Math.round(candidate.stats.imbalance / 60);
  const combined = Math.round(candidate.stats.total / 60);
  const walkingNote = candidate.stats.walkingCount
    ? ` Walker-sensitive scoring keeps the longest walk around ${Math.round(candidate.stats.walkingMax / 60)} min.`
    : "";
  const trafficLights = candidate.routes.reduce((sum, route) => sum + Number(route.trafficLight || 0), 0);
  const source = candidate.venue.source === "nearby" ? "nearby GrabMaps POI discovery" : "GrabMaps keyword search";
  return `Chosen from ${source} using GrabMaps traffic-adjusted ETAs because everyone can arrive in about ${longest} min, the average trip is ${average} min, the spread is ${spread} min, combined travel effort is ${combined} min, and routes pass ${trafficLights} traffic lights.${walkingNote}`;
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

function courtFor(candidate) {
  const sortedRoutes = [...candidate.routes].sort((a, b) => b.duration - a.duration);
  const worst = sortedRoutes[0];
  const best = sortedRoutes.at(-1);
  const trafficLights = candidate.routes.reduce((sum, route) => sum + Number(route.trafficLight || 0), 0);
  const longest = Math.round(worst.duration / 60);
  const shortest = Math.round(best.duration / 60);
  const spread = Math.round(candidate.stats.imbalance / 60);
  const totalDistance = candidate.routes.reduce((sum, route) => sum + Number(route.distance || 0), 0);
  const verdict = spread <= 8
    ? "Approved: suspiciously civil"
    : spread <= 18
      ? "Approved with side-eye"
      : "Approved, but someone is filing an appeal";

  return {
    verdict,
    worstFriend: worst.friendName,
    bestFriend: best.friendName,
    longestMinutes: longest,
    shortestMinutes: shortest,
    spreadMinutes: spread,
    totalDistance,
    trafficLights,
    evidence: `${worst.friendName} carries the longest trip at ${longest} min while ${best.friendName} gets away with ${shortest} min.`
  };
}

function sortAndShape(candidates, optimizeFor, capMinutes, tone) {
  const sorted = candidates
    .map((candidate) => {
      const stats = durationStats(candidate.routes);
      const scored = {
        ...candidate,
        stats,
        score: scoreCandidate(stats, optimizeFor, capMinutes, candidate.venue.centerDistanceMeters, candidate.venue.intentFit),
        fairnessScore: fairnessScore(stats)
      };
      return {
        ...scored,
        explanation: explain(scored),
        roast: roastFor(scored, tone),
        court: courtFor(scored)
      };
    })
    .sort((a, b) => a.score - b.score);

  const picked = [];
  const pickedIds = new Set();
  const pickedAreas = new Set();

  for (const candidate of sorted) {
    const areaKey = (candidate.venue.area || candidate.venue.address || candidate.venue.name || "").toLowerCase();
    if (picked.length > 0 && areaKey && pickedAreas.has(areaKey)) continue;
    picked.push(candidate);
    pickedIds.add(candidate.venue.id);
    if (areaKey) pickedAreas.add(areaKey);
    if (picked.length >= 5) break;
  }

  for (const candidate of sorted) {
    if (picked.length >= 5) break;
    if (pickedIds.has(candidate.venue.id)) continue;
    picked.push(candidate);
    pickedIds.add(candidate.venue.id);
  }

  return picked.map((candidate, index) => ({
    ...candidate,
    varietyTag: index === 0
      ? "Best overall"
      : candidate.venue.area
        ? `Different pocket: ${candidate.venue.area}`
        : candidate.venue.source === "nearby"
          ? "Nearby wild card"
          : "Same intent, new backup"
  }));
}

async function discoverVenues({ center, friends, categories, intent, country, candidateLimit }) {
  const location = `${center.lat},${center.lng}`;
  const keywords = venueSearchKeywords({ categories, intent });
  const radiusKm = candidateRadiusKm(friends, center);
  const fallbackRadiusKm = Math.max(radiusKm, 5);
  const withinRadius = (place, radius) => place.centerDistanceMeters <= radius * 1000;
  const annotate = (place, source) => ({
    ...place,
    ...source,
    centerDistanceMeters: distanceMeters(center, place)
  });
  const maxPerSearch = Math.max(5, Math.ceil(Number(candidateLimit || 18) / keywords.length));
  const keywordResults = await Promise.allSettled(
    keywords.map(async (keyword) => {
      const places = await searchPlaces({ keyword, location, country, limit: maxPerSearch });
      return places.map((place) => annotate(place, { source: "keyword", sourceKeyword: keyword }));
    })
  );
  const nearbyResults = await Promise.allSettled([
    nearbyPlaces({ location, radius: radiusKm, rankBy: "distance", limit: 16 }),
    nearbyPlaces({ location, radius: radiusKm, rankBy: "popularity", limit: 16 })
  ]);
  const nearbyPlacesFromApi = nearbyResults.flatMap((result) => result.status === "fulfilled"
    ? result.value.map((place) => annotate(place, { source: "nearby" })).filter((place) => withinRadius(place, radiusKm))
    : []);
  const keywordPlacesFromApi = keywordResults
    .flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const localKeywordPlaces = keywordPlacesFromApi
    .filter((place) => withinRadius(place, radiusKm))
    .map((place) => ({ ...place, intentFit: true }));
  const fallbackKeywordPlaces = keywordPlacesFromApi.filter((place) => withinRadius(place, fallbackRadiusKm));
  const matchedNearbyPlaces = nearbyPlacesFromApi
    .filter((place) => placeMatchesCategories(place, categories))
    .map((place) => ({ ...place, intentFit: true }));
  const categoryMatchedPlaces = [...localKeywordPlaces, ...matchedNearbyPlaces];
  const shouldUseGenericLocalBackups = !categories.some((category) => String(category).toLowerCase() === "dessert");
  const localBackupPlaces = categoryMatchedPlaces.length >= Math.min(5, Number(candidateLimit || 18))
    ? []
    : !shouldUseGenericLocalBackups
      ? []
    : nearbyPlacesFromApi
      .filter((place) => !categoryMatchedPlaces.some((matchedPlace) => matchedPlace.id === place.id))
      .filter(isUsefulVenueFallback)
      .map((place) => ({ ...place, intentFit: false }));

  const allPlaces = [
    ...categoryMatchedPlaces,
    ...localBackupPlaces,
    ...(categoryMatchedPlaces.length ? [] : fallbackKeywordPlaces)
  ];

  return {
    keywords,
    searchRadiusKm: radiusKm,
    places: [...new Map(allPlaces.map((place) => [place.id, place])).values()]
      .sort((a, b) => a.centerDistanceMeters - b.centerDistanceMeters)
      .slice(0, Number(candidateLimit || 18))
  };
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
    res.set("Cache-Control", "no-store");
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
    res.json({
      ...data,
      places: (data.places || [])
        .map(normalizePlace)
        .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng))
    });
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

app.post("/api/roast", async (req, res, next) => {
  try {
    requireOpenAiKey();
    const intent = String(req.body.intent || "").trim();
    if (intent.length < 8) {
      res.status(400).json({ error: "Intent is too short. Add a few more details before roasting." });
      return;
    }

    const result = await runRoastAgent({
      intent,
      tone: req.body.tone || "spicy"
    });
    res.json(result);
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
    const categories = Array.isArray(req.body.categories)
      ? req.body.categories.filter((value) => typeof value === "string" && value.trim())
      : [req.body.category].filter((value) => typeof value === "string" && value.trim());
    const intent = String(req.body.intent || "").trim();
    if (!intent && categories.length === 0) {
      res.status(400).json({ error: "Provide a plan or at least one filter before launching." });
      return;
    }
    const optimizeFor = req.body.optimizeFor || "fair";
    const capMinutes = Number(req.body.capMinutes || 25);
    const tone = req.body.tone || "spicy";
    const discovery = await discoverVenues({
      center,
      friends,
      categories,
      intent,
      country: req.body.country || "SGP",
      candidateLimit: req.body.candidateLimit || 18
    });

    const uniquePlaces = discovery.places.slice(0, 14);
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
      category: categories[0] || null,
      categories,
      intent,
      venueKeywords: discovery.keywords,
      venueKeyword: discovery.keywords[0],
      searchRadiusKm: discovery.searchRadiusKm,
      intentSignals: intentSignals(intent),
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
