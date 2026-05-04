import { loadLiveStreams, loadSiteData } from "./sheet-loader.js?v=20260503-79";

const VIEWER_OPPONENT_LABEL = "リスナー";
const VIEWER_TEAM_KEY = "__LISTENER__";

let bpRows = [];
let championIcons = {};
let participants = [];
let playerMatches = [];
let schedules = [];
let scrimResults = [];
let teams = {};
let liveStreams = [];
let liveTimer = null;

const state = {
  view: "calendar",
  calendarMode: window.matchMedia("(max-width: 760px)").matches ? "cards" : "full",
  filterOpen: !window.matchMedia("(max-width: 900px)").matches,
  type: "",
  tier: "",
  keyword: "",
  excludeScrims: false,
  excludeViewer: false,
  lastUpdatedAt: null,
  fullCalendar: null,
  playerStatsSort: { key: "kda", direction: "desc" }
};

const elements = {
  calendarGrid: document.querySelector("#calendarGrid"),
  fullCalendar: document.querySelector("#fullCalendar"),
  leagueBoard: document.querySelector("#leagueBoard"),
  rankingBoard: document.querySelector("#rankingBoard"),
  playerStats: document.querySelector("#playerStats"),
  championStats: document.querySelector("#championStats"),
  filterPanel: document.querySelector("#filterPanel"),
  filterToggle: document.querySelector("#filterToggle"),
  headerStatus: document.querySelector("#headerStatus"),
  liveNowList: document.querySelector("#liveNowList"),
  liveNowStatus: document.querySelector("#liveNowStatus"),
  typeFilter: document.querySelector("#typeFilter"),
  tierFilter: document.querySelector("#tierFilter"),
  keywordFilter: document.querySelector("#keywordFilter"),
  excludeScrimsFilter: document.querySelector("#excludeScrimsFilter"),
  excludeViewerFilter: document.querySelector("#excludeViewerFilter"),
  dataSourceStatus: document.querySelector("#dataSourceStatus"),
  reloadData: document.querySelector("#reloadData"),
  dialog: document.querySelector("#matchDialog"),
  dialogMeta: document.querySelector("#dialogMeta"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogBody: document.querySelector("#dialogBody"),
  closeDialog: document.querySelector("#closeDialog")
};

document.addEventListener("DOMContentLoaded", async () => {
  setupHeaderEnhancements();
  moveFilterPanel();
  applyFilterPanelState();
  if (!window.FullCalendar) state.calendarMode = "cards";
  await hydrateData();
  await hydrateLiveStreams();
  startLiveRefresh();
  bindEvents();
  applyCalendarMode();
  render();
});

function setupHeaderEnhancements() {
  const topbar = document.querySelector(".topbar");
  const intro = topbar?.querySelector(":scope > div");
  const title = intro?.querySelector("h1");
  if (title && !intro.querySelector(".header-description")) {
    const description = document.createElement("p");
    description.className = "header-description";
    description.textContent = "League The k4senの試合予定・配信状況・スタッツをまとめて確認";
    title.after(description);
  }
  if (intro && !intro.querySelector("#headerStatus")) {
    const status = document.createElement("div");
    status.id = "headerStatus";
    status.className = "header-status";
    status.textContent = "LIVE配信中 --件 / 本日の試合 --件 / 最終更新 --";
    const dataStatus = intro.querySelector("#dataSourceStatus");
    (dataStatus || title)?.after(status);
    elements.headerStatus = status;
  }
  if (elements.filterPanel && !elements.filterPanel.querySelector("#filterToggle")) {
    let headingRow = elements.filterPanel.querySelector(".filter-heading-row");
    if (!headingRow) {
      const heading = elements.filterPanel.querySelector(".sidebar-heading");
      headingRow = document.createElement("div");
      headingRow.className = "filter-heading-row";
      const titleNode = heading?.querySelector("h2");
      if (titleNode) {
        headingRow.append(titleNode);
        heading.append(headingRow);
      }
    }
    const button = document.createElement("button");
    button.id = "filterToggle";
    button.className = "filter-toggle-button";
    button.type = "button";
    headingRow?.append(button);
    elements.filterToggle = button;
  }
}

function moveFilterPanel() {
  const toolbar = document.querySelector(".toolbar");
  if (toolbar && elements.filterPanel && toolbar.parentElement !== elements.filterPanel) {
    elements.filterPanel.append(toolbar);
  }
  ensureExtraFilters(toolbar);
}

function ensureExtraFilters(toolbar) {
  if (!toolbar || toolbar.querySelector("#excludeScrimsFilter")) return;
  const fieldset = document.createElement("fieldset");
  fieldset.className = "filter-checks";
  fieldset.innerHTML = `
    <legend>表示オプション</legend>
    <label>
      <input id="excludeScrimsFilter" type="checkbox">
      <span>スクリムを除く</span>
    </label>
    <label>
      <input id="excludeViewerFilter" type="checkbox">
      <span>vsリスナーを除く</span>
    </label>
  `;
  toolbar.append(fieldset);
  elements.excludeScrimsFilter = fieldset.querySelector("#excludeScrimsFilter");
  elements.excludeViewerFilter = fieldset.querySelector("#excludeViewerFilter");
}

async function hydrateData(options = {}) {
  try {
    if (elements.dataSourceStatus) elements.dataSourceStatus.textContent = options.refresh ? "スプレッドシートを再読込中" : "データ確認中";
    if (elements.reloadData) elements.reloadData.disabled = true;
    applyData(await loadSiteData(options));
    markUpdated();
    document.body.dataset.dataSource = "sheet";
    if (elements.dataSourceStatus) elements.dataSourceStatus.textContent = "スプレッドシートの最新データを表示中";
    render();
  } catch (error) {
    console.error("Google Sheets load failed.", error);
    document.body.dataset.dataSource = "error";
    if (elements.dataSourceStatus) {
      elements.dataSourceStatus.textContent = "スプレッドシート読み込み失敗: GASのWebアプリ公開状態を確認してください";
    }
  } finally {
    if (elements.reloadData) elements.reloadData.disabled = false;
  }
}

function applyData(data) {
  bpRows = data.bpRows || [];
  championIcons = data.championIcons || {};
  participants = data.participants || [];
  playerMatches = data.playerMatches || [];
  schedules = data.schedules || [];
  scrimResults = data.scrimResults || [];
  teams = data.teams || {};
}

async function hydrateLiveStreams(options = {}) {
  if (!elements.liveNowList) return;
  try {
    if (elements.liveNowStatus) elements.liveNowStatus.textContent = "LTK参加者の配信を確認中";
    const payload = await loadLiveStreams(options);
    liveStreams = payload.streams || [];
    markUpdated();
    if (elements.liveNowStatus) {
      elements.liveNowStatus.textContent = payload.configured
        ? `LOL配信中のLTK参加者 ${liveStreams.length}件`
        : "Twitch API未設定";
    }
  } catch (error) {
    console.error("Live streams load failed.", error);
    liveStreams = [];
    if (elements.liveNowStatus) elements.liveNowStatus.textContent = "LIVE NOWを取得できませんでした";
  }
  renderLiveNow();
  renderHeaderStatus();
}

function startLiveRefresh() {
  if (liveTimer) window.clearInterval(liveTimer);
  liveTimer = window.setInterval(() => hydrateLiveStreams({ refresh: true }), 4 * 60 * 1000);
}

function bindEvents() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("is-active", item === button));
      document.querySelectorAll(".view").forEach((view) => view.classList.toggle("is-active", view.id === `${state.view}View`));
      render();
    });
  });

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.calendarMode = button.dataset.calendarMode;
      applyCalendarMode();
      renderCalendar();
    });
  });

  document.querySelectorAll("[name='champTier']").forEach((input) => {
    input.addEventListener("change", renderChampions);
  });

  elements.typeFilter.addEventListener("change", () => {
    state.type = elements.typeFilter.value;
    render();
  });
  elements.tierFilter.addEventListener("change", () => {
    state.tier = elements.tierFilter.value;
    render();
  });
  elements.keywordFilter.addEventListener("input", () => {
    state.keyword = elements.keywordFilter.value.trim().toLocaleLowerCase("ja");
    render();
  });
  elements.excludeScrimsFilter?.addEventListener("change", () => {
    state.excludeScrims = elements.excludeScrimsFilter.checked;
    render();
  });
  elements.excludeViewerFilter?.addEventListener("change", () => {
    state.excludeViewer = elements.excludeViewerFilter.checked;
    render();
  });
  elements.filterToggle?.addEventListener("click", () => {
    state.filterOpen = !state.filterOpen;
    applyFilterPanelState();
  });
  elements.reloadData?.addEventListener("click", async () => {
    await hydrateData({ refresh: true });
    await hydrateLiveStreams({ refresh: true });
  });
  elements.closeDialog.addEventListener("click", () => elements.dialog.close());
  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) elements.dialog.close();
  });
}

