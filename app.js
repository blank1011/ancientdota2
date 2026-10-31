const $ = (selector) => document.querySelector(selector);
const rankNames = ["Unranked", "Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal"];
const rankAssets = "https://www.opendota.com/assets/images/dota2/rank_icons";
const invokerPortrait = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/invoker.png";
const gameModeNames = [
  "Unknown",
  "All Pick",
  "Captains Mode",
  "Random Draft",
  "Single Draft",
  "All Random",
  "Intro",
  "Diretide",
  "Reverse Captains Mode",
  "Greeviling",
  "Tutorial",
  "Mid Only",
  "Least Played",
  "Limited Heroes",
  "Compendium Matchmaking",
  "Custom",
  "Captains Draft",
  "Balanced Draft",
  "Ability Draft",
  "Event",
  "All Random Death Match",
  "1v1 Mid",
  "All Draft",
  "Turbo",
  "Mutation",
  "Coaches Challenge"
];
const lobbyTypeNames = new Map([
  [0, "Unranked"],
  [1, "Practice"],
  [2, "Tournament"],
  [3, "Tutorial"],
  [4, "Co-op Bots"],
  [5, "Ranked Team"],
  [6, "Ranked Solo"],
  [7, "Ranked"],
  [8, "1v1 Mid"],
  [9, "Battle Cup"],
  [10, "Local Bots"],
  [11, "Spectator"],
  [12, "Event"],
  [13, "Gauntlet"],
  [14, "New Player"],
  [15, "Featured"]
]);
const friendsStorageKey = "ancient-friends";
const mmrSettingsStoragePrefix = "ancient-mmr-settings:";
const maxFriends = 12;
const defaultMmrMatchChange = 25;
let heroById = new Map();
let signedInAccountId = null;
let dashboardLoadId = 0;
let dashboardLoadingTimer;
let itemNamesPromise;
let itemNames = new Map();
const heroItemPopularity = new Map();
let activeMatchRequest = 0;
let activeMatchAccountId = null;
let activeHeroGuideRequest = 0;
let selectedTrendMatchId = null;
let activeTrendMatches = null;
let mmrMatches = null;
let mmrSettings = null;
let selectedInsightHeroId = null;
let historyMatches = null;
let historyLoaded = false;
let historyRequestId = 0;
let playerSearchRequestId = 0;
let activePage = "overview";
const pageDetails = {
  overview: { eyebrow: "PLAYER OVERVIEW", title: "Your game." },
  matches: { eyebrow: "THE BATTLEFIELD", title: "Match history" },
  "player-search": { eyebrow: "PUBLIC PLAYER LOOKUP", title: "Player search" },
  scout: { eyebrow: "INTELLIGENCE BRIEFING", title: "Scout report" },
  party: { eyebrow: "YOUR FIRETEAM", title: "Party roster" }
};

function setProfileAvatar(source) {
  const avatar = $("#avatar");
  avatar.hidden = false;
  avatar.dataset.fallback = source ? "false" : "true";
  avatar.alt = source ? "Steam profile avatar" : "Invoker portrait placeholder";
  avatar.src = source || invokerPortrait;
}

$("#avatar").addEventListener("error", (event) => {
  const avatar = event.currentTarget;
  if (avatar.dataset.fallback === "true") {
    avatar.hidden = true;
    return;
  }
  setProfileAvatar("");
});

$("#win-loss-tooltip-hero").addEventListener("error", (event) => {
  event.currentTarget.hidden = true;
});
for (const selector of ["#most-played-hero-image", "#highest-winrate-hero-image"]) {
  $(selector).addEventListener("error", (event) => {
    event.currentTarget.hidden = true;
  });
}

function setLoginError(message) {
  const error = $("#login-error");
  error.textContent = message;
  error.hidden = false;
}

async function apiJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { ...options, cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`OpenDota returned ${response.status}`);
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("OpenDota took too long to respond (12-second limit).");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

function normalizeSteamId(input) {
  if (!/^\d{1,20}$/.test(input)) throw new Error("Enter a numeric Steam32 or Steam64 ID.");
  const entered = BigInt(input);
  const steam64Base = 76561197960265728n;
  const maxAccountId = 4294967295n;
  const accountId = entered >= steam64Base ? entered - steam64Base : entered;
  if (accountId <= 0n || accountId > maxAccountId) throw new Error("That Steam ID is outside the supported range.");
  return accountId.toString();
}

function readFriendIds() {
  const stored = localStorage.getItem(friendsStorageKey);
  if (!stored) return [];
  const parsed = JSON.parse(stored);
  if (!Array.isArray(parsed) || parsed.length > maxFriends || parsed.some((id) => typeof id !== "string" || !/^\d{1,10}$/.test(id))) {
    throw new Error("Your saved friend list is invalid. Remove its Ancient friend-list data from this browser to continue.");
  }
  return [...new Set(parsed)];
}

function saveFriendIds(ids) {
  localStorage.setItem(friendsStorageKey, JSON.stringify(ids));
}

function setFriendError(message) {
  const error = $("#friend-error");
  error.textContent = message;
  error.hidden = !message;
}

function rankDetails(tier) {
  const value = Number(tier) || 0;
  const medal = value > 0 ? Math.min(8, Math.floor(value / 10)) : 0;
  return {
    name: rankNames[medal],
    image: `${rankAssets}/rank_icon_${medal}.png`,
    stars: medal && medal < 8 ? `${value % 10} star${value % 10 === 1 ? "" : "s"}` : ""
  };
}

function validRankTier(value) {
  const tier = Number(value);
  return Number.isFinite(tier) && tier > 0 && tier <= 80 ? tier : undefined;
}

function matchRankTier(match) {
  return [match.avg_rank_tier, match.average_rank]
    .map(validRankTier)
    .find((tier) => tier !== undefined);
}

function matchModeLabel(match) {
  const gameMode = match.game_mode === null || match.game_mode === undefined || match.game_mode === ""
    ? undefined
    : Number(match.game_mode);
  const lobbyType = match.lobby_type === null || match.lobby_type === undefined || match.lobby_type === ""
    ? undefined
    : Number(match.lobby_type);
  const modeName = Number.isInteger(gameMode)
    ? gameModeNames[gameMode] || `Mode ${gameMode}`
    : "Mode unavailable";
  const lobbyName = Number.isInteger(lobbyType)
    ? lobbyTypeNames.get(lobbyType) || `Lobby ${lobbyType}`
    : "Lobby unavailable";
  return `${lobbyName} · ${modeName}`;
}

function rankTierToStep(tier) {
  const medal = Math.floor(tier / 10);
  const stars = Math.min(5, Math.max(1, tier % 10));
  return (medal - 1) * 5 + stars;
}

function rankStepToTier(step) {
  const boundedStep = Math.min(40, Math.max(1, step));
  const medal = Math.ceil(boundedStep / 5);
  const stars = boundedStep - (medal - 1) * 5;
  return medal * 10 + stars;
}

function estimateCompetitiveRank(matches) {
  const recentMatches = matches.slice(0, 20);
  const rankedMatches = recentMatches
    .map((match, index) => {
      const tier = matchRankTier(match);
      return { step: tier === undefined ? undefined : rankTierToStep(tier), weight: recentMatches.length - index };
    })
    .filter((match) => match.step !== undefined);
  if (rankedMatches.length < 5) return null;

  const totalWeight = rankedMatches.reduce((sum, match) => sum + match.weight, 0);
  const weightedStep = rankedMatches.reduce((sum, match) => sum + match.step * match.weight, 0) / totalWeight;
  return { tier: rankStepToTier(Math.round(weightedStep)), sampleSize: rankedMatches.length, matchCount: recentMatches.length };
}

function renderPredictedRank(matches, isRanked) {
  const card = $("#predicted-rank-card");
  const grid = $(".stats-grid");
  card.hidden = false;
  grid.classList.add("has-prediction");
  const estimate = estimateCompetitiveRank(matches);
  const icon = $("#predicted-rank-icon");
  const name = $("#predicted-rank-name");
  const caption = $("#predicted-rank-caption");
  $("#predicted-rank-label").textContent = isRanked ? "RECENT MATCH RANK" : "PREDICTED RANK";
  if (!estimate) {
    icon.hidden = true;
    name.textContent = "Not enough data";
    caption.textContent = `Need 5 rank-known matches in your last ${Math.min(matches.length, 20)} to estimate.`;
    card.title = "Ancient needs at least five recent matches with a recorded OpenDota average rank before showing a prediction.";
    return;
  }

  const rank = rankDetails(estimate.tier);
  icon.src = rank.image;
  icon.alt = "";
  icon.hidden = false;
  name.textContent = `${rank.name}${rank.stars ? ` · ${rank.stars}` : ""}`;
  caption.textContent = isRanked
    ? `Weighted from ${estimate.sampleSize} recent match ranks · not your medal`
    : `Weighted from ${estimate.sampleSize} OpenDota match ranks · estimate only`;
  card.title = "Weighted average of recorded match-average ranks in the latest 20 games. It is not your personal medal or a verified MMR.";
}

function latestRecordedRank(ratings) {
  if (!Array.isArray(ratings)) return undefined;
  const recent = [...ratings]
    .filter((entry) => validRankTier(entry.rank_tier) && Number.isFinite(Number(entry.time)) && Number(entry.time) > 0)
    .sort((a, b) => Number(b.time) - Number(a.time))[0];
  if (!recent) return undefined;
  const ageInDays = (Date.now() / 1000 - Number(recent.time)) / 86400;
  return ageInDays >= 0 && ageInDays <= 30 ? validRankTier(recent.rank_tier) : undefined;
}

function matchMmrChange(match, focusAccountId) {
  const lobbyType = Number(match.lobby_type);
  if (![5, 6, 7].includes(lobbyType)) {
    return { text: "—", title: "MMR changes apply to ranked matches." };
  }
  if (typeof match.radiant_win !== "boolean" || !Number.isFinite(Number(match.player_slot))) {
    return { text: "—", title: "OpenDota did not provide enough match data to estimate the MMR change." };
  }
  if (!signedInAccountId || String(focusAccountId) !== String(signedInAccountId)) {
    return {
      text: "Varies",
      title: "Dota's actual MMR change varies by player and match; this profile's current MMR baseline isn't available here."
    };
  }
  if (!mmrSettings) {
    return { text: "—", title: "Enter your current MMR and estimated ranked-game change to show estimated gains and losses." };
  }
  if (Number(match.start_time) <= mmrSettings.baselineAt) {
    return { text: "—", title: "This match was played before the current MMR baseline was set." };
  }
  const won = match.radiant_win === (Number(match.player_slot) < 128);
  const change = won ? mmrSettings.matchChange : -mmrSettings.matchChange;
  return {
    text: `≈ ${change > 0 ? "+" : ""}${formatNumber(change)}`,
    title: "Estimated from your fixed per-ranked-game setting and match result; this is not the actual Dota MMR change."
  };
}

function createFriendRow(accountId) {
  const row = document.createElement("article");
  row.className = "friend-row";
  row.dataset.accountId = accountId;
  row.innerHTML = `<div class="friend-loading-avatar"><span></span></div><div class="friend-details"><strong>Loading player…</strong><span>Fetching public stats</span></div><span class="friend-row-loading" aria-label="Loading"></span>`;
  return row;
}

async function populateFriendRow(row, accountId) {
  try {
    const [player, record] = await Promise.all([
      apiJson(`https://api.opendota.com/api/players/${accountId}`),
      apiJson(`https://api.opendota.com/api/players/${accountId}/wl`)
    ]);
    if (!player.profile?.personaname) throw new Error("No public OpenDota profile found for this Steam ID.");
    const rank = rankDetails(player.rank_tier);
    const wins = Number(record.win) || 0;
    const losses = Number(record.lose) || 0;
    const total = wins + losses;

    row.replaceChildren();
    const avatar = document.createElement("img");
    avatar.className = "friend-avatar";
    avatar.src = player.profile.avatar || player.profile.avatarfull || "";
    avatar.alt = "";
    avatar.loading = "lazy";
    row.append(avatar);

    const details = document.createElement("div");
    details.className = "friend-details";
    const name = document.createElement("a");
    name.href = `https://steamcommunity.com/profiles/${BigInt(accountId) + 76561197960265728n}`;
    name.target = "_blank";
    name.rel = "noopener noreferrer";
    name.textContent = player.profile.personaname;
    const stats = document.createElement("span");
    stats.textContent = `${rank.name} · ${total ? `${Math.round((wins / total) * 100)}% WR` : "No match record"}`;
    details.append(name, stats);
    row.append(details);

    const rankIcon = document.createElement("img");
    rankIcon.className = "friend-rank-icon";
    rankIcon.src = rank.image;
    rankIcon.alt = rank.name;
    rankIcon.title = rank.name;
    row.append(rankIcon);

    const remove = document.createElement("button");
    remove.className = "friend-remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${player.profile.personaname}`);
    remove.addEventListener("click", () => removeFriend(accountId));
    row.append(remove);
  } catch (error) {
    row.replaceChildren();
    row.classList.add("friend-row-error");
    const issue = document.createElement("span");
    issue.className = "friend-load-error";
    issue.textContent = `Could not load ${accountId}: ${error.message}`;
    const remove = document.createElement("button");
    remove.className = "friend-remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove Steam ID ${accountId}`);
    remove.addEventListener("click", () => removeFriend(accountId));
    row.append(issue, remove);
  }
}

