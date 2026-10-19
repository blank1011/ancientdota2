const $ = (selector) => document.querySelector(selector);
const rankNames = ["Unranked", "Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal"];
const rankAssets = "https://www.opendota.com/assets/images/dota2/rank_icons";
const friendsStorageKey = "ancient-friends";
const maxFriends = 12;
let heroById = new Map();
let signedInAccountId = null;
let itemNamesPromise;
let itemNames = new Map();
let activeMatchRequest = 0;

function setLoginError(message) {
  const error = $("#login-error");
  error.textContent = message;
  error.hidden = false;
}

async function apiJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`OpenDota returned ${response.status}`);
  return response.json();
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
  card.hidden = true;
  grid.classList.remove("has-prediction");
  if (isRanked) return;

  card.hidden = false;
  grid.classList.add("has-prediction");
  const estimate = estimateCompetitiveRank(matches);
  const icon = $("#predicted-rank-icon");
  const name = $("#predicted-rank-name");
  const caption = $("#predicted-rank-caption");
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
  caption.textContent = `Weighted from ${estimate.sampleSize} OpenDota match ranks · estimate only`;
  card.title = "Weighted average of the recorded average ranks in your latest 20 matches; newer matches count more. This is an estimate, not a verified personal rank.";
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
  const isCurrentPlayer = signedInAccountId && String(player.account_id) === String(signedInAccountId);
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

async function openMatchDetails(matchId) {
  const dialog = $("#match-dialog");
  const content = $("#match-dialog-content");
  const requestId = ++activeMatchRequest;
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

function renderMatches(matches) {
  const body = $("#matches-body");
  body.replaceChildren();
  $("#matches-summary").textContent = `${matches.length} RECENT GAMES`;
  if (!matches.length) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 6;
    cell.className = "empty-matches";
    cell.textContent = "No recent matches found for this profile.";
    return;
  }

  for (const match of matches) {
    const row = body.insertRow();
    row.className = "match-row-clickable";
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `View details for match ${match.match_id}`);
    row.dataset.matchId = match.match_id;
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

$("#matches-body").addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-match-id]");
  if (row) openMatchDetails(row.dataset.matchId);
});

$("#matches-body").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest("tr[data-match-id]");
  if (!row) return;
  event.preventDefault();
  openMatchDetails(row.dataset.matchId);
});

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

function showDashboard() {
  $("#welcome").hidden = true;
  $("#dashboard").hidden = false;
  $("#signout").hidden = false;
  document.body.classList.add("signed-in");
}

async function loadDashboard(accountId) {
  signedInAccountId = accountId;
  showDashboard();
  renderFriends();
  const error = $("#dashboard-error");
  try {
    const [profile, record, matches, heroes] = await Promise.all([
      apiJson(`https://api.opendota.com/api/players/${accountId}`),
      apiJson(`https://api.opendota.com/api/players/${accountId}/wl`),
      apiJson(`https://api.opendota.com/api/players/${accountId}/recentMatches`),
      apiJson("https://api.opendota.com/api/heroes")
    ]);
    heroById = new Map(heroes.map((hero) => [hero.id, hero]));

    $("#player-name").textContent = profile.profile?.personaname || "Dota 2 player";
    $("#avatar").src = profile.profile?.avatarfull || profile.profile?.avatar || "";
    $("#steam-profile").href = profile.profile?.profileurl || `https://steamcommunity.com/profiles/${accountId}`;

    const profileRankTier = validRankTier(profile.rank_tier);
    const rank = rankDetails(profileRankTier);
    $("#rank-icon").src = rank.image;
    $("#rank-icon").alt = rank.name;
    $("#rank-name").textContent = rank.name;
    $("#rank-stars").textContent = rank.stars;
    renderPredictedRank(matches, profileRankTier !== undefined);

    const wins = Number(record.win) || 0;
    const losses = Number(record.lose) || 0;
    const total = wins + losses;
    const winrate = total ? Math.round((wins / total) * 100) : 0;
    $("#winrate").innerHTML = `${total ? winrate : "—"}<small>%</small>`;
    $("#win-loss").textContent = `${formatNumber(wins)}W – ${formatNumber(losses)}L`;
    $("#winrate-bar").style.width = `${winrate}%`;
    const mmr = profile.mmr_estimate?.estimate;
    $("#mmr").textContent = Number.isFinite(mmr) ? formatNumber(mmr) : "Unranked";
    $("#mmr-caption").textContent = Number.isFinite(mmr) ? "OpenDota estimate · not official" : "No MMR estimate available";
    $("#matches-count").textContent = total ? formatNumber(total) : "—";
    renderRecentForm(matches);
    renderMatches(matches);
  } catch (err) {
    error.textContent = `We couldn't load your OpenDota stats. ${err.message}. Try refreshing in a moment.`;
    error.hidden = false;
    $("#matches-body").replaceChildren();
    const row = $("#matches-body").insertRow();
    const cell = row.insertCell();
    cell.colSpan = 6;
    cell.className = "empty-matches";
    cell.textContent = "Recent matches couldn't be loaded.";
    $("#matches-summary").textContent = "";
  }
}

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