function render() {
  renderHeaderStatus();
  renderLiveNow();
  if (state.view === "calendar") renderCalendar();
  if (state.view === "league") renderLeagueTables();
  if (state.view === "players") renderRankings();
  if (state.view === "stats") renderPlayerStats();
  if (state.view === "champions") renderChampions();
}

function markUpdated() {
  state.lastUpdatedAt = new Date();
}

function renderHeaderStatus() {
  if (!elements.headerStatus) return;
  const liveCount = Number.isFinite(liveStreams.length) ? liveStreams.length : null;
  const today = japanDateKey();
  const todayMatchCount = allCalendarItems().filter((item) => item.date === today).length;
  const updated = state.lastUpdatedAt ? japanTimeLabel(state.lastUpdatedAt) : "--";
  elements.headerStatus.textContent = `LIVE配信中 ${liveCount ?? "--"}件 / 本日の試合 ${todayMatchCount ?? "--"}件 / 最終更新 ${updated}`;
}

function applyFilterPanelState() {
  document.body.classList.toggle("filter-collapsed", !state.filterOpen);
  document.body.classList.toggle("filter-open", state.filterOpen);
  if (elements.filterToggle) {
    elements.filterToggle.textContent = state.filterOpen ? "隠す" : "フィルター";
    elements.filterToggle.setAttribute("aria-expanded", String(state.filterOpen));
    elements.filterToggle.setAttribute("aria-controls", "filterPanel");
  }
}

function renderLiveNow() {
  if (!elements.liveNowList) return;
  if (!liveStreams.length) {
    elements.liveNowList.innerHTML = `<p class="live-empty">現在LOL配信中のLTK参加者はいません</p>`;
    return;
  }
  elements.liveNowList.replaceChildren(...liveStreams.map(liveNowCard));
}

function liveNowCard(stream) {
  const card = document.createElement("a");
  card.className = "live-now-card";
  card.href = stream.streamUrl || "#";
  card.target = "_blank";
  card.rel = "noreferrer";
  const team = teams[stream.teamKey] || Object.values(teams).find((item) => item.key === stream.teamShortName) || {};
  card.style.setProperty("--team", team.accent || "#14b8a6");
  card.innerHTML = `
    <div class="live-person">
      ${stream.iconUrl ? `<img class="live-avatar" src="${stream.iconUrl}" alt="">` : `<span class="live-avatar">${(stream.name || "?").slice(0, 1)}</span>`}
      <div>
        <strong>${stream.name || "Unknown"}</strong>
        <p>${liveTeamMark(stream.teamKey, stream.teamShortName)} <span>${stream.teamShortName || team.key || "-"}</span> <span>${stream.rank || "-"}</span> <span>${stream.role || "-"}</span></p>
      </div>
    </div>
    <p class="live-title">${stream.streamTitle || "League of Legends"}</p>
    <span class="live-link">Twitchで見る</span>
  `;
  return card;
}

function liveTeamMark(teamKey, fallback) {
  const team = teams[teamKey || fallback];
  if (team?.logo) return `<img class="live-team-mark" src="${team.logo}" alt="">`;
  return `<span class="live-team-key">${fallback || teamKey || "-"}</span>`;
}

function allCalendarItems() {
  return buildCalendarItems();
}

function buildCalendarItems() {
  const map = new Map();
  const standalone = [];
  const resultById = new Map(scrimResults.map((result) => [result.id, result]));
  const usedResultIds = new Set();

  schedules.forEach((item) => {
    if (item.status === "tbd") {
      standalone.push({ ...item, results: [] });
      return;
    }

    if (item.linkedResultIds?.length) {
      const linkedResults = item.linkedResultIds
        .map((id) => resultById.get(id))
        .filter(Boolean);
      linkedResults.forEach((result) => usedResultIds.add(result.id));
      map.set(`SCHEDULE_${item.id}`, {
        ...item,
        results: linkedResults,
        resultSource: linkedResults.length > 0,
        status: linkedResults.length && item.status === "scheduled" ? "completed" : item.status,
        viewerMatch: linkedResults.some((result) => result.viewerMatch)
      });
      return;
    }

    const key = calendarKey(item);
    if (!map.has(key)) {
      map.set(key, { ...item, results: [], resultSource: false });
    }
  });

  scrimResults.forEach((result) => {
    if (usedResultIds.has(result.id)) return;
    const key = calendarKey(result);
    if (!map.has(key)) {
      map.set(key, {
        id: `AUTO_${key}`,
        date: result.date,
        eventTime: "",
        day: "RESULT",
        match: "Scrim",
        type: result.type || "スクリム結果",
        stage: "RESULT",
        matchName: result.matchName || "スクリム",
        tier: result.tier,
        left: result.left,
        right: result.right,
        leftLabel: result.leftLabel,
        rightLabel: result.rightLabel,
        blue: "",
        red: "",
        status: "completed",
        results: [],
        resultSource: true,
        viewerMatch: result.viewerMatch
      });
    }
    const item = map.get(key);
    item.results.push(result);
    item.resultSource = true;
    item.viewerMatch ||= result.viewerMatch;
    if (item.status === "scheduled") item.status = "completed";
  });

  return [...standalone, ...map.values()]
    .map((item) => ({ ...item, resultRecord: item.results?.length ? summarizeResults(item.results, item.left, item.right) : null }))
    .sort(compareCalendarItems);
}

function scheduleId(item) {
  return item.id || `${item.day}_${item.match}_${item.tier}`;
}

function compareCalendarItems(a, b) {
  const byDate = a.date.localeCompare(b.date);
  if (byDate) return byDate;
  const aTime = eventTimeSortValue(a);
  const bTime = eventTimeSortValue(b);
  if (aTime !== bTime) return aTime - bTime;
  return scheduleId(a).localeCompare(scheduleId(b), "ja", { numeric: true });
}

function eventTimeSortValue(item) {
  if (!item.eventTime) return Number.POSITIVE_INFINITY;
  const [hour, minute] = item.eventTime.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return Number.POSITIVE_INFINITY;
  return hour * 60 + minute;
}

function calendarKey(item) {
  const matchup = [item.left || "TBD_LEFT", item.right || "TBD_RIGHT"].sort().join("__");
  return `${item.date}__${item.tier}__${matchup}`;
}