async function renderFriends() {
  const list = $("#friend-list");
  list.replaceChildren();
  try {
    const ids = readFriendIds();
    $("#party-count").textContent = `${ids.length} / ${maxFriends}`;
    if (!ids.length) {
      const empty = document.createElement("div");
      empty.className = "party-empty";
      empty.innerHTML = "<span class=\"party-empty-icon\">♙</span><strong>Your party awaits.</strong><span>Add a friend’s Steam ID above to get started.</span>";
      list.append(empty);
      return;
    }
    const rows = ids.map((id) => {
      const row = createFriendRow(id);
      list.append(row);
      return populateFriendRow(row, id);
    });
    await Promise.all(rows);
  } catch (error) {
    setFriendError(error.message);
    $("#party-count").textContent = "—";
    const message = document.createElement("div");
    message.className = "party-empty party-empty-error";
    message.textContent = error.message;
    list.append(message);
  }
}

function removeFriend(accountId) {
  try {
    const ids = readFriendIds().filter((id) => id !== accountId);
    saveFriendIds(ids);
    setFriendError("");
    renderFriends();
  } catch (error) {
    setFriendError(`Couldn't update your saved party: ${error.message}`);
  }
}

async function addFriend(input) {
  const accountId = normalizeSteamId(input.trim());
  if (accountId === signedInAccountId) throw new Error("That’s your Steam ID — you’re already the captain of this party.");
  const ids = readFriendIds();
  if (ids.includes(accountId)) throw new Error("That friend is already in your party.");
  if (ids.length >= maxFriends) throw new Error(`Your party list is full. Remove a friend before adding another (maximum ${maxFriends}).`);

  const [player, record] = await Promise.all([
    apiJson(`https://api.opendota.com/api/players/${accountId}`),
    apiJson(`https://api.opendota.com/api/players/${accountId}/wl`)
  ]);
  if (!player.profile?.personaname) throw new Error("No public OpenDota profile found. Ask your friend to make their Dota profile public and try again.");
  if (!record || !Number.isFinite(Number(record.win)) || !Number.isFinite(Number(record.lose))) {
    throw new Error("OpenDota could not read this player's match record. Please try again later.");
  }
  saveFriendIds([...ids, accountId]);
  return player.profile.personaname;
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDate(unixSeconds) {
  const date = new Date(unixSeconds * 1000);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function createMatchPlayerCard(player) {
  const card = document.createElement("article");
  const isCurrentPlayer = activeMatchAccountId && String(player.account_id) === String(activeMatchAccountId);
  card.className = `match-player-card${isCurrentPlayer ? " match-player-current" : ""}`;

  const hero = heroById.get(player.hero_id);
  const top = document.createElement("div");
  top.className = "match-player-top";
  const heroImage = document.createElement("img");
  heroImage.className = "match-player-hero";
  if (hero) {
    heroImage.src = `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${hero.name.replace("npc_dota_hero_", "")}.png`;
    heroImage.alt = "";
    heroImage.loading = "lazy";
  } else {
    heroImage.hidden = true;
  }

  const identity = document.createElement("div");
  identity.className = "match-player-identity";
  const playerName = document.createElement("span");
  playerName.className = "match-player-name";
  const displayName = player.personaname || (player.account_id ? `Player ${player.account_id}` : "Anonymous player");
  if (player.account_id) {
    const profileLink = document.createElement("a");
    profileLink.href = `https://www.opendota.com/players/${encodeURIComponent(player.account_id)}`;
    profileLink.target = "_blank";
    profileLink.rel = "noopener noreferrer";
    profileLink.textContent = displayName;
    playerName.append(profileLink);
  } else {
    playerName.textContent = displayName;
  }
  const heroName = document.createElement("span");
  heroName.className = "match-player-hero-name";
  heroName.textContent = hero?.localized_name || "Unknown hero";
  identity.append(playerName, heroName);
  top.append(heroImage, identity);

  const kda = document.createElement("div");
  kda.className = "match-player-kda";
  const kdaValue = document.createElement("strong");
  kdaValue.textContent = `${player.kills ?? 0} / ${player.deaths ?? 0} / ${player.assists ?? 0}`;
  const kdaLabel = document.createElement("span");
  kdaLabel.textContent = "K / D / A";
  kda.append(kdaValue, kdaLabel);

  const metrics = document.createElement("div");
  metrics.className = "match-player-metrics";
  for (const [label, value] of [
    ["LVL", player.level],
    ["LH / DN", `${player.last_hits ?? 0} / ${player.denies ?? 0}`],
    ["NET WORTH", player.net_worth == null ? "—" : formatNumber(player.net_worth)],
    ["GPM", player.gold_per_min ?? "—"],
    ["XPM", player.xp_per_min ?? "—"]
  ]) {
    const metric = document.createElement("div");
    const metricValue = document.createElement("strong");
    metricValue.textContent = String(value ?? "—");
    const metricLabel = document.createElement("span");
    metricLabel.textContent = label;
    metric.append(metricValue, metricLabel);
    metrics.append(metric);
  }

  const inventory = document.createElement("div");
  inventory.className = "match-player-inventory";
  inventory.setAttribute("aria-label", `${displayName}'s inventory`);
  for (let slot = 0; slot < 6; slot += 1) {
    const itemId = Number(player[`item_${slot}`]) || 0;
    const itemInfo = itemNames.get(itemId);
    const itemSlot = document.createElement("span");
    itemSlot.className = "match-item-slot";
    if (itemId && itemInfo) {
      const image = document.createElement("img");
      image.src = `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/${itemInfo.name}.png`;
      image.alt = itemInfo.displayName;
      image.title = itemInfo.displayName;
      image.loading = "lazy";
      image.addEventListener("error", () => {
        image.hidden = true;
        itemSlot.textContent = itemInfo.displayName;
      }, { once: true });
      itemSlot.append(image);
    } else if (itemId) {
      itemSlot.textContent = `#${itemId}`;
      itemSlot.title = "Item name unavailable";
    } else {
      itemSlot.classList.add("match-item-empty");
      itemSlot.textContent = "·";
      itemSlot.setAttribute("aria-label", "Empty item slot");
    }
    inventory.append(itemSlot);
  }

  card.append(top, kda, metrics, inventory);
  return card;
}

function loadItemNames() {
  if (!itemNamesPromise) {
    itemNamesPromise = apiJson("https://api.opendota.com/api/constants/items").then((items) => {
      itemNames = new Map(Object.entries(items).map(([name, item]) => [
        Number(item.id),
        { name, displayName: item.dname || name.replaceAll("_", " ") }
      ]));
      return itemNames;
    }).catch((error) => {
      itemNamesPromise = undefined;
      throw error;
    });
  }
  return itemNamesPromise;
}

function renderMatchTeam(container, teamName, players, match) {
  const radiant = teamName === "radiant";
  const teamWon = match.radiant_win === radiant;
  const heading = document.createElement("div");
  heading.className = `match-team-heading match-team-${teamName}`;
  const title = document.createElement("h3");
  title.textContent = radiant ? "Radiant" : "Dire";
  const score = document.createElement("strong");
  score.textContent = String(radiant ? match.radiant_score ?? "—" : match.dire_score ?? "—");
  const result = document.createElement("span");
  result.className = `match-team-result ${teamWon ? "match-team-won" : "match-team-lost"}`;
  result.textContent = teamWon ? "VICTORY" : "DEFEAT";
  heading.append(title, score, result);

  const playerList = document.createElement("div");
  playerList.className = "match-team-players";
  for (const player of players) playerList.append(createMatchPlayerCard(player));
  container.append(heading, playerList);
}

const advantageMetrics = [
  { id: "netWorth", label: "NET WORTH", direct: "radiant_net_worth_adv", player: "net_worth_t" },
  { id: "experience", label: "EXPERIENCE", direct: "radiant_xp_adv", player: "xp_t" },
  { id: "goldEarned", label: "GOLD EARNED", direct: "radiant_gold_adv", player: "gold_t" }
];

function getAdvantageSeries(match, metric) {
  const direct = match[metric.direct];
  if (Array.isArray(direct) && direct.length > 1) {
    return direct.map(Number).filter(Number.isFinite);
  }

  const radiant = [];
  const dire = [];
  for (const player of match.players || []) {
    const values = player[metric.player];
    if (!Array.isArray(values) || values.length < 2) continue;
    const team = player.player_slot < 128 ? radiant : dire;
    for (let index = 0; index < values.length; index += 1) {
      const value = Number(values[index]);
      if (!Number.isFinite(value)) continue;
      team[index] = (team[index] || 0) + value;
    }
  }
  const length = Math.min(radiant.length, dire.length);
  if (length < 2) return [];
  return Array.from({ length }, (_, index) => (radiant[index] || 0) - (dire[index] || 0));
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function renderAdvantageGraph(chart, series, duration, metric) {
  chart.replaceChildren();
  if (!series.length) {
    const unavailable = document.createElement("div");
    unavailable.className = "advantage-unavailable";
    unavailable.textContent = `${metric.label} timeline isn't available for this match. OpenDota hasn't provided the per-minute replay data.`;
    chart.append(unavailable);
    return;
  }

  const width = 1000;
  const height = 310;
  const margin = { top: 20, right: 20, bottom: 43, left: 68 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxMagnitude = Math.max(1, ...series.map(Math.abs));
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxMagnitude)));
  const step = magnitude / 2;
  const bound = Math.ceil(maxMagnitude / step) * step;
  const baselineY = margin.top + (bound / (2 * bound)) * plotHeight;
  const x = (index) => margin.left + (index / Math.max(1, series.length - 1)) * plotWidth;
  const y = (value) => margin.top + ((bound - value) / (2 * bound)) * plotHeight;
  const svg = svgElement("svg", {
    class: "advantage-svg",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `${metric.label} advantage per minute, Radiant compared with Dire`
  });

  for (let value = -bound; value <= bound; value += step) {
    const position = y(value);
    svg.append(svgElement("line", {
      x1: margin.left,
      y1: position,
      x2: width - margin.right,
      y2: position,
      class: value === 0 ? "advantage-zero-line" : "advantage-grid-line"
    }));
    const label = svgElement("text", {
      x: margin.left - 11,
      y: position + 4,
      "text-anchor": "end",
      class: "advantage-axis-label"
    });
    label.textContent = value === 0 ? "0" : `${value > 0 ? "+" : "−"}${formatNumber(Math.round(Math.abs(value) / 1000))}k`;
    svg.append(label);
  }

  const tickCount = 5;
  for (let tick = 0; tick < tickCount; tick += 1) {
    const ratio = tick / (tickCount - 1);
    const minute = Math.round((duration / 60) * ratio);
    const position = margin.left + plotWidth * ratio;
    svg.append(svgElement("line", {
      x1: position,
      y1: margin.top,
      x2: position,
      y2: height - margin.bottom,
      class: "advantage-grid-line advantage-vertical-line"
    }));
    const label = svgElement("text", {
      x: position,
      y: height - 14,
      "text-anchor": "middle",
      class: "advantage-axis-label"
    });
    label.textContent = `${minute}:00`;
    svg.append(label);
  }

  let start = 0;
  while (start < series.length) {
    const positive = series[start] >= 0;
    let end = start + 1;
    while (end < series.length && (series[end] >= 0) === positive) end += 1;
    const segment = series.slice(start, end);
    const firstX = x(start);
    const lastX = x(end - 1);
    const points = segment.map((value, offset) => `${x(start + offset)},${y(value)}`).join(" ");
    const fill = svgElement("polygon", {
      points: `${firstX},${baselineY} ${points} ${lastX},${baselineY}`,
      class: positive ? "advantage-radiant-fill" : "advantage-dire-fill"
    });
    const line = svgElement("polyline", {
      points,
      class: positive ? "advantage-radiant-line" : "advantage-dire-line"
    });
    svg.append(fill, line);
    start = end;
  }

  chart.append(svg);
}

function renderAdvantageSection(match) {
  const section = document.createElement("section");
  section.className = "advantage-section";
  section.setAttribute("aria-label", "Team advantage per minute");
  const heading = document.createElement("div");
  heading.className = "advantage-heading";
  const titleGroup = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.innerHTML = '<span class="eyebrow-line"></span> MATCH TIMELINE';
  const title = document.createElement("h3");
  title.textContent = "Team advantages per minute";
  titleGroup.append(eyebrow, title);
  const legend = document.createElement("div");
  legend.className = "advantage-legend";
  for (const [label, className] of [["RADIANT", "advantage-legend-radiant"], ["DIRE", "advantage-legend-dire"]]) {
    const item = document.createElement("span");
    item.className = className;
    item.textContent = label;
    legend.append(item);
  }
  heading.append(titleGroup, legend);

  const tabs = document.createElement("div");
  tabs.className = "advantage-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Choose an advantage graph");
  const chart = document.createElement("div");
  chart.className = "advantage-chart";
  const seriesByMetric = new Map(advantageMetrics.map((metric) => [metric.id, getAdvantageSeries(match, metric)]));
  const enabledMetric = advantageMetrics.find((metric) => seriesByMetric.get(metric.id).length > 1);
  const selectedMetric = enabledMetric?.id || advantageMetrics[0].id;

  for (const metric of advantageMetrics) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "advantage-tab";
    button.id = `advantage-tab-${metric.id}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(metric.id === selectedMetric));
    button.setAttribute("aria-controls", "advantage-chart");
    button.textContent = metric.label;
    button.addEventListener("click", () => {
      tabs.querySelectorAll(".advantage-tab").forEach((tab) => tab.setAttribute("aria-selected", String(tab === button)));
      chart.setAttribute("aria-labelledby", button.id);
      renderAdvantageGraph(chart, seriesByMetric.get(metric.id), match.duration, metric);
    });
    tabs.append(button);
  }
  chart.id = "advantage-chart";
  chart.setAttribute("role", "tabpanel");
  chart.setAttribute("aria-labelledby", `advantage-tab-${selectedMetric}`);
  renderAdvantageGraph(chart, seriesByMetric.get(selectedMetric), match.duration, advantageMetrics.find((metric) => metric.id === selectedMetric));
  section.append(heading, tabs, chart);
  return section;
}

function renderMatchDetails(match, itemNamesAvailable) {
  const content = $("#match-dialog-content");
  content.replaceChildren();
  const currentPlayer = match.players?.find((player) => String(player.account_id) === String(signedInAccountId));
  const currentPlayerWon = currentPlayer ? match.radiant_win === (currentPlayer.player_slot < 128) : null;

  const summary = document.createElement("section");
  summary.className = `match-detail-summary ${currentPlayerWon === null ? "" : currentPlayerWon ? "match-summary-win" : "match-summary-loss"}`;
  const summaryResult = document.createElement("span");
  summaryResult.className = "match-detail-result";
  summaryResult.textContent = currentPlayerWon === null ? (match.radiant_win ? "RADIANT VICTORY" : "DIRE VICTORY") : currentPlayerWon ? "YOUR VICTORY" : "YOUR DEFEAT";
  const score = document.createElement("strong");
  score.className = "match-detail-score";
  score.textContent = `${match.radiant_score ?? "—"} : ${match.dire_score ?? "—"}`;
  const meta = document.createElement("div");
  meta.className = "match-detail-meta";
  const duration = document.createElement("span");
  duration.textContent = formatDuration(match.duration);
  const date = document.createElement("span");
  date.textContent = match.start_time ? formatDate(match.start_time) : "Date unavailable";
  const matchId = document.createElement("span");
  matchId.textContent = `MATCH ${match.match_id}`;
  const openDota = document.createElement("a");
  openDota.href = `https://www.opendota.com/matches/${encodeURIComponent(match.match_id)}`;
  openDota.target = "_blank";
  openDota.rel = "noopener noreferrer";
  openDota.textContent = "OpenDota ↗";
  meta.append(duration, date, matchId, openDota);
  summary.append(summaryResult, score, meta);
  content.append(summary);
  content.append(renderAdvantageSection(match));

  if (!itemNamesAvailable) {
    const itemNotice = document.createElement("p");
    itemNotice.className = "match-item-notice";
    itemNotice.textContent = "Item names could not be loaded from OpenDota. The rest of the match details are available.";
    content.append(itemNotice);
  }

  if (!Array.isArray(match.players) || match.players.length === 0) {
    const unavailable = document.createElement("p");
    unavailable.className = "match-modal-notice";
    unavailable.textContent = "OpenDota did not provide player-by-player details for this match.";
    content.append(unavailable);
    return;
  }

  const teams = document.createElement("div");
  teams.className = "match-teams";
  const radiant = document.createElement("section");
  radiant.className = "match-team";
  radiant.setAttribute("aria-label", "Radiant team");
  renderMatchTeam(radiant, "radiant", match.players.filter((player) => player.player_slot < 128), match);
  const dire = document.createElement("section");
  dire.className = "match-team";
  dire.setAttribute("aria-label", "Dire team");
  renderMatchTeam(dire, "dire", match.players.filter((player) => player.player_slot >= 128), match);
  teams.append(radiant, dire);
  content.append(teams);
}

