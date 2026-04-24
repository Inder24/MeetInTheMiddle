import "dotenv/config";

const token = process.env.TELEGRAM_BOT_TOKEN;
const apiBaseUrl = process.env.MEET_API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const telegramBaseUrl = token ? `https://api.telegram.org/bot${token}` : null;
const sessions = new Map();
const maxVoteOptions = 3;

const vibeAliases = {
  cafe: "cafe",
  coffee: "cafe",
  food: "food",
  restaurant: "food",
  mall: "mall",
  shopping: "mall",
  park: "park",
  nature: "park",
  trail: "park",
  bar: "bar",
  pub: "bar",
  dessert: "dessert",
  coworking: "coworking",
  work: "coworking"
};

const modeAliases = {
  car: "car",
  drive: "car",
  driving: "car",
  bicycle: "bike",
  bike: "bike",
  cycle: "bike",
  cycling: "bike",
  walk: "walk",
  walking: "walk"
};

const optimizeAliases = {
  fair: "fair",
  fairest: "fair",
  balanced: "fair",
  fastest: "fastest",
  fast: "fastest",
  quickest: "fastest",
  capped: "capped",
  cap: "capped",
  limit: "capped",
  social: "social",
  resentment: "social"
};

const toneAliases = {
  gentle: "gentle",
  nice: "gentle",
  spicy: "spicy",
  roast: "spicy",
  unhinged: "unhinged",
  chaos: "unhinged"
};

const fillerWords = new Set(["at", "from", "near", "in", "to", "by", "via", "around"]);
const commandAliases = {
  "/start": "/start",
  "/help": "/help",
  "/new": "/newmeet",
  "/newmeet": "/newmeet",
  "/meet": "/newmeet",
  "/vibe": "/vibe",
  "/category": "/vibe",
  "/optimize": "/optimize",
  "/optimise": "/optimize",
  "/goal": "/optimize",
  "/cap": "/cap",
  "/max": "/cap",
  "/tone": "/tone",
  "/roast": "/tone",
  "/add": "/add",
  "/friend": "/add",
  "/me": "/me",
  "/iam": "/me",
  "/list": "/list",
  "/people": "/list",
  "/friends": "/list",
  "/remove": "/remove",
  "/delete": "/remove",
  "/clear": "/clear",
  "/reset": "/clear",
  "/rank": "/rank",
  "/plan": "/rank",
  "/go": "/rank",
  "/results": "/rank"
};

function requireToken() {
  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN. Add it to .env or export it before running the bot.");
  }
}

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      category: "cafe",
      optimizeFor: "fair",
      capMinutes: 25,
      tone: "spicy",
      friends: [],
      lastResults: [],
      votes: {}
    });
  }
  return sessions.get(chatId);
}

function normalizeVibe(value = "") {
  return vibeAliases[value.trim().toLowerCase()] || null;
}

function normalizeMode(value = "") {
  return modeAliases[value.trim().toLowerCase()] || null;
}

function normalizeOptimize(value = "") {
  return optimizeAliases[value.trim().toLowerCase()] || null;
}

function normalizeTone(value = "") {
  return toneAliases[value.trim().toLowerCase()] || null;
}

function tokenize(value = "") {
  return value
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^[,.;:|\-\u2014]+|[,.;:|\-\u2014]+$/g, ""))
    .filter(Boolean);
}

function parseMeetingSettings(args = "") {
  const next = {};
  const leftovers = [];

  for (const token of tokenize(args)) {
    const vibe = normalizeVibe(token);
    const optimizeFor = normalizeOptimize(token);
    const tone = normalizeTone(token);
    const capMatch = token.match(/^(\d{1,3})(?:m|min|mins|minutes)?$/i);

    if (vibe && !next.category) {
      next.category = vibe;
    } else if (optimizeFor && !next.optimizeFor) {
      next.optimizeFor = optimizeFor;
    } else if (tone && !next.tone) {
      next.tone = tone;
    } else if (capMatch && !next.capMinutes) {
      const cap = Number(capMatch[1]);
      if (cap >= 5 && cap <= 120) next.capMinutes = cap;
    } else {
      leftovers.push(token);
    }
  }

  return { settings: next, leftovers };
}