function calendarEventTitle(item) {
  if (isViewerScrim(item)) {
    const games = item.resultRecord?.games ? ` ${item.resultRecord.games}G` : "";
    return `${viewerHomeLabel(item)} vs ${VIEWER_OPPONENT_LABEL}${games}`;
  }
  const base = `${item.left || "TBD"} vs ${item.right || "TBD"}`;
  if (!item.resultRecord) return base;
  return `${base} ${item.resultRecord.leftWins}-${item.resultRecord.rightWins}`;
}

function summarizeResults(results, left, right) {
  const summary = {
    games: results.length,
    leftWins: 0,
    rightWins: 0,
    dateLabel: shortDate(results[0]?.date || ""),
    carry: "",
    maxDamage: 0
  };
  results.forEach((result) => {
    if (result.winner === left) summary.leftWins += 1;
    if (result.winner === right) summary.rightWins += 1;
    if (result.maxDamage > summary.maxDamage) {
      summary.maxDamage = result.maxDamage;
      summary.carry = result.carry;
    }
  });
  return summary;
}

function tierSort(tier) {
  return { NEXT: 1, CORE: 2, MASTERS: 3, "NEXT/CORE": 4 }[tier] || 9;
}

function renderCalendar() {
  const items = filterCalendarItems();
  renderCardCalendar(items);
  renderFullCalendar(items);
}

function renderCardCalendar(items) {
  const grouped = groupByDate(items);
  elements.calendarGrid.replaceChildren(...Object.entries(grouped).map(([date, dayItems]) => {
    const day = document.createElement("section");
    day.className = "day-column";
    day.append(dateHeader(date, dayItems[0].day), ...dayItems.map(scheduleCard));
    return day;
  }));
}

function renderFullCalendar(items) {
  if (!window.FullCalendar) {
    state.calendarMode = "cards";
    applyCalendarMode();
    return;
  }
  const events = items.map((item) => ({
    id: item.id,
    title: item.status === "tbd" ? tbdDisplayTitle(item) : calendarEventTitle(item),
    start: item.date,
    allDay: true,
    sortOrder: calendarSortKey(item),
    backgroundColor: "#191919",
    borderColor: "#34383d",
    textColor: "#f8fafc",
    extendedProps: { item }
  }));

  try {
    if (!state.fullCalendar) {
      state.fullCalendar = new window.FullCalendar.Calendar(elements.fullCalendar, {
      locale: "ja",
      initialView: "dayGridMonth",
      initialDate: "2026-05-01",
      height: "auto",
      fixedWeekCount: false,
      dayMaxEvents: 4,
      displayEventTime: false,
      eventOrder: "sortOrder",
      headerToolbar: { left: "prev,next today", center: "title", right: "" },
      buttonText: { today: "今日" },
      dayCellClassNames(info) {
        return dateKey(info.date) === japanDateKey() ? ["is-ltk-today"] : [];
      },
      eventContent(info) {
        return { domNodes: [calendarEventNode(info.event.extendedProps.item)] };
      },
      eventClick(info) {
        openMatch(info.event.extendedProps.item);
      },
      events
    });
      state.fullCalendar.render();
    } else {
      state.fullCalendar.removeAllEvents();
      state.fullCalendar.addEventSource(events);
      state.fullCalendar.updateSize();
    }
  } catch (error) {
    console.error("FullCalendar render failed. Falling back to card calendar.", error);
    state.calendarMode = "cards";
    applyCalendarMode();
  }
}

function calendarEventNode(item) {
  const node = document.createElement("div");
  node.className = `fc-match-event ${isViewerScrim(item) ? "is-viewer-match" : ""}`;
  const tier = item.tier && item.tier !== "NEXT/CORE" ? item.tier : "";
  const caption = calendarMatchCaption(item);
  if (isViewerScrim(item)) {
    node.innerHTML = `
      ${tier ? `<div class="fc-match-tier">${tier}</div>` : ""}
      <div class="fc-match-title">
        <span class="fc-match-team is-left">${calendarTeamIcon(item.left)}<span>${teamShortName(item.left)}</span></span>
        <span class="fc-event-vs">vs</span>
        <span class="fc-match-team is-right is-listener"><span>リスナー</span></span>
      </div>
      <div class="fc-match-sub">
        <span>${caption}</span>
        ${item.resultRecord ? `<b>${viewerResultLabel(item)}</b>` : ""}
      </div>
    `;
    return node;
  }
  if (item.status === "tbd") {
    node.innerHTML = `
      ${tier ? `<div class="fc-match-tier">${tier}</div>` : ""}
      <div class="fc-match-title">${tbdDisplayTitle(item)}</div>
      <div class="fc-match-sub">
        <span>${caption}</span>
      </div>
    `;
    return node;
  }
  node.innerHTML = `
    ${tier ? `<div class="fc-match-tier">${tier}</div>` : ""}
    <div class="fc-match-title">
      <span class="fc-match-team is-left">${calendarTeamIcon(item.left)}<span>${teamShortName(item.left)}</span></span>
      <span class="fc-event-vs">vs</span>
      <span class="fc-match-team is-right"><span>${teamShortName(item.right)}</span>${calendarTeamIcon(item.right)}</span>
    </div>
    <div class="fc-match-sub">
      <span>${caption}</span>
      ${item.resultRecord ? `<b>${item.resultRecord.leftWins}-${item.resultRecord.rightWins}</b>` : ""}
    </div>
  `;
  return node;
}

function calendarMatchName(item) {
  if (item.matchName) return item.matchName;
  const rawStage = item.stage || "";
  const stage = rawStage === "GROUP" || rawStage === "Regular" ? "RegularStage" : rawStage;
  const name = item.match || item.type || "TBD";
  if (!stage || name.startsWith(`${stage}_`) || name.includes("Stage_")) return name;
  if (stage === "RESULT") return name;
  return `${stage}_${name}`;
}

function tbdDisplayTitle(item) {
  return item.displayTitle || item.display_title || "TBD";
}

function calendarMatchCaption(item) {
  return [item.eventTime, calendarMatchName(item)].filter(Boolean).join(" / ");
}

function calendarSortKey(item) {
  const time = Number.isFinite(eventTimeSortValue(item))
    ? String(eventTimeSortValue(item)).padStart(4, "0")
    : "9999";
  return `${time}_${scheduleId(item)}`;
}

function calendarTeamLabel(teamKey, tier) {
  const suffix = tier && tier !== "NEXT/CORE" ? ` ${tier}` : "";
  return `${teamShortName(teamKey)}${suffix}`;
}

function calendarTeamIcon(teamKey) {
  const team = teams[teamKey];
  if (!team?.logo) return `<span class="fc-team-mark">${teamKey || "?"}</span>`;
  return `<img class="fc-team-mark" src="${team.logo}" alt="${team.name}">`;
}

function applyCalendarMode() {
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.calendarMode === state.calendarMode);
  });
  elements.fullCalendar.hidden = state.calendarMode !== "full";
  elements.calendarGrid.hidden = state.calendarMode !== "cards";
  if (state.calendarMode === "full" && state.fullCalendar) {
    requestAnimationFrame(() => state.fullCalendar.updateSize());
  }
}

function dateHeader(dateValue, dayLabel) {
  const date = new Date(`${dateValue}T00:00:00`);
  const wrapper = document.createElement("div");
  wrapper.className = "date-header";
  wrapper.innerHTML = `<span>${dayLabel}</span><strong>${date.getMonth() + 1}/${date.getDate()} ${weekday(date)}</strong>`;
  return wrapper;
}