async function openMatchDetails(matchId, focusAccountId = signedInAccountId) {
  const dialog = $("#match-dialog");
  const content = $("#match-dialog-content");
  const requestId = ++activeMatchRequest;
  activeMatchAccountId = focusAccountId;
  $("#match-dialog-title").textContent = "Match details";
  content.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "match-modal-loading";
  loading.innerHTML = '<span class="loading-spinner"></span> Summoning the full battle report…';
  content.append(loading);
  dialog.showModal();

  const detailsRequest = apiJson(`https://api.opendota.com/api/matches/${encodeURIComponent(matchId)}`);
  try {
    const [matchResult, itemsResult] = await Promise.allSettled([detailsRequest, loadItemNames()]);
    if (!dialog.open || requestId !== activeMatchRequest) return;
    if (matchResult.status === "rejected") throw matchResult.reason;
    const itemNamesAvailable = itemsResult.status === "fulfilled";
    renderMatchDetails(matchResult.value, itemNamesAvailable);
    content.scrollTop = 0;
  } catch (error) {
    if (!dialog.open || requestId !== activeMatchRequest) return;
    content.replaceChildren();
    const message = document.createElement("p");
    message.className = "match-modal-error";
    message.textContent = `Couldn't load this match from OpenDota. ${error.message}. Please try again in a moment.`;
    content.append(message);
  }
}

function renderMatches(matches, bodySelector = "#matches-body", summarySelector = "#history-summary", focusAccountId = signedInAccountId) {
  const body = $(bodySelector);
  body.replaceChildren();
  const summary = $(summarySelector);
  if (summary) summary.textContent = `${matches.length} ${matches.length === 1 ? "GAME" : "GAMES"}`;
  if (!matches.length) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 8;
    cell.className = "empty-matches";
    cell.textContent = "No matches found for these filters.";
    return;
  }

  for (const match of matches) {
    const row = body.insertRow();
    row.className = "match-row-clickable";
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `View details for match ${match.match_id}`);
    row.dataset.matchId = match.match_id;
    if (focusAccountId) row.dataset.focusAccountId = focusAccountId;
    const isRadiant = match.player_slot < 128;
    const won = match.radiant_win === isRadiant;
    const outcome = row.insertCell();
    outcome.innerHTML = `<span class="result-label ${won ? "result-win" : "result-loss"}">${won ? "WIN" : "LOSS"}</span>`;

    const heroCell = row.insertCell();
    heroCell.className = "hero-cell";
    const hero = heroById.get(match.hero_id);
    if (hero) {
      const img = document.createElement("img");
      img.src = `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${hero.name.replace("npc_dota_hero_", "")}.png`;
      img.alt = "";
      img.loading = "lazy";
      heroCell.append(img);
    }
    const heroName = document.createElement("span");
    heroName.textContent = hero?.localized_name ?? "Unknown hero";
    heroCell.append(heroName);

    const rankCell = row.insertCell();
    rankCell.className = "rank-cell";
    const rankTier = matchRankTier(match);
    if (rankTier !== undefined) {
      const rank = rankDetails(rankTier);
      const rankContent = document.createElement("div");
      rankContent.className = "rank-content";
      const img = document.createElement("img");
      img.src = rank.image;
      img.alt = `${rank.name} ${rank.stars}`.trim();
      img.title = `${rank.name}${rank.stars ? ` · ${rank.stars}` : ""}`;
      rankContent.append(img);
      const label = document.createElement("span");
      label.textContent = `${rank.name}${rank.stars ? ` · ${rank.stars}` : ""}`;
      rankContent.append(label);
      rankCell.append(rankContent);
    } else {
      rankCell.classList.add("rank-unavailable");
      rankCell.textContent = "Not provided";
      rankCell.title = "OpenDota has no average rank data for this match. Ancient does not guess a game rank.";
      rankCell.setAttribute("aria-label", "Game rank not provided by OpenDota");
    }

    const modeCell = row.insertCell();
    modeCell.className = "game-mode-cell";
    modeCell.textContent = matchModeLabel(match);

    const mmrCell = row.insertCell();
    mmrCell.className = "mmr-change-cell";
    const mmrChange = matchMmrChange(match, focusAccountId);
    mmrCell.textContent = mmrChange.text;
    mmrCell.title = mmrChange.title;

    const kda = row.insertCell();
    kda.className = "kda-cell";
    kda.append(
      document.createTextNode(`${match.kills} / `),
      Object.assign(document.createElement("span"), {
        className: "deaths",
        textContent: match.deaths
      }),
      document.createTextNode(` / ${match.assists}`)
    );
    row.insertCell().textContent = formatDuration(match.duration);
    row.insertCell().textContent = formatDate(match.start_time);
  }
}

for (const body of document.querySelectorAll(".match-table-body")) {
  body.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-match-id]");
    if (row) openMatchDetails(row.dataset.matchId, row.dataset.focusAccountId || signedInAccountId);
  });

  body.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("tr[data-match-id]");
    if (!row) return;
    event.preventDefault();
    openMatchDetails(row.dataset.matchId, row.dataset.focusAccountId || signedInAccountId);
  });
}

$("#match-dialog-close").addEventListener("click", () => $("#match-dialog").close());
$("#match-dialog").addEventListener("click", (event) => {
  if (event.target === $("#match-dialog")) $("#match-dialog").close();
});
$("#match-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  $("#match-dialog").close();
});
$("#match-dialog").addEventListener("close", () => {
  activeMatchRequest += 1;
});
window.addEventListener("keydown", (event) => {
  const dialog = $("#match-dialog");
  if (event.key === "Escape" && dialog.open) {
    event.preventDefault();
    dialog.close();
  }
});

function renderRecentForm(matches) {
  const recent = matches.slice(0, 5);
  const wins = recent.filter((match) => match.radiant_win === (match.player_slot < 128)).length;
  $("#recent-form-summary").textContent = recent.length ? `${wins}W – ${recent.length - wins}L` : "—";
  const marks = $("#recent-form");
  marks.replaceChildren();
  for (const match of recent) {
    const won = match.radiant_win === (match.player_slot < 128);
    const mark = document.createElement("span");
    mark.className = `form-mark ${won ? "form-mark-win" : "form-mark-loss"}`;
    mark.textContent = won ? "W" : "L";
    mark.title = `${won ? "Win" : "Loss"} · ${formatDate(match.start_time)}`;
    marks.append(mark);
  }
}

function readMmrSettings(accountId) {
  const stored = localStorage.getItem(`${mmrSettingsStoragePrefix}${accountId}`);
  if (!stored) return null;
  const settings = JSON.parse(stored);
  if (!settings || !Number.isInteger(settings.currentMmr) || settings.currentMmr < 1 || settings.currentMmr > 20000
    || !Number.isInteger(settings.matchChange) || settings.matchChange < 1 || settings.matchChange > 100) {
    throw new Error("Saved MMR settings are invalid. Enter them again to replace the saved values.");
  }
  const baselineWasMigrated = settings.baselineAt === undefined;
  if (baselineWasMigrated) {
    settings.baselineAt = Math.floor(Date.now() / 1000);
    localStorage.setItem(`${mmrSettingsStoragePrefix}${accountId}`, JSON.stringify({
      currentMmr: settings.currentMmr,
      matchChange: settings.matchChange,
      baselineAt: settings.baselineAt
    }));
  }
  if (!Number.isInteger(settings.baselineAt) || settings.baselineAt < 1
    || settings.baselineAt > Math.floor(Date.now() / 1000) + 60) {
    throw new Error("Saved MMR baseline date is invalid. Enter your MMR again to replace the saved values.");
  }
  if (baselineWasMigrated) settings.baselineWasMigrated = true;
  return settings;
}

