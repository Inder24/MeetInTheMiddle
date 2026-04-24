import { GrabMapsBuilder, MapBuilder } from "https://maps.grab.com/developer/assets/js/grabmaps.es.js";

const friendSeeds = [
  { name: "Asha", query: "Orchard Road Singapore", mode: "car", color: "#00b577" },
  { name: "Ben", query: "Tampines Singapore", mode: "motorcycle", color: "#f45f4f" },
  { name: "Chloe", query: "Jurong East Singapore", mode: "bike", color: "#2c7be5" },
  { name: "Dev", query: "Marina Bay Sands", mode: "walk", color: "#f4bd38" }
];

const state = {
  friends: friendSeeds.map((seed) => ({ ...seed, selected: null, options: [] })),
  results: [],
  activeIndex: 0,
  map: null,
  grabMap: null,
  mapReady: false,
  pendingDraw: false,
  markers: []
};

const friendsGrid = document.querySelector("#friends-grid");
const form = document.querySelector("#planner-form");
const searchAllButton = document.querySelector("#search-all");
const statusLine = document.querySelector("#status-line");
const mapStatus = document.querySelector("#map-status");
const resultsList = document.querySelector("#results-list");
const shareCard = document.querySelector("#share-card");

function minutes(seconds) {
  return `${Math.round(seconds / 60)} min`;
}