function scheduleCard(item) {
  const card = document.createElement("button");
  card.className = `schedule-card ${item.resultRecord ? "is-result" : ""} ${isViewerScrim(item) ? "is-viewer-match" : ""}`;
  card.type = "button";
  card.append(calendarEventNode(item));
  card.addEventListener("click", () => openMatch(item));
  return card;
  const left = teams[item.left];
  const right = teams[item.right];
  if (isViewerScrim(item)) {
    card.innerHTML = `
      <div class="card-top">
        <span>${calendarMatchName(item)}${item.resultRecord ? " / 終了" : ""}</span>
      </div>
      <div class="match-row">
        ${viewerTeamBlock(viewerHomeLabel(item), item.tier, item.left)}
        <span class="versus">VS</span>
        ${viewerTeamBlock(VIEWER_OPPONENT_LABEL, "")}
      </div>
      ${item.resultRecord ? resultLine(item) : ""}
    `;
    card.addEventListener("click", () => openMatch(item));
    return card;
  }
  card.innerHTML = item.status === "tbd" ? tbdCardMarkup(item) : `
    <div class="card-top">
      <span>${calendarMatchName(item)}${item.resultRecord ? " / 終了" : ""}</span>
    </div>
    <div class="match-row">
      ${teamBlock(left, item.tier)}
      <span class="versus">VS</span>
      ${teamBlock(right, item.tier)}
    </div>
    ${item.resultRecord ? resultLine(item) : ""}
  `;
  card.addEventListener("click", () => openMatch(item));
  return card;
}

function tbdCard(item) {
  return `
    <div class="card-top">
      <span>${calendarMatchName(item)}</span>
    </div>
    <div class="tbd-title">${tbdDisplayTitle(item)}</div>
    <p class="tbd-note">対戦カード未定</p>
  `;
}

function tbdCardMarkup(item) {
  return `
    <div class="card-top">
      <span>${calendarMatchName(item)}</span>
    </div>
    <div class="tbd-title">${tbdDisplayTitle(item)}</div>
    <p class="tbd-note">対戦カード未定</p>
  `;
}

function teamBlock(team, tier) {
  if (!team) return `<div class="team-block is-empty">TBD</div>`;
  return `
    <div class="team-block" style="--team:${team.accent}">
      <span class="team-mark">${team.logo ? `<img src="${team.logo}" alt="${team.name}">` : team.mark}</span>
      <strong>${team.fullName}</strong>
      <small>${tierLabel(tier)}</small>
    </div>
  `;
}

function viewerTeamBlock(label, tier, teamKey = "") {
  const team = teams[teamKey];
  return `
    <div class="team-block is-viewer-team">
      ${team?.logo ? `<span class="team-mark"><img src="${team.logo}" alt="${team.name}"></span>` : ""}
      <strong>${label || "TBD"}</strong>
      ${tier ? `<small>${tierLabel(tier)}</small>` : `<small>集計対象外</small>`}
    </div>
  `;
}

function sideLine(item) {
  if (!item.blue && !item.red) return `<div class="side-line">SIDE TBD</div>`;
  return `<div class="side-line"><span>BLUE ${item.blue}</span><span>RED ${item.red}</span></div>`;
}

function resultLine(item) {
  const record = item.resultRecord || summarizeResults([item], item.left, item.right);
  if (isViewerScrim(item)) {
    return `<div class="side-line"><span>RESULT ${viewerResultLabel(item)}</span><span>${record.games}G / ${record.dateLabel}</span></div>`;
  }
  return `<div class="side-line"><span>RESULT ${record.leftWins}-${record.rightWins}</span><span>${record.games}G / ${record.dateLabel}</span></div>`;
}

function openMatch(item) {
  elements.dialogMeta.textContent = `${item.date.replaceAll("-", "/")} ${item.eventTime ? `${item.eventTime} ` : ""}${item.day} ${item.match} / ${item.type}`;
  elements.dialogTitle.textContent = isViewerScrim(item)
    ? `${viewerHomeLabel(item)} vs ${VIEWER_OPPONENT_LABEL}`
    : item.status === "tbd" ? "TBD" : `${item.left || "TBD"} vs ${item.right || "TBD"}`;
  const body = item.resultRecord
    ? [matchSummary(item), resultSummary(item), participantSection(item)]
    : [matchSummary(item), participantSection(item)];
  elements.dialogBody.replaceChildren(...body);
  elements.dialog.showModal();
}

function matchSummary(item) {
  const section = document.createElement("section");
  section.className = "dialog-summary";
  const center = item.resultRecord ? `<span class="versus match-score">${matchScoreLabel(item)}</span>` : `<span class="versus">VS</span>`;
  section.innerHTML = item.status === "tbd"
    ? `<p>このカードは予定画像上で未定です。</p>`
    : isViewerScrim(item)
    ? `${item.left ? dialogTeamBlock(item.left, item.tier) : dialogTextTeamBlock(viewerHomeLabel(item), item.tier)}${center}${dialogTextTeamBlock(VIEWER_OPPONENT_LABEL, "")}`
    : `${dialogTeamBlock(item.left, item.tier)}${center}${dialogTeamBlock(item.right, item.tier)}`;
  return section;
}

function resultSummary(item) {
  const section = document.createElement("section");
  section.className = "result-summary";
  if (item.results?.length) {
    section.classList.add("is-games-only");
    const list = document.createElement("div");
    list.className = "result-game-list";
    item.results.forEach((result, index) => {
      const button = document.createElement("button");
      button.className = "result-game-card";
      button.type = "button";
      button.innerHTML = `
        <span>Game${index + 1}</span>
        <strong>WIN ${winnerDisplayName(result)}</strong>
        <small>${result.time} / ${result.leftKda} - ${result.rightKda}</small>
        <em>クリックして詳細を表示</em>
      `;
      button.addEventListener("click", () => renderGameDetail(section, result));
      list.append(button);
    });
    section.append(list);
    const detail = document.createElement("div");
    detail.className = "game-detail";
    detail.innerHTML = `<p class="muted">Gameを選択すると使用チャンピオンとスタッツを表示します。</p>`;
    section.append(detail);
    return section;
  }
  section.innerHTML = `
    <div><span>勝利</span><strong>${item.winner}</strong></div>
    <div><span>試合時間</span><strong>${item.time}</strong></div>
    <div><span>KDA</span><strong>${item.leftKda} / ${item.rightKda}</strong></div>
    <div><span>Gold</span><strong>${formatNumber(item.leftGold)} / ${formatNumber(item.rightGold)}</strong></div>
    <div><span>最大DMG</span><strong>${item.carry} ${formatNumber(item.maxDamage)}</strong></div>
  `;
  return section;
}

function renderGameDetail(section, result) {
  const detail = section.querySelector(".game-detail");
  if (!detail) return;
  const rows = playerMatches.filter((row) => row.matchId === result.id);
  if (!rows.length) {
    detail.innerHTML = `<p class="muted">このGameの詳細データが見つかりません。</p>`;
    return;
  }
  detail.innerHTML = `
    <h3>${result.match || result.id} / WIN ${winnerDisplayName(result)}</h3>
    <div class="game-detail-grid">
      ${gameDetailTeam(result.left, rows)}
      ${gameDetailTeam(result.right, rows)}
    </div>
  `;
}