function applySettings(session, settings = {}) {
  Object.entries(settings).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      session[key] = value;
    }
  });
}

function settingsSummary(settings = {}) {
  const lines = [];
  if (settings.category) lines.push(`vibe <b>${settings.category}</b>`);
  if (settings.optimizeFor) lines.push(`optimize <b>${settings.optimizeFor}</b>`);
  if (settings.capMinutes) lines.push(`cap <b>${settings.capMinutes} min</b>`);
  if (settings.tone) lines.push(`tone <b>${settings.tone}</b>`);
  return lines.join(", ");
}

function parseSelfArgs(args = "") {
  const tokens = tokenize(args);
  let mode = null;
  const locationTokens = [];

  for (const token of tokens) {
    const maybeMode = normalizeMode(token);
    if (maybeMode && !mode) {
      mode = maybeMode;
    } else if (!fillerWords.has(token.toLowerCase())) {
      locationTokens.push(token);
    }
  }

  return { mode, locationQuery: locationTokens.join(" ") };
}

function parseAddArgs(args = "") {
  const pipeParts = args.split("|").map((part) => part.trim()).filter(Boolean);
  if (pipeParts.length >= 3) {
    return {
      name: pipeParts[0],
      mode: normalizeMode(pipeParts[1]),
      locationQuery: pipeParts.slice(2).join(" | ")
    };
  }

  const tokens = tokenize(args);
  const modeIndex = tokens.findIndex((token) => normalizeMode(token));
  if (modeIndex <= 0 || modeIndex >= tokens.length - 1) return null;

  const name = tokens.slice(0, modeIndex).join(" ");
  const mode = normalizeMode(tokens[modeIndex]);
  const locationQuery = tokens
    .slice(modeIndex + 1)
    .filter((token) => !fillerWords.has(token.toLowerCase()))
    .join(" ");

  return { name, mode, locationQuery };
}

function parseIncomingCommand(text = "") {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const [firstToken, ...rest] = trimmed.split(/\s+/);
  const rawCommand = firstToken.startsWith("/") ? firstToken : `/${firstToken}`;
  const commandName = rawCommand.split("@")[0].toLowerCase();
  const command = commandAliases[commandName];
  if (!command) return null;

  return {
    command,
    args: rest.join(" ").trim()
  };
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

function minutes(seconds) {
  return `${Math.round(seconds / 60)} min`;
}

function modeLabel(mode) {
  return mode === "bike" ? "bicycle" : mode;
}

function displayName(user = {}) {
  return user.first_name || user.username || `Friend ${user.id || ""}`.trim();
}

function courtVerdict(result, index = 0) {
  const worst = result.routes.reduce((max, route) => (route.duration > max.duration ? route : max));
  const worstMinutes = Math.round(worst.duration / 60);
  const totalMinutes = Math.round(result.stats.total / 60);
  const spreadMinutes = Math.round(result.stats.imbalance / 60);
  const verdict = index === 0 ? "Court-approved" : "Backup counsel";
  return `${verdict}: ${escapeHtml(result.venue.name)} is ${result.fairnessScore}/100 fair. Total group pain is ${totalMinutes} min, spread is ${spreadMinutes} min, and ${escapeHtml(worst.friendName)} takes the biggest hit at ${worstMinutes} min.`;
}

function rankLabel(result, index) {
  return `${index + 1}. ${result.venue.name} (${result.fairnessScore}/100 fair)`;
}

function formatHelp() {
  return [
    "<b>MeetInTheMiddle bot</b>",
    "",
    "Plan a fair meetup from Telegram:",
    "<code>/newmeet cafe fastest unhinged</code>",
    "<code>/me bike at Tampines Singapore</code>",
    "<code>/add Asha | car | Orchard Road Singapore</code>",
    "<code>/add Ben bicycle from Tampines Singapore</code>",
    "<code>/add Ben | bicycle | Tampines Singapore</code>",
    "<code>/add Dev | walk | Marina Bay Sands</code>",
    "<code>/rank park fastest 25min</code>",
    "",
    "<b>Vibes:</b> cafe, food, mall, park, bar, dessert, coworking",
    "<b>Modes:</b> car, bicycle, walk",
    "<b>Vote:</b> after /rank, tap a venue button.",
    "<b>Other commands:</b> /vibe, /optimize, /cap, /tone, /list, /remove, /clear"
  ].join("\n");
}

async function localApi(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Local API failed: ${response.status}`);
  }
  return data;
}

async function telegram(method, payload = {}) {
  requireToken();
  const response = await fetch(`${telegramBaseUrl}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.description || `Telegram ${method} failed`);
  }
  return data.result;
}