function meters(distance) {
  return distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`;
}

function setStatus(message) {
  statusLine.textContent = message;
}

function setMapStatus(message, visible = true) {
  mapStatus.textContent = message;
  mapStatus.classList.toggle("is-visible", visible);
}

function isValidNumber(value) {
  return Number.isFinite(Number(value));
}

function pointFrom(lat, lng) {
  const point = { lat: Number(lat), lng: Number(lng) };
  if (!isValidNumber(point.lat) || !isValidNumber(point.lng)) return null;
  if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return null;
  return point;
}

function pointFromPlace(place) {
  return pointFrom(place?.lat, place?.lng);
}

function renderFriends() {
  friendsGrid.innerHTML = state.friends.map((friend, index) => `
    <article class="friend-card">
      <div class="friend-top">
        <label>
          Friend
          <input data-friend-name="${index}" value="${friend.name}" />
        </label>
        <label>
          Mode
          <select data-friend-mode="${index}">
            <option value="car" ${friend.mode === "car" ? "selected" : ""}>Car</option>
            <option value="motorcycle" ${friend.mode === "motorcycle" ? "selected" : ""}>Motorcycle</option>
            <option value="bike" ${friend.mode === "bike" ? "selected" : ""}>Bike</option>
            <option value="walk" ${friend.mode === "walk" ? "selected" : ""}>Walk</option>
          </select>
        </label>
      </div>
      <div class="search-row">
        <label>
          Origin search
          <input data-friend-query="${index}" value="${friend.query}" />
        </label>
        <button class="small-button" type="button" data-search-friend="${index}">Search</button>
      </div>
      <select class="place-choice" data-friend-choice="${index}">
        <option value="">${friend.options.length ? "Choose live result" : "No live result selected"}</option>
        ${friend.options.map((place, optionIndex) => `
          <option value="${optionIndex}" ${friend.selected?.id === place.id ? "selected" : ""}>
            ${place.name} - ${place.address || place.category}
          </option>
        `).join("")}
      </select>
      <p class="selected-place">${friend.selected ? `${friend.selected.name} (${friend.selected.lat.toFixed(4)}, ${friend.selected.lng.toFixed(4)})` : "Search and choose an origin."}</p>
    </article>
  `).join("");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

async function searchFriend(index) {
  const friend = state.friends[index];
  if (!friend.query.trim()) return;
  setStatus(`Searching live Grab Maps places for ${friend.name}...`);
  const data = await api(`/api/search?keyword=${encodeURIComponent(friend.query)}&country=SGP&limit=6`);
  friend.options = data.places;
  friend.selected = data.places[0] || null;
  renderFriends();
  drawMap();
  setStatus(data.places.length ? `Selected first live match for ${friend.name}.` : `No live places found for ${friend.name}.`);
}

async function searchAllFriends() {
  collectFriendInputs();
  searchAllButton.disabled = true;
  try {
    for (let index = 0; index < state.friends.length; index += 1) {
      await searchFriend(index);
    }
    setStatus("All four origins are selected from live Grab Maps search.");
  } finally {
    searchAllButton.disabled = false;
  }
}

function collectFriendInputs() {
  state.friends.forEach((friend, index) => {
    friend.name = document.querySelector(`[data-friend-name="${index}"]`).value.trim() || `Friend ${index + 1}`;
    friend.query = document.querySelector(`[data-friend-query="${index}"]`).value.trim();
    friend.mode = document.querySelector(`[data-friend-mode="${index}"]`).value;
  });
}

function selectedFriendsPayload() {
  return state.friends
    .filter((friend) => friend.selected)
    .map((friend) => ({
      name: friend.name,
      lat: friend.selected.lat,
      lng: friend.selected.lng,
      mode: friend.mode
    }));
}

function decodePolyline(encoded, precision = 6) {
  let index = 0;
  let first = 0;
  let second = 0;
  const coordinates = [];
  const factor = 10 ** precision;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    first += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    second += result & 1 ? ~(result >> 1) : result >> 1;

    const a = first / factor;
    const b = second / factor;
    coordinates.push(Math.abs(a) <= 90 && Math.abs(b) <= 180 ? [b, a] : [a, b]);
  }

  return coordinates;
}

function lineFeature(route, color) {
  const rawCoordinates = typeof route.geometry === "string"
    ? decodePolyline(route.geometry)
    : route.geometry?.coordinates || [];
  const coordinates = rawCoordinates.filter((point) => {
    const lng = Number(point?.[0]);
    const lat = Number(point?.[1]);
    return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  });
  return {
    type: "Feature",
    properties: { color },
    geometry: { type: "LineString", coordinates }
  };
}

async function initMap() {
  setMapStatus("Loading Grab map...");
  try {
    const config = await api("/api/client-config");
    const style = await api("/api/style.json?theme=basic");
    style.glyphs = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";
    const client = new GrabMapsBuilder()
      .setBaseUrl(config.grabMapsBaseUrl)
      .setApiKey(config.grabMapsApiKey)
      .build();
    const grabMap = await new MapBuilder(client)
      .setContainer("map")
      .setCenter([103.8198, 1.3521])
      .setZoom(10)
      .setStyle(style)
      .enableNavigation()
      .enableAttribution()
      .enableBuildings()
      .enableLabels()
      .build();
    state.grabMap = grabMap;
    state.map = grabMap.getMap();
  } catch (error) {
    console.warn("GrabMaps library map failed; falling back to authenticated MapLibre style.", error);
    const style = await api("/api/style.json?theme=basic");
    state.map = new maplibregl.Map({
      container: "map",
      style,
      center: [103.8198, 1.3521],
      zoom: 10
    });
    state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    setMapStatus("GrabMaps library had trouble loading, so the POC is using the same Grab style through MapLibre.");
  }

  if (!state.map.loaded()) {
    await new Promise((resolve) => state.map.once("load", resolve));
  }
  state.mapReady = true;
  setMapStatus("", false);
  ensureRoutesLayer();
  state.map.on("styledata", ensureRoutesLayer);
  state.map.on("idle", () => {
    if (!state.pendingDraw) return;
    state.pendingDraw = false;
    drawMap();
  });
}

function ensureRoutesLayer() {
  if (!state.map || !state.map.isStyleLoaded()) return;
  if (!state.map.getSource("routes")) {
    state.map.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  if (!state.map.getLayer("routes-line")) {
    state.map.addLayer({
      id: "routes-line",
      type: "line",
      source: "routes",
      paint: {
        "line-color": ["get", "color"],
        "line-width": 5,
        "line-opacity": 0.82
      }
    });
  }
  if (!state.map.getSource("meet-points")) {
    state.map.addSource("meet-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  if (!state.map.getLayer("meet-points-circle")) {
    state.map.addLayer({
      id: "meet-points-circle",
      type: "circle",
      source: "meet-points",
      paint: {
        "circle-radius": ["case", ["==", ["get", "kind"], "venue"], 10, 7],
        "circle-color": ["get", "color"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["case", ["==", ["get", "kind"], "venue"], 4, 3],
        "circle-opacity": 0.95
      }
    });
  }
  if (!state.map.getLayer("meet-points-label")) {
    state.map.addLayer({
      id: "meet-points-label",
      type: "symbol",
      source: "meet-points",
      layout: {
        "text-field": ["get", "label"],
        "text-size": 12,
        "text-offset": [0, 1.25],
        "text-anchor": "top"
      },
      paint: {
        "text-color": "#17191d",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5
      }
    });
  }
}

function clearMarkers() {
  document.querySelectorAll(".maplibregl-marker").forEach((marker) => marker.remove());
  state.markers.forEach((marker) => marker.remove());
  state.markers = [];
}

function pointFeature(point, label, color, kind = "friend") {
  return {
    type: "Feature",
    properties: { label, color, kind },
    geometry: { type: "Point", coordinates: [point.lng, point.lat] }
  };
}

function focusMap(points) {
  if (!points.length) return;
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const center = {
    lng: (minLng + maxLng) / 2,
    lat: (minLat + maxLat) / 2
  };
  const span = Math.max(maxLng - minLng, maxLat - minLat);
  const zoom = span < 0.015 ? 13 : span < 0.05 ? 12 : span < 0.12 ? 11 : span < 0.25 ? 10 : span < 0.6 ? 9 : 6;
  state.map.easeTo({ center, zoom, duration: 600 });
}

function drawMap() {
  if (!state.mapReady || !state.map?.isStyleLoaded()) {
    state.pendingDraw = true;
    setMapStatus("Map is still getting ready. Results will draw automatically once it is ready.");
    return;
  }

  try {
    ensureRoutesLayer();
    clearMarkers();
    const points = [];
    const pointFeatures = [];

    state.friends.forEach((friend) => {
      const point = pointFromPlace(friend.selected);
      if (!point) return;
      points.push(point);
      pointFeatures.push(pointFeature(point, friend.name, friend.color));
    });

    const active = state.results[state.activeIndex];
    const routeFeatures = [];
    if (active) {
      const venuePoint = pointFromPlace(active.venue);
      if (venuePoint) {
        points.push(venuePoint);
        pointFeatures.push(pointFeature(venuePoint, active.venue.name, "#17191d", "venue"));
      }
      active.routes.forEach((route, index) => {
        const feature = lineFeature(route, state.friends[index]?.color || "#3177d9");
        if (feature.geometry.coordinates.length > 1) routeFeatures.push(feature);
      });
    }

    state.map.getSource("routes")?.setData({ type: "FeatureCollection", features: routeFeatures });
    state.map.getSource("meet-points")?.setData({ type: "FeatureCollection", features: pointFeatures });

    focusMap(points);
    state.pendingDraw = false;
    setMapStatus("", false);
  } catch (error) {
    console.warn("Map draw skipped:", error);
    setMapStatus("Map overlay skipped one update. Try selecting another venue or ranking again.");
  }
}

function renderResults() {
  if (!state.results.length) {
    resultsList.innerHTML = "";
    shareCard.hidden = true;
    return;
  }

  const winner = state.results[0];
  shareCard.hidden = false;
  shareCard.innerHTML = `
    <h2>Winner: ${winner.venue.name}</h2>
    <p>${winner.roast}</p>
  `;

  resultsList.innerHTML = state.results.map((result, index) => {
    const longest = Math.max(...result.routes.map((route) => route.duration));
    return `
      <article class="result-card ${index === state.activeIndex ? "is-active" : ""}" data-result-index="${index}">
        <div class="result-head">
          <div>
            <h3>${index + 1}. ${result.venue.name}</h3>
            <p class="meta">${result.venue.category} - ${result.venue.address || "Address unavailable"}</p>
          </div>
          <span class="score-badge">${result.fairnessScore}/100 fair</span>
        </div>
        <p class="reason">${result.explanation}</p>
        <p class="roast">${result.roast}</p>
        <div class="route-bars">
          ${result.routes.map((route) => `
            <div class="route-bar">
              <strong>${route.friendName}</strong>
              <div class="bar-track"><div class="bar-fill" style="width:${Math.max(8, route.duration / longest * 100)}%"></div></div>
              <span>${minutes(route.duration)}</span>
            </div>
          `).join("")}
        </div>
        <p class="meta">Total ${minutes(result.stats.total)} - longest ${minutes(result.stats.max)} - ${meters(result.routes.reduce((sum, route) => sum + route.distance, 0))} combined</p>
      </article>
    `;
  }).join("");
}

async function recommend(event) {
  event.preventDefault();
  collectFriendInputs();
  const friends = selectedFriendsPayload();
  if (friends.length < 2) {
    setStatus("Search and select at least two live friend origins first.");
    return;
  }

  const submitButton = form.querySelector(".primary-action");
  submitButton.disabled = true;
  setStatus("Routing every friend to live Grab Maps venues...");
  try {
    const data = await api("/api/recommend", {
      method: "POST",
      body: JSON.stringify({
        friends,
        category: document.querySelector("#category").value.trim() || "cafe",
        optimizeFor: document.querySelector("#optimizeFor").value,
        capMinutes: Number(document.querySelector("#capMinutes").value || 25),
        tone: document.querySelector("#tone").value
      })
    });
    state.results = data.results;
    state.activeIndex = 0;
    renderResults();
    drawMap();
    setStatus(data.results.length ? `Ranked ${data.results.length} live venues from Grab Maps.` : "No routable live venues found for this setup.");
  } catch (error) {
    setStatus(`Could not rank venues: ${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
}

friendsGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-search-friend]");
  if (!button) return;
  collectFriendInputs();
  searchFriend(Number(button.dataset.searchFriend)).catch((error) => setStatus(error.message));
});

friendsGrid.addEventListener("change", (event) => {
  const choice = event.target.closest("[data-friend-choice]");
  if (!choice) return;
  const index = Number(choice.dataset.friendChoice);
  if (choice.value === "") {
    state.friends[index].selected = null;
  } else {
    const selectedIndex = Number(choice.value);
    state.friends[index].selected = Number.isFinite(selectedIndex) ? state.friends[index].options[selectedIndex] : null;
  }
  renderFriends();
  drawMap();
});

resultsList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-result-index]");
  if (!card) return;
  state.activeIndex = Number(card.dataset.resultIndex);
  renderResults();
  drawMap();
});

form.addEventListener("submit", recommend);
searchAllButton.addEventListener("click", () => searchAllFriends().catch((error) => setStatus(error.message)));

renderFriends();
try {
  await initMap();
  drawMap();
  setStatus("Ready. Search origins, then rank meetup spots.");
} catch (error) {
  console.warn("Map initialization failed:", error);
  setMapStatus("The map could not initialize, but live search and ranking still work.");
  setStatus("Map unavailable. Search and ranking still use live Grab Maps APIs.");
}