function gameDetailTeam(teamKey, rows) {
  const teamRows = rows.filter((row) => row.team === teamKey);
  const title = teamKey === VIEWER_TEAM_KEY ? VIEWER_OPPONENT_LABEL : teamFullName(teamKey);
  return `
    <article class="game-detail-team">
      <h4>${teamKey !== VIEWER_TEAM_KEY ? teamLogo(teamKey, "ranking-team-logo") : ""}${title}</h4>
      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Player</th>
            <th>Champion</th>
            <th>KDA</th>
            <th>DMG</th>
            <th>Gold</th>
          </tr>
        </thead>
        <tbody>
          ${teamRows.map((row, index) => `
            <tr>
              <td>${row.role}</td>
              <td>${gameDetailPlayerName(row, index, teamKey)}</td>
              <td><span class="game-champion">${champIcon(row.champion)}<span>${row.champion}</span></span></td>
              <td>${row.kills}/${row.deaths}/${row.assists}</td>
              <td>${row.damage ? formatNumber(row.damage) : "-"}</td>
              <td>${row.gold ? formatNumber(row.gold) : "-"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </article>
  `;
}

function gameDetailPlayerName(row, index, teamKey) {
  if (teamKey === VIEWER_TEAM_KEY) return `PLAYER${index + 1}`;
  return row.name || row.summoner || "-";
}

function participantSection(item) {
  const wrapper = document.createElement("section");
  wrapper.className = "participants";
  if (item.status === "tbd") {
    wrapper.innerHTML = `<h3>参加者</h3><p class="muted">対戦カード未定のため、参加者一覧は表示しません。</p>`;
    return wrapper;
  }

  const tiers = item.tier === "NEXT/CORE" ? ["NEXT", "CORE"] : [item.tier];
  wrapper.innerHTML = `<h3>参加者</h3>`;
  const teamKeys = isViewerScrim(item) ? [item.left].filter(Boolean) : [item.left, item.right].filter(Boolean);
  teamKeys.forEach((teamKey) => {
    const teamSection = document.createElement("div");
    teamSection.className = "team-roster-row";
    teamSection.style.setProperty("--team", teams[teamKey]?.accent || "#0f766e");
    teamSection.innerHTML = `<h4>${teamLogo(teamKey, "team-roster-logo")}${teams[teamKey]?.fullName || teamKey}</h4>`;
    const grid = document.createElement("div");
    grid.className = "roster-grid";
    tiers.forEach((tier) => {
      participants
        .filter((person) => person.team === teamKey && person.tier === tier)
        .forEach((person) => grid.append(participantCard(person)));
    });
    teamSection.append(grid);
    wrapper.append(teamSection);
  });
  return wrapper;
}

function participantCard(person) {
  const card = document.createElement("article");
  card.className = "participant-card";
  card.innerHTML = `
    <div class="avatar">${person.icon ? `<img src="${person.icon}" alt="">` : `<span>${person.name.slice(0, 1)}</span>`}</div>
    <div class="participant-meta">
      <strong>${person.name}</strong>
      <span>${person.role} / ${person.org || "所属未確認"}</span>
    </div>
    <div class="links">
      ${iconLink("X", person.x, "./image/X.png")}
      ${iconLink("YouTube", person.youtube, "./image/Youtube.png")}
      ${iconLink("Twitch", person.twitch, "./image/Twitch.png")}
    </div>
  `;
  return card;
}

function renderRankings() {
  const stats = buildPlayerStats().filter((item) => filterByKeyword([item], (x) => `${x.name} ${x.champions} ${x.team}`)[0]);
  elements.rankingBoard.replaceChildren(...["NEXT", "CORE", "MASTERS"].map((tier) => rankingTier(tier, stats.filter((item) => item.tier === tier))));
}

function renderPlayerStats() {
  const columns = playerStatsColumns();
  const sortColumn = columns.find((column) => column.key === state.playerStatsSort.key) || columns[5];
  const rows = sortPlayerStats(buildPlayerStats()
    .filter((item) => !state.tier || item.tier === state.tier)
    .filter((item) => filterByKeyword([item], (x) => `${x.name} ${teamFullName(x.team)} ${x.tier} ${x.role} ${x.champions}`)[0]), sortColumn);
  const table = document.createElement("table");
  table.className = "player-stats-table";
  table.innerHTML = `
    <thead>
      <tr>
        ${columns.map((column) => `
          <th class="${column.numeric ? "is-numeric" : ""}">
            <button class="stat-sort-button" type="button" data-stat-sort="${column.key}" aria-label="${column.label}で並び替え">
              ${column.label}${sortMark(column.key)}
            </button>
          </th>
        `).join("")}
      </tr>
    </thead>
    <tbody>
      ${rows.map((item) => `
        <tr>
          ${columns.map((column) => `<td class="${column.numeric ? "is-numeric" : ""}">${column.render(item)}</td>`).join("")}
        </tr>
      `).join("")}
    </tbody>
  `;
  table.querySelectorAll("[data-stat-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.statSort;
      const current = state.playerStatsSort;
      state.playerStatsSort = {
        key,
        direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
      };
      renderPlayerStats();
    });
  });
  elements.playerStats.replaceChildren(table);
}

function playerStatsColumns() {
  return [
    { key: "name", label: "Player", value: (item) => item.name, render: (item) => playerStatsIdentity(item) },
    { key: "tier", label: "Tier", value: (item) => item.tier, render: (item) => item.tier },
    { key: "matches", label: "Games", numeric: true, value: (item) => item.matches, render: (item) => formatDecimal(item.matches) },
    { key: "record", label: "W-L", value: (item) => item.wins / item.matches, render: (item) => `${item.wins}-${item.matches - item.wins}` },
    { key: "kda", label: "KDA", numeric: true, value: (item) => item.kda, render: (item) => formatDecimal(item.kda) },
    { key: "kills", label: "K", numeric: true, value: (item) => item.avgKills, render: (item) => formatDecimal(item.avgKills) },
    { key: "deaths", label: "D", numeric: true, value: (item) => item.avgDeaths, render: (item) => formatDecimal(item.avgDeaths) },
    { key: "assists", label: "A", numeric: true, value: (item) => item.avgAssists, render: (item) => formatDecimal(item.avgAssists) },
    { key: "kp", label: "KP", numeric: true, value: (item) => item.killParticipation, render: (item) => percent(item.killParticipation) },
    { key: "cs15", label: "CS@15", numeric: true, value: (item) => item.avgCs15, render: (item) => item.avgCs15 == null ? "-" : formatDecimal(item.avgCs15) },
    { key: "damage", label: "DMG", numeric: true, value: (item) => item.avgDamage, render: (item) => formatNumber(item.avgDamage) },
    { key: "damageShare", label: "DMG%", numeric: true, value: (item) => item.damageShare, render: (item) => percent(item.damageShare) },
    { key: "championCount", label: "Champ", numeric: true, value: (item) => item.championCount, render: (item) => formatDecimal(item.championCount) }
  ];
}

function playerStatsIdentity(item) {
  return `
    <span class="stats-identity">
      ${playerIcon(item.name)}
      <span class="stats-identity-text">
        <strong>${item.name}</strong>
        <small>${teamLogo(item.team, "ranking-team-logo")}${teamShortName(item.team)} / ${item.role}</small>
      </span>
    </span>
  `;
}

function sortPlayerStats(rows, column) {
  const direction = state.playerStatsSort.direction === "asc" ? 1 : -1;
  const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
  return rows.sort((a, b) => {
    const left = column.value(a);
    const right = column.value(b);
    const leftMissing = left == null || Number.isNaN(left);
    const rightMissing = right == null || Number.isNaN(right);
    if (leftMissing || rightMissing) {
      return leftMissing === rightMissing ? collator.compare(a.name, b.name) : leftMissing ? 1 : -1;
    }
    const result = Number.isFinite(left) && Number.isFinite(right)
      ? left - right
      : collator.compare(String(left ?? ""), String(right ?? ""));
    return result * direction || collator.compare(a.name, b.name);
  });
}

function sortMark(key) {
  if (state.playerStatsSort.key !== key) return "";
  return state.playerStatsSort.direction === "asc" ? " ▲" : " ▼";
}

function renderLeagueTables() {
  const tiers = ["NEXT", "CORE", "MASTERS"];
  elements.leagueBoard.replaceChildren(...tiers.map((tier) => leagueTier(tier)));
}

function leagueTier(tier) {
  const rows = leagueScrimResults().filter((item) => item.tier === tier);
  const section = document.createElement("section");
  section.className = "league-tier";
  section.innerHTML = `<h3>${tier}</h3>`;

  const teamKeys = Object.keys(teams);
  const columnKeys = [...teamKeys, VIEWER_TEAM_KEY];
  const summary = buildLeagueSummary(rows, teamKeys, columnKeys);
  const table = document.createElement("table");
  table.className = "league-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Team</th>
        ${columnKeys.map((key) => `<th>${teamHeader(key, "short")}</th>`).join("")}
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      ${teamKeys.map((rowTeam) => `
        <tr>
          <th>${leagueRowHeader(rowTeam, tier)}</th>
          ${columnKeys.map((colTeam) => leagueCell(rowTeam, colTeam, summary)).join("")}
          <td class="league-total">${totalCell(rowTeam, summary)}</td>
        </tr>
      `).join("")}
    </tbody>
  `;
  const shell = document.createElement("div");
  shell.className = "table-shell league-shell";
  shell.append(table);
  if (!rows.length) {
    const note = document.createElement("p");
    note.className = "muted league-note";
    note.textContent = "この階級は、まだスクリム結果がありません。";
    section.append(note);
  }
  section.append(shell);
  return section;
}

function buildLeagueSummary(rows, teamKeys, columnKeys = teamKeys) {
  const byMatchupDate = new Map();
  const totals = new Map(teamKeys.map((team) => [team, { wins: 0, losses: 0 }]));
  rows.forEach((row) => {
    if (!row.left || !row.right || !row.winner) return;
    const loser = row.winner === row.left ? row.right : row.left;
    if (!teamKeys.includes(row.left) && !teamKeys.includes(row.right)) return;
    if (!columnKeys.includes(row.left) || !columnKeys.includes(row.right)) return;
    const matchup = [row.left, row.right].sort().join("__");
    const key = `${matchup}__${row.date}`;
    if (!byMatchupDate.has(key)) {
      byMatchupDate.set(key, {
        date: row.date,
        teams: [row.left, row.right].sort(),
        records: new Map([[row.left, { wins: 0, losses: 0 }], [row.right, { wins: 0, losses: 0 }]])
      });
    }
    const item = byMatchupDate.get(key);
    item.records.get(row.winner).wins += 1;
    item.records.get(row.winner).losses += 0;
    item.records.get(loser).losses += 1;
    item.records.get(loser).wins += 0;
    if (totals.has(row.winner)) totals.get(row.winner).wins += 1;
    if (totals.has(loser)) totals.get(loser).losses += 1;
  });
  return { byMatchupDate: [...byMatchupDate.values()], totals };
}

function leagueCell(rowTeam, colTeam, summary) {
  if (rowTeam === colTeam) return `<td class="league-empty">-</td>`;
  const entries = summary.byMatchupDate
    .filter((item) => item.teams.includes(rowTeam) && item.teams.includes(colTeam))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!entries.length) return `<td class="league-muted">未実施</td>`;
  return `
    <td>
      <div class="league-records">
        ${entries.map((item) => {
          const record = item.records.get(rowTeam) || { wins: 0, losses: 0 };
          return `<span class="${record.wins > record.losses ? "is-win" : record.wins < record.losses ? "is-loss" : ""}">${record.wins}-${record.losses} (${shortDate(item.date)})</span>`;
        }).join("")}
      </div>
    </td>
  `;
}

