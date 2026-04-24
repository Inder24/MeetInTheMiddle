import { GrabMapsBuilder, MapBuilder } from "https://maps.grab.com/developer/assets/js/grabmaps.es.js";

const friendSeeds = [
  { name: "Asha", query: "Orchard Road Singapore", mode: "car", color: "#00b577" },
  { name: "Ben", query: "Tampines Singapore", mode: "bike", color: "#f45f4f" },
  { name: "Chloe", query: "Jurong East Singapore", mode: "bike", color: "#2c7be5" },
  { name: "Dev", query: "Marina Bay Sands", mode: "walk", color: "#f4bd38" }
];
const friendPalette = ["#00b577", "#f45f4f", "#2c7be5", "#f4bd38", "#8b5cf6", "#14b8a6", "#ec4899", "#f97316"];

const state = {
  friends: friendSeeds.map((seed) => ({
    ...seed,
    placeholderQuery: seed.query,
    query: "",
    selected: null,
    options: [],
    suggestions: [],
    suggestOpen: false,
    isSuggesting: false
  })),
  results: [],
  activeIndex: 0,
  map: null,
  grabMap: null,
  mapReady: false,
  pendingDraw: false,
  markers: [],
  roastSuggestion: "",
  gameplanLocked: false,
  selectedCategories: [],
  optimizeFor: ""
};

const friendsGrid = document.querySelector("#friends-grid");
const form = document.querySelector("#planner-form");
const addFriendButton = document.querySelector("#add-friend");
const statusLine = document.querySelector("#status-line");
const mapStatus = document.querySelector("#map-status");
const resultsList = document.querySelector("#results-list");
const shareCard = document.querySelector("#share-card");
const crewStep = document.querySelector("#step-crew");
const mapBoardStep = document.querySelector("#step-map-board");
const summaryStep = document.querySelector("#step-summary");
const roastPanel = document.querySelector("#roast-panel");
const categoryInput = document.querySelector("#category");
const planIntentInput = document.querySelector("#plan-intent");
const planIntentButton = document.querySelector("#plan-intent-button");
const roastPlanButton = document.querySelector("#roast-plan-button");
const roastText = document.querySelector("#roast-text");
const stepHeadingGameplan = document.querySelector("#heading-gameplan");
const stepHeadingCrew = document.querySelector("#heading-crew");
const stepHeadingPicks = document.querySelector("#heading-picks");
const stepHeadingRoast = document.querySelector("#heading-roast");
const suggestTimers = new Map();
const suggestRequestIds = new Map();

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

function smoothScrollTo(element) {
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "start" });
}

function unlockCrewStep() {
  crewStep.classList.remove("is-hidden");
  setActiveStep("crew");
  setTimeout(() => smoothScrollTo(crewStep), 120);
}

function unlockExperienceStage() {
  [mapBoardStep, summaryStep, roastPanel].forEach((section) => {
    section.classList.remove("is-locked");
    section.classList.add("is-ready");
  });
  setActiveStep("picks");
  setTimeout(() => {
    state.map?.resize();
    smoothScrollTo(mapBoardStep);
  }, 120);
}