function isRankedMmrMatch(match) {
  return [5, 6, 7].includes(Number(match.lobby_type))
    && match.start_time !== null
    && match.start_time !== undefined
    && Number.isFinite(Number(match.start_time))
    && Number(match.start_time) > 0
    && typeof match.radiant_win === "boolean"
    && match.player_slot !== null
    && match.player_slot !== undefined
    && Number.isFinite(Number(match.player_slot));
}

function renderMmrTrend(matches, message = "") {
  const chart = $("#win-loss-chart");
  const summary = $("#win-loss-summary");
  const reportValues = [
    $("#mmr-report-current"),
    $("#mmr-report-change"),
    $("#mmr-report-wins"),
    $("#mmr-report-losses")
  ];
  const tooltip = $("#win-loss-tooltip-text");
  const tooltipHero = $("#win-loss-tooltip-hero");
  chart.replaceChildren();
  chart.scrollLeft = 0;
  reportValues.forEach((value) => {
    value.textContent = "—";
    value.classList.remove("mmr-report-positive", "mmr-report-negative");
  });
  tooltip.textContent = message || "Hover over or focus an arrow to inspect that match.";
  tooltipHero.hidden = true;
  tooltipHero.removeAttribute("src");
  if (!Array.isArray(matches)) {
    summary.textContent = message || "Recent results unavailable.";
    return;
  }

  if (!mmrSettings) {
    summary.textContent = "Enter your MMR and set the baseline to begin tracking.";
    const prompt = document.createElement("p");
    prompt.className = "mmr-chart-empty";
    prompt.textContent = "Your ranked match history will be estimated from the MMR and per-game change you enter above.";
    chart.append(prompt);
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const rankedGames = matches
    .filter((match) => isRankedMmrMatch(match)
      && Number(match.start_time) > mmrSettings.baselineAt
      && Number(match.start_time) <= now)
    .map((match) => {
      const won = match.radiant_win === (Number(match.player_slot) < 128);
      return {
        match,
        won,
        change: won ? mmrSettings.matchChange : -mmrSettings.matchChange
      };
    })
    .sort((a, b) => Number(a.match.start_time) - Number(b.match.start_time));
  if (!rankedGames.length) {
    summary.textContent = `MMR baseline: ${formatNumber(mmrSettings.currentMmr)} · set ${formatDate(mmrSettings.baselineAt)}.`;
    reportValues[0].textContent = formatNumber(mmrSettings.currentMmr);
    reportValues[1].textContent = "0";
    reportValues[2].textContent = "+0";
    reportValues[3].textContent = "−0";
    const empty = document.createElement("p");
    empty.className = "mmr-chart-empty";
    empty.textContent = "No ranked matches with results since this MMR baseline was set.";
    chart.append(empty);
    return;
  }

  let estimatedMmr = mmrSettings.currentMmr;
  for (const game of rankedGames) {
    game.previousMmr = estimatedMmr;
    estimatedMmr += game.change;
    game.mmr = estimatedMmr;
  }

  const wins = rankedGames.filter((game) => game.won).length;
  const losses = rankedGames.length - wins;
  const winGains = wins * mmrSettings.matchChange;
  const lossDeductions = losses * mmrSettings.matchChange;
  const netChange = rankedGames.reduce((total, game) => total + game.change, 0);
  const netLabel = `${netChange > 0 ? "+" : ""}${formatNumber(netChange)}`;
  reportValues[0].textContent = formatNumber(mmrSettings.currentMmr);
  reportValues[1].textContent = netLabel;
  reportValues[1].classList.toggle("mmr-report-positive", netChange > 0);
  reportValues[1].classList.toggle("mmr-report-negative", netChange < 0);
  reportValues[2].textContent = `+${formatNumber(winGains)}`;
  reportValues[3].textContent = `−${formatNumber(lossDeductions)}`;
  summary.textContent = `Estimated MMR: ${formatNumber(mmrSettings.currentMmr)} → ${formatNumber(estimatedMmr)} · ${rankedGames.length} ranked games since ${formatDate(mmrSettings.baselineAt)} · ${wins} wins / ${losses} losses`;

  const margin = { top: 22, right: 16, bottom: 34, left: 58 };
  const minimumWidth = Math.max(580, chart.clientWidth || 0);
  const pointSpacing = 26;
  const width = Math.max(minimumWidth, (rankedGames.length + 1) * pointSpacing + margin.left + margin.right);
  const height = 330;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = [mmrSettings.currentMmr, ...rankedGames.map((game) => game.mmr)];
  const valueSpan = Math.max(300, Math.max(...values) - Math.min(...values));
  const padding = valueSpan * 0.12;
  const axisMin = Math.floor((Math.min(...values) - padding) / 500) * 500;
  const axisMax = Math.max(axisMin + 500, Math.ceil((Math.max(...values) + padding) / 500) * 500);
  const yForMmr = (value) => margin.top + ((axisMax - value) / (axisMax - axisMin)) * plotHeight;
  const xForIndex = (index) => margin.left + (plotWidth - rankedGames.length * pointSpacing) / 2 + index * pointSpacing;
  const svg = svgElement("svg", {
    class: "win-loss-svg mmr-trend-svg",
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: "img",
    "aria-label": `Estimated MMR trend from a baseline of ${formatNumber(mmrSettings.currentMmr)} MMR through ${rankedGames.length} ranked games played since ${formatDate(mmrSettings.baselineAt)}. The estimated ending MMR is ${formatNumber(estimatedMmr)}.`
  });
  const tickValues = [axisMax, Math.round((axisMin + axisMax) / 2), axisMin];
  for (const [index, value] of tickValues.entries()) {
    const y = yForMmr(value);
    const label = svgElement("text", {
      x: margin.left - 8,
      y: y + 4,
      "text-anchor": "end",
      class: "win-loss-axis-label"
    });
    label.textContent = formatNumber(value);
    svg.append(
      svgElement("line", {
        x1: margin.left,
        y1: y,
        x2: width - margin.right,
        y2: y,
        class: index === tickValues.length - 1 ? "win-loss-zero-line" : "win-loss-grid-line"
      }),
      label
    );
  }

  for (const [index, game] of rankedGames.entries()) {
    const previousX = xForIndex(index);
    const x = xForIndex(index + 1);
    const previousY = yForMmr(game.previousMmr);
    const y = yForMmr(game.mmr);
    const hero = heroById.get(Number(game.match.hero_id));
    const heroName = hero?.localized_name || "Unknown hero";
    const date = formatDate(game.match.start_time);
    const change = `${game.change > 0 ? "+" : ""}${formatNumber(game.change)}`;
    const result = game.won ? "WIN" : "LOSS";
    const label = `${date}: ${result}, estimated ${change} MMR to ${formatNumber(game.mmr)} MMR. ${heroName}. Select for match analytics.`;
    const point = svgElement("g", {
      class: `win-loss-point-group mmr-match-group ${game.won ? "mmr-bar-win" : "mmr-bar-loss"}`,
      tabindex: 0,
      role: "button",
      "aria-pressed": String(Number(game.match.match_id) === selectedTrendMatchId),
      "aria-label": label,
      "aria-describedby": "win-loss-tooltip"
    });
    const title = svgElement("title");
    title.textContent = label;
    const direction = Math.atan2(y - previousY, x - previousX) * 180 / Math.PI + 90;
    point.append(
      title,
      svgElement("line", {
        x1: previousX,
        y1: previousY,
        x2: x,
        y2: y,
        class: `mmr-trend-segment ${game.won ? "mmr-segment-win" : "mmr-segment-loss"}`
      }),
      svgElement("polygon", {
        points: "-4,4 4,4 0,-4",
        transform: `translate(${x} ${y}) rotate(${direction})`,
        class: `mmr-trend-arrow ${game.won ? "mmr-segment-win" : "mmr-segment-loss"}`
      }),
      svgElement("circle", {
        cx: x,
        cy: y,
        r: 8,
        class: "mmr-point-hit"
      }),
      svgElement("circle", {
        cx: x,
        cy: y,
        r: 3,
        class: `mmr-trend-point ${game.won ? "mmr-segment-win" : "mmr-segment-loss"}`
      }),
      svgElement("rect", {
        x: Math.min(previousX, x) - 6,
        y: margin.top,
        width: Math.abs(x - previousX) + 12,
        height: plotHeight,
        class: "mmr-bar-hit"
      })
    );
    const showMatch = () => {
      tooltip.textContent = `${date} · ${result} · ${change} MMR · Estimated ${formatNumber(game.mmr)} · ${heroName}`;
      if (hero) {
        tooltipHero.src = `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${hero.name.replace("npc_dota_hero_", "")}.png`;
        tooltipHero.alt = `${heroName} portrait`;
        tooltipHero.hidden = false;
      } else {
        tooltipHero.hidden = true;
      }
    };
    const resetTooltip = () => {
      if (document.activeElement !== point) {
        tooltip.textContent = "Hover or focus an arrow to inspect that match; select it to review stats and items.";
        tooltipHero.hidden = true;
      }
    };
    const selectMatch = () => {
      selectedTrendMatchId = Number(game.match.match_id);
      for (const pointGroup of svg.querySelectorAll(".win-loss-point-group")) {
        pointGroup.setAttribute("aria-pressed", String(pointGroup === point));
      }
      renderSelectedMatchReview(game.match, `${date} · RANKED MATCH · ESTIMATED ${change} MMR`);
    };
    point.addEventListener("pointerenter", showMatch);
    point.addEventListener("pointerleave", resetTooltip);
    point.addEventListener("focus", showMatch);
    point.addEventListener("blur", resetTooltip);
    point.addEventListener("click", selectMatch);
    point.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectMatch();
    });
    svg.append(point);
  }

  svg.append(svgElement("circle", {
    cx: xForIndex(0),
    cy: yForMmr(mmrSettings.currentMmr),
    r: 3,
    class: "mmr-baseline-point"
  }));
  const firstLabel = svgElement("text", {
    x: margin.left,
    y: height - 5,
    "text-anchor": "start",
    class: "win-loss-axis-label"
  });
  firstLabel.textContent = "MMR SET";
  const lastLabel = svgElement("text", {
    x: width - margin.right,
    y: height - 5,
    "text-anchor": "end",
    class: "win-loss-axis-label"
  });
  lastLabel.textContent = "LATEST MATCH";
  svg.append(firstLabel, lastLabel);
  chart.append(svg);
}

$("#mmr-settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const status = $("#mmr-settings-status");
  if (!signedInAccountId) {
    status.textContent = "Sign in before saving MMR settings.";
    return;
  }
  const settings = {
    currentMmr: Number($("#mmr-current-input").value),
    matchChange: Number($("#mmr-change-input").value),
    baselineAt: Math.floor(Date.now() / 1000)
  };
  if (!Number.isInteger(settings.currentMmr) || settings.currentMmr < 1 || settings.currentMmr > 20000
    || !Number.isInteger(settings.matchChange) || settings.matchChange < 1 || settings.matchChange > 100) {
    status.textContent = "Enter a baseline MMR from 1 to 20,000 and a ranked-game change from 1 to 100.";
    return;
  }
  try {
    localStorage.setItem(`${mmrSettingsStoragePrefix}${signedInAccountId}`, JSON.stringify(settings));
  } catch (error) {
    status.textContent = `MMR settings couldn't be saved in this browser: ${error.message}`;
    return;
  }
  mmrSettings = settings;
  status.textContent = "MMR settings saved in this browser for your Steam account.";
  renderMmrTrend(mmrMatches, mmrMatches ? "" : "Loading ranked matches…");
  if (historyLoaded) renderHistoryMatches();
});

function loadHeroItemPopularity(heroId) {
  const id = Number(heroId);
  if (!Number.isInteger(id) || id < 1) return Promise.reject(new Error("This match has no valid hero ID."));
  if (!heroItemPopularity.has(id)) {
    const request = apiJson(`https://api.opendota.com/api/heroes/${encodeURIComponent(id)}/itemPopularity`)
      .catch((error) => {
        heroItemPopularity.delete(id);
        throw error;
      });
    heroItemPopularity.set(id, request);
  }
  return heroItemPopularity.get(id);
}