function totalCell(teamKey, summary) {
  const record = summary.totals.get(teamKey) || { wins: 0, losses: 0 };
  return `<strong>${record.wins}-${record.losses}</strong>`;
}

function rankingTier(tier, rows) {
  const section = document.createElement("section");
  section.className = "ranking-tier";
  section.innerHTML = `<h3>${tier}</h3>`;
  if (!rows.length) {
    section.innerHTML += `<p class="muted">この階級は、まだスクショから取得した試合実績がありません。</p>`;
    return section;
  }
  section.append(
    rankingList("KDA", rows, "kda", formatDecimal),
    rankingList("K", rows, "avgKills", formatDecimal),
    rankingList("D", rows, "avgDeaths", formatDecimal, "asc"),
    rankingList("A", rows, "avgAssists", formatDecimal),
    rankingList("キル関与率", rows, "killParticipation", percent),
    rankingList("CS@15", rows.filter((item) => item.avgCs15 != null), "avgCs15", formatDecimal),
    rankingList("平均ダメージ", rows, "avgDamage", formatNumber),
    rankingList("ダメージ割合", rows, "damageShare", percent),
    rankingList("使用チャンピオン数", rows, "championCount", formatDecimal)
  );
  return section;
}

function rankingList(title, rows, key, formatter, direction = "desc") {
  const block = document.createElement("div");
  block.className = "ranking-list";
  block.innerHTML = `
    <h4>${title}</h4>
    <div class="ranking-column-head">
      <span>#</span>
      <span>Player</span>
      <span>${title}</span>
    </div>
  `;
  rows
    .slice()
    .sort((a, b) => direction === "asc" ? a[key] - b[key] : b[key] - a[key])
    .slice(0, 5)
    .forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "ranking-row";
      row.innerHTML = `
        <span>${index + 1}</span>
        <span class="ranking-person-card" style="--team:${teams[item.team]?.accent || "#64748b"}">
          <span class="ranking-player">${playerIcon(item.name)}<strong>${item.name}</strong></span>
          <small>${teamLogo(item.team, "ranking-team-logo")}${teamShortName(item.team)} / ${item.role}</small>
        </span>
        <b>${formatter(item[key])}</b>
      `;
      block.append(row);
    });
  return block;
}

function renderChampions() {
  const tiers = selectedChampionTiers();
  const rows = buildChampionStats().filter((item) => tiers.includes(item.tier));
  const merged = mergeChampionStats(rows);
  const filtered = filterByKeyword(merged, (item) => `${item.champion} ${item.roles.join(" ")}`);
  elements.championStats.replaceChildren(
    championRankingList("ピック率", filtered, "pickRate", (item) => rateWithCount(item.picks, item.matchCount), "pick"),
    championRankingList("バン率", filtered, "banRate", (item) => rateWithCount(item.bans, item.matchCount), "ban"),
    championRankingList("ピックorバン率", filtered, "presenceRate", (item) => rateWithCount(item.presence, item.matchCount), "presence"),
    championRankingList("勝率（3回以上ピックされたチャンピオンのみ）", filtered.filter((item) => item.picks >= 3), "winRate", (item) => rateWithCount(item.wins, item.picks), "win")
  );
}

function championRankingList(title, rows, key, formatter, detailMode, note = "") {
  const block = document.createElement("section");
  block.className = "ranking-list champion-ranking-list";
  block.innerHTML = `<h4>${title}</h4>${note ? `<p class="ranking-note">${note}</p>` : ""}`;
  rows
    .slice()
    .sort((a, b) => b[key] - a[key] || b.presence - a.presence)
    .slice(0, 10)
    .forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "ranking-row champion-ranking-row";
      row.tabIndex = 0;
      row.role = "button";
      row.innerHTML = `
        <span>${index + 1}</span>
        <span class="ranking-player">${champIcon(item.champion)}<strong>${item.champion}</strong></span>
        <b>${formatter(item)}</b>
      `;
      row.addEventListener("click", () => openChampionDetail(item, title, detailMode));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openChampionDetail(item, title, detailMode);
        }
      });
      block.append(row);
    });
  return block;
}