async function sendMessage(chatId, text) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
}

async function sendMessageWithButtons(chatId, text, inlineKeyboard) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: inlineKeyboard
    }
  });
}

async function answerCallbackQuery(callbackQueryId, text) {
  return telegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false
  });
}

async function resolveOrigin(query) {
  const data = await localApi(`/api/search?keyword=${encodeURIComponent(query)}&country=SGP&limit=1`);
  return data.places?.[0] || null;
}

async function handleAdd(chatId, args) {
  const parsed = parseAddArgs(args);
  if (!parsed?.name || !parsed?.mode || !parsed?.locationQuery) {
    await sendMessage(chatId, "Use: <code>/add Name | car/bicycle/walk | location</code>\nOr: <code>/add Asha car at Orchard Road Singapore</code>");
    return;
  }

  const { name, mode, locationQuery } = parsed;

  await sendMessage(chatId, `Searching Grab Maps for <b>${escapeHtml(name)}</b>...`);
  const place = await resolveOrigin(locationQuery);
  if (!place) {
    await sendMessage(chatId, `No Grab Maps origin found for: <code>${escapeHtml(locationQuery)}</code>`);
    return;
  }

  const session = getSession(chatId);
  const friend = {
    name,
    mode,
    lat: place.lat,
    lng: place.lng,
    label: place.name,
    address: place.address
  };
  const existingIndex = session.friends.findIndex((item) => item.name.toLowerCase() === name.toLowerCase());
  if (existingIndex >= 0) {
    session.friends[existingIndex] = friend;
  } else {
    session.friends.push(friend);
  }

  await sendMessage(
    chatId,
    `Added <b>${escapeHtml(name)}</b> by <b>${modeLabel(mode)}</b>\n` +
      `Origin: ${escapeHtml(place.name)} (${place.lat.toFixed(4)}, ${place.lng.toFixed(4)})`
  );
}

async function handleMe(chatId, user, args) {
  const { mode, locationQuery } = parseSelfArgs(args);
  if (!mode || !locationQuery) {
    await sendMessage(chatId, "Use: <code>/me car/bicycle/walk location</code>\nExample: <code>/me bicycle at Tampines Singapore</code>");
    return;
  }

  const name = displayName(user);
  await handleAdd(chatId, `${name} | ${mode} | ${locationQuery}`);
}

function formatRankMessage(session, results) {
  const winner = results[0];
  const routeLines = winner.routes
    .map((route) => `• ${escapeHtml(route.friendName)}: ${minutes(route.duration)}`)
    .join("\n");
  const topThree = results.slice(0, maxVoteOptions)
    .map((result, index) => `${rankLabel(result, index)}\n   ${escapeHtml(result.venue.address || result.venue.category || "")}`)
    .join("\n\n");

  return [
    `⚖️ <b>Fairness Court is in session</b>`,
    `Vibe: <b>${escapeHtml(session.category)}</b> · Optimize: <b>${escapeHtml(session.optimizeFor)}</b>`,
    "",
    `<b>Verdict</b>`,
    courtVerdict(winner),
    "",
    `<b>Top picks</b>`,
    topThree,
    "",
    `<b>Winner trips</b>`,
    routeLines,
    "",
    `<b>Why</b>`,
    escapeHtml(winner.explanation),
    "",
    `<b>Roast</b>`,
    escapeHtml(winner.roast),
    "",
    "Vote below. Democracy, but with ETAs."
  ].join("\n");
}