function appendMatchItemInventory(container, match) {
  const heading = document.createElement("h4");
  heading.className = "selected-items-heading";
  heading.textContent = "ITEMS IN THIS MATCH";
  container.append(heading);
  const items = Array.from({ length: 6 }, (_, slot) => Number(match[`item_${slot}`]) || 0).filter(Boolean);
  if (!items.length) {
    const unavailable = document.createElement("p");
    unavailable.className = "selected-items-note";
    unavailable.textContent = "OpenDota did not include this match's final inventory.";
    container.append(unavailable);
    return;
  }

  const list = document.createElement("div");
  list.className = "selected-match-items";
  for (const itemId of items) {
    const info = itemNames.get(itemId);
    const item = document.createElement("span");
    item.className = "selected-match-item";
    if (info) {
      const image = document.createElement("img");
      image.src = `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/${info.name}.png`;
      image.alt = info.displayName;
      image.title = info.displayName;
      image.loading = "lazy";
      image.addEventListener("error", () => {
        image.hidden = true;
        item.append(Object.assign(document.createElement("span"), { textContent: info.displayName }));
      }, { once: true });
      item.append(image);
    } else {
      item.textContent = `Item #${itemId}`;
      item.title = "OpenDota item name unavailable";
    }
    list.append(item);
  }
  container.append(list);
}

async function renderSelectedMatchReview(match, labelText) {
  const container = $("#improvement-focus");
  const requestId = Number(match.match_id);
  const won = match.radiant_win === (Number(match.player_slot) < 128);
  const hero = heroById.get(match.hero_id);
  const heroName = hero?.localized_name || "Unknown hero";
  const readNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
    ? Number(value)
    : null;
  const kda = [match.kills, match.deaths, match.assists].map(readNumber);
  const lastHits = readNumber(match.last_hits);
  const duration = readNumber(match.duration);
  const stats = [
    ["K / D / A", kda.every((value) => value !== null) ? kda.join(" / ") : "Unavailable"],
    ["GOLD / MIN", readNumber(match.gold_per_min) === null ? "Unavailable" : `${Math.round(Number(match.gold_per_min))}`],
    ["XP / MIN", readNumber(match.xp_per_min) === null ? "Unavailable" : `${Math.round(Number(match.xp_per_min))}`],
    ["LAST HITS / MIN", lastHits !== null && duration > 0 ? (lastHits / (duration / 60)).toFixed(1) : "Unavailable"],
    ["DEATHS", readNumber(match.deaths) === null ? "Unavailable" : String(match.deaths)]
  ];
  const label = document.createElement("span");
  label.className = "improvement-pattern-label";
  label.textContent = `${labelText} · ${won ? "WIN" : "LOSS"}`;
  const title = document.createElement("h3");
  title.className = "improvement-metric";
  title.textContent = heroName;
  const statsGrid = document.createElement("div");
  statsGrid.className = "selected-match-stats";
  for (const [name, value] of stats) {
    const stat = document.createElement("div");
    stat.className = "selected-match-stat";
    const statName = document.createElement("span");
    statName.textContent = name;
    const statValue = document.createElement("strong");
    statValue.textContent = value;
    stat.append(statName, statValue);
    statsGrid.append(stat);
  }
  const itemPanel = document.createElement("section");
  itemPanel.className = "selected-match-build";
  const inventoryLoading = document.createElement("p");
  inventoryLoading.className = "selected-items-note";
  inventoryLoading.textContent = "Loading item names…";
  itemPanel.append(inventoryLoading);
  const buildHeading = document.createElement("h4");
  buildHeading.className = "selected-items-heading";
  buildHeading.textContent = `POPULAR ${heroName.toUpperCase()} ITEMS`;
  const buildNote = document.createElement("p");
  buildNote.className = "selected-items-note";
  buildNote.textContent = "General OpenDota item trends by game stage, not a personalized build recommendation.";
  const trends = document.createElement("div");
  trends.className = "selected-item-trends";
  const backButton = $("#overall-analysis-button");
  backButton.hidden = false;
  container.replaceChildren(label, title, statsGrid, itemPanel, buildHeading, buildNote, trends);

  const buildRequest = loadHeroItemPopularity(match.hero_id);
  const namesRequest = loadItemNames();
  const [buildResult, namesResult] = await Promise.allSettled([buildRequest, namesRequest]);
  if (selectedTrendMatchId !== requestId || container !== $("#improvement-focus")) return;
  itemPanel.replaceChildren();
  appendMatchItemInventory(itemPanel, match);
  if (namesResult.status === "rejected") {
    const itemNameError = document.createElement("p");
    itemNameError.className = "selected-items-note selected-items-error";
    itemNameError.textContent = `Item names unavailable: ${namesResult.reason.message}`;
    itemPanel.append(itemNameError);
  }
  if (buildResult.status === "fulfilled") {
    renderHeroBuilds(buildResult.value, trends);
  } else if (buildResult.status === "rejected") {
    const buildError = document.createElement("p");
    buildError.className = "selected-items-note selected-items-error";
    buildError.textContent = `Popular item trends unavailable: ${buildResult.reason.message}`;
    trends.append(buildError);
  }
}

function renderImprovementFocus(matches) {
  const container = $("#improvement-focus");
  $("#overall-analysis-button").hidden = true;
  container.replaceChildren();
  const readNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
    ? Number(value)
    : null;
  const games = (Array.isArray(matches) ? matches : [])
    .slice(0, 20)
    .filter((match) => typeof match.radiant_win === "boolean" && readNumber(match.player_slot) !== null)
    .map((match) => ({ match, won: match.radiant_win === (Number(match.player_slot) < 128) }));
  const wins = games.filter((game) => game.won);
  const losses = games.filter((game) => !game.won);
  if (wins.length < 2 || losses.length < 2) {
    const message = document.createElement("p");
    message.className = "improvement-message";
    message.textContent = `Need at least 2 wins and 2 losses with available stats to find a useful pattern. Recent sample: ${wins.length}W – ${losses.length}L.`;
    container.append(message);
    return;
  }

  const metrics = [
    {
      label: "Last hits per minute",
      read: (match) => {
        const lastHits = readNumber(match.last_hits);
        const duration = readNumber(match.duration);
        return lastHits !== null && duration > 0 ? lastHits / (duration / 60) : null;
      },
      format: (value) => value.toFixed(1),
      action: "Try to secure more lane creeps, then keep your farm pattern going between fights."
    },
    {
      label: "Gold per minute",
      read: (match) => readNumber(match.gold_per_min),
      format: (value) => `${Math.round(value)} GPM`,
      action: "Look for safe farm between fights and turn won fights into objectives."
    },
    {
      label: "Experience per minute",
      read: (match) => readNumber(match.xp_per_min),
      format: (value) => `${Math.round(value)} XPM`,
      action: "Reduce time spent waiting between plays; keep earning experience from waves and camps."
    },
    {
      label: "Deaths per game",
      read: (match) => readNumber(match.deaths),
      format: (value) => value.toFixed(1),
      lowerIsBetter: true,
      action: "Before entering fog or rejoining a fight, check enemy positions and whether teammates can follow."
    }
  ];
  let comparableMetricCount = 0;
  const comparisons = metrics.flatMap((metric) => {
    const winValues = wins.map(({ match }) => metric.read(match)).filter((value) => value !== null);
    const lossValues = losses.map(({ match }) => metric.read(match)).filter((value) => value !== null);
    if (winValues.length < 2 || lossValues.length < 2) return [];
    comparableMetricCount += 1;
    const winAverage = winValues.reduce((total, value) => total + value, 0) / winValues.length;
    const lossAverage = lossValues.reduce((total, value) => total + value, 0) / lossValues.length;
    const gap = metric.lowerIsBetter ? lossAverage - winAverage : winAverage - lossAverage;
    return gap > 0 ? [{ metric, winAverage, lossAverage, gap, sampleSize: winValues.length + lossValues.length }] : [];
  })
    .filter((comparison) => comparison.gap / Math.max(Math.abs(comparison.winAverage), 1) >= 0.05)
    .sort((a, b) => b.gap / Math.max(Math.abs(b.winAverage), 1) - a.gap / Math.max(Math.abs(a.winAverage), 1));

  if (!comparisons.length) {
    const message = document.createElement("p");
    message.className = "improvement-message";
    message.textContent = comparableMetricCount
      ? "No clear stat gap stands out in this sample. Keep reviewing match reports to spot a pattern you can work on."
      : "Not enough recent match stats are available to compare yet. Check back after OpenDota has more match data.";
    container.append(message);
    return;
  }

  const { metric, winAverage, lossAverage, sampleSize } = comparisons[0];
  const label = document.createElement("span");
  label.className = "improvement-pattern-label";
  label.textContent = "PATTERN TO REVIEW";
  const title = document.createElement("h3");
  title.className = "improvement-metric";
  title.textContent = metric.label;
  const comparison = document.createElement("p");
  comparison.className = "improvement-comparison";
  comparison.textContent = `Recent losses: ${metric.format(lossAverage)} · wins: ${metric.format(winAverage)}`;
  const action = document.createElement("p");
  action.className = "improvement-action";
  action.textContent = metric.action;
  const sample = document.createElement("span");
  sample.className = "improvement-sample";
  sample.textContent = `Based on ${sampleSize} of your last ${games.length} games`;
  container.append(label, title, comparison, action, sample);
}

function setScoutMessage(selector, message, isError = false, retry) {
  const container = $(selector);
  container.replaceChildren();
  const text = document.createElement("p");
  text.className = isError ? "scout-error" : "scout-empty";
  text.textContent = message;
  container.append(text);
  if (retry) {
    const button = document.createElement("button");
    button.className = "scout-retry";
    button.type = "button";
    button.textContent = "Retry";
    button.addEventListener("click", retry, { once: true });
    container.append(button);
  }
}

function makeHeroImage(heroId, className = "scout-hero-image") {
  const hero = heroById.get(Number(heroId));
  if (!hero) return null;
  const image = document.createElement("img");
  image.className = className;
  image.src = `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${hero.name.replace("npc_dota_hero_", "")}.png`;
  image.alt = "";
  image.loading = "lazy";
  return image;
}

function renderHeroPerformance(heroStats) {
  const container = $("#hero-performance");
  container.replaceChildren();
  const heroRecords = (Array.isArray(heroStats) ? heroStats : [])
    .map((entry) => ({
      ...entry,
      games: Number(entry.games),
      wins: Number(entry.win)
    }))
    .filter((entry) => Number.isFinite(entry.games) && entry.games > 0
      && Number.isFinite(entry.wins) && entry.wins >= 0 && entry.wins <= entry.games);
  renderPersonalHeroHighlights(heroRecords);
  const topHeroes = [...heroRecords]
    .sort((a, b) => b.games - a.games)
    .slice(0, 5);
  if (!topHeroes.length) {
    setScoutMessage("#hero-performance", "No recorded hero statistics were returned for this profile.");
    return;
  }

  for (const entry of topHeroes) {
    const hero = heroById.get(Number(entry.hero_id));
    const games = Number(entry.games);
    const wins = Number(entry.win) || 0;
    const row = document.createElement("div");
    row.className = "scout-hero-row";
    const image = makeHeroImage(entry.hero_id);
    if (image) row.append(image);
    const name = document.createElement("span");
    name.className = "scout-row-name";
    name.textContent = hero?.localized_name || `Hero ${entry.hero_id}`;
    const count = document.createElement("span");
    count.className = "scout-row-meta";
    count.textContent = `${formatNumber(games)} games`;
    const rate = document.createElement("strong");
    rate.className = `scout-row-rate${wins / games >= 0.5 ? " positive" : " negative"}`;
    rate.textContent = `${Math.round((wins / games) * 100)}%`;
    row.append(name, count, rate);
    container.append(row);
  }
}