function openChampionDetail(item, title, mode) {
  elements.dialogMeta.textContent = `Champion / ${title}`;
  elements.dialogTitle.textContent = item.champion;
  const wins = competitivePlayerMatches().filter((row) => row.champion === item.champion && row.result === "WIN");
  const body = document.createElement("section");
  body.className = "champion-detail";
  body.innerHTML = `
    <div class="champion-detail-head">
      ${champIcon(item.champion)}
      <div>
        <strong>${title}</strong>
        <span>${championDetailMetric(item, mode)}</span>
      </div>
    </div>
    ${championDetailRows("勝利した使用者", wins, true)}
    ${mode === "ban" || mode === "presence" ? `<p class="muted">BANは現在の元データにBANしたチーム・選手情報がないため、件数のみ表示しています。BAN数: ${item.bans}</p>` : ""}
  `;
  elements.dialogBody.replaceChildren(body);
  elements.dialog.showModal();
}

function championDetailMetric(item, mode) {
  if (mode === "pick") return `ピック ${rateWithCount(item.picks, item.matchCount)}`;
  if (mode === "ban") return `BAN ${rateWithCount(item.bans, item.matchCount)}`;
  if (mode === "presence") return `P/B ${rateWithCount(item.presence, item.matchCount)}`;
  return `勝率 ${rateWithCount(item.wins, item.picks)}`;
}

function championDetailRows(title, rows, winsOnly) {
  if (!rows.length) return `<div class="champion-detail-list"><h3>${title}</h3><p class="muted">該当データなし</p></div>`;
  return `
    <div class="champion-detail-list">
      <h3>${title}</h3>
      ${rows.map((row) => `
        <article>
          ${playerIcon(row.name)}
          <div>
            <strong>${row.name}</strong>
            <span>${teamLogo(row.team, "ranking-team-logo")}${teamFullName(row.team)} / ${row.role}</span>
          </div>
          <b>${winsOnly ? "WIN" : row.result}</b>
        </article>
      `).join("")}
    </div>
  `;
}

function buildPlayerStats() {
  const map = new Map();
  competitivePlayerMatches().forEach((row) => {
    const key = row.name;
    if (!map.has(key)) {
      map.set(key, { name: row.name, team: row.team, tier: row.tier, role: row.role, matches: 0, wins: 0, kills: 0, deaths: 0, assists: 0, damage: 0, cs15: 0, cs15Matches: 0, gold: 0, champions: new Set() });
    }
    const item = map.get(key);
    item.matches += 1;
    item.wins += row.result === "WIN" ? 1 : 0;
    item.kills += row.kills;
    item.deaths += row.deaths;
    item.assists += row.assists;
    item.damage += row.damage;
    if (Number.isFinite(row.cs15) && row.cs15 > 0) {
      item.cs15 += row.cs15;
      item.cs15Matches += 1;
    }
    item.gold += row.gold;
    item.champions.add(row.champion);
  });
  return [...map.values()].map((item) => ({
    ...item,
    kda: item.deaths === 0 ? item.kills + item.assists : (item.kills + item.assists) / item.deaths,
    avgKills: item.kills / item.matches,
    avgDeaths: item.deaths / item.matches,
    avgAssists: item.assists / item.matches,
    killParticipation: teamKillParticipation(item),
    damageShare: teamDamageShare(item),
    avgDamage: item.damage / item.matches,
    avgCs15: item.cs15Matches ? item.cs15 / item.cs15Matches : null,
    avgGold: item.gold / item.matches,
    championCount: item.champions.size,
    champions: [...item.champions].join(" / ")
  }));
}

function buildChampionStats() {
  const picks = competitivePlayerMatches().map((row) => ({ matchId: row.matchId, tier: row.tier, champion: row.champion, type: "PICK", win: row.result === "WIN", role: row.role }));
  const bans = competitiveBpRows().map((row) => ({ matchId: row.matchId, tier: row.tier, champion: row.champion, type: row.type, win: false, role: "" }));
  return [...picks, ...bans];
}

function mergeChampionStats(rows) {
  const map = new Map();
  const matchCount = new Set(competitivePlayerMatches().map((row) => row.matchId)).size || 1;
  rows.forEach((row) => {
    if (!row.champion) return;
    if (!map.has(row.champion)) {
      map.set(row.champion, { champion: row.champion, tiers: new Set(), roles: new Set(), picks: 0, bans: 0, wins: 0 });
    }
    const item = map.get(row.champion);
    item.tiers.add(row.tier);
    if (row.role) item.roles.add(row.role);
    if (row.type === "PICK") item.picks += 1;
    if (row.type === "BAN") item.bans += 1;
    if (row.win) item.wins += 1;
  });
  return [...map.values()].map((item) => ({
    ...item,
    tiers: [...item.tiers],
    roles: [...item.roles],
    presence: item.picks + item.bans,
    matchCount,
    pickRate: item.picks / matchCount,
    banRate: item.bans / matchCount,
    presenceRate: (item.picks + item.bans) / matchCount,
    winRate: item.picks ? item.wins / item.picks : 0
  }))
    .sort((a, b) => (b.picks + b.bans) - (a.picks + a.bans) || b.picks - a.picks);
}

function filterCalendarItems() {
  return allCalendarItems().filter((item) => {
    if (state.type && item.type !== state.type) return false;
    if (state.tier && !item.tier.includes(state.tier)) return false;
    if (state.excludeScrims && isScrimLikeItem(item)) return false;
    if (state.excludeViewer && isViewerScrim(item)) return false;
    if (!state.keyword) return true;
    const relatedPlayers = playersForSchedule(item).map((person) => `${person.name} ${person.org}`);
    const text = [item.left, item.right, item.winner, item.type, item.tier, item.stage, item.day, item.match, ...relatedPlayers]
      .join(" ")
      .toLocaleLowerCase("ja");
    return text.includes(state.keyword);
  });
}

function isScrimCalendarItem(item) {
  const text = [item.type, item.matchName, item.match, item.stage]
    .filter(Boolean)
    .join(" ");
  return text.includes("スクリム");
}

function isScrimLikeItem(item) {
  const text = [item?.type, item?.matchName, item?.match, item?.stage]
    .filter(Boolean)
    .join(" ");
  return text.includes("スクリム") || text.includes("Scrim") || text.includes("繧ｹ繧ｯ");
}

function viewerMatchIds() {
  return new Set(scrimResults.filter(isViewerScrim).map((row) => row.id));
}

function isViewerScrim(item) {
  return Boolean(item?.viewerMatch)
    || item?.right === VIEWER_TEAM_KEY
    || item?.left === VIEWER_TEAM_KEY
    || item?.type === "対視聴者"
    || item?.matchName === "対視聴者"
    || (!item?.left || !item?.right) && item?.resultSource;
}

function competitiveScrimResults() {
  return scrimResults.filter((row) => !isViewerScrim(row));
}

function leagueScrimResults() {
  return scrimResults.filter((row) => row.left && row.right && row.winner);
}

function competitivePlayerMatches() {
  return playerMatches.filter((row) => row.name && row.team !== VIEWER_TEAM_KEY && matchPassesGlobalFilters(row.matchId));
}

function competitiveBpRows() {
  return bpRows.filter((row) => row.team !== VIEWER_TEAM_KEY && matchPassesGlobalFilters(row.matchId));
}

function matchPassesGlobalFilters(matchId) {
  const match = scrimResults.find((row) => row.id === matchId);
  if (!match) return true;
  if (state.excludeScrims && isScrimLikeItem(match)) return false;
  if (state.excludeViewer && isViewerScrim(match)) return false;
  return true;
}

function playersForSchedule(item) {
  if (isViewerScrim(item)) return [];
  if (item.status === "tbd") return [];
  const tiers = item.tier === "NEXT/CORE" ? ["NEXT", "CORE"] : [item.tier];
  return participants.filter((person) => [item.left, item.right].includes(person.team) && tiers.includes(person.tier));
}