function setActiveStep(step) {
  const mapping = {
    gameplan: stepHeadingGameplan,
    crew: stepHeadingCrew,
    picks: stepHeadingPicks,
    roast: stepHeadingRoast
  };
  Object.values(mapping).forEach((node) => {
    node?.closest(".section-heading")?.classList.remove("is-current");
  });
  mapping[step]?.closest(".section-heading")?.classList.add("is-current");
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

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function placeSubtitle(place) {
  return place.address || place.category || "Grab Maps result";
}

function focusOriginInput(index) {
  requestAnimationFrame(() => {
    const input = document.querySelector(`[data-friend-query="${index}"]`);
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function renderSuggestions(friend, index) {
  if (!friend.suggestOpen) return "";
  if (friend.isSuggesting) {
    return `<div class="autocomplete-panel is-loading" role="status">Finding live Grab suggestions...</div>`;
  }
  if (!friend.suggestions.length) {
    return `<div class="autocomplete-panel is-empty" role="status">No suggestions yet. Try a fuller address.</div>`;
  }

  return `
    <div class="autocomplete-panel" role="listbox" aria-label="Origin suggestions">
      ${friend.suggestions.map((place, suggestionIndex) => `
        <button class="suggestion-option" type="button" role="option" data-suggest-place="${index}:${suggestionIndex}">
          <span>${escapeHtml(place.name)}</span>
          <small>${escapeHtml(placeSubtitle(place))}</small>
        </button>
      `).join("")}
    </div>
  `;
}

function renderFriends({ focusIndex } = {}) {
  friendsGrid.innerHTML = state.friends.map((friend, index) => `
    <article class="friend-card" style="border-color:${friend.color}">
      <div class="friend-top">
        <label>
          Friend
          <input data-friend-name="${index}" value="${friend.name}" />
        </label>
        <label>
          Mode
          <select data-friend-mode="${index}">
            <option value="car" ${friend.mode === "car" ? "selected" : ""}>Car</option>
            <option value="bike" ${friend.mode === "bike" ? "selected" : ""}>Bike</option>
            <option value="public_transport" ${friend.mode === "public_transport" ? "selected" : ""}>Public Transport</option>
            <option value="walk" ${friend.mode === "walk" ? "selected" : ""}>Walk</option>
          </select>
        </label>
      </div>
      <div class="search-row">
        <label class="origin-field">
          Origin search
          <input
            data-friend-query="${index}"
            value="${escapeHtml(friend.query)}"
            autocomplete="off"
            aria-autocomplete="list"
            aria-expanded="${friend.suggestOpen ? "true" : "false"}"
            placeholder="${escapeHtml(friend.placeholderQuery || "Start typing an address or place")}"
          />
          ${renderSuggestions(friend, index)}
        </label>
        <button class="small-button" type="button" data-search-friend="${index}">Search</button>
      </div>
      <div class="friend-actions">
        <button class="small-button remove-friend" type="button" data-remove-friend="${index}" ${state.friends.length <= 2 ? "disabled" : ""}>Remove</button>
      </div>
      <p class="selected-place">${friend.selected ? `${friend.selected.name} (${friend.selected.lat.toFixed(4)}, ${friend.selected.lng.toFixed(4)})` : ""}</p>
    </article>
  `).join("");

  if (Number.isInteger(focusIndex)) focusOriginInput(focusIndex);
}

function updateFriendSuggestions(index) {
  const friend = state.friends[index];
  const input = document.querySelector(`[data-friend-query="${index}"]`);
  const field = input?.closest(".origin-field");
  if (!field) return;

  field.querySelector(".autocomplete-panel")?.remove();
  input.setAttribute("aria-expanded", friend.suggestOpen ? "true" : "false");

  const html = renderSuggestions(friend, index);
  if (!html) return;

  const template = document.createElement("template");
  template.innerHTML = html.trim();
  field.append(template.content.firstElementChild);
}

function intentText() {
  return (planIntentInput?.value || "").trim();
}

function hasPlanningInputs() {
  return intentText().length > 0 || state.selectedCategories.length > 0 || Boolean(state.optimizeFor);
}

function updateRoastView(message) {
  roastText.textContent = message;
}

function nextFriendColor() {
  return friendPalette[state.friends.length % friendPalette.length];
}

function addFriend() {
  const nextIndex = state.friends.length + 1;
  state.friends.push({
    name: `Friend ${nextIndex}`,
    mode: "car",
    color: nextFriendColor(),
    placeholderQuery: `Friend ${nextIndex} location`,
    query: "",
    selected: null,
    options: [],
    suggestions: [],
    suggestOpen: false,
    isSuggesting: false
  });
  renderFriends({ focusIndex: state.friends.length - 1 });
  drawMap();
  setStatus(`Added Friend ${nextIndex}.`);
}

function removeFriend(index) {
  if (state.friends.length <= 2) {
    setStatus("At least two friends are required.");
    return;
  }
  const [removed] = state.friends.splice(index, 1);
  suggestTimers.forEach((timer) => clearTimeout(timer));
  suggestTimers.clear();
  suggestRequestIds.clear();
  renderFriends();
  drawMap();
  setStatus(`${removed?.name || "Friend"} removed from crew.`);
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
  friend.suggestions = [];
  friend.suggestOpen = false;
  friend.isSuggesting = false;
  renderFriends();
  drawMap();
  setStatus(data.places.length ? `Selected first live match for ${friend.name}.` : `No live places found for ${friend.name}.`);
}

function selectFriendPlace(index, place) {
  const friend = state.friends[index];
  friend.selected = place;
  friend.query = place.name;
  friend.options = [place, ...friend.options.filter((option) => option.id !== place.id)].slice(0, 6);
  friend.suggestions = [];
  friend.suggestOpen = false;
  friend.isSuggesting = false;
  renderFriends();
  drawMap();
  setStatus(`${friend.name}'s origin selected from Grab Maps autocomplete.`);
}

async function suggestFriend(index, requestId) {
  const friend = state.friends[index];
  const keyword = friend.query.trim();
  if (keyword.length < 2) return;

  try {
    const data = await api(`/api/suggest?keyword=${encodeURIComponent(keyword)}&country=SGP&limit=5`);
    if (requestId !== suggestRequestIds.get(index)) return;
    friend.suggestions = data.places;
    friend.isSuggesting = false;
    friend.suggestOpen = true;
    updateFriendSuggestions(index);
  } catch (error) {
    if (requestId !== suggestRequestIds.get(index)) return;
    friend.suggestions = [];
    friend.isSuggesting = false;
    friend.suggestOpen = true;
    updateFriendSuggestions(index);
    setStatus(`Autocomplete unavailable for ${friend.name}: ${error.message}`);
  }
}

function queueSuggest(index) {
  const friend = state.friends[index];
  clearTimeout(suggestTimers.get(index));

  if (friend.query.trim().length < 2) {
    friend.suggestions = [];
    friend.suggestOpen = false;
    friend.isSuggesting = false;
    suggestRequestIds.set(index, (suggestRequestIds.get(index) || 0) + 1);
    updateFriendSuggestions(index);
    return;
  }

  friend.suggestOpen = true;
  friend.isSuggesting = true;
  updateFriendSuggestions(index);
  const requestId = (suggestRequestIds.get(index) || 0) + 1;
  suggestRequestIds.set(index, requestId);
  suggestTimers.set(index, setTimeout(() => suggestFriend(index, requestId), 220));
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
  const mapCenter = [103.8198, 1.3521];
  const config = await api("/api/client-config");
  const style = await api("/api/style.json?theme=basic");
  const client = new GrabMapsBuilder()
    .setBaseUrl(window.location.origin)
    .setApiKey(config.grabMapsApiKey)
    .build();
  state.grabMap = await new MapBuilder(client)
    .setContainer("map")
    .setCenter(mapCenter)
    .setZoom(10)
    .setStyle(style)
    .enableNavigation()
    .enableAttribution()
    .enableBuildings()
    .enableLabels()
    .build();
  state.map = state.grabMap.getMap();

  if (!state.map.loaded()) {
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3500);
      state.map.once("load", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  state.mapReady = true;
  state.map.resize();
  requestAnimationFrame(() => state.map?.resize());
  setMapStatus("", false);
  ensureRoutesLayer();
  window.addEventListener("resize", () => state.map?.resize());
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
  const intent = intentText();
  shareCard.innerHTML = `
    <h2>Agreed place: ${winner.venue.name}</h2>
    <p>${winner.explanation}</p>
    <p class="meta">${intent ? `Intent: ${escapeHtml(intent)}` : "No intent entered yet."}</p>
    <div class="route-bars">
      ${winner.routes.map((route) => `
        <div class="route-bar">
          <strong>${route.friendName}</strong>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(8, route.duration / winner.stats.max * 100)}%"></div></div>
          <span>${minutes(route.duration)}</span>
        </div>
      `).join("")}
    </div>
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
  if (!state.gameplanLocked) {
    setStatus("Lock your gameplan first, then launch meetup plan.");
    startPlanFromIntent();
    return;
  }
  collectFriendInputs();
  const intent = intentText();
  if (!hasPlanningInputs()) {
    setStatus("Select at least one filter or add a plan before launching.");
    return;
  }
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
        intent,
        categories: state.selectedCategories,
        optimizeFor: state.optimizeFor || undefined
      })
    });
    state.results = data.results;
    state.activeIndex = 0;
    unlockExperienceStage();
    renderResults();
    drawMap();
    setStatus(data.results.length ? `Ranked ${data.results.length} live venues from Grab Maps.` : "No routable live venues found for this setup.");
  } catch (error) {
    setStatus(`Could not rank venues: ${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
}

function startPlanFromIntent() {
  if (!hasPlanningInputs()) {
    setStatus("Pick at least one filter or type a plan to continue.");
    planIntentInput?.focus();
    return;
  }
  if (!state.gameplanLocked) {
    state.gameplanLocked = true;
    unlockCrewStep();
  }
  const intent = intentText();
  if (intent) {
    setStatus(`Gameplan locked: ${intent}`);
    return;
  }
  setStatus("Gameplan locked from selected filters.");
}

async function roastPlanIntent() {
  setActiveStep("roast");
  smoothScrollTo(roastPanel);
  const intent = intentText();
  const filterSummary = state.selectedCategories.length ? `Filters: ${state.selectedCategories.join(", ")}` : "";
  const roastInput = intent || filterSummary;
  if (!roastInput) {
    updateRoastView("Add a plan or choose filters first so roast mode has context.");
    setStatus("Roast mode needs a plan or selected filters.");
    return;
  }

  roastPlanButton.disabled = true;
  updateRoastView("Generating roast suggestion...");
  try {
    const roastData = await api("/api/roast", {
      method: "POST",
      body: JSON.stringify({
        intent: roastInput,
        tone: "spicy"
      })
    });
    state.roastSuggestion = roastData.roast;
    updateRoastView(state.roastSuggestion);
    setStatus("Roast generated from AI.");
  } catch (error) {
    updateRoastView(`Roast failed: ${error.message}`);
    setStatus(`Could not generate roast: ${error.message}`);
  } finally {
    roastPlanButton.disabled = false;
  }
}

friendsGrid.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-friend]");
  if (removeButton) {
    removeFriend(Number(removeButton.dataset.removeFriend));
    return;
  }

  const suggestion = event.target.closest("[data-suggest-place]");
  if (suggestion) {
    const [friendIndex, suggestionIndex] = suggestion.dataset.suggestPlace.split(":").map(Number);
    const place = state.friends[friendIndex]?.suggestions[suggestionIndex];
    if (place) selectFriendPlace(friendIndex, place);
    return;
  }

  const button = event.target.closest("[data-search-friend]");
  if (!button) return;
  collectFriendInputs();
  searchFriend(Number(button.dataset.searchFriend)).catch((error) => setStatus(error.message));
});

friendsGrid.addEventListener("input", (event) => {
  const input = event.target.closest("[data-friend-query]");
  if (!input) return;
  const index = Number(input.dataset.friendQuery);
  state.friends[index].query = input.value;
  queueSuggest(index);
});

friendsGrid.addEventListener("focusin", (event) => {
  const input = event.target.closest("[data-friend-query]");
  if (!input) return;
  const index = Number(input.dataset.friendQuery);
  if (state.friends[index].suggestions.length) {
    state.friends[index].suggestOpen = true;
    updateFriendSuggestions(index);
  }
});

resultsList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-result-index]");
  if (!card) return;
  state.activeIndex = Number(card.dataset.resultIndex);
  renderResults();
  drawMap();
});