function renderPersonalHeroHighlights(heroRecords) {
  const mostPlayedName = $("#most-played-hero-name");
  const mostPlayedCaption = $("#most-played-hero-caption");
  const mostPlayedImage = $("#most-played-hero-image");
  const highestWinrateName = $("#highest-winrate-hero-name");
  const highestWinrateCaption = $("#highest-winrate-hero-caption");
  const highestWinrateImage = $("#highest-winrate-hero-image");
  const records = [...heroRecords].sort((a, b) => b.games - a.games);
  const mostPlayed = records[0];
  if (!mostPlayed) {
    mostPlayedName.textContent = "Unavailable";
    mostPlayedCaption.textContent = "No recorded hero matches";
    mostPlayedImage.hidden = true;
  } else {
    const hero = heroById.get(Number(mostPlayed.hero_id));
    mostPlayedName.textContent = hero?.localized_name || `Hero ${mostPlayed.hero_id}`;
    mostPlayedCaption.textContent = `${formatNumber(mostPlayed.games)} games · ${Math.round((mostPlayed.wins / mostPlayed.games) * 100)}% win rate`;
    if (hero) {
      mostPlayedImage.src = `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${hero.name.replace("npc_dota_hero_", "")}.png`;
      mostPlayedImage.alt = `${hero.localized_name} portrait`;
      mostPlayedImage.hidden = false;
    } else {
      mostPlayedImage.hidden = true;
    }
  }

  const mostSuccessful = records
    .filter((entry) => entry.games >= 5)
    .sort((a, b) => (b.wins / b.games) - (a.wins / a.games) || b.games - a.games)[0];
  if (!mostSuccessful) {
    highestWinrateName.textContent = "Not enough data";
    highestWinrateCaption.textContent = "Play at least 5 games on a hero";
    highestWinrateImage.hidden = true;
    return;
  }

  const hero = heroById.get(Number(mostSuccessful.hero_id));
  const winRate = Math.round((mostSuccessful.wins / mostSuccessful.games) * 100);
  highestWinrateName.textContent = hero?.localized_name || `Hero ${mostSuccessful.hero_id}`;
  highestWinrateCaption.textContent = `${winRate}% win rate · ${formatNumber(mostSuccessful.games)} games`;
  if (hero) {
    highestWinrateImage.src = `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${hero.name.replace("npc_dota_hero_", "")}.png`;
    highestWinrateImage.alt = `${hero.localized_name} portrait`;
    highestWinrateImage.hidden = false;
  } else {
    highestWinrateImage.hidden = true;
  }
}

function renderRankHistory(ratings) {
  const container = $("#rank-history");
  container.replaceChildren();
  const history = (Array.isArray(ratings) ? ratings : [])
    .filter((entry) => validRankTier(entry.rank_tier) && Number.isFinite(Number(entry.time)) && Number(entry.time) > 0)
    .sort((a, b) => Number(b.time) - Number(a.time))
    .filter((entry, index, entries) => index === 0 || Number(entry.rank_tier) !== Number(entries[index - 1].rank_tier))
    .slice(0, 5);
  if (!history.length) {
    setScoutMessage("#rank-history", "OpenDota has no rank changes recorded for this profile yet.");
    return;
  }

  for (const entry of history) {
    const rank = rankDetails(entry.rank_tier);
    const row = document.createElement("div");
    row.className = "rank-history-row";
    const image = document.createElement("img");
    image.src = rank.image;
    image.alt = "";
    image.loading = "lazy";
    const details = document.createElement("span");
    details.className = "rank-history-name";
    details.textContent = `${rank.name}${rank.stars ? ` · ${rank.stars}` : ""}`;
    const date = document.createElement("time");
    date.dateTime = new Date(Number(entry.time) * 1000).toISOString();
    date.textContent = new Date(Number(entry.time) * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    row.append(image, details, date);
    container.append(row);
  }
}

function renderPartyChemistry(peers) {
  const container = $("#party-chemistry");
  container.replaceChildren();
  const friendIds = new Set(readFriendIds());
  const allies = (Array.isArray(peers) ? peers : [])
    .filter((peer) => peer.account_id && Number(peer.games) > 0)
    .sort((a, b) => Number(b.games) - Number(a.games));
  const withFriends = allies.filter((peer) => friendIds.has(String(peer.account_id)));
  const shown = withFriends.length ? withFriends.slice(0, 5) : allies.slice(0, 5);
  if (!shown.length) {
    setScoutMessage("#party-chemistry", "OpenDota has no party history available yet. Play matches with friends and check back.");
    return;
  }

  const hint = document.createElement("p");
  hint.className = "scout-inline-note";
  hint.textContent = withFriends.length
    ? "Friends from your roster who appear in your match history."
    : friendIds.size
      ? "Your roster friends have no shared matches in this data yet; showing your most frequent allies."
      : "Add friends to your roster to highlight them in this history.";
  container.append(hint);
  for (const peer of shown) {
    const row = document.createElement("div");
    row.className = "scout-peer-row";
    const name = document.createElement("span");
    name.className = "scout-row-name";
    name.textContent = peer.personaname || `Player ${peer.account_id}`;
    const record = document.createElement("span");
    record.className = "scout-row-meta";
    record.textContent = `${formatNumber(Number(peer.games))} games · ${Math.round((Number(peer.win) / Number(peer.games)) * 100)}% together`;
    if (friendIds.has(String(peer.account_id))) {
      const badge = document.createElement("span");
      badge.className = "party-match-badge";
      badge.textContent = "PARTY";
      row.append(badge);
    }
    row.append(name, record);
    container.append(row);
  }
}

function renderHeroOptions(heroStats) {
  const select = $("#insight-hero-select");
  const topHeroes = [...heroStats]
    .filter((entry) => heroById.has(Number(entry.hero_id)))
    .sort((a, b) => Number(b.games) - Number(a.games))
    .slice(0, 30);
  select.replaceChildren();
  for (const entry of topHeroes) {
    const option = document.createElement("option");
    option.value = String(entry.hero_id);
    option.textContent = heroById.get(Number(entry.hero_id)).localized_name;
    select.append(option);
  }
  select.disabled = !topHeroes.length;
  if (!topHeroes.length) {
    setScoutMessage("#hero-matchups", "No hero data is available for matchup insights.");
    setScoutMessage("#hero-builds", "No hero data is available for item insights.");
    setScoutMessage("#hero-benchmarks", "No hero data is available for benchmarks.");
    return;
  }
  selectedInsightHeroId = Number(topHeroes[0].hero_id);
  select.value = String(selectedInsightHeroId);
  loadHeroGuide(signedInAccountId, selectedInsightHeroId, dashboardLoadId);
}

function renderHeroMatchups(matchups) {
  const container = $("#hero-matchups");
  container.replaceChildren();
  const toughest = (Array.isArray(matchups) ? matchups : [])
    .filter((entry) => Number(entry.hero_id) !== selectedInsightHeroId && Number(entry.games_played) >= 10 && Number.isFinite(Number(entry.wins)))
    .sort((a, b) => (Number(a.wins) / Number(a.games_played)) - (Number(b.wins) / Number(b.games_played)))
    .slice(0, 5);
  if (!toughest.length) {
    setScoutMessage("#hero-matchups", "Not enough matchup data yet. OpenDota needs at least 10 sampled games per opponent.");
    return;
  }
  for (const entry of toughest) {
    const hero = heroById.get(Number(entry.hero_id));
    const row = document.createElement("div");
    row.className = "scout-matchup-row";
    const image = makeHeroImage(entry.hero_id);
    if (image) row.append(image);
    const name = document.createElement("span");
    name.className = "scout-row-name";
    name.textContent = hero?.localized_name || `Hero ${entry.hero_id}`;
    const rate = document.createElement("strong");
    rate.className = "scout-row-rate negative";
    rate.textContent = `${Math.round((Number(entry.wins) / Number(entry.games_played)) * 100)}%`;
    rate.title = `${formatNumber(Number(entry.games_played))} sampled games`;
    row.append(name, rate);
    container.append(row);
  }
}

function itemLabel(itemKey) {
  const item = itemNames.get(Number(itemKey));
  if (item) return item;
  const name = String(itemKey).replaceAll("_", " ");
  return { name: String(itemKey), displayName: name.replace(/\b\w/g, (letter) => letter.toUpperCase()) };
}

function renderHeroBuilds(popularity, container = $("#hero-builds")) {
  container.replaceChildren();
  const stages = [
    ["early_game_items", "EARLY"],
    ["mid_game_items", "MID"],
    ["late_game_items", "LATE"]
  ];
  let hasItems = false;
  for (const [key, label] of stages) {
    const rawItems = popularity?.[key];
    const items = rawItems && typeof rawItems === "object"
      ? Object.entries(rawItems).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 3)
      : [];
    if (!items.length) continue;
    hasItems = true;
    const stage = document.createElement("div");
    stage.className = "item-stage";
    const title = document.createElement("span");
    title.className = "item-stage-label";
    title.textContent = label;
    const list = document.createElement("div");
    list.className = "item-stage-list";
    for (const [itemKey] of items) {
      const item = itemLabel(itemKey);
      const entry = document.createElement("span");
      entry.className = "item-trend";
      const image = document.createElement("img");
      image.src = `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/${item.name}.png`;
      image.alt = "";
      image.loading = "lazy";
      image.title = item.displayName;
      image.addEventListener("error", () => image.remove(), { once: true });
      const name = document.createElement("span");
      name.textContent = item.displayName;
      entry.append(image, name);
      list.append(entry);
    }
    stage.append(title, list);
    container.append(stage);
  }
  if (!hasItems) {
    const message = document.createElement("p");
    message.className = "scout-empty";
    message.textContent = "Item trends aren’t available for this hero yet.";
    container.append(message);
  }
}

function renderHeroBenchmarks(matches, benchmarks) {
  const container = $("#hero-benchmarks");
  container.replaceChildren();
  const metrics = [
    { field: "gold_per_min", label: "GPM", percentileField: "gold_per_min", format: (value) => formatNumber(Math.round(value)) },
    { field: "xp_per_min", label: "XPM", percentileField: "xp_per_min", format: (value) => formatNumber(Math.round(value)) },
    { field: "last_hits", label: "LAST HITS / MIN", percentileField: "last_hits_per_min", format: (value) => value.toFixed(1) }
  ];
  let anyMetric = false;
  for (const metric of metrics) {
    const samples = (Array.isArray(matches) ? matches : [])
      .filter((match) => Number.isFinite(Number(match[metric.field])) && Number(match.duration) > 0)
      .slice(0, 20);
    const points = benchmarks?.result?.[metric.percentileField];
    if (!samples.length || !Array.isArray(points) || !points.length) continue;
    anyMetric = true;
    const average = samples.reduce((total, match) => {
      const value = metric.field === "last_hits" ? Number(match.last_hits) / (Number(match.duration) / 60) : Number(match[metric.field]);
      return total + value;
    }, 0) / samples.length;
    const sortedPoints = points
      .filter((point) => Number.isFinite(Number(point.value)) && Number.isFinite(Number(point.percentile)))
      .sort((a, b) => Number(a.percentile) - Number(b.percentile));
    const surpassed = sortedPoints.filter((point) => average >= Number(point.value)).at(-1);
    const percentile = surpassed ? `≥${Math.round(Number(surpassed.percentile))}th percentile` : `<${Math.round(Number(sortedPoints[0]?.percentile ?? 10))}th percentile`;
    const nextGoal = sortedPoints.find((point) => Number(point.percentile) === 75) || sortedPoints.find((point) => Number(point.percentile) > Number(surpassed?.percentile ?? 0));
    const row = document.createElement("div");
    row.className = "benchmark-row";
    const title = document.createElement("span");
    title.className = "benchmark-label";
    title.textContent = metric.label;
    const value = document.createElement("strong");
    value.textContent = `${metric.format(average)} · ${percentile}`;
    const goal = document.createElement("span");
    goal.className = "benchmark-goal";
    goal.textContent = nextGoal ? `Next target: ${metric.format(Number(nextGoal.value))} (${Math.round(Number(nextGoal.percentile))}th percentile)` : "At the highest published benchmark";
    row.append(title, value, goal);
    container.append(row);
  }
  if (!anyMetric) {
    setScoutMessage("#hero-benchmarks", "No recent stat samples or benchmark values are available for this hero yet.");
  }
}

async function loadHeroGuide(accountId, heroId, loadId) {
  const requestId = ++activeHeroGuideRequest;
  selectedInsightHeroId = Number(heroId);
  for (const selector of ["#hero-matchups", "#hero-builds", "#hero-benchmarks"]) {
    setScoutMessage(selector, "Gathering OpenDota data…");
  }
  const base = "https://api.opendota.com/api";
  const encodedAccount = encodeURIComponent(accountId);
  const encodedHero = encodeURIComponent(heroId);
  const results = await Promise.allSettled([
    apiJson(`${base}/heroes/${encodedHero}/matchups`),
    loadHeroItemPopularity(heroId),
    apiJson(`${base}/benchmarks?hero_id=${encodedHero}`),
    apiJson(`${base}/players/${encodedAccount}/matches?hero_id=${encodedHero}&limit=20`),
    loadItemNames()
  ]);
  if (loadId !== dashboardLoadId || requestId !== activeHeroGuideRequest) return;
  const [matchups, popularity, benchmarks, matches, items] = results;
  if (matchups.status === "fulfilled") renderHeroMatchups(matchups.value);
  else setScoutMessage("#hero-matchups", `Matchup data unavailable: ${matchups.reason.message}`, true, () => loadHeroGuide(accountId, heroId, loadId));
  if (popularity.status === "fulfilled" && items.status === "fulfilled") renderHeroBuilds(popularity.value);
  else setScoutMessage("#hero-builds", `Item trends unavailable: ${(popularity.status === "rejected" ? popularity.reason : items.reason).message}`, true, () => loadHeroGuide(accountId, heroId, loadId));
  if (benchmarks.status === "fulfilled" && matches.status === "fulfilled") renderHeroBenchmarks(matches.value, benchmarks.value);
  else {
    const error = benchmarks.status === "rejected" ? benchmarks.reason : matches.reason;
    setScoutMessage("#hero-benchmarks", `Performance comparison unavailable: ${error.message}`, true, () => loadHeroGuide(accountId, heroId, loadId));
  }
}