function voteKeyboard(results) {
  return [
    results.slice(0, maxVoteOptions).map((result, index) => ({
      text: `Vote #${index + 1}: ${result.venue.name.slice(0, 24)}`,
      callback_data: `vote:${index}`
    })),
    [{ text: "Show vote count", callback_data: "votes:show" }]
  ];
}

async function handleRank(chatId, args = "") {
  const session = getSession(chatId);
  const { settings } = parseMeetingSettings(args);
  applySettings(session, settings);

  if (session.friends.length < 2) {
    await sendMessage(chatId, "Add at least two friends first with <code>/add Name | mode | location</code>.");
    return;
  }

  const parsedSummary = settingsSummary(settings);
  await sendMessage(chatId, `Ranking live Grab Maps venues${parsedSummary ? ` with ${parsedSummary}` : ""}. Tiny robot legs are moving...`);
  const payload = {
    friends: session.friends.map(({ name, lat, lng, mode }) => ({ name, lat, lng, mode })),
    category: session.category,
    optimizeFor: session.optimizeFor,
    capMinutes: session.capMinutes,
    tone: session.tone,
    candidateLimit: 12
  };
  const data = await localApi("/api/recommend", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  const results = data.results || [];
  if (!results.length) {
    await sendMessage(chatId, "No routable venues found for this setup. Try another vibe or origin.");
    return;
  }

  session.lastResults = results.slice(0, maxVoteOptions);
  session.votes = {};

  await sendMessageWithButtons(chatId, formatRankMessage(session, results), voteKeyboard(results));
}

function voteSummary(session) {
  if (!session.lastResults.length) return "No active vote. Run /rank first.";
  return session.lastResults.map((result, index) => {
    const count = session.votes[index]?.size || 0;
    return `${index + 1}. ${escapeHtml(result.venue.name)} - ${count} vote${count === 1 ? "" : "s"}`;
  }).join("\n");
}

async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  if (!chatId) return;

  const session = getSession(chatId);
  const data = callbackQuery.data || "";
  const voterId = callbackQuery.from?.id;

  if (data === "votes:show") {
    await answerCallbackQuery(callbackQuery.id, "Vote count refreshed.");
    await sendMessage(chatId, `<b>Current vote count</b>\n${voteSummary(session)}`);
    return;
  }

  if (data.startsWith("vote:")) {
    const index = Number(data.split(":")[1]);
    if (!Number.isInteger(index) || !session.lastResults[index]) {
      await answerCallbackQuery(callbackQuery.id, "That venue is no longer active. Run /rank again.");
      return;
    }

    Object.values(session.votes).forEach((voters) => voters.delete(voterId));
    session.votes[index] ||= new Set();
    session.votes[index].add(voterId);

    await answerCallbackQuery(callbackQuery.id, `Voted for #${index + 1}.`);
    await sendMessage(
      chatId,
      `<b>${escapeHtml(displayName(callbackQuery.from))}</b> voted for <b>${escapeHtml(session.lastResults[index].venue.name)}</b>.\n\n${voteSummary(session)}`
    );
  }
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  const parsedCommand = parseIncomingCommand(text);
  if (!parsedCommand) return;

  const { command, args } = parsedCommand;
  const session = getSession(chatId);

  try {
    if (command === "/start" || command === "/help") {
      await sendMessage(chatId, formatHelp());
      return;
    }
    if (command === "/newmeet") {
      const { settings } = parseMeetingSettings(args);
      const vibe = settings.category || "cafe";
      sessions.set(chatId, {
        category: vibe,
        optimizeFor: settings.optimizeFor || "fair",
        capMinutes: settings.capMinutes || 25,
        tone: settings.tone || "spicy",
        friends: [],
        lastResults: [],
        votes: {}
      });
      const summary = settingsSummary({ category: vibe, optimizeFor: settings.optimizeFor, capMinutes: settings.capMinutes, tone: settings.tone });
      await sendMessage(chatId, `New meetup started${summary ? ` with ${summary}` : ""}. Add friends with <code>/add Name | mode | location</code> or <code>/me mode location</code>.`);
      return;
    }
    if (command === "/vibe") {
      const { settings } = parseMeetingSettings(args);
      const vibe = settings.category;
      if (!vibe) {
        await sendMessage(chatId, "Choose one: cafe, food, mall, park, bar, dessert, coworking.");
        return;
      }
      session.category = vibe;
      await sendMessage(chatId, `Vibe set to <b>${vibe}</b>.`);
      return;
    }
    if (command === "/optimize") {
      const { settings } = parseMeetingSettings(args);
      const optimizeFor = settings.optimizeFor;
      if (!["fair", "fastest", "capped", "social"].includes(optimizeFor)) {
        await sendMessage(chatId, "Choose one: fair, fastest, capped, social.");
        return;
      }
      session.optimizeFor = optimizeFor;
      await sendMessage(chatId, `Optimize mode set to <b>${optimizeFor}</b>.`);
      return;
    }
    if (command === "/cap") {
      const { settings } = parseMeetingSettings(args);
      const cap = settings.capMinutes || Number(args);
      if (!Number.isFinite(cap) || cap < 5 || cap > 120) {
        await sendMessage(chatId, "Use a cap between 5 and 120 minutes, e.g. <code>/cap 25</code>.");
        return;
      }
      session.capMinutes = cap;
      await sendMessage(chatId, `Max minutes cap set to <b>${cap}</b>.`);
      return;
    }
    if (command === "/tone") {
      const { settings } = parseMeetingSettings(args);
      const tone = settings.tone;
      if (!["gentle", "spicy", "unhinged"].includes(tone)) {
        await sendMessage(chatId, "Choose one: gentle, spicy, unhinged.");
        return;
      }
      session.tone = tone;
      await sendMessage(chatId, `Roast tone set to <b>${tone}</b>.`);
      return;
    }
    if (command === "/add") {
      await handleAdd(chatId, args);
      return;
    }
    if (command === "/me") {
      await handleMe(chatId, message.from, args);
      return;
    }
    if (command === "/list") {
      const friends = session.friends.length
        ? session.friends.map((friend) => `• ${escapeHtml(friend.name)} (${modeLabel(friend.mode)}) - ${escapeHtml(friend.label)}`).join("\n")
        : "No friends yet.";
      await sendMessage(chatId, `<b>Meetup</b>: ${session.category}, optimize ${session.optimizeFor}\n${friends}`);
      return;
    }
    if (command === "/remove") {
      const before = session.friends.length;
      session.friends = session.friends.filter((friend) => friend.name.toLowerCase() !== args.toLowerCase());
      await sendMessage(chatId, before === session.friends.length ? "No matching friend found." : `Removed <b>${escapeHtml(args)}</b>.`);
      return;
    }
    if (command === "/clear") {
      session.friends = [];
      session.lastResults = [];
      session.votes = {};
      await sendMessage(chatId, "Cleared friends for this meetup.");
      return;
    }
    if (command === "/rank") {
      await handleRank(chatId, args);
      return;
    }

    await sendMessage(chatId, "I don't know that command yet. Try /help.");
  } catch (error) {
    console.error(error);
    await sendMessage(chatId, `Something went sideways: ${escapeHtml(error.message)}`);
  }
}

async function poll() {
  requireToken();
  let offset = 0;
  console.log(`Telegram bot polling. Local API: ${apiBaseUrl}`);

  while (true) {
    try {
      const updates = await telegram("getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["message", "callback_query"]
      });
      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message) await handleMessage(update.message);
        if (update.callback_query) await handleCallbackQuery(update.callback_query);
      }
    } catch (error) {
      if (/unauthorized/i.test(error.message)) {
        console.error("Telegram rejected TELEGRAM_BOT_TOKEN. Re-copy or rotate the token in BotFather, update .env, then restart the bot.");
        process.exit(1);
      }
      console.error("Telegram polling error:", error.message);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

poll();