form.addEventListener("click", (event) => {
  const categoryChip = event.target.closest("[data-category]");
  if (categoryChip) {
    const category = categoryChip.dataset.category;
    const nextSelected = state.selectedCategories.includes(category)
      ? state.selectedCategories.filter((item) => item !== category)
      : [...state.selectedCategories, category];
    state.selectedCategories = nextSelected;
    categoryInput.value = nextSelected.join(",");
    form.querySelectorAll("[data-category]").forEach((button) => {
      button.classList.toggle("is-active", nextSelected.includes(button.dataset.category));
    });
    if (nextSelected.length) {
      setStatus(`Venue vibes: ${nextSelected.join(", ")}.`);
    } else {
      setStatus("Venue vibe cleared.");
    }
    return;
  }

  const optimizeChip = event.target.closest("[data-optimize]");
  if (optimizeChip) {
    const selected = state.optimizeFor === optimizeChip.dataset.optimize ? "" : optimizeChip.dataset.optimize;
    state.optimizeFor = selected;
    document.querySelector("#optimizeFor").value = selected;
    form.querySelectorAll("[data-optimize]").forEach((button) => {
      button.classList.toggle("is-active", selected === button.dataset.optimize);
    });
    setStatus(selected ? `Squad priority set to ${optimizeChip.textContent.trim()}.` : "Squad priority cleared.");
  }
});

form.addEventListener("submit", recommend);
addFriendButton.addEventListener("click", addFriend);
planIntentButton.addEventListener("click", startPlanFromIntent);
roastPlanButton.addEventListener("click", () => roastPlanIntent().catch((error) => setStatus(error.message)));

renderFriends();
setActiveStep("gameplan");
try {
  await initMap();
  drawMap();
  setStatus("Ready. Search origins, then rank meetup spots.");
} catch (error) {
  console.warn("Map initialization failed:", error);
  setMapStatus("The map could not initialize, but live search and ranking still work.");
  setStatus("Map unavailable. Search and ranking still use live Grab Maps APIs.");
}