$("#insight-hero-select").addEventListener("change", (event) => {
  const heroId = Number(event.currentTarget.value);
  if (Number.isInteger(heroId) && heroId > 0) loadHeroGuide(signedInAccountId, heroId, dashboardLoadId);
});

function renderHistoryMatches() {
  if (!Array.isArray(historyMatches)) return;
  const result = $("#history-result-filter").value;
  const heroId = $("#history-hero-filter").value;
  const filtered = historyMatches.filter((match) => {
    const won = match.radiant_win === (match.player_slot < 128);
    return (result === "all" || (result === "win" && won) || (result === "loss" && !won))
      && (heroId === "all" || String(match.hero_id) === heroId);
  });
  renderMatches(filtered);
  $("#history-note").textContent = `Showing ${filtered.length} of ${historyMatches.length} games returned by OpenDota.`;
}

function populateHistoryHeroFilter() {
  const select = $("#history-hero-filter");
  const selected = select.value;
  select.replaceChildren(new Option("All heroes", "all"));
  const heroes = [...heroById.values()].sort((a, b) => a.localized_name.localeCompare(b.localized_name));
  for (const hero of heroes) select.add(new Option(hero.localized_name, String(hero.id)));
  select.value = [...select.options].some((option) => option.value === selected) ? selected : "all";
  renderHistoryMatches();
}

async function loadMatchHistory() {
  if (historyLoaded) {
    renderHistoryMatches();
    return;
  }
  const requestId = ++historyRequestId;
  const dashboardId = dashboardLoadId;
  const body = $("#matches-body");
  body.replaceChildren();
  const row = body.insertRow();
  const cell = row.insertCell();
  cell.colSpan = 8;
  cell.className = "table-loading";
  cell.innerHTML = '<span class="loading-spinner"></span> Calling your latest battles…';
  $("#history-summary").textContent = "LOADING";
  try {
    const matches = await apiJson(`https://api.opendota.com/api/players/${encodeURIComponent(signedInAccountId)}/matches?limit=100`);
    if (dashboardId !== dashboardLoadId || requestId !== historyRequestId) return;
    historyMatches = Array.isArray(matches) ? matches : [];
    historyLoaded = true;
    renderHistoryMatches();
  } catch (error) {
    if (dashboardId !== dashboardLoadId || requestId !== historyRequestId) return;
    body.replaceChildren();
    const errorRow = body.insertRow();
    const errorCell = errorRow.insertCell();
    errorCell.colSpan = 8;
    errorCell.className = "empty-matches";
    errorCell.textContent = `Match history couldn't be loaded: ${error.message}.`;
    $("#history-summary").textContent = "";
    const retry = document.createElement("button");
    retry.className = "scout-retry";
    retry.type = "button";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => {
      historyLoaded = false;
      loadMatchHistory();
    }, { once: true });
    errorCell.append(" ", retry);
  }
}

function setActivePage(page) {
  activePage = pageDetails[page] ? page : "overview";
  for (const section of document.querySelectorAll("[data-page-content]")) {
    section.hidden = section.dataset.pageContent !== activePage;
  }
  for (const link of document.querySelectorAll(".nav-link[data-page]")) {
    const selected = link.dataset.page === activePage;
    link.classList.toggle("nav-link-active", selected);
    if (selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  $("#page-eyebrow").textContent = pageDetails[activePage].eyebrow;
  $("#page-title").textContent = pageDetails[activePage].title;
  if (activePage === "matches") loadMatchHistory();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function readPageFromHash() {
  const page = location.hash.slice(1);
  if (!pageDetails[page]) {
    history.replaceState(null, "", `${location.pathname}${location.search}#overview`);
    return "overview";
  }
  return page;
}

document.querySelectorAll(".nav-link[data-page], .text-action[data-page]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const page = link.dataset.page;
    if (page !== activePage) location.hash = page;
    else setActivePage(page);
  });
});

window.addEventListener("hashchange", () => {
  if (document.body.classList.contains("signed-in")) setActivePage(readPageFromHash());
});

function setPlayerSearchStatus(message, isError = false) {
  const status = $("#player-search-status");
  status.textContent = message;
  status.classList.toggle("player-search-status-error", isError);
}

function renderSearchedPlayer(accountId, profile) {
  const displayName = profile.profile?.personaname || `Dota player · ${accountId}`;
  const avatar = $("#searched-player-avatar");
  avatar.hidden = false;
  avatar.src = profile.profile?.avatarfull || profile.profile?.avatar || invokerPortrait;
  avatar.alt = profile.profile?.avatarfull || profile.profile?.avatar ? `${displayName}'s Steam avatar` : "Invoker portrait placeholder";
  avatar.dataset.fallback = profile.profile?.avatarfull || profile.profile?.avatar ? "false" : "true";
  const rankTier = validRankTier(profile.rank_tier);
  const rank = rankDetails(rankTier);
  $("#searched-player-name").textContent = displayName;
  $("#searched-player-link").href = `https://www.opendota.com/players/${encodeURIComponent(accountId)}`;
  $("#searched-player-rank-icon").src = rank.image;
  $("#searched-player-rank-icon").alt = rank.name;
  $("#searched-player-rank").textContent = `${rank.name}${rank.stars ? ` · ${rank.stars}` : ""}`;
}

$("#searched-player-avatar").addEventListener("error", (event) => {
  const avatar = event.currentTarget;
  if (avatar.dataset.fallback === "true") {
    avatar.hidden = true;
    return;
  }
  avatar.dataset.fallback = "true";
  avatar.src = invokerPortrait;
  avatar.alt = "Invoker portrait placeholder";
});

function setPlayerSearchMatchesMessage(message, isError = false) {
  const body = $("#player-search-matches-body");
  body.replaceChildren();
  const row = body.insertRow();
  const cell = row.insertCell();
  cell.colSpan = 8;
  cell.className = isError ? "empty-matches player-search-error" : "empty-matches";
  cell.textContent = message;
  $("#player-search-match-count").textContent = "";
}

async function searchPlayer(input) {
  const requestId = ++playerSearchRequestId;
  let accountId;
  try {
    accountId = normalizeSteamId(input.trim());
  } catch (error) {
    $("#player-search-submit").disabled = false;
    $("#player-search-submit").textContent = "Search player";
    setPlayerSearchStatus(error.message, true);
    $("#player-search-id").focus();
    return;
  }

  const button = $("#player-search-submit");
  const results = $("#player-search-results");
  button.disabled = true;
  button.textContent = "Searching…";
  results.hidden = true;
  setPlayerSearchStatus("Looking up the public profile and recent matches…");
  setPlayerSearchMatchesMessage("Loading recent matches…");

  const base = "https://api.opendota.com/api/players";
  const profileRequest = apiJson(`${base}/${encodeURIComponent(accountId)}`);
  const matchesRequest = apiJson(`${base}/${encodeURIComponent(accountId)}/recentMatches`);
  const heroesRequest = heroById.size
    ? Promise.resolve([...heroById.values()])
    : apiJson("https://api.opendota.com/api/heroes");
  const [profileResult, matchesResult, heroesResult] = await Promise.allSettled([profileRequest, matchesRequest, heroesRequest]);
  if (requestId !== playerSearchRequestId) return;
  button.disabled = false;
  button.textContent = "Search player";

  const notices = [];
  if (profileResult.status === "fulfilled") {
    renderSearchedPlayer(accountId, profileResult.value || {});
  } else {
    renderSearchedPlayer(accountId, {});
    notices.push(`Profile details unavailable: ${profileResult.reason.message}`);
  }
  if (heroesResult.status === "fulfilled" && Array.isArray(heroesResult.value)) {
    heroById = new Map(heroesResult.value.map((hero) => [hero.id, hero]));
  } else if (heroesResult.status === "rejected") {
    notices.push("Hero names couldn’t be loaded; match rows may show unknown heroes.");
  }

  results.hidden = false;
  if (matchesResult.status === "fulfilled" && Array.isArray(matchesResult.value)) {
    const matches = matchesResult.value;
    renderMatches(matches, "#player-search-matches-body", "#player-search-match-count", accountId);
    if (!matches.length) {
      setPlayerSearchMatchesMessage("No recent matches are available for this player. Their match data may be private or not yet parsed by OpenDota.");
    }
  } else {
    const message = matchesResult.status === "rejected"
      ? `Recent matches unavailable: ${matchesResult.reason.message}`
      : "OpenDota returned an unexpected response for recent matches.";
    setPlayerSearchMatchesMessage(message, true);
    notices.push(message);
  }
  setPlayerSearchStatus(notices.length ? notices.join(" ") : "Player found. Recent public match data is shown below.", notices.length > 0 && matchesResult.status === "rejected");
}

$("#player-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  searchPlayer($("#player-search-id").value);
});

$("#overall-analysis-button").addEventListener("click", () => {
  selectedTrendMatchId = null;
  for (const point of document.querySelectorAll(".mmr-match-group")) {
    point.setAttribute("aria-pressed", "false");
  }
  $("#overall-analysis-button").hidden = true;
  if (Array.isArray(activeTrendMatches)) renderImprovementFocus(activeTrendMatches);
});

$("#history-result-filter").addEventListener("change", renderHistoryMatches);
$("#history-hero-filter").addEventListener("change", renderHistoryMatches);

function showDashboard() {
  $("#welcome").hidden = true;
  $("#dashboard").hidden = false;
  $("#signout").hidden = false;
  document.body.classList.add("signed-in");
  setActivePage(readPageFromHash());
}

function updateDashboardErrors(errors, accountId, loadId) {
  if (loadId !== dashboardLoadId) return;
  const notice = $("#dashboard-error");
  notice.replaceChildren();
  if (!errors.size) {
    notice.hidden = true;
    return;
  }

  const labels = [...errors.keys()].join(", ");
  const message = document.createElement("span");
  message.textContent = `Still waiting on ${labels}. ${[...errors.values()][0]} `;
  const retry = document.createElement("button");
  retry.className = "notice-retry";
  retry.type = "button";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => loadDashboard(accountId));
  notice.append(message, retry);
  notice.hidden = false;
}

function setLoadingPlaceholders(selectors, isLoading) {
  for (const selector of selectors) {
    $(selector).classList.toggle("loading-placeholder", isLoading);
  }
}