function selectedChampionTiers() {
  return [...document.querySelectorAll("[name='champTier']:checked")].map((input) => input.value);
}

function filterByKeyword(items, selector) {
  if (!state.keyword) return items;
  return items.filter((item) => selector(item).toLocaleLowerCase("ja").includes(state.keyword));
}

function groupByDate(items) {
  return items.reduce((grouped, item) => {
    grouped[item.date] ||= [];
    grouped[item.date].push(item);
    return grouped;
  }, {});
}

function weekday(date) {
  return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][date.getDay()];
}

function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function japanDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function japanTimeLabel(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function tierLabel(tier) {
  return tier === "NEXT/CORE" ? "NEXT + CORE" : tier;
}

function teamHeader(teamKey, mode = "full") {
  if (teamKey === VIEWER_TEAM_KEY) {
    return `<span class="league-team"><span>${VIEWER_OPPONENT_LABEL}</span></span>`;
  }
  const team = teams[teamKey];
  if (!team) return teamKey;
  return `
    <span class="league-team">
      <span class="team-mark">${team.logo ? `<img src="${team.logo}" alt="${team.name}">` : team.mark}</span>
      <span>${mode === "short" ? team.key : team.fullName}</span>
    </span>
  `;
}

function leagueRowHeader(teamKey, tier) {
  const team = teams[teamKey];
  if (!team) return teamKey;
  const players = participants.filter((person) => person.team === teamKey && person.tier === tier);
  return `
    <span class="league-row-team">
      ${teamLogo(teamKey, "league-row-logo")}
      <span class="league-row-name">${team.fullName}</span>
      <span class="league-player-icons">
        ${players.map((person) => person.icon
          ? `<img src="${person.icon}" alt="${person.name}" title="${person.name}">`
          : `<span title="${person.name}">${person.name.slice(0, 1)}</span>`).join("")}
      </span>
    </span>
  `;
}

function dialogTeamBlock(teamKey, tier) {
  const team = teams[teamKey];
  if (!team) return `<div class="dialog-team">TBD</div>`;
  return `
    <div class="dialog-team" style="--team:${team.accent}">
      ${teamLogo(teamKey, "dialog-team-logo")}
      <div>
        <strong>${team.fullName}</strong>
        <small>${tierLabel(tier)}</small>
      </div>
    </div>
  `;
}

function dialogTextTeamBlock(label, tier) {
  return `
    <div class="dialog-team dialog-text-team">
      <div>
        <strong>${label || "TBD"}</strong>
        <small>${tier ? tierLabel(tier) : "集計対象外"}</small>
      </div>
    </div>
  `;
}

function matchScoreLabel(item) {
  const record = item.resultRecord;
  if (!record) return "VS";
  return `<span class="score-number">${record.leftWins}</span><span class="score-vs">VS</span><span class="score-number">${record.rightWins}</span>`;
}

function winnerDisplayName(result) {
  if (result.winner === VIEWER_TEAM_KEY) return VIEWER_OPPONENT_LABEL;
  return teamFullName(result.winner);
}

function teamLogo(teamKey, className) {
  const team = teams[teamKey];
  if (!team?.logo) return `<span class="${className}">${teamKey || "?"}</span>`;
  return `<img class="${className}" src="${team.logo}" alt="${team.name}">`;
}

function teamShortName(teamKey) {
  return teams[teamKey]?.key || teamKey || "TBD";
}

function teamFullName(teamKey) {
  return teams[teamKey]?.fullName || teamKey || "TBD";
}

function viewerHomeLabel(item, short = false) {
  if (item.left) return short ? calendarTeamLabel(item.left, item.tier) : teamFullName(item.left);
  return item.leftLabel || "LTK";
}

function viewerResultLabel(item) {
  const record = item.resultRecord || summarizeResults(item.results || [item], item.left, item.right);
  return `${record.games}G`;
}

function displayTeamLabel(item, side) {
  if (isViewerScrim(item)) {
    if (side === "left") return viewerHomeLabel(item);
    return VIEWER_OPPONENT_LABEL;
  }
  return side === "left" ? item.left : item.right;
}

function playerIcon(name) {
  const person = participants.find((item) => item.name === name);
  if (!person?.icon) return `<span class="ranking-avatar">${name.slice(0, 1)}</span>`;
  return `<img class="ranking-avatar" src="${person.icon}" alt="">`;
}

function teamKillParticipation(item) {
  const teamKillsByMatch = new Map();
  const rows = competitivePlayerMatches();
  rows.forEach((row) => {
    const key = `${row.matchId}__${row.team}`;
    teamKillsByMatch.set(key, (teamKillsByMatch.get(key) || 0) + row.kills);
  });
  let total = 0;
  let count = 0;
  rows
    .filter((row) => row.name === item.name)
    .forEach((row) => {
      const teamKills = teamKillsByMatch.get(`${row.matchId}__${row.team}`) || 0;
      if (teamKills > 0) {
        total += (row.kills + row.assists) / teamKills;
        count += 1;
      }
    });
  return count ? total / count : 0;
}

function teamDamageShare(item) {
  const teamDamageByMatch = new Map();
  const rows = competitivePlayerMatches();
  rows.forEach((row) => {
    const key = `${row.matchId}__${row.team}`;
    teamDamageByMatch.set(key, (teamDamageByMatch.get(key) || 0) + row.damage);
  });
  let total = 0;
  let count = 0;
  rows
    .filter((row) => row.name === item.name)
    .forEach((row) => {
      const teamDamage = teamDamageByMatch.get(`${row.matchId}__${row.team}`) || 0;
      if (teamDamage > 0) {
        total += row.damage / teamDamage;
        count += 1;
      }
    });
  return count ? total / count : 0;
}

function shortDate(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function iconLink(label, url, icon) {
  if (!url) return `<span class="sns-link is-off"><img src="${icon}" alt="${label}"></span>`;
  const normalized = url.startsWith("http") ? url : `https://${url}`;
  return `<a class="sns-link" href="${normalized}" target="_blank" rel="noreferrer" aria-label="${label}"><img src="${icon}" alt="${label}"></a>`;
}

function champIcon(champion) {
  const url = championIconUrl(champion);
  if (!url) return `<span class="champ-fallback">${champion.slice(0, 1)}</span>`;
  return `<img class="champ-icon" src="${url}" alt="">`;
}

function championIconUrl(champion) {
  const key = String(champion || "").trim();
  if (!key) return "";
  return championIcons[key]
    || championIcons[normalizeChampionName(key)]
    || championIcons[denormalizeChampionName(key)]
    || "";
}

function normalizeChampionName(value) {
  return String(value || "")
    .replace(/IV/g, "Ⅳ")
    .replace(/III/g, "Ⅲ")
    .replace(/II/g, "Ⅱ")
    .replace(/I/g, "Ⅰ");
}

function denormalizeChampionName(value) {
  return String(value || "")
    .replace(/Ⅳ/g, "IV")
    .replace(/Ⅲ/g, "III")
    .replace(/Ⅱ/g, "II")
    .replace(/Ⅰ/g, "I");
}

function formatNumber(value) {
  return new Intl.NumberFormat("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(truncateOneDecimal(value));
}

function formatDecimal(value) {
  return truncateOneDecimal(value).toFixed(1);
}

function truncateOneDecimal(value) {
  const number = Number(value) || 0;
  return Math.floor(number * 10) / 10;
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function rateWithCount(numerator, denominator) {
  const rate = denominator ? numerator / denominator : 0;
  return `${percent(rate)} (${numerator}/${denominator || 0})`;
}