async function loadDashboard(accountId) {
  const loadId = ++dashboardLoadId;
  clearTimeout(dashboardLoadingTimer);
  dashboardLoadingTimer = null;
  signedInAccountId = accountId;
  historyMatches = null;
  historyLoaded = false;
  historyRequestId += 1;
  mmrMatches = null;
  heroById = new Map();
  selectedTrendMatchId = null;
  activeTrendMatches = null;
  for (const selector of ["#most-played-hero-name", "#highest-winrate-hero-name"]) {
    $(selector).textContent = "Loading…";
  }
  $("#most-played-hero-caption").textContent = "Loading hero history…";
  $("#most-played-hero-image").hidden = true;
  $("#highest-winrate-hero-image").hidden = true;
  $("#highest-winrate-hero-caption").textContent = "Requires at least 5 games";
  $("#mmr-current-input").value = "";
  $("#mmr-change-input").value = String(defaultMmrMatchChange);
  try {
    mmrSettings = readMmrSettings(accountId);
    if (mmrSettings) {
      $("#mmr-current-input").value = String(mmrSettings.currentMmr);
      $("#mmr-change-input").value = String(mmrSettings.matchChange);
      $("#mmr-settings-status").textContent = mmrSettings.baselineWasMigrated
        ? "Your saved baseline had no date. Tracking starts now."
        : "Your MMR settings were loaded from this browser.";
    } else {
      $("#mmr-settings-status").textContent = "Set your MMR baseline to start tracking gains and losses. Saved in this browser.";
    }
  } catch (error) {
    mmrSettings = null;
    $("#mmr-settings-status").textContent = `Saved MMR settings couldn't be loaded: ${error.message} Enter them again to replace the saved values.`;
  }
  showDashboard();
  renderFriends();
  selectedInsightHeroId = null;
  $("#insight-hero-select").disabled = true;
  $("#insight-hero-select").replaceChildren(Object.assign(document.createElement("option"), { textContent: "Loading heroes…" }));
  setScoutMessage("#hero-performance", "Loading hero records…");
  setScoutMessage("#rank-history", "Loading rank history…");
  setScoutMessage("#party-chemistry", "Loading party stats…");
  renderMmrTrend(null, "Loading ranked match history…");
  const errors = new Map();
  const pending = new Set(["profile", "win/loss record", "recent matches", "ranked match history", "hero names", "hero performance", "rank history", "party chemistry"]);
  const results = {
    matches: null,
    ranked: null,
    profileRankTier: undefined,
    ratings: null,
    heroStats: null
  };
  const updateDisplayedRank = () => {
    const rankTier = latestRecordedRank(results.ratings) ?? results.profileRankTier;
    const rank = rankDetails(rankTier);
    $("#rank-icon").src = rank.image;
    $("#rank-icon").alt = rank.name;
    $("#rank-name").textContent = rank.name;
    $("#rank-stars").textContent = rank.stars;
    results.ranked = rankTier !== undefined;
    if (Array.isArray(results.matches)) renderPredictedRank(results.matches, results.ranked);
  };
  const loadingNotice = $("#dashboard-loading");
  loadingNotice.textContent = "Connecting to OpenDota. Profile and match data will appear as each section finishes loading.";
  loadingNotice.hidden = false;
  setLoadingPlaceholders(["#player-name", "#rank-name", "#winrate", "#win-loss", "#matches-count", "#recent-form-summary"], true);
  updateDashboardErrors(errors, accountId, loadId);

  const updateLoadingNotice = () => {
    if (loadId !== dashboardLoadId) return;
    if (!pending.size) {
      clearTimeout(dashboardLoadingTimer);
      dashboardLoadingTimer = null;
      loadingNotice.hidden = true;
      return;
    }
    if (dashboardLoadingTimer) return;
    dashboardLoadingTimer = setTimeout(() => {
      if (loadId !== dashboardLoadId || !pending.size) return;
      loadingNotice.textContent = `OpenDota is taking a while. Still loading: ${[...pending].join(", ")}. Finished sections remain available below.`;
    }, 5000);
  };

  updateLoadingNotice();

  const request = async (label, url, onSuccess, onFailure = () => {}) => {
    try {
      const data = await apiJson(url);
      if (loadId !== dashboardLoadId) return;
      errors.delete(label);
      await onSuccess(data);
      updateDashboardErrors(errors, accountId, loadId);
    } catch (error) {
      if (loadId !== dashboardLoadId) return;
      errors.set(label, error.message || "The request failed.");
      onFailure(error);
      updateDashboardErrors(errors, accountId, loadId);
    } finally {
      if (loadId === dashboardLoadId) {
        pending.delete(label);
        updateLoadingNotice();
      }
    }
  };

  const profileRequest = request(
    "profile",
    `https://api.opendota.com/api/players/${accountId}`,
    (profile) => {
      $("#player-name").textContent = profile.profile?.personaname || "Dota 2 player";
      setProfileAvatar(profile.profile?.avatarfull || profile.profile?.avatar);
      $("#steam-profile").href = profile.profile?.profileurl || `https://steamcommunity.com/profiles/${accountId}`;

      results.profileRankTier = validRankTier(profile.rank_tier);
      updateDisplayedRank();

      setLoadingPlaceholders(["#player-name", "#rank-name"], false);
    },
    () => {
      $("#player-name").textContent = "Profile unavailable";
      $("#rank-name").textContent = "Unavailable";
      setLoadingPlaceholders(["#player-name", "#rank-name"], false);
    }
  );

  const recordRequest = request(
    "win/loss record",
    `https://api.opendota.com/api/players/${accountId}/wl`,
    (record) => {
      const wins = Number(record.win) || 0;
      const losses = Number(record.lose) || 0;
      const total = wins + losses;
      const winrate = total ? Math.round((wins / total) * 100) : 0;
      $("#winrate").innerHTML = `${total ? winrate : "—"}<small>%</small>`;
      $("#win-loss").textContent = `${formatNumber(wins)}W – ${formatNumber(losses)}L`;
      $("#winrate-bar").style.width = `${winrate}%`;
      $("#matches-count").textContent = total ? formatNumber(total) : "—";
      setLoadingPlaceholders(["#winrate", "#win-loss", "#matches-count"], false);
    },
    () => {
      $("#winrate").innerHTML = `—<small>%</small>`;
      $("#win-loss").textContent = "Record unavailable";
      $("#matches-count").textContent = "—";
      setLoadingPlaceholders(["#winrate", "#win-loss", "#matches-count"], false);
    }
  );

  const matchesRequest = request(
    "recent matches",
    `https://api.opendota.com/api/players/${accountId}/recentMatches`,
    (matches) => {
      results.matches = matches;
      activeTrendMatches = matches;
      selectedTrendMatchId = null;
      renderRecentForm(matches);
      renderImprovementFocus(matches);
      if (historyLoaded) renderHistoryMatches();
      if (results.ranked !== null) renderPredictedRank(matches, results.ranked);
      setLoadingPlaceholders(["#recent-form-summary"], false);
    },
    () => {
      activeTrendMatches = null;
      selectedTrendMatchId = null;
      $("#overall-analysis-button").hidden = true;
      setScoutMessage("#improvement-focus", "Recent match stats are unavailable right now.", true);
      $("#recent-form-summary").textContent = "Unavailable";
      $("#recent-form").replaceChildren();
      setLoadingPlaceholders(["#recent-form-summary"], false);
    }
  );

  const rankedMatchesRequest = request(
    "ranked match history",
    `https://api.opendota.com/api/players/${encodeURIComponent(accountId)}/matches?limit=100`,
    async (matches) => {
      const allMatches = Array.isArray(matches) ? [...matches] : [];
      const baselineAt = mmrSettings?.baselineAt ?? Math.floor(Date.now() / 1000);
      const pageSize = 100;
      const maxPages = 20;
      let offset = allMatches.length;
      let oldestMatchTime = allMatches.length ? Number(allMatches[allMatches.length - 1].start_time) : Infinity;
      for (let page = 1; page < maxPages && allMatches.length >= pageSize && oldestMatchTime > baselineAt; page += 1) {
        const nextPage = await apiJson(`https://api.opendota.com/api/players/${encodeURIComponent(accountId)}/matches?limit=${pageSize}&offset=${offset}`);
        if (!Array.isArray(nextPage) || !nextPage.length) break;
        allMatches.push(...nextPage);
        offset += nextPage.length;
        oldestMatchTime = Number(nextPage[nextPage.length - 1].start_time);
        if (nextPage.length < pageSize) break;
      }
      if (allMatches.length >= pageSize * maxPages && oldestMatchTime > baselineAt) {
        const probe = await apiJson(`https://api.opendota.com/api/players/${encodeURIComponent(accountId)}/matches?limit=1&offset=${offset}`);
        if (Array.isArray(probe) && probe.length && Number(probe[0].start_time) > baselineAt) {
          throw new Error("More than 2,000 matches have been played since the MMR baseline was set. The chart cannot estimate all of them yet.");
        }
      }
      mmrMatches = allMatches;
      selectedTrendMatchId = null;
      renderMmrTrend(mmrMatches);
    },
    (error) => renderMmrTrend(null, `Ranked match history couldn't be loaded: ${error.message}`)
  );

  const heroesRequest = request(
    "hero names",
    "https://api.opendota.com/api/heroes",
    (heroes) => {
      heroById = new Map(heroes.map((hero) => [hero.id, hero]));
      populateHistoryHeroFilter();
      if (Array.isArray(mmrMatches)) renderMmrTrend(mmrMatches);
      if (historyLoaded) renderHistoryMatches();
      if (results.heroStats) {
        renderHeroPerformance(results.heroStats);
        renderHeroOptions(results.heroStats);
      }
    },
    () => {}
  );

  const heroStatsRequest = request(
    "hero performance",
    `https://api.opendota.com/api/players/${accountId}/heroes`,
    (heroStats) => {
      results.heroStats = heroStats;
      renderHeroPerformance(heroStats);
      if (heroById.size) renderHeroOptions(heroStats);
    },
    (error) => {
      setScoutMessage("#hero-performance", `Hero records unavailable: ${error.message}`);
      renderPersonalHeroHighlights([]);
      setScoutMessage("#hero-matchups", "Hero insights need OpenDota hero history.");
      setScoutMessage("#hero-builds", "Hero insights need OpenDota hero history.");
      setScoutMessage("#hero-benchmarks", "Hero insights need OpenDota hero history.");
    }
  );

  const ratingsRequest = request(
    "rank history",
    `https://api.opendota.com/api/players/${accountId}/ratings`,
    (ratings) => {
      results.ratings = ratings;
      renderRankHistory(ratings);
      updateDisplayedRank();
    },
    (error) => setScoutMessage("#rank-history", `Rank history unavailable: ${error.message}`)
  );

  const peersRequest = request(
    "party chemistry",
    `https://api.opendota.com/api/players/${accountId}/peers?limit=100`,
    renderPartyChemistry,
    (error) => setScoutMessage("#party-chemistry", `Party history unavailable: ${error.message}`)
  );

  await Promise.all([profileRequest, recordRequest, matchesRequest, rankedMatchesRequest, heroesRequest, heroStatsRequest, ratingsRequest, peersRequest]);
}

async function syncRecentGames() {
  const button = $("#sync-matches");
  const status = $("#sync-status");
  const accountId = signedInAccountId;
  if (!accountId || button.disabled) return;
  const previousRank = $("#rank-name").textContent;
  button.disabled = true;
  button.textContent = "Refreshing profile…";
  status.textContent = "";
  try {
    await apiJson(`https://api.opendota.com/api/players/${encodeURIComponent(accountId)}/refresh`, { method: "POST" });
    status.textContent = "Refresh requested. Updating rank, hero stats, and recent matches…";
    historyMatches = null;
    historyLoaded = false;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await loadDashboard(accountId);
    const rankChanged = $("#rank-name").textContent !== previousRank;
    status.textContent = rankChanged
      ? "OpenDota profile refreshed. Your rank and match data are updated."
      : "OpenDota refresh requested. Recalibration data may take a few minutes to appear; try refreshing again shortly.";
  } catch (error) {
    status.textContent = `Could not refresh OpenDota profile: ${error.message}`;
  } finally {
    button.disabled = false;
    button.innerHTML = '<span aria-hidden="true">↻</span> Refresh rank &amp; games';
  }
}

$("#sync-matches").addEventListener("click", syncRecentGames);

$("#friend-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#friend-steam-id");
  const button = $("#friend-form button[type='submit']");
  const accountId = input.value;
  setFriendError("");
  button.disabled = true;
  button.textContent = "…";
  try {
    const name = await addFriend(accountId);
    input.value = "";
    await renderFriends();
    setFriendError(`Added ${name} to your party.`);
  } catch (error) {
    setFriendError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "+";
  }
});

async function initialize() {
  const loginError = new URLSearchParams(location.search).get("error");
  if (loginError) {
    setLoginError(loginError === "steam" ? "Steam sign-in couldn't be verified. Please try again." : "Sign-in failed. Please try again.");
    history.replaceState(null, "", "/");
  }
  try {
    const response = await fetch("/api/auth/session");
    if (!response.ok) throw new Error(`Session request failed (${response.status})`);
    const session = await response.json();
    if (session.account_id) await loadDashboard(session.account_id);
  } catch (err) {
    setLoginError(`Couldn't check your sign-in session: ${err.message}. Please restart the app and refresh.`);
  }
}

$("#steam-login").addEventListener("click", () => {
  $("#steam-login").disabled = true;
  $("#steam-login span:nth-child(2)").textContent = "Connecting to Steam…";
  location.assign("/api/auth/login");
});

$("#signout").addEventListener("click", async () => {
  const response = await fetch("/api/auth/logout", { method: "POST" });
  if (!response.ok) {
    $("#dashboard-error").textContent = `Couldn't sign out (${response.status}). Please try again.`;
    $("#dashboard-error").hidden = false;
    return;
  }
  location.assign("/");
});

initialize();
