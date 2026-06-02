import { loadLiveStreams, loadSiteData } from "./sheet-loader.js?v=20260602-02";

const VIEWER_OPPONENT_LABEL = "リスナー";
const VIEWER_TEAM_KEY = "__LISTENER__";
const CLIP_WATCHED_STORAGE_KEY = "ltkdb.watchedClipIds.v1";
const TWITCH_CLIP_LIKED_STORAGE_KEY = "ltkdb.likedTwitchClipIds.v1";
const TWITCH_CLIP_VIEWER_ID_STORAGE_KEY = "ltkdb.twitchClipViewerId.v1";
const CLIP_WARNING_STORAGE_KEY = "ltk_clip_warning_accepted";
const CLIP_WARNING_ACCEPTED_VALUE = "v2";
const CLIP_WARNING_TEAM_STORAGE_KEY = "ltk_clip_warning_team";
const CLIP_WARNING_TEAM_OPTIONS = ["DD", "CC", "IT", "LR"];
const CLIP_WARNING_TEAM_LABELS = {
  DD: "Dahlia Diadem",
  CC: "Camellia Crown",
  IT: "Iris Tiara",
  LR: "Laurel Regalia"
};
const CLIP_RECENT_DAYS = 7;
const CLIP_PAGE_SIZE = 24;
const TWITCH_CLIP_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLScMV6ErnMTeMzfvV1bE8-L5MDz4hMCiXM33MTqfPmPXSkSUHg/viewform";
const TWITCH_CLIP_LIKE_ENDPOINT = "https://script.google.com/macros/s/AKfycbwNzByFJex1ZVj7mKFrMnGfYDrRSK_6Ew1j5A-S6hQymMs8a7Emx1_wqWGPObNCe_0/exec";
const CLIPS_PREVIEW_ENABLED = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const FULL_CALENDAR_COLLAPSED_EVENT_LIMIT = 2;
const ROLE_ORDER = ["TOP", "JG", "MID", "ADC", "SUP"];
const DRAFT_SLOTS = {
  BLUE: {
    BAN: [1, 3, 5, 14, 16],
    PICK: [7, 10, 11, 18, 19]
  },
  RED: {
    BAN: [2, 4, 6, 13, 15],
    PICK: [8, 9, 12, 17, 20]
  }
};
const ROUTES = [
  { hash: "#/schedule", view: "calendar", pagePath: "/schedule", pageTitle: "予定" },
  { hash: "#/standings", view: "league", pagePath: "/standings", pageTitle: "リーグ表" },
  { hash: "#/teams", view: "teams", pagePath: "/teams", pageTitle: "チーム戦績" },
  { hash: "#/players", view: "stats", pagePath: "/players", pageTitle: "個人成績" },
  { hash: "#/rankings", view: "ranking", pagePath: "/rankings", pageTitle: "個人ランキング" },
  { hash: "#/champions", view: "champions", pagePath: "/champions", pageTitle: "チャンピオン" },
  { hash: "#/clips", view: "clips", clipSource: "youtube", pagePath: "/clips", pageTitle: "切り抜き動画" },
  { hash: "#/clips/youtube", view: "clips", clipSource: "youtube", pagePath: "/clips/youtube", pageTitle: "YouTubeまとめ" },
  { hash: "#/clips/twitch", view: "clips", clipSource: "twitch", pagePath: "/clips/twitch", pageTitle: "Twitchクリップまとめ" },
  { hash: "#/about", view: "about", pagePath: "/about", pageTitle: "このサイトについて" },
  { hash: "#/contact", view: "contact", pagePath: "/contact", pageTitle: "お問い合わせ" }
];
const DEFAULT_ROUTE = ROUTES[0];
const routeByHash = new Map(ROUTES.map((route) => [route.hash, route]));
const viewToRoute = new Map();
ROUTES.forEach((route) => {
  if (!viewToRoute.has(route.view)) viewToRoute.set(route.view, route);
});
const viewToHash = Object.fromEntries([...viewToRoute].map(([view, route]) => [view, route.hash]));
const hashToView = Object.fromEntries(ROUTES.map((route) => [route.hash, route.view]));
const viewToPageTitle = Object.fromEntries([...viewToRoute].map(([view, route]) => [view, route.pageTitle]));
const viewToPagePath = Object.fromEntries([...viewToRoute].map(([view, route]) => [view, route.pagePath]));
const clipSourceToHash = {
  youtube: "#/clips/youtube",
  twitch: "#/clips/twitch"
};

let bpRows = [];
let championIcons = {};
let participants = [];
let playerMatches = [];
let schedules = [];
let scrimResults = [];
let teams = {};
let liveStreams = [];
let clipVideos = [];
let twitchClips = [];
let siteNews = [];
let watchedClipIds = readWatchedClipIds();
let likedTwitchClipIds = readLikedTwitchClipIds();
let liveTimer = null;
let dataTimer = null;
let dialogBackStack = [];
let currentDialogView = null;
let lastTrackedPagePath = "";
let currentRoute = DEFAULT_ROUTE;
const narrowLayoutQuery = window.matchMedia("(max-width: 900px)");

const state = {
  view: "calendar",
  calendarMode: window.matchMedia("(max-width: 760px)").matches ? "cards" : "full",
  filterOpen: true,
  type: "",
  tier: "",
  team: "",
  keyword: "",
  excludeScrims: true,
  excludeViewer: false,
  lastUpdatedAt: null,
  fullCalendarExpanded: false,
  fullCalendarExpandedDate: "",
  fullCalendar: null,
  playerStatsSort: { key: "kda", direction: "desc" },
  championStatsSort: { key: "presence", direction: "desc" },
  championTableOpen: true,
  clipSource: "youtube",
  clipPage: 1,
  twitchClipPage: 1,
  twitchClipPlayer: "",
  twitchClipSort: "new",
  clipViewerTeam: readClipViewerTeam(),
  previousView: "calendar"
};

const elements = {
  calendarGrid: document.querySelector("#calendarGrid"),
  fullCalendar: document.querySelector("#fullCalendar"),
  leagueBoard: document.querySelector("#leagueBoard"),
  teamStats: document.querySelector("#teamStats"),
  rankingBoard: document.querySelector("#rankingBoard"),
  playerStats: document.querySelector("#playerStats"),
  championStats: document.querySelector("#championStats"),
  championTable: document.querySelector("#championTable"),
  championTableToggle: document.querySelector("#championTableToggle"),
  clipsGrid: document.querySelector("#clipsGrid"),
  clipsPagination: document.querySelector("#clipsPagination"),
  clipsStatus: document.querySelector("#clipsStatus"),
  clipTeamNotice: document.querySelector("#clipTeamNotice"),
  clipTeamNoticeLabel: document.querySelector("[data-clip-team-label]"),
  changeClipTeam: document.querySelector("[data-change-clip-team]"),
  clipWarningModal: null,
  clipSourceTabs: document.querySelectorAll("[data-clip-source]"),
  twitchClipIntro: document.querySelector("#twitchClipIntro"),
  twitchClipFormLink: document.querySelector("#twitchClipFormLink"),
  twitchClipFilters: document.querySelector("#twitchClipFilters"),
  twitchClipPlayerFilter: document.querySelector("#twitchClipPlayerFilter"),
  twitchClipSortFilter: document.querySelector("#twitchClipSortFilter"),
  filterPanel: document.querySelector("#filterPanel"),
  filterToggle: document.querySelector("#filterToggle"),
  headerStatus: document.querySelector("#headerStatus"),
  liveNowPanel: document.querySelector(".live-now-panel"),
  liveNowList: document.querySelector("#liveNowList"),
  liveNowStatus: document.querySelector("#liveNowStatus"),
  newsList: document.querySelector("#newsList"),
  typeFilter: document.querySelector("#typeFilter"),
  tierFilter: document.querySelector("#tierFilter"),
  teamFilter: document.querySelector("#teamFilter"),
  keywordFilter: document.querySelector("#keywordFilter"),
  excludeScrimsFilter: document.querySelector("#excludeScrimsFilter"),
  excludeViewerFilter: document.querySelector("#excludeViewerFilter"),
  dataSourceStatus: document.querySelector("#dataSourceStatus"),
  reloadData: document.querySelector("#reloadData"),
  dialog: document.querySelector("#matchDialog"),
  dialogBack: document.querySelector("#backDialog"),
  dialogMeta: document.querySelector("#dialogMeta"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogBody: document.querySelector("#dialogBody"),
  closeDialog: document.querySelector("#closeDialog")
};

document.addEventListener("DOMContentLoaded", async () => {
  ensureAnalytics();
  applyFeatureFlags();
  applyRouteFromHash({ render: false, trackPageView: false });
  setupHeaderEnhancements();
  moveFilterPanel();
  applyFilterPanelState();
  if (!window.FullCalendar) state.calendarMode = "cards";
  bindEvents();
  await hydrateData();
  await hydrateLiveStreams();
  startDataRefresh();
  startLiveRefresh();
  applyCalendarMode();
  render();
  trackVirtualPageView(routeForState());
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
    const dataSourceRow = intro.querySelector(".data-source-row");
    const dataStatus = intro.querySelector("#dataSourceStatus");
    (dataSourceRow || dataStatus || title)?.after(status);
    elements.headerStatus = status;
  }
  if (elements.filterPanel && !elements.filterToggle) {
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
      <input id="excludeScrimsFilter" type="checkbox" checked>
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
    if (elements.dataSourceStatus && !options.silent) elements.dataSourceStatus.textContent = options.refresh ? "データベースを更新確認中" : "データ確認中";
    if (elements.reloadData) elements.reloadData.disabled = true;
    applyData(await loadSiteData(options));
    markUpdated();
    document.body.dataset.dataSource = "static";
    if (elements.dataSourceStatus) elements.dataSourceStatus.textContent = "データベースの公開データを表示中";
    render();
  } catch (error) {
    console.error("Site data load failed.", error);
    document.body.dataset.dataSource = "error";
    if (elements.dataSourceStatus) {
      elements.dataSourceStatus.textContent = "データベース読み込み失敗: 時間をおいて再読み込みしてください";
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
  clipVideos = data.clipVideos || [];
  twitchClips = data.twitchClips || [];
  siteNews = data.siteNews || [];
  populateTeamFilter();
}

function populateTeamFilter() {
  if (!elements.teamFilter) return;
  const current = elements.teamFilter.value || state.team;
  const options = Object.entries(teams)
    .sort(([, a], [, b]) => String(a.shortName || a.name || "").localeCompare(String(b.shortName || b.name || ""), "ja", { numeric: true }))
    .map(([key, team]) => `<option value="${key}">${team.shortName || key} / ${team.name || key}</option>`);
  elements.teamFilter.innerHTML = `<option value="">すべて</option>${options.join("")}`;
  if (current && teams[current]) {
    elements.teamFilter.value = current;
    state.team = current;
  } else {
    state.team = "";
  }
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
  liveTimer = window.setInterval(() => hydrateLiveStreams(), 5 * 60 * 1000);
}

function startDataRefresh() {
  if (dataTimer) window.clearInterval(dataTimer);
  dataTimer = window.setInterval(async () => {
    await hydrateData({ refresh: true, silent: true });
  }, 5 * 60 * 1000);
}

function bindEvents() {
  document.addEventListener("click", handleGlobalAnalyticsClick);
  window.addEventListener("hashchange", () => applyRouteFromHash());
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      const requestedView = button.dataset.view || "calendar";
      if (requestedView === "clips" && !CLIPS_PREVIEW_ENABLED) {
        navigateToRoute(DEFAULT_ROUTE);
        return;
      }
      if (requestedView === "clips" && !hasAcceptedClipWarning()) {
        state.previousView = state.view && state.view !== "clips" ? state.view : state.previousView || "calendar";
        showClipWarningModal();
        trackAnalyticsEvent("clip_warning_view", { page: "clips" });
        return;
      }
      navigateToRoute(viewToRoute.get(requestedView) || DEFAULT_ROUTE);
      trackAnalyticsEvent("select_content", {
        content_type: "navigation_tab",
        item_id: requestedView,
        item_name: button.textContent.trim()
      });
    });
  });

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.calendarMode = button.dataset.calendarMode;
      applyCalendarMode();
      renderCalendar();
    });
  });

  document.querySelectorAll("[name='champTier'], [name='champRole']").forEach((input) => {
    input.addEventListener("change", renderChampions);
  });
  elements.championTableToggle?.addEventListener("click", () => {
    state.championTableOpen = !state.championTableOpen;
    applyChampionTableState();
  });
  elements.clipSourceTabs?.forEach((button) => {
    button.addEventListener("click", () => {
      const nextSource = button.dataset.clipSource || "youtube";
      navigateToRoute(routeByHash.get(clipSourceToHash[nextSource]) || routeByHash.get("#/clips"));
      trackAnalyticsEvent("clip_source_tab_click", {
        source: nextSource,
        page: "clips"
      });
    });
  });
  elements.twitchClipPlayerFilter?.addEventListener("input", () => {
    state.twitchClipPlayer = elements.twitchClipPlayerFilter.value.trim().toLocaleLowerCase("ja");
    state.twitchClipPage = 1;
    trackAnalyticsEvent("twitch_clip_filter_click", {
      filter_type: "player",
      filter_value: state.twitchClipPlayer ? "filled" : "empty"
    });
    renderClips();
  });
  elements.twitchClipSortFilter?.addEventListener("change", () => {
    state.twitchClipSort = elements.twitchClipSortFilter.value || "new";
    state.twitchClipPage = 1;
    trackAnalyticsEvent("twitch_clip_filter_click", {
      filter_type: "sort",
      filter_value: state.twitchClipSort
    });
    renderClips();
  });
  elements.twitchClipFormLink?.addEventListener("click", (event) => {
    if (!TWITCH_CLIP_FORM_URL) {
      event.preventDefault();
      return;
    }
    trackAnalyticsEvent("twitch_clip_submit_form_click", {
      page: "clips",
      source: "twitch"
    });
  });
  elements.changeClipTeam?.addEventListener("click", () => {
    showClipWarningModal({ showTeams: true, stayOnBack: true });
    trackAnalyticsEvent("clip_team_filter_click", {
      filter_name: "clip_viewer_team_change",
      filter_value: state.clipViewerTeam || "all",
      view: "clips"
    });
  });

  elements.typeFilter.addEventListener("change", () => {
    state.type = elements.typeFilter.value;
    trackFilterChange("type", state.type);
    render();
  });
  elements.tierFilter.addEventListener("change", () => {
    state.tier = elements.tierFilter.value;
    trackFilterChange("tier", state.tier);
    render();
  });
  elements.teamFilter?.addEventListener("change", () => {
    state.team = elements.teamFilter.value;
    if (state.view === "clips") state.clipPage = 1;
    if (state.view === "clips") state.twitchClipPage = 1;
    trackAnalyticsEvent(state.view === "clips" ? "clip_team_filter_click" : "filter_change", {
      filter_name: "team",
      filter_value: state.team || "all",
      view: state.view
    });
    if (state.view === "clips") {
      trackAnalyticsEvent("clip_filter_click", {
        filter_name: "team",
        filter_value: state.team || "all",
        view: state.view
      });
      if (state.clipSource === "twitch") {
        trackAnalyticsEvent("twitch_clip_filter_click", {
          filter_type: "team",
          filter_value: state.team || "all"
        });
      }
    }
    render();
  });
  elements.keywordFilter.addEventListener("input", () => {
    state.keyword = elements.keywordFilter.value.trim().toLocaleLowerCase("ja");
    trackFilterChange("keyword", state.keyword ? "filled" : "empty");
    render();
  });
  elements.excludeScrimsFilter?.addEventListener("change", () => {
    state.excludeScrims = elements.excludeScrimsFilter.checked;
    trackFilterChange("exclude_scrims", state.excludeScrims ? "on" : "off");
    render();
  });
  elements.excludeViewerFilter?.addEventListener("change", () => {
    state.excludeViewer = elements.excludeViewerFilter.checked;
    trackFilterChange("exclude_viewer", state.excludeViewer ? "on" : "off");
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
  elements.dialogBack?.addEventListener("click", restorePreviousDialogView);
  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) elements.dialog.close();
  });
  elements.dialog.addEventListener("close", () => {
    dialogBackStack = [];
    currentDialogView = null;
    updateDialogBackButton();
  });
  narrowLayoutQuery.addEventListener("change", applyFilterPanelState);
}

function switchView(viewName, options = {}) {
  const nextView = viewToRoute.has(viewName) ? viewName : DEFAULT_ROUTE.view;
  const nextClipSource = nextView === "clips" ? options.clipSource || state.clipSource || "youtube" : state.clipSource;
  const viewChanged = state.view !== nextView;
  const clipSourceChanged = nextView === "clips" && state.clipSource !== nextClipSource;
  if (state.view && state.view !== "clips" && nextView !== "clips") {
    state.previousView = state.view;
  }
  if (state.view && state.view !== "clips" && nextView === "clips") {
    state.previousView = state.view;
  }
  state.view = nextView;
  if (nextView === "clips") {
    state.clipSource = nextClipSource;
    if (clipSourceChanged) {
      state.clipPage = 1;
      state.twitchClipPage = 1;
    }
  }
  document.querySelectorAll(".tab-button").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.view === state.view);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === `${state.view}View`);
  });
  if (options.render !== false) render();
  if (options.trackPageView && (viewChanged || clipSourceChanged || options.forcePageView)) {
    trackVirtualPageView(options.route || routeForState());
  }
}

function normalizeHash(hashValue = window.location.hash) {
  const rawHash = String(hashValue || "").trim();
  if (!rawHash) return "";
  const hashBody = (rawHash.startsWith("#") ? rawHash.slice(1) : rawHash).split("?")[0];
  const path = hashBody.startsWith("/") ? hashBody : `/${hashBody}`;
  return `#${path.replace(/\/+$/, "") || "/"}`;
}

function resolveRouteFromHash(hashValue = window.location.hash) {
  const hash = normalizeHash(hashValue);
  if (!hash) return { route: DEFAULT_ROUTE, invalid: false };
  const route = routeByHash.get(hash);
  if (route) {
    if (route.view === "clips" && !CLIPS_PREVIEW_ENABLED) return { route: DEFAULT_ROUTE, invalid: true };
    return { route, invalid: false };
  }
  if (hash.startsWith("#/clips/")) {
    const fallbackRoute = CLIPS_PREVIEW_ENABLED ? routeByHash.get("#/clips") : DEFAULT_ROUTE;
    return { route: fallbackRoute, invalid: true };
  }
  return { route: DEFAULT_ROUTE, invalid: true };
}

function applyRouteFromHash(options = {}) {
  const resolved = resolveRouteFromHash();
  if (resolved.invalid && window.location.hash !== resolved.route.hash) {
    window.location.replace(resolved.route.hash);
  }
  currentRoute = resolved.route;
  switchView(resolved.route.view, {
    clipSource: resolved.route.clipSource,
    render: options.render,
    route: resolved.route,
    trackPageView: options.trackPageView !== false
  });
}

function navigateToRoute(route) {
  const nextRoute = route || DEFAULT_ROUTE;
  if (window.location.hash === nextRoute.hash) {
    applyRouteFromHash();
    return;
  }
  window.location.hash = nextRoute.hash;
}

function routeForState() {
  if (
    currentRoute?.view === state.view &&
    (state.view !== "clips" || currentRoute.clipSource === state.clipSource)
  ) {
    return currentRoute;
  }
  if (state.view === "clips") {
    return routeByHash.get(clipSourceToHash[state.clipSource]) || routeByHash.get("#/clips");
  }
  return viewToRoute.get(state.view) || DEFAULT_ROUTE;
}

function trackVirtualPageView(route) {
  const nextRoute = route || routeForState();
  if (!nextRoute || lastTrackedPagePath === nextRoute.pagePath) return;
  lastTrackedPagePath = nextRoute.pagePath;
  trackAnalyticsEvent("page_view", {
    page_path: nextRoute.pagePath || viewToPagePath[nextRoute.view] || DEFAULT_ROUTE.pagePath,
    page_title: nextRoute.pageTitle || viewToPageTitle[nextRoute.view] || DEFAULT_ROUTE.pageTitle
  });
}

function hasAcceptedClipWarning() {
  try {
    return window.localStorage?.getItem(CLIP_WARNING_STORAGE_KEY) === CLIP_WARNING_ACCEPTED_VALUE;
  } catch {
    return false;
  }
}

function readClipViewerTeam() {
  try {
    const teamKey = window.localStorage?.getItem(CLIP_WARNING_TEAM_STORAGE_KEY) || "";
    return CLIP_WARNING_TEAM_OPTIONS.includes(teamKey) ? teamKey : "";
  } catch {
    return "";
  }
}

function activeClipTeamFilter() {
  return state.clipViewerTeam || state.team;
}

function clipWarningTeamName(teamKey) {
  return teams[teamKey]?.fullName || CLIP_WARNING_TEAM_LABELS[teamKey] || teamKey;
}

function clipWarningTeamMark(teamKey) {
  return teams[teamKey]?.logo
    ? teamLogo(teamKey, "clip-warning-team-logo")
    : `<span class="clip-warning-team-fallback">${teamKey}</span>`;
}

function acceptClipWarning(teamKey = "") {
  const selectedTeam = CLIP_WARNING_TEAM_OPTIONS.includes(teamKey) ? teamKey : "";
  try {
    window.localStorage?.setItem(CLIP_WARNING_STORAGE_KEY, CLIP_WARNING_ACCEPTED_VALUE);
    if (selectedTeam) {
      window.localStorage?.setItem(CLIP_WARNING_TEAM_STORAGE_KEY, selectedTeam);
    } else {
      window.localStorage?.removeItem(CLIP_WARNING_TEAM_STORAGE_KEY);
    }
  } catch {
    // localStorageが使えない環境でも閲覧自体は許可する。
  }
  state.clipViewerTeam = selectedTeam;
  state.clipPage = 1;
  state.twitchClipPage = 1;
  closeClipWarningModal();
  navigateToRoute(routeByHash.get("#/clips"));
  trackAnalyticsEvent("clip_warning_accept", {
    page: "clips",
    viewer_team: selectedTeam || "all"
  });
}

function backFromClipWarning() {
  const stayOnBack = elements.clipWarningModal?.dataset.stayOnBack === "true";
  closeClipWarningModal();
  if (stayOnBack) return;
  navigateToRoute(viewToRoute.get(state.previousView || "calendar") || DEFAULT_ROUTE);
  trackAnalyticsEvent("clip_warning_back", { page: "clips" });
}

function setupClipWarningModal() {
  if (elements.clipWarningModal) return;
  const modal = document.createElement("div");
  modal.className = "clip-warning-modal-backdrop";
  modal.hidden = true;
  modal.innerHTML = `
    <section class="clip-warning-modal" role="dialog" aria-modal="true" aria-labelledby="clipWarningTitle">
      <div class="clip-warning-accent" aria-hidden="true">!</div>
      <h2 id="clipWarningTitle" class="clip-warning-modal-title">閲覧前のご注意</h2>
      <p class="clip-warning-modal-text">このページにはLTK関連の切り抜き動画・クリップが含まれます。

LTK参加メンバー・コーチ・関係者の方は、スクリム情報の取得につながる可能性があるため閲覧をお控えください。

一般視聴者の方のみ、内容を確認のうえ閲覧してください。
自分のチームを選択すると、そのチームに関係する切り抜き動画とクリップだけを表示します。</p>
      <div class="clip-warning-team-picker" hidden data-clip-warning-teams>
        ${CLIP_WARNING_TEAM_OPTIONS.map((teamKey) => `
          <button class="clip-warning-team-button" type="button" data-clip-warning-team="${teamKey}">
            <span>${clipWarningTeamMark(teamKey)}</span>
            <strong>${clipWarningTeamName(teamKey)}</strong>
            <small>${teamShortName(teamKey)}</small>
          </button>
        `).join("")}
      </div>
      <div class="clip-warning-modal-actions">
        <button class="clip-warning-back-button" type="button" data-clip-warning-back>戻る</button>
        <button class="clip-warning-team-toggle-button" type="button" data-clip-warning-team-toggle>自分のチームを選択してみる</button>
        <button class="clip-warning-accept-button" type="button" data-clip-warning-accept>一般視聴者として閲覧する</button>
      </div>
    </section>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target === modal) backFromClipWarning();
  });
  modal.querySelector("[data-clip-warning-accept]")?.addEventListener("click", () => acceptClipWarning(""));
  modal.querySelector("[data-clip-warning-team-toggle]")?.addEventListener("click", () => {
    const picker = modal.querySelector("[data-clip-warning-teams]");
    if (!picker) return;
    picker.hidden = !picker.hidden;
    trackAnalyticsEvent("clip_warning_team_picker", { page: "clips" });
  });
  modal.querySelectorAll("[data-clip-warning-team]").forEach((button) => {
    button.addEventListener("click", () => acceptClipWarning(button.dataset.clipWarningTeam || ""));
  });
  modal.querySelector("[data-clip-warning-back]")?.addEventListener("click", backFromClipWarning);
  document.addEventListener("keydown", (event) => {
    if (!modal.hidden && event.key === "Escape") backFromClipWarning();
  });
  document.body.append(modal);
  elements.clipWarningModal = modal;
}

function showClipWarningModal(options = {}) {
  if (!elements.clipWarningModal) setupClipWarningModal();
  const picker = elements.clipWarningModal.querySelector("[data-clip-warning-teams]");
  if (picker) picker.hidden = !options.showTeams;
  elements.clipWarningModal.dataset.stayOnBack = options.stayOnBack ? "true" : "false";
  elements.clipWarningModal.hidden = false;
  const focusTarget = options.showTeams
    ? elements.clipWarningModal.querySelector("[data-clip-warning-team]")
    : elements.clipWarningModal.querySelector("[data-clip-warning-accept]");
  focusTarget?.focus();
}

function closeClipWarningModal() {
  if (!elements.clipWarningModal) return;
  elements.clipWarningModal.hidden = true;
  elements.clipWarningModal.dataset.stayOnBack = "false";
}

function applyFeatureFlags() {
  document.querySelectorAll("[data-clips-preview]").forEach((element) => {
    element.hidden = !CLIPS_PREVIEW_ENABLED;
  });
  if (CLIPS_PREVIEW_ENABLED) return;
  document.querySelector("#clipsView")?.classList.remove("is-active");
  if (state.view === "clips") state.view = "calendar";
}

function render() {
  renderHeaderStatus();
  renderLiveNow();
  renderNews();
  if (state.view === "calendar") renderCalendar();
  if (state.view === "league") renderLeagueTables();
  if (state.view === "teams") renderTeamStats();
  if (state.view === "stats") renderPlayerStats();
  if (state.view === "ranking") renderRankings();
  if (state.view === "champions") renderChampions();
  if (state.view === "clips") renderClips();
}

function renderNews() {
  if (!elements.newsList) return;
  const rows = siteNews
    .filter((item) => item.published !== false)
    .slice(0, 5);
  if (!rows.length) {
    elements.newsList.innerHTML = `<p class="news-empty">更新情報はまだありません</p>`;
    return;
  }
  elements.newsList.innerHTML = rows.map((item) => `
    <article class="news-item">
      <div class="news-item-head">
        <span>${escapeAttr(shortNewsDate(item.newsDate || item.createdAt))}</span>
        ${item.category ? `<span class="news-item-category">${escapeAttr(item.category)}</span>` : ""}
      </div>
      <p class="news-item-title">${escapeAttr(item.title || "更新しました")}</p>
      ${item.body ? `<p class="news-item-body">${escapeAttr(item.body)}</p>` : ""}
    </article>
  `).join("");
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

function renderClips() {
  renderClipTeamNotice();
  applyClipSourceState();
  if (state.clipSource === "twitch") {
    renderTwitchClips();
    return;
  }
  renderYouTubeClips();
}

function renderClipTeamNotice() {
  if (!elements.clipTeamNotice || !elements.clipTeamNoticeLabel) return;
  if (!hasAcceptedClipWarning()) {
    elements.clipTeamNotice.hidden = true;
    return;
  }
  const teamKey = state.clipViewerTeam;
  elements.clipTeamNotice.hidden = false;
  elements.clipTeamNoticeLabel.innerHTML = teamKey
    ? `${teamLogo(teamKey, "clip-team-notice-logo")}<span>${teamFullName(teamKey)}だけ表示中</span>`
    : "全チーム表示中";
}

function renderYouTubeClips() {
  if (!elements.clipsGrid) return;
  const teamFilter = activeClipTeamFilter();
  const allFilteredRows = clipVideos
    .filter((item) => !teamFilter || item.teamKey === teamFilter)
    .filter((item) => !state.tier || item.tier === state.tier)
    .filter((item) => filterByKeyword([item], (video) => `${video.title} ${video.memberName} ${video.channelTitle} ${teamFullName(video.teamKey)} ${video.tier} ${video.role}`)[0])
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  const rows = allFilteredRows.filter(isRecentClip);
  const totalPages = Math.max(1, Math.ceil(rows.length / CLIP_PAGE_SIZE));
  if (state.clipPage > totalPages) state.clipPage = totalPages;
  if (state.clipPage < 1) state.clipPage = 1;
  const pageRows = rows.slice((state.clipPage - 1) * CLIP_PAGE_SIZE, state.clipPage * CLIP_PAGE_SIZE);

  if (elements.clipsStatus) {
    elements.clipsStatus.textContent = rows.length
      ? `直近${CLIP_RECENT_DAYS}日 ${rows.length}件 / ${state.clipPage}ページ目`
      : `直近${CLIP_RECENT_DAYS}日に条件に一致する動画がありません`;
  }

  if (!rows.length) {
    elements.clipsGrid.innerHTML = `<p class="empty-state">表示できる切り抜き動画がありません。</p>`;
    renderClipPagination(0, 0);
    return;
  }

  const groups = pageRows.reduce((acc, video) => {
    const { date } = formatClipDateParts(video.publishedAt);
    const key = date || "投稿日不明";
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(video);
    return acc;
  }, new Map());

  elements.clipsGrid.innerHTML = [...groups.entries()].map(([date, videos]) => `
    <section class="clip-date-section">
      <h3 class="clip-date-heading">${date}</h3>
      <div class="clip-date-grid">
        ${videos.map((video) => {
          const { time } = formatClipDateParts(video.publishedAt);
          const clipKey = clipWatchKey(video);
          const watched = watchedClipIds.has(clipKey);
          return `
            <article class="clip-card${watched ? " is-watched" : ""}" data-clip-card="${escapeAttr(clipKey)}" style="--team:${teams[video.teamKey]?.accent || "#14b8a6"}">
              <a class="clip-thumb clip-watch-link" href="${escapeAttr(video.url)}" target="_blank" rel="noreferrer" data-clip-id="${escapeAttr(clipKey)}">
                ${video.thumbnail ? `<img src="${escapeAttr(video.thumbnail)}" alt="">` : `<span>NO IMAGE</span>`}
                ${watched ? `<span class="clip-watched-badge">視聴済み</span>` : ""}
              </a>
              <div class="clip-card-body">
                <div class="clip-member-row">
                  ${video.iconUrl ? `<img class="clip-member-icon" src="${escapeAttr(video.iconUrl)}" alt="">` : playerIcon(video.memberName || video.channelTitle)}
                  <div>
                    <button class="clip-player-button" type="button" data-clip-player="${escapeAttr(video.memberName || video.channelTitle || "YouTube")}" data-clip-team="${escapeAttr(video.teamKey || "")}">
                      ${video.memberName || video.channelTitle || "YouTube"}
                    </button>
                    <small>${teamLogo(video.teamKey, "ranking-team-logo")}${teamShortName(video.teamKey)} / ${video.tier || "-"} / ${video.role || "-"}</small>
                  </div>
                </div>
                <h3><a class="clip-watch-link" href="${escapeAttr(video.url)}" target="_blank" rel="noreferrer" data-clip-id="${escapeAttr(clipKey)}">${video.title}</a></h3>
                <div class="clip-meta-row">
                  <span>投稿日 ${date}</span>
                  <span>投稿時間 ${time || "--:--"}</span>
                </div>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `).join("");

  elements.clipsGrid.querySelectorAll(".clip-watch-link").forEach((link) => {
    link.addEventListener("click", () => {
      markClipWatched(link.dataset.clipId);
      const video = clipVideos.find((item) => clipWatchKey(item) === link.dataset.clipId);
      trackAnalyticsEvent("youtube_clip_click", {
        video_id: video?.videoId || link.dataset.clipId || "",
        video_title: video?.title || "",
        player_name: video?.memberName || "",
        team_name: teamFullName(video?.teamKey),
        tier: video?.tier || "",
        role: video?.role || ""
      });
    });
  });
  elements.clipsGrid.querySelectorAll(".clip-player-button").forEach((button) => {
    button.addEventListener("click", () => {
      trackAnalyticsEvent("clip_player_click", {
        player_name: button.dataset.clipPlayer || "",
        team_key: button.dataset.clipTeam || "",
        view: "clips"
      });
    });
  });
  renderClipPagination(rows.length, totalPages);
}

function renderTwitchClips() {
  if (!elements.clipsGrid) return;
  const teamFilter = activeClipTeamFilter();
  const filteredRows = twitchClips
    .filter((item) => !teamFilter || item.teamKey === teamFilter)
    .filter((item) => !state.tier || item.tier === state.tier)
    .filter((item) => !state.twitchClipPlayer || item.relatedPlayerName.toLocaleLowerCase("ja").includes(state.twitchClipPlayer))
    .filter((item) => filterByKeyword([item], (clip) => `${clip.title} ${clip.broadcasterName} ${clip.creatorName} ${clip.relatedPlayerName} ${teamFullName(clip.teamKey)} ${clip.tier} ${clip.role} ${clip.comment}`)[0]);
  const rows = filteredRows.sort((a, b) => {
    if (state.twitchClipSort === "likes") return twitchClipLikeCount(b) - twitchClipLikeCount(a);
    if (state.twitchClipSort === "views") return (b.viewCount || 0) - (a.viewCount || 0);
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / CLIP_PAGE_SIZE));
  if (state.twitchClipPage > totalPages) state.twitchClipPage = totalPages;
  if (state.twitchClipPage < 1) state.twitchClipPage = 1;
  const pageRows = rows.slice((state.twitchClipPage - 1) * CLIP_PAGE_SIZE, state.twitchClipPage * CLIP_PAGE_SIZE);

  if (elements.clipsStatus) {
    elements.clipsStatus.textContent = rows.length
      ? `掲載OKのTwitchクリップ ${rows.length}件 / ${state.twitchClipPage}ページ目`
      : "条件に一致するTwitchクリップがありません";
  }

  if (!rows.length) {
    elements.clipsGrid.innerHTML = `<p class="empty-state">表示できるTwitchクリップがありません。</p>`;
    renderClipPagination(0, 0);
    return;
  }

  elements.clipsGrid.innerHTML = `<div class="clip-date-grid">${pageRows.map((clip) => {
    const { date } = formatClipDateParts(clip.createdAt);
    return twitchClipCardHtml(clip, date || "作成日不明");
  }).join("")}</div>`;

  elements.clipsGrid.querySelectorAll(".twitch-clip-link").forEach((link) => {
    link.addEventListener("click", () => {
      const clip = twitchClips.find((item) => item.clipId === link.dataset.clipId);
      trackAnalyticsEvent("twitch_clip_click", {
        clip_id: clip?.clipId || link.dataset.clipId || "",
        clip_title: clip?.title || "",
        broadcaster_name: clip?.broadcasterName || "",
        creator_name: clip?.creatorName || "",
        player_name: clip?.relatedPlayerName || "",
        team_name: teamFullName(clip?.teamKey),
        tier: clip?.tier || "",
        role: clip?.role || ""
      });
    });
  });
  elements.clipsGrid.querySelectorAll("[data-twitch-like]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleTwitchClipLike(button.dataset.twitchLike || "");
      renderTwitchClips();
    });
  });
  renderClipPagination(rows.length, totalPages);
}

function twitchClipCardHtml(clip, dateLabel) {
  const { time } = formatClipDateParts(clip.createdAt);
  const teamKey = clip.teamKey || "";
  const teamAccent = teams[teamKey]?.accent || "#9146ff";
  const liked = likedTwitchClipIds.has(clip.clipId);
  const likeCount = twitchClipLikeCount(clip);
  const thumbnail = clip.thumbnailUrl
    ? `<img src="${escapeAttr(clip.thumbnailUrl)}" alt="">`
    : `<div class="twitch-placeholder"><strong>Twitch Clip</strong><small>${clip.broadcasterName || "Twitch"}</small></div>`;
  return `
    <article class="clip-card twitch-clip-card" style="--team:${teamAccent}">
      <a class="clip-thumb twitch-clip-link" href="${escapeAttr(clip.url)}" target="_blank" rel="noreferrer" data-clip-id="${escapeAttr(clip.clipId)}">
        ${thumbnail}
        <span class="clip-platform-badge">Twitch Clip</span>
      </a>
      <div class="clip-card-body">
        <h3><a class="twitch-clip-link" href="${escapeAttr(clip.url)}" target="_blank" rel="noreferrer" data-clip-id="${escapeAttr(clip.clipId)}">${clip.title}</a></h3>
        <div class="clip-member-row">
          ${clip.relatedPlayerName ? playerIcon(clip.relatedPlayerName) : `<span class="ranking-avatar">T</span>`}
          <div>
            <strong>${clip.relatedPlayerName || "関連選手未設定"}</strong>
            <small>${teamLogo(teamKey, "ranking-team-logo")}${teamShortName(teamKey)} / ${clip.tier || "-"} / ${clip.role || "-"}</small>
          </div>
        </div>
        <div class="clip-service-meta">
          <span>作成者：${clip.creatorName || "-"}</span>
          <span>再生数：${formatInteger(clip.viewCount || 0)}</span>
        </div>
        <button class="twitch-like-button${liked ? " is-liked" : ""}" type="button" data-twitch-like="${escapeAttr(clip.clipId)}" aria-pressed="${liked ? "true" : "false"}">
          <span>${liked ? "いいね済み" : "いいね"}</span>
          <strong>${formatInteger(likeCount)}</strong>
        </button>
        ${clip.comment ? `<p class="clip-comment">${clip.comment}</p>` : ""}
        <div class="clip-meta-row">
          <span>投稿日 ${dateLabel}</span>
          <span>投稿時間 ${time || "--:--"}</span>
        </div>
      </div>
    </article>
  `;
}

function twitchClipLikeCount(clip) {
  return Number(clip?.likeCount || 0);
}

function readLikedTwitchClipIds() {
  try {
    return new Set(JSON.parse(window.localStorage?.getItem(TWITCH_CLIP_LIKED_STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function toggleTwitchClipLike(clipId) {
  if (!clipId) return;
  const liked = likedTwitchClipIds.has(clipId);
  if (liked) likedTwitchClipIds.delete(clipId);
  else likedTwitchClipIds.add(clipId);
  try {
    window.localStorage?.setItem(TWITCH_CLIP_LIKED_STORAGE_KEY, JSON.stringify([...likedTwitchClipIds]));
  } catch {
    // localStorageが使えない環境では画面上の状態だけ更新する。
  }
  const clip = twitchClips.find((item) => item.clipId === clipId);
  sendTwitchClipLike(clipId, !liked);
  trackAnalyticsEvent(liked ? "twitch_clip_unlike" : "twitch_clip_like", {
    clip_id: clipId,
    clip_title: clip?.title || "",
    related_player_name: clip?.relatedPlayerName || ""
  });
}

function twitchClipViewerId() {
  try {
    const existing = window.localStorage?.getItem(TWITCH_CLIP_VIEWER_ID_STORAGE_KEY);
    if (existing) return existing;
    const generated = `viewer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    window.localStorage?.setItem(TWITCH_CLIP_VIEWER_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `viewer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }
}

function sendTwitchClipLike(clipId, liked) {
  if (!TWITCH_CLIP_LIKE_ENDPOINT || !clipId) return;
  const formData = new FormData();
  formData.append("action", "twitch_clip_like");
  formData.append("clip_id", clipId);
  formData.append("viewer_id", twitchClipViewerId());
  formData.append("liked", liked ? "true" : "false");
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(TWITCH_CLIP_LIKE_ENDPOINT, formData)) return;
  } catch {
    // sendBeacon不可の場合はfetchへフォールバックする。
  }
  fetch(TWITCH_CLIP_LIKE_ENDPOINT, {
    method: "POST",
    mode: "no-cors",
    body: formData,
    keepalive: true
  }).catch((error) => {
    console.warn("Twitch clip like update failed.", error);
  });
}

function applyClipSourceState() {
  elements.clipSourceTabs?.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.clipSource === state.clipSource);
  });
  const isTwitch = state.clipSource === "twitch";
  if (elements.twitchClipIntro) elements.twitchClipIntro.hidden = !isTwitch;
  if (elements.twitchClipFilters) elements.twitchClipFilters.hidden = !isTwitch;
  if (elements.twitchClipFormLink) {
    elements.twitchClipFormLink.href = TWITCH_CLIP_FORM_URL || "#";
    elements.twitchClipFormLink.setAttribute("aria-disabled", TWITCH_CLIP_FORM_URL ? "false" : "true");
    elements.twitchClipFormLink.classList.toggle("is-disabled", !TWITCH_CLIP_FORM_URL);
    elements.twitchClipFormLink.textContent = TWITCH_CLIP_FORM_URL ? "クリップを投稿する" : "投稿フォーム未設定";
  }
}

function renderClipPagination(totalRows, totalPages) {
  if (!elements.clipsPagination) return;
  if (!totalRows || totalPages <= 1) {
    elements.clipsPagination.innerHTML = "";
    return;
  }
  elements.clipsPagination.innerHTML = `
    <button type="button" class="clip-page-button" data-clip-page="${currentClipPage() - 1}" ${currentClipPage() <= 1 ? "disabled" : ""}>前へ</button>
    <span>${currentClipPage()} / ${totalPages}</span>
    <button type="button" class="clip-page-button" data-clip-page="${currentClipPage() + 1}" ${currentClipPage() >= totalPages ? "disabled" : ""}>次へ</button>
  `;
  elements.clipsPagination.querySelectorAll("[data-clip-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextPage = Number(button.dataset.clipPage);
      if (!Number.isFinite(nextPage)) return;
      setCurrentClipPage(Math.max(1, Math.min(totalPages, nextPage)));
      trackAnalyticsEvent(state.clipSource === "twitch" ? "twitch_clip_filter_click" : "clip_filter_click", {
        filter_name: "pagination",
        filter_type: "pagination",
        filter_value: String(currentClipPage()),
        view: "clips"
      });
      renderClips();
    });
  });
}

function currentClipPage() {
  return state.clipSource === "twitch" ? state.twitchClipPage : state.clipPage;
}

function setCurrentClipPage(value) {
  if (state.clipSource === "twitch") state.twitchClipPage = value;
  else state.clipPage = value;
}

function isRecentClip(video) {
  const date = new Date(video?.publishedAt || "");
  if (Number.isNaN(date.getTime())) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CLIP_RECENT_DAYS);
  return date >= cutoff;
}

function trackFilterChange(filterName, filterValue) {
  trackAnalyticsEvent(state.view === "clips" ? "clip_filter_click" : "filter_change", {
    filter_name: filterName,
    filter_value: filterValue || "all",
    view: state.view
  });
  if (state.view === "clips") state.clipPage = 1;
  if (state.view === "clips") state.twitchClipPage = 1;
}

function readWatchedClipIds() {
  try {
    const raw = window.localStorage?.getItem(CLIP_WATCHED_STORAGE_KEY);
    const values = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(values) ? values.map(String).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function writeWatchedClipIds() {
  try {
    window.localStorage?.setItem(CLIP_WATCHED_STORAGE_KEY, JSON.stringify([...watchedClipIds]));
  } catch {
    // 視聴済みは補助表示なので、保存できない環境では静かに諦める。
  }
}

function clipWatchKey(video) {
  return String(video?.videoId || video?.url || video?.title || "").trim();
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function markClipWatched(clipId) {
  if (!clipId || watchedClipIds.has(clipId)) return;
  watchedClipIds.add(clipId);
  writeWatchedClipIds();
  elements.clipsGrid?.querySelector(`[data-clip-card="${cssEscape(clipId)}"]`)?.classList.add("is-watched");
  elements.clipsGrid?.querySelector(`[data-clip-card="${cssEscape(clipId)}"] .clip-thumb`)?.insertAdjacentHTML(
    "beforeend",
    `<span class="clip-watched-badge">視聴済み</span>`
  );
}

function trackAnalyticsEvent(eventName, params = {}) {
  ensureAnalytics();
  if (typeof window.gtag !== "function") return;
  window.gtag("event", eventName, params);
}

function handleGlobalAnalyticsClick(event) {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target) return;

  const socialLink = target.closest(".sns-link:not(.is-off)");
  if (socialLink) {
    const participant = socialLink.closest(".participant-card");
    trackAnalyticsEvent("social_link_click", {
      platform: socialLink.getAttribute("aria-label") || "",
      destination_url: socialLink.getAttribute("href") || "",
      player_name: participant?.querySelector(".participant-meta strong")?.textContent?.trim() || "",
      source_view: state.view
    });
  }

  const contactLink = target.closest(".contact-form-link");
  if (contactLink) {
    trackAnalyticsEvent("contact_click", {
      destination_url: contactLink.getAttribute("href") || "",
      source_view: state.view
    });
  }
}

function ensureAnalytics() {
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== "function") {
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
  }
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
  card.addEventListener("click", () => {
    trackAnalyticsEvent("live_stream_click", {
      player_name: stream.name || "",
      team_key: stream.teamKey || "",
      tier: stream.rank || "",
      role: stream.role || "",
      stream_url: stream.streamUrl || "",
      platform: "twitch"
    });
  });
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
  const resultById = new Map(scrimResults.map((result) => [result.id, result]));
  return schedules
    .map((item) => {
      const linkedResults = item.linkedResultIds?.length
        ? item.linkedResultIds.map((id) => resultById.get(id)).filter(Boolean)
        : [];
      return {
        ...item,
        results: linkedResults,
        resultSource: linkedResults.length > 0,
        status: linkedResults.length && item.status === "scheduled" ? "completed" : item.status,
        viewerMatch: item.viewerMatch || linkedResults.some((result) => result.viewerMatch)
      };
    })
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
  const base = `${teamShortName(item.left)} vs ${teamShortName(item.right)}`;
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
      dayMaxEvents: state.fullCalendarExpanded ? false : FULL_CALENDAR_COLLAPSED_EVENT_LIMIT,
      dayMaxEventRows: state.fullCalendarExpanded ? false : FULL_CALENDAR_COLLAPSED_EVENT_LIMIT,
      moreLinkClick(info) {
        state.fullCalendarExpanded = true;
        state.fullCalendarExpandedDate = dateKey(info.date);
        elements.fullCalendar.classList.add("is-single-day-expanded");
        state.fullCalendar.setOption("dayMaxEvents", false);
        state.fullCalendar.setOption("dayMaxEventRows", false);
        requestAnimationFrame(() => state.fullCalendar.updateSize());
        return false;
      },
      displayEventTime: false,
      eventOrder: "sortOrder",
      headerToolbar: { left: "prev,next today", center: "title", right: "" },
      buttonText: { today: "今日" },
      dayCellClassNames(info) {
        const key = dateKey(info.date);
        return [
          key === japanDateKey() ? "is-ltk-today" : "",
          key === state.fullCalendarExpandedDate ? "is-ltk-expanded-day" : ""
        ].filter(Boolean);
      },
      dayCellDidMount(info) {
        const key = dateKey(info.date);
        if (key !== state.fullCalendarExpandedDate) return;
        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "fc-day-expand-close";
        closeButton.textContent = "閉じる";
        closeButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          collapseFullCalendarDay();
        });
        info.el.querySelector(".fc-daygrid-day-top")?.append(closeButton);
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

function collapseFullCalendarDay() {
  state.fullCalendarExpanded = false;
  state.fullCalendarExpandedDate = "";
  elements.fullCalendar.classList.remove("is-single-day-expanded");
  if (!state.fullCalendar) return;
  state.fullCalendar.setOption("dayMaxEvents", FULL_CALENDAR_COLLAPSED_EVENT_LIMIT);
  state.fullCalendar.setOption("dayMaxEventRows", FULL_CALENDAR_COLLAPSED_EVENT_LIMIT);
  requestAnimationFrame(() => state.fullCalendar.updateSize());
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
        <span class="fc-match-team is-right is-listener"><span>${VIEWER_OPPONENT_LABEL}</span></span>
      </div>
      <div class="fc-match-sub">
        <span>${caption}</span>
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
  if (!team) return "";
  if (!team.logo) return `<span class="fc-team-mark">${team.mark || teamKey || "?"}</span>`;
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

function openMatch(item, options = {}) {
  prepareDialogNavigation({ type: "match", item }, options);
  trackAnalyticsEvent("match_detail_open", {
    match_id: item.id || "",
    schedule_id: item.scheduleId || item.id || "",
    date: item.date || "",
    tier: item.tier || "",
    match_type: item.matchType || item.type || "",
    left_team: item.left || "",
    right_team: item.right || "",
    source_view: state.view
  });
  elements.dialogMeta.textContent = `${item.date.replaceAll("-", "/")} ${item.eventTime ? `${item.eventTime} ` : ""}${item.day} ${item.match} / ${item.type}`;
  elements.dialogTitle.textContent = isViewerScrim(item)
    ? `${viewerHomeLabel(item)} vs ${VIEWER_OPPONENT_LABEL}`
    : item.status === "tbd" ? "TBD" : `${item.left || "TBD"} vs ${item.right || "TBD"}`;
  const body = item.resultRecord
    ? [matchSummary(item), resultSummary(item), participantSection(item)]
    : [matchSummary(item), participantSection(item)];
  elements.dialogBody.replaceChildren(...body);
  if (!elements.dialog.open) elements.dialog.showModal();
  resetDialogScroll();
}

function prepareDialogNavigation(nextView, options = {}) {
  if (options.clear !== false) dialogBackStack = [];
  if (options.push && currentDialogView) dialogBackStack.push(currentDialogView);
  currentDialogView = nextView;
  updateDialogBackButton();
}

function restorePreviousDialogView() {
  const previous = dialogBackStack.pop();
  if (!previous) return;
  if (previous.type === "team") openTeamDetail(previous.item, { clear: false });
  if (previous.type === "match") openMatch(previous.item, { clear: false });
  if (previous.type === "player") openPlayerDetail(previous.item, { clear: false });
  updateDialogBackButton();
}

function updateDialogBackButton() {
  if (!elements.dialogBack) return;
  elements.dialogBack.hidden = dialogBackStack.length === 0;
}

function resetDialogScroll() {
  requestAnimationFrame(() => {
    elements.dialog.scrollTop = 0;
    elements.dialogBody.scrollTop = 0;
  });
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
    section.append(detail);
    renderGameDetail(section, item.results[0]);
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
    <h3 class="game-detail-title">${gameDetailTitle(result)}</h3>
    ${bpFlowTable(result, rows)}
    <div class="game-detail-grid">
      ${gameDetailTeam(result.left, rows)}
      ${gameDetailTeam(result.right, rows)}
    </div>
  `;
}

function gameDetailTitle(result) {
  const winner = result.winner;
  const label = result.match?.startsWith("G") ? result.match.replace(/^G/, "Game") : result.match || result.id;
  return `
    <span>${label} / WIN</span>
    <span class="game-detail-winner">
      ${winner !== VIEWER_TEAM_KEY ? teamLogo(winner, "ranking-team-logo") : ""}
      <span>${winnerDisplayName(result)}</span>
    </span>
  `;
}

function bpFlowTable(result, rows) {
  const teamsForRows = [result.left, result.right].filter(Boolean);
  if (!teamsForRows.length) return "";
  return `
    <section class="bp-flow">
      <h4>BP Flow</h4>
      <div class="bp-flow-board">
        ${teamsForRows.map((teamKey) => bpFlowTeamRow(result, rows, teamKey)).join("")}
      </div>
    </section>
  `;
}

function bpFlowTeamRow(result, rows, teamKey) {
  const cells = draftActionsForTeam(result, rows, teamKey);
  const title = teamKey === VIEWER_TEAM_KEY ? VIEWER_OPPONENT_LABEL : teamShortName(teamKey);
  return `
    <div class="bp-flow-row" style="--team:${teams[teamKey]?.accent || "#14b8a6"}">
      <div class="bp-flow-team">
        ${teamKey !== VIEWER_TEAM_KEY ? teamLogo(teamKey, "bp-flow-logo") : ""}
        <strong>${title}</strong>
      </div>
      <div class="bp-flow-cells">
        ${cells.length ? cells.map(bpFlowCell).join("") : `<span class="bp-flow-empty">BPデータなし</span>`}
      </div>
    </div>
  `;
}

function draftActionsForTeam(result, rows, teamKey) {
  const side = draftSideForTeam(result, teamKey);
  const slots = DRAFT_SLOTS[side] || DRAFT_SLOTS.BLUE;
  let sourceActions = bpRows
    .filter((row) => row.matchId === result.id && row.team === teamKey);
  if (!sourceActions.length && side) {
    sourceActions = bpRows
      .filter((row) => row.matchId === result.id && row.side === side);
  }
  sourceActions = sourceActions
    .sort((a, b) => (a.bpOrder || 999) - (b.bpOrder || 999));
  const banActions = sourceActions.filter((row) => row.type === "BAN").map((row, index) => draftAction(row, row.bpOrder || slots.BAN[index] || index + 1, index));
  let pickActions = sourceActions.filter((row) => row.type === "PICK").map((row, index) => draftAction(row, row.bpOrder || slots.PICK[index] || index + 1, index));
  if (!pickActions.length) {
    pickActions = ROLE_ORDER
      .map((role) => rows.find((row) => row.team === teamKey && row.role === role))
      .filter(Boolean)
      .map((row, index) => ({
        champion: row.champion,
        type: "PICK",
        label: `P${index + 1}`,
        detail: row.role,
        order: slots.PICK[index] || 20
      }));
  }
  return [...banActions, ...pickActions].sort((a, b) => a.order - b.order);
}

function draftAction(row, fallbackOrder, index) {
  return {
    champion: row.champion,
    type: row.type,
    label: row.type === "BAN" ? `B${index + 1}` : `P${index + 1}`,
    detail: row.role || row.phase || "",
    order: fallbackOrder
  };
}

function draftSideForTeam(result, teamKey) {
  const action = bpRows.find((row) => row.matchId === result.id && row.team === teamKey && (row.side === "BLUE" || row.side === "RED"));
  if (action) return action.side;
  return teamKey === result.left ? "BLUE" : "RED";
}

function bpFlowCell(item) {
  return `
    <span class="bp-flow-cell is-${item.type.toLowerCase()}" style="grid-column:${item.order}" title="${item.type}: ${item.champion}${item.detail ? ` / ${item.detail}` : ""}">
      ${champIcon(item.champion)}
      <small>${item.label}</small>
    </span>
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
  const teamGameCounts = rankingTeamGameCounts();
  const stats = buildPlayerStats()
    .filter((item) => !state.team || item.team === state.team)
    .filter((item) => isRankingEligible(item, teamGameCounts))
    .filter((item) => filterByKeyword([item], (x) => `${x.name} ${x.champions} ${x.team}`)[0]);
  elements.rankingBoard.replaceChildren(...["NEXT", "CORE", "MASTERS"].map((tier) => rankingTier(tier, stats.filter((item) => item.tier === tier))));
}

function rankingTeamGameCounts() {
  const counts = new Map();
  leagueScrimResults()
    .filter((row) => matchPassesGlobalFilters(row.id))
    .forEach((row) => {
      [row.left, row.right]
        .filter((teamKey) => teamKey && teamKey !== VIEWER_TEAM_KEY)
        .forEach((teamKey) => {
          const key = `${teamKey}__${row.tier}`;
          counts.set(key, (counts.get(key) || 0) + 1);
        });
    });
  return counts;
}

function isRankingEligible(item, teamGameCounts) {
  const teamGames = teamGameCounts.get(`${item.team}__${item.tier}`) || 0;
  return teamGames > 0 && item.matches >= teamGames / 2;
}

function renderPlayerPerformance() {
  renderRankings();
  renderPlayerStats();
}

function renderPlayerStats() {
  const columns = playerStatsColumns();
  const sortColumn = columns.find((column) => column.key === state.playerStatsSort.key) || columns[5];
  const rows = sortPlayerStats(buildPlayerStats()
    .filter((item) => !state.tier || item.tier === state.tier)
    .filter((item) => !state.team || item.team === state.team)
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
      ${rows.map((item, rowIndex) => `
        <tr>
          ${columns.map((column) => `<td class="${column.numeric ? "is-numeric" : ""}">${column.render(item, rowIndex)}</td>`).join("")}
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
  table.querySelectorAll("[data-player-detail]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = rows[Number(button.dataset.playerDetail)];
      if (item) openPlayerDetail(item);
    });
  });
  elements.playerStats.replaceChildren(table);
}

function playerStatsColumns() {
  return [
    { key: "name", label: "Player", value: (item) => item.name, render: (item, index) => playerStatsPlayer(item, index) },
    { key: "team", label: "Team", value: (item) => teamFullName(item.team), render: (item) => playerStatsTeam(item) },
    { key: "tier", label: "Tier", value: (item) => item.tier, render: (item) => item.tier },
    { key: "role", label: "Role", value: (item) => item.role, render: (item) => item.role },
    { key: "matches", label: "Games", numeric: true, value: (item) => item.matches, render: (item) => formatInteger(item.matches) },
    { key: "record", label: "W-L", value: (item) => item.wins / item.matches, render: (item) => `${item.wins}-${item.matches - item.wins}` },
    { key: "mvp", label: "MVP", numeric: true, value: (item) => item.mvp, render: (item) => formatInteger(item.mvp) },
    { key: "kda", label: "KDA", numeric: true, value: (item) => item.kda, render: (item) => formatDecimal(item.kda) },
    { key: "kills", label: "K", numeric: true, value: (item) => item.avgKills, render: (item) => formatDecimal(item.avgKills) },
    { key: "deaths", label: "D", numeric: true, value: (item) => item.avgDeaths, render: (item) => formatDecimal(item.avgDeaths) },
    { key: "assists", label: "A", numeric: true, value: (item) => item.avgAssists, render: (item) => formatDecimal(item.avgAssists) },
    { key: "kp", label: "KP", numeric: true, value: (item) => item.killParticipation, render: (item) => percent(item.killParticipation) },
    { key: "cs15", label: "CS@15", numeric: true, value: (item) => item.avgCs15, render: (item) => item.avgCs15 == null ? "-" : formatInteger(item.avgCs15) },
    { key: "dpm", label: "DPM", numeric: true, value: (item) => item.dpm, render: (item) => item.dpm == null ? "-" : formatDecimal(item.dpm) },
    { key: "damageShare", label: "DMG%", numeric: true, value: (item) => item.damageShare, render: (item) => percent(item.damageShare) },
    { key: "championCount", label: "Champ", numeric: true, value: (item) => item.championCount, render: (item) => formatInteger(item.championCount) }
  ];
}

function playerStatsPlayer(item, index) {
  return `
    <button class="stats-player-link" type="button" data-player-detail="${index}" aria-label="${item.name}の詳細を表示">
      ${playerIcon(item.name)}
      <strong>${item.name}</strong>
    </button>
  `;
}

function playerStatsTeam(item) {
  return `<span class="stats-team">${teamLogo(item.team, "ranking-team-logo")}<span>${teamShortName(item.team)}</span></span>`;
}

function openPlayerDetail(item, options = {}) {
  prepareDialogNavigation({ type: "player", item }, options);
  trackAnalyticsEvent("player_detail_open", {
    player_name: item.name || "",
    team_key: item.team || "",
    tier: item.tier || "",
    role: item.role || "",
    source_view: state.view
  });
  const rows = competitivePlayerMatches()
    .filter((row) => row.name === item.name && row.team === item.team && row.role === item.role)
    .sort((a, b) => {
      const left = scrimResults.find((match) => match.id === a.matchId);
      const right = scrimResults.find((match) => match.id === b.matchId);
      return String(left?.date || "").localeCompare(String(right?.date || ""))
        || String(left?.match || "").localeCompare(String(right?.match || ""), "ja", { numeric: true });
    });
  elements.dialogMeta.textContent = `Player / ${item.tier} / ${item.role}`;
  elements.dialogTitle.textContent = item.name;

  const body = document.createElement("section");
  body.className = "player-detail";
  body.innerHTML = `
    <div class="player-detail-head" style="--team:${teams[item.team]?.accent || "#64748b"}">
      ${playerIcon(item.name)}
      <div>
        <strong>${item.name}</strong>
        <span>${teamLogo(item.team, "ranking-team-logo")}${teamFullName(item.team)} / ${item.tier} / ${item.role}</span>
      </div>
    </div>
    <div class="player-detail-metrics">
      ${playerMetric("試合", formatInteger(item.matches))}
      ${playerMetric("勝敗", `${item.wins}-${item.matches - item.wins}`)}
      ${playerMetric("勝率", percent(item.wins / item.matches))}
      ${playerMetric("MVP", formatInteger(item.mvp))}
      ${playerMetric("KDA", formatDecimal(item.kda))}
      ${playerMetric("DPM", item.dpm == null ? "-" : formatDecimal(item.dpm))}
      ${playerMetric("CS@15", item.avgCs15 == null ? "-" : formatInteger(item.avgCs15))}
    </div>
    ${playerChampionTable(rows)}
    ${playerMatchLog(rows)}
  `;
  elements.dialogBody.replaceChildren(body);
  if (!elements.dialog.open) elements.dialog.showModal();
  resetDialogScroll();
}

function playerMetric(label, value) {
  return `<div><span>${label}</span><strong>${value}</strong></div>`;
}

function playerChampionTable(rows) {
  const champions = playerChampionStats(rows);
  if (!champions.length) return `<section class="player-detail-section"><h3>使用チャンピオン</h3><p class="muted">該当データなし</p></section>`;
  return `
    <section class="player-detail-section">
      <h3>使用チャンピオン</h3>
      <div class="player-detail-table-wrap">
        <table class="player-detail-table player-champion-table">
          <thead>
            <tr>
              <th>Champion</th>
              <th>Games</th>
              <th>W-L</th>
              <th>Win%</th>
              <th>KDA</th>
              <th>K</th>
              <th>D</th>
              <th>A</th>
              <th>DPM</th>
              <th>CS@15</th>
            </tr>
          </thead>
          <tbody>
            ${champions.map((champion) => `
              <tr>
                <td><span class="game-champion">${champIcon(champion.name)}<span>${champion.name}</span></span></td>
                <td>${formatInteger(champion.matches)}</td>
                <td>${champion.wins}-${champion.matches - champion.wins}</td>
                <td>${percent(champion.wins / champion.matches)}</td>
                <td>${formatDecimal(champion.kda)}</td>
                <td>${formatDecimal(champion.avgKills)}</td>
                <td>${formatDecimal(champion.avgDeaths)}</td>
                <td>${formatDecimal(champion.avgAssists)}</td>
                <td>${champion.dpm == null ? "-" : formatDecimal(champion.dpm)}</td>
                <td>${champion.avgCs15 == null ? "-" : formatInteger(champion.avgCs15)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function playerChampionStats(rows) {
  const map = new Map();
  rows.forEach((row) => {
    if (!row.champion) return;
    if (!map.has(row.champion)) {
      map.set(row.champion, { name: row.champion, matches: 0, wins: 0, kills: 0, deaths: 0, assists: 0, dpmDamage: 0, dpmMinutes: 0, cs15: 0, cs15Matches: 0 });
    }
    const item = map.get(row.champion);
    item.matches += 1;
    item.wins += row.result === "WIN" ? 1 : 0;
    item.kills += row.kills;
    item.deaths += row.deaths;
    item.assists += row.assists;
    const minutes = matchDurationMinutes(row.matchId);
    if (minutes) {
      item.dpmDamage += row.damage;
      item.dpmMinutes += minutes;
    }
    if (Number.isFinite(row.cs15) && row.cs15 > 0) {
      item.cs15 += row.cs15;
      item.cs15Matches += 1;
    }
  });
  return [...map.values()]
    .map((item) => ({
      ...item,
      kda: item.deaths === 0 ? item.kills + item.assists : (item.kills + item.assists) / item.deaths,
      avgKills: item.kills / item.matches,
      avgDeaths: item.deaths / item.matches,
      avgAssists: item.assists / item.matches,
      dpm: item.dpmMinutes ? item.dpmDamage / item.dpmMinutes : null,
      avgCs15: item.cs15Matches ? item.cs15 / item.cs15Matches : null
    }))
    .sort((a, b) => b.matches - a.matches || b.wins / b.matches - a.wins / a.matches || a.name.localeCompare(b.name, "ja"));
}

function playerMatchLog(rows) {
  if (!rows.length) return `<section class="player-detail-section"><h3>試合ログ</h3><p class="muted">該当データなし</p></section>`;
  return `
    <section class="player-detail-section">
      <h3>試合ログ</h3>
      <div class="player-detail-table-wrap">
        <table class="player-detail-table player-log-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Match</th>
              <th>Result</th>
              <th>Champion</th>
              <th>KDA</th>
              <th>DPM</th>
              <th>CS@15</th>
              <th>Opponent</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => {
              const match = scrimResults.find((item) => item.id === row.matchId);
              const minutes = matchDurationMinutes(row.matchId);
              const opponent = opponentLaneRow(row);
              return `
                <tr>
                  <td>${shortDate(match?.date || row.date)}</td>
                  <td>${playerMatchLabel(row, match)}</td>
                  <td>${row.result}</td>
                  <td><span class="game-champion">${champIcon(row.champion)}<span>${row.champion}</span></span></td>
                  <td>${row.kills}/${row.deaths}/${row.assists}</td>
                  <td>${minutes ? formatDecimal(row.damage / minutes) : "-"}</td>
                  <td>${Number.isFinite(row.cs15) && row.cs15 > 0 ? formatInteger(row.cs15) : "-"}</td>
                  <td>${opponent ? `<span class="game-champion opponent-champion"><em>vs</em>${champIcon(opponent.champion)}<span>${opponent.champion}</span></span>` : "-"}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function playerMatchLabel(row, match) {
  if (!match) return row.matchId;
  const opponent = row.team === match.left ? match.right : row.team === match.right ? match.left : "";
  if (opponent === VIEWER_TEAM_KEY) {
    return `
      <span class="player-match-label is-listener">
        <span>${VIEWER_OPPONENT_LABEL}</span>
        <small>${match.match || match.id}</small>
      </span>
    `;
  }
  return `
    <span class="player-match-label">
      ${opponent && opponent !== VIEWER_TEAM_KEY ? teamLogo(opponent, "ranking-team-logo") : ""}
      <span>${opponent === VIEWER_TEAM_KEY ? VIEWER_OPPONENT_LABEL : teamFullName(opponent)}</span>
      <small>${match.match || match.id}</small>
    </span>
  `;
}

function opponentLaneRow(row) {
  const matchRows = playerMatches.filter((item) => item.matchId === row.matchId);
  return matchRows.find((item) => item.role === row.role && item.team !== row.team) || null;
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

  const teamKeys = state.team && teams[state.team] ? [state.team] : Object.keys(teams);
  const columnKeys = [...teamKeys, VIEWER_TEAM_KEY];
  if (state.team && teams[state.team]) {
    columnKeys.splice(0, columnKeys.length, ...Object.keys(teams), VIEWER_TEAM_KEY);
  }
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
  shell.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const button = target?.closest("[data-league-result-ids]");
    if (!button) return;
    openLeagueResults(button.dataset.leagueResultIds);
  });
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
        records: new Map([[row.left, { wins: 0, losses: 0 }], [row.right, { wins: 0, losses: 0 }]]),
        results: []
      });
    }
    const item = byMatchupDate.get(key);
    item.results.push(row);
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
          const resultIds = item.results.map((result) => result.id).join(",");
          return `<button type="button" class="league-record-button ${record.wins > record.losses ? "is-win" : record.wins < record.losses ? "is-loss" : ""}" data-league-result-ids="${resultIds}">${record.wins}-${record.losses} (${shortDate(item.date)})</button>`;
        }).join("")}
      </div>
    </td>
  `;
}

function openLeagueResults(resultIdsValue, options = {}) {
  const ids = String(resultIdsValue || "").split(",").map((id) => id.trim()).filter(Boolean);
  const results = ids.map((id) => scrimResults.find((result) => result.id === id)).filter(Boolean);
  if (!results.length) return;
  trackAnalyticsEvent("league_result_open", {
    result_ids: ids.join(","),
    games: results.length,
    tier: results[0]?.tier || "",
    left_team: results[0]?.left || "",
    right_team: results[0]?.right || "",
    source_view: state.view
  });
  const first = results[0];
  const item = {
    id: `league_${ids.join("_")}`,
    date: first.date,
    eventTime: first.eventTime || "",
    day: "RESULT",
    match: gameRangeLabel(results),
    type: first.type || "スクリム",
    matchType: first.matchType || first.matchKind || first.type || "",
    stage: "RESULT",
    matchName: first.matchName || "スクリム",
    tier: first.tier,
    left: first.left,
    right: first.right,
    leftLabel: first.leftLabel,
    rightLabel: first.rightLabel,
    status: "completed",
    results,
    resultSource: true,
    viewerMatch: results.some((result) => result.viewerMatch),
    resultRecord: summarizeResults(results, first.left, first.right)
  };
  openMatch(item, options);
}

function gameRangeLabel(results) {
  const labels = results
    .map((result) => result.match)
    .filter(Boolean);
  if (!labels.length) return `${results.length}G`;
  if (labels.length === 1) return labels[0];
  return `${labels[0]}-${labels[labels.length - 1]}`;
}

function totalCell(teamKey, summary) {
  const record = summary.totals.get(teamKey) || { wins: 0, losses: 0 };
  return `<strong>${record.wins}-${record.losses}</strong>`;
}

function renderTeamStats() {
  if (!elements.teamStats) return;
  const rows = buildTeamStatsRows();
  if (!rows.length) {
    elements.teamStats.innerHTML = `<p class="muted empty-state">条件に一致するチーム戦績がありません。</p>`;
    return;
  }
  const table = document.createElement("table");
  table.className = "team-stats-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Team</th>
        <th>Tier</th>
        <th>Games</th>
        <th>W-L</th>
        <th>Win%</th>
        <th>KDA</th>
        <th>DPM</th>
        <th>Avg Gold</th>
        <th>MVP</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((row, index) => `
        <tr data-team-detail="${index}" tabindex="0">
          <td><button class="team-stats-link" type="button">${teamLogo(row.team, "ranking-team-logo")}<strong>${teamFullName(row.team)}</strong></button></td>
          <td>${row.tier}</td>
          <td>${formatInteger(row.matches)}</td>
          <td>${row.wins}-${row.losses}</td>
          <td>${percent(row.wins / row.matches)}</td>
          <td>${formatTeamKda(row)}</td>
          <td>${row.dpm == null ? "-" : formatDecimal(row.dpm)}</td>
          <td>${row.avgGold == null ? "-" : formatInteger(row.avgGold)}</td>
          <td>${formatInteger(row.mvp)}</td>
        </tr>
      `).join("")}
    </tbody>
  `;
  table.querySelectorAll("[data-team-detail]").forEach((row) => {
    const item = rows[Number(row.dataset.teamDetail)];
    row.addEventListener("click", () => openTeamDetail(item));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openTeamDetail(item);
      }
    });
  });
  elements.teamStats.replaceChildren(table);
}

function buildTeamStatsRows() {
  const map = new Map();
  filteredTeamResults().forEach((result) => {
    [result.left, result.right].forEach((teamKey) => {
      if (!teams[teamKey]) return;
      const side = teamKey === result.left ? "left" : "right";
      const key = `${teamKey}__${result.tier}`;
      if (!map.has(key)) {
        map.set(key, {
          team: teamKey,
          tier: result.tier,
          matches: 0,
          wins: 0,
          losses: 0,
          kills: 0,
          deaths: 0,
          assists: 0,
          gold: 0,
          goldMatches: 0,
          dpmDamage: 0,
          dpmMinutes: 0,
          mvp: 0,
          resultIds: []
        });
      }
      const item = map.get(key);
      const kda = parseTeamKda(side === "left" ? result.leftKda : result.rightKda);
      const gold = side === "left" ? result.leftGold : result.rightGold;
      item.matches += 1;
      item.wins += result.winner === teamKey ? 1 : 0;
      item.losses += result.winner && result.winner !== teamKey ? 1 : 0;
      item.kills += kda.kills;
      item.deaths += kda.deaths;
      item.assists += kda.assists;
      if (Number.isFinite(gold) && gold > 0) {
        item.gold += gold;
        item.goldMatches += 1;
      }
      item.mvp += resultMvpTeam(result) === teamKey ? 1 : 0;
      item.resultIds.push(result.id);
      const minutes = matchDurationMinutes(result.id);
      if (minutes) {
        teamRowsForMatch(result.id, teamKey).forEach((row) => {
          item.dpmDamage += row.damage;
          item.dpmMinutes += minutes;
        });
      }
    });
  });
  return [...map.values()]
    .map((item) => ({
      ...item,
      avgGold: item.goldMatches ? item.gold / item.goldMatches : null,
      dpm: item.dpmMinutes ? item.dpmDamage / item.dpmMinutes : null
    }))
    .filter((item) => !state.team || item.team === state.team)
    .sort((a, b) => tierSort(a.tier) - tierSort(b.tier) || teamShortName(a.team).localeCompare(teamShortName(b.team), "ja"));
}

function filteredTeamResults() {
  return leagueScrimResults()
    .filter((row) => matchPassesGlobalFilters(row.id))
    .filter((row) => !state.tier || row.tier === state.tier)
    .filter((row) => !state.team || row.left === state.team || row.right === state.team || row.winner === state.team)
    .filter((row) => {
      if (!state.type) return true;
      if (state.type === "スクリム") return isScrimLikeItem(row);
      if (state.type === "本番") return String(row.matchType || row.type || "").includes("本番");
      return String(row.type || "").includes(state.type);
    })
    .filter((row) => {
      if (!state.keyword) return true;
      const text = [teamFullName(row.left), teamFullName(row.right), row.tier, row.matchName, row.type, row.mvp, row.carry]
        .join(" ")
        .toLocaleLowerCase("ja");
      return text.includes(state.keyword);
    });
}

function openTeamDetail(item, options = {}) {
  prepareDialogNavigation({ type: "team", item }, options);
  trackAnalyticsEvent("team_detail_open", {
    team_key: item.team || "",
    team_name: teamFullName(item.team),
    tier: item.tier || "",
    matches: item.matches || 0,
    source_view: state.view
  });
  const results = item.resultIds
    .map((id) => scrimResults.find((row) => row.id === id))
    .filter(Boolean)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.match || "").localeCompare(String(b.match || ""), "ja", { numeric: true }));
  elements.dialogMeta.textContent = `Team / ${item.tier}`;
  elements.dialogTitle.textContent = `${teamFullName(item.team)} ${item.tier}`;

  const body = document.createElement("section");
  body.className = "player-detail team-detail";
  body.innerHTML = `
    ${teamProfileHeader(item, results)}
    ${teamOverviewCards(item, results)}
    ${teamDraftPanel(item.team, results)}
    ${teamMetricPanels(item.team, results)}
    ${teamOpponentTable(item.team, results)}
    ${teamPlayerSummary(item.team, results)}
    ${teamMatchLog(item.team, results)}
  `;
  elements.dialogBody.replaceChildren(body);
  body.querySelectorAll("[data-team-matchup-result-ids]").forEach((button) => {
    button.addEventListener("click", () => openLeagueResults(button.dataset.teamMatchupResultIds, { push: true, clear: false }));
  });
  body.querySelectorAll("[data-team-log-result-id]").forEach((button) => {
    button.addEventListener("click", () => openLeagueResults(button.dataset.teamLogResultId, { push: true, clear: false }));
  });
  body.querySelectorAll("[data-team-player-name]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = buildPlayerStats().find((row) => row.name === button.dataset.teamPlayerName && row.team === button.dataset.teamPlayerTeam && row.role === button.dataset.teamPlayerRole);
      if (item) openPlayerDetail(item, { push: true, clear: false });
    });
  });
  if (!elements.dialog.open) elements.dialog.showModal();
  resetDialogScroll();
}

function teamProfileHeader(item, results) {
  return `
    <div class="team-profile-head" style="--team:${teams[item.team]?.accent || "#64748b"}">
      ${teamLogo(item.team, "dialog-team-logo")}
      <div>
        <p class="eyebrow">${item.tier} / ${teamShortName(item.team)}</p>
        <strong>${teamFullName(item.team)}</strong>
        <span>${formatInteger(item.matches)} Games ・ ${item.wins}-${item.losses} ・ Win ${percent(item.wins / item.matches)}</span>
      </div>
      <div class="team-profile-record">
        <span>Latest</span>
        <strong>${teamRecentForm(item.team, results)}</strong>
      </div>
    </div>
  `;
}

function teamRecentForm(teamKey, results) {
  const marks = results.slice(-6).map((result) => result.winner === teamKey ? "W" : "L");
  return marks.length ? marks.join(" ") : "-";
}

function teamOverviewCards(item, results) {
  const avgTime = averageMatchMinutes(results);
  return `
    <section class="team-overview-grid">
      ${teamStatCard("Record", `${item.wins}-${item.losses}`, `${percent(item.wins / item.matches)} Win`)}
      ${teamStatCard("KDA", formatTeamKda(item), "Team total")}
      ${teamStatCard("DPM", item.dpm == null ? "-" : formatDecimal(item.dpm), "Team damage/min")}
      ${teamStatCard("Avg Gold", item.avgGold == null ? "-" : formatInteger(item.avgGold), "Result screen")}
      ${teamStatCard("Avg Time", avgTime == null ? "-" : `${formatDecimal(avgTime)}m`, "Known games")}
      ${teamStatCard("MVP", formatInteger(item.mvp), "MVP count")}
    </section>
  `;
}

function teamStatCard(label, value, sub) {
  return `<article class="team-stat-card"><span>${label}</span><strong>${value}</strong><small>${sub}</small></article>`;
}

function averageMatchMinutes(results) {
  const minutes = results.map((result) => matchDurationMinutes(result.id)).filter((value) => Number.isFinite(value) && value > 0);
  if (!minutes.length) return null;
  return minutes.reduce((sum, value) => sum + value, 0) / minutes.length;
}

function teamDraftPanel(teamKey, results) {
  const resultIds = new Set(results.map((result) => result.id));
  const picks = playerMatches.filter((row) => resultIds.has(row.matchId) && row.team === teamKey && row.champion && !isNoBanChampion(row.champion));
  const bans = bpRows.filter((row) => resultIds.has(row.matchId) && row.team === teamKey && row.type === "BAN" && row.champion && !isNoBanChampion(row.champion));
  const bannedAgainst = bpRows.filter((row) => resultIds.has(row.matchId) && row.team !== teamKey && row.type === "BAN" && row.champion && !isNoBanChampion(row.champion));
  return `
    <section class="team-stat-section">
      <div class="team-section-title">
        <h3>Draft</h3>
        <span>画像から取得できたPICK/BAN</span>
      </div>
      <div class="team-draft-grid">
        ${teamChampionMiniList("Most Picked", countChampions(picks), "pick")}
        ${teamChampionMiniList("Most Banned", countChampions(bans), "ban")}
        ${teamChampionMiniList("Banned Against", countChampions(bannedAgainst), "ban")}
      </div>
    </section>
  `;
}

function teamMetricPanels(teamKey, results) {
  const resultIds = new Set(results.map((result) => result.id));
  const rows = playerMatches.filter((row) => resultIds.has(row.matchId) && row.team === teamKey);
  const goldDiff15Values = results
    .map((result) => {
      if (!Number.isFinite(result.goldDiff15)) return null;
      if (result.left === teamKey) return result.goldDiff15;
      if (result.right === teamKey) return -result.goldDiff15;
      return null;
    })
    .filter((value) => Number.isFinite(value));
  const maxDpm = rows
    .map((row) => {
      const minutes = matchDurationMinutes(row.matchId);
      return minutes ? { row, dpm: row.damage / minutes } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.dpm - a.dpm)[0];
  const maxDamage = rows.slice().sort((a, b) => b.damage - a.damage)[0];
  return `
    <section class="team-stat-section">
      <div class="team-section-title">
        <h3>Economy / Aggression</h3>
        <span>リザルト画像ベース</span>
      </div>
      <div class="team-overview-grid">
        ${teamStatCard("Gold diff@15", goldDiff15Values.length ? formatSignedInteger(goldDiff15Values.reduce((sum, value) => sum + value, 0) / goldDiff15Values.length) : "-", "Team average")}
        ${teamStatCard("Top DPM", maxDpm ? `${maxDpm.row.name} ${formatDecimal(maxDpm.dpm)}` : "-", "Best game")}
        ${teamStatCard("Top Damage", maxDamage ? `${maxDamage.name} ${formatInteger(maxDamage.damage)}` : "-", "Best game")}
      </div>
    </section>
  `;
}

function countChampions(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = row.champion;
    if (!key) return;
    if (!map.has(key)) map.set(key, { champion: key, count: 0, wins: 0 });
    const item = map.get(key);
    item.count += 1;
    item.wins += row.result === "WIN" ? 1 : 0;
  });
  return [...map.values()].sort((a, b) => b.count - a.count || b.wins - a.wins || a.champion.localeCompare(b.champion, "ja"));
}

function teamChampionMiniList(title, rows, mode) {
  const items = rows.slice(0, 5);
  return `
    <article class="team-draft-card">
      <h4>${title}</h4>
      ${items.length ? items.map((item) => `
        <div>
          <span class="game-champion">${champIcon(item.champion)}<span>${item.champion}</span></span>
          <b>${formatInteger(item.count)}${mode === "pick" ? ` / ${percent(item.wins / item.count)}` : ""}</b>
        </div>
      `).join("") : `<p class="muted">データなし</p>`}
    </article>
  `;
}

function teamOpponentTable(teamKey, results) {
  const map = new Map();
  results.forEach((result) => {
    const opponent = result.left === teamKey ? result.right : result.right === teamKey ? result.left : "";
    if (!opponent) return;
    if (!map.has(opponent)) map.set(opponent, { team: opponent, matches: 0, wins: 0, resultIds: [] });
    const item = map.get(opponent);
    item.matches += 1;
    item.wins += result.winner === teamKey ? 1 : 0;
    item.resultIds.push(result.id);
  });
  const rows = [...map.values()].sort((a, b) => b.matches - a.matches || b.wins - a.wins);
  if (!rows.length) return `<section class="player-detail-section"><h3>対戦相手別成績</h3><p class="muted">該当データなし</p></section>`;
  return `
    <section class="player-detail-section">
      <h3>対戦相手別成績</h3>
      <div class="player-detail-table-wrap">
        <table class="player-detail-table team-opponent-table">
          <thead>
            <tr>
              <th>Opponent</th>
              <th>Games</th>
              <th>W-L</th>
              <th>Win%</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>
                  <button class="team-matchup-link" type="button" data-team-matchup-result-ids="${row.resultIds.join(",")}">
                    ${row.team === VIEWER_TEAM_KEY ? VIEWER_OPPONENT_LABEL : `${teamLogo(row.team, "ranking-team-logo")} <span>${teamFullName(row.team)}</span>`}
                  </button>
                </td>
                <td>${formatInteger(row.matches)}</td>
                <td>${row.wins}-${row.matches - row.wins}</td>
                <td>${percent(row.wins / row.matches)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function teamPlayerSummary(teamKey, results) {
  const resultIds = new Set(results.map((result) => result.id));
  const rows = playerMatches.filter((row) => resultIds.has(row.matchId) && row.team === teamKey);
  if (!rows.length) return `<section class="player-detail-section"><h3>主な選手成績</h3><p class="muted">該当データなし</p></section>`;
  const stats = buildPlayerStatsFromRows(rows);
  return `
    <section class="player-detail-section">
      <h3>主な選手成績</h3>
      <div class="player-detail-table-wrap">
        <table class="team-player-gol-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Player</th>
              <th>KDA</th>
              <th>KP%</th>
              <th>DPM</th>
              <th>DMG%</th>
              <th>GOLD%</th>
              <th>Champions Played</th>
            </tr>
          </thead>
          <tbody>
            ${stats.map((row) => `
              <tr>
                <td>${row.role}</td>
                <td>
                  <button class="team-player-detail-link" type="button" data-team-player-name="${escapeAttr(row.name)}" data-team-player-team="${escapeAttr(row.team)}" data-team-player-role="${escapeAttr(row.role)}" aria-label="${escapeAttr(row.name)}の個人成績を表示">
                    ${playerMiniLabel(row)}
                  </button>
                </td>
                <td>${formatDecimal(row.kda)}</td>
                <td>${percent(row.killParticipation)}</td>
                <td>${row.dpm == null ? "-" : formatDecimal(row.dpm)}</td>
                <td>${teamPercentBar(row.damageShare)}</td>
                <td>${teamPercentBar(row.goldShare)}</td>
                <td>${teamPlayerChampionStrip(row.championCounts)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function buildPlayerStatsFromRows(rows) {
  const map = new Map();
  const teamKillsByMatch = new Map();
  const teamDamageByMatch = new Map();
  const teamGoldByMatch = new Map();
  rows.forEach((row) => {
    const key = row.matchId;
    teamKillsByMatch.set(key, (teamKillsByMatch.get(key) || 0) + row.kills);
    teamDamageByMatch.set(key, (teamDamageByMatch.get(key) || 0) + row.damage);
    teamGoldByMatch.set(key, (teamGoldByMatch.get(key) || 0) + row.gold);
  });
  rows.forEach((row) => {
    const key = `${row.team}__${row.name}__${row.role}`;
    if (!map.has(key)) map.set(key, { name: row.name, team: row.team, role: row.role, matches: 0, wins: 0, kills: 0, deaths: 0, assists: 0, dpmDamage: 0, dpmMinutes: 0, cs15: 0, cs15Matches: 0, kpTotal: 0, kpMatches: 0, damageShareTotal: 0, damageShareMatches: 0, goldShareTotal: 0, goldShareMatches: 0, championCounts: new Map() });
    const item = map.get(key);
    item.matches += 1;
    item.wins += row.result === "WIN" ? 1 : 0;
    item.kills += row.kills;
    item.deaths += row.deaths;
    item.assists += row.assists;
    const minutes = matchDurationMinutes(row.matchId);
    if (minutes) {
      item.dpmDamage += row.damage;
      item.dpmMinutes += minutes;
    }
    if (Number.isFinite(row.cs15) && row.cs15 > 0) {
      item.cs15 += row.cs15;
      item.cs15Matches += 1;
    }
    const teamKills = teamKillsByMatch.get(row.matchId) || 0;
    if (teamKills > 0) {
      item.kpTotal += (row.kills + row.assists) / teamKills;
      item.kpMatches += 1;
    }
    const teamDamage = teamDamageByMatch.get(row.matchId) || 0;
    if (teamDamage > 0) {
      item.damageShareTotal += row.damage / teamDamage;
      item.damageShareMatches += 1;
    }
    const teamGold = teamGoldByMatch.get(row.matchId) || 0;
    if (teamGold > 0) {
      item.goldShareTotal += row.gold / teamGold;
      item.goldShareMatches += 1;
    }
    if (row.champion && !isNoBanChampion(row.champion)) {
      item.championCounts.set(row.champion, (item.championCounts.get(row.champion) || 0) + 1);
    }
  });
  return [...map.values()]
    .map((item) => ({
      ...item,
      kda: item.deaths === 0 ? item.kills + item.assists : (item.kills + item.assists) / item.deaths,
      dpm: item.dpmMinutes ? item.dpmDamage / item.dpmMinutes : null,
      avgCs15: item.cs15Matches ? item.cs15 / item.cs15Matches : null,
      killParticipation: item.kpMatches ? item.kpTotal / item.kpMatches : 0,
      damageShare: item.damageShareMatches ? item.damageShareTotal / item.damageShareMatches : 0,
      goldShare: item.goldShareMatches ? item.goldShareTotal / item.goldShareMatches : 0,
      championCounts: [...item.championCounts.entries()]
        .map(([champion, count]) => ({ champion, count }))
        .sort((a, b) => b.count - a.count || a.champion.localeCompare(b.champion, "ja"))
    }))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || b.matches - a.matches || a.name.localeCompare(b.name, "ja"));
}

function teamPercentBar(value) {
  return `
    <span class="team-percent-cell">
      <span class="team-percent-value">${percent(value)}</span>
      <span class="team-percent-bar"><i style="width:${Math.max(0, Math.min(100, Math.round(value * 100)))}%"></i></span>
    </span>
  `;
}

function teamPlayerChampionStrip(champions) {
  if (!champions?.length) return "-";
  return `
    <span class="team-champion-strip">
      ${champions.map((item) => `
        <span class="team-champion-pick" title="${item.champion} ${item.count}回">
          ${champIcon(item.champion)}
          <small>${formatInteger(item.count)}</small>
        </span>
      `).join("")}
    </span>
  `;
}

function teamMatchLog(teamKey, results) {
  if (!results.length) return `<section class="player-detail-section"><h3>試合ログ</h3><p class="muted">該当データなし</p></section>`;
  return `
    <section class="player-detail-section">
      <h3>試合ログ</h3>
      <div class="player-detail-table-wrap">
        <table class="player-detail-table team-log-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Match</th>
              <th>Result</th>
              <th>KDA</th>
              <th>Gold</th>
              <th>Max DMG</th>
              <th>MVP</th>
            </tr>
          </thead>
          <tbody>
            ${results.map((result) => {
              const side = result.left === teamKey ? "left" : "right";
              const opponent = side === "left" ? result.right : result.left;
              const win = result.winner === teamKey;
              return `
                <tr>
                  <td>${shortDate(result.date)}</td>
                  <td>
                    <button class="team-matchup-link" type="button" data-team-log-result-id="${escapeAttr(result.id)}" aria-label="${escapeAttr(result.match || result.id)}の試合詳細を表示">
                      ${opponent === VIEWER_TEAM_KEY ? VIEWER_OPPONENT_LABEL : `${teamLogo(opponent, "ranking-team-logo")} ${teamFullName(opponent)}`}
                      <small>${result.match || result.id}</small>
                    </button>
                  </td>
                  <td>${win ? "WIN" : "LOSE"}</td>
                  <td>${side === "left" ? result.leftKda : result.rightKda}</td>
                  <td>${formatInteger(side === "left" ? result.leftGold : result.rightGold)}</td>
                  <td>${result.carry ? `${result.carry} ${formatInteger(result.maxDamage)}` : "-"}</td>
                  <td>${result.mvp || "-"}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function parseTeamKda(value) {
  const [kills = 0, deaths = 0, assists = 0] = String(value || "")
    .split("/")
    .map((part) => Number(String(part).replace(/[^\d.-]/g, "")) || 0);
  return { kills, deaths, assists };
}

function formatTeamKda(item) {
  return `${formatInteger(item.kills)}/${formatInteger(item.deaths)}/${formatInteger(item.assists)}`;
}

function teamRowsForMatch(matchId, teamKey) {
  return playerMatches.filter((row) => row.matchId === matchId && row.team === teamKey);
}

function resultMvpTeam(result) {
  if (!result?.mvp) return "";
  return playerMatches.find((row) => row.matchId === result.id && row.name === result.mvp)?.team || "";
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
    rankingList("平均KDA", rows, "kda", formatDecimal, "desc", "KDA"),
    rankingList("MVP数", rows, "mvp", formatInteger, "desc", "MVP"),
    rankingList("平均キル数", rows, "avgKills", formatDecimal, "desc", "K"),
    rankingList("平均デス数", rows, "avgDeaths", formatDecimal, "asc", "D"),
    rankingList("平均アシスト数", rows, "avgAssists", formatDecimal, "desc", "A"),
    rankingList("キル関与率", rows, "killParticipation", percent, "desc", "KP"),
    rankingList("15分時点のCS", rows.filter((item) => item.avgCs15 != null), "avgCs15", formatInteger, "desc", "CS@15"),
    rankingList("分間ダメージ", rows.filter((item) => item.dpm != null), "dpm", formatDecimal, "desc", "DPM"),
    rankingList("ダメージ割合", rows, "damageShare", percent, "desc", "DMG%"),
    rankingList("1試合最大ダメージ", rows, "maxDamageGame", formatInteger, "desc", "Max DMG"),
    rankingList("1試合最多キル", rows, "maxKillsGame", formatInteger, "desc", "Max K"),
    rankingList("使用チャンピオン数", rows, "championCount", formatInteger, "desc", "Champ")
  );
  return section;
}

function rankingList(title, rows, key, formatter, direction = "desc", columnLabel = title) {
  const block = document.createElement("div");
  block.className = "ranking-list";
  block.innerHTML = `
    <h4>${title}</h4>
    <div class="ranking-column-head">
      <span>#</span>
      <span>Player</span>
      <span>${columnLabel}</span>
    </div>
  `;
  rows
    .slice()
    .sort((a, b) => direction === "asc" ? a[key] - b[key] : b[key] - a[key])
    .slice(0, 3)
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
      row.tabIndex = 0;
      row.role = "button";
      row.addEventListener("click", () => openPlayerDetail(item));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPlayerDetail(item);
        }
      });
      block.append(row);
    });
  return block;
}

function renderChampions() {
  const tiers = selectedChampionTiers();
  const roles = selectedChampionRoles();
  const tierRows = buildChampionStats().filter((item) => tiers.includes(item.tier));
  const rolePickRows = tierRows.filter((item) => item.type === "PICK" && roles.includes(item.role));
  const roleChampions = new Set(rolePickRows.map((item) => item.champion));
  const rows = roles.length === ROLE_ORDER.length
    ? tierRows
    : [...rolePickRows, ...tierRows.filter((item) => item.type === "BAN" && roleChampions.has(item.champion))];
  const merged = mergeChampionStats(rows);
  const filtered = filterByKeyword(merged, (item) => `${item.champion} ${item.roles.join(" ")}`);
  elements.championStats.replaceChildren(championPicksBansPanel(filtered, rows, roles));
  renderChampionTable(filtered, tiers, roles);
}

function renderChampionTable(champions, tiers, roles) {
  if (!elements.championTable) return;
  const performance = championPerformanceStats(tiers, roles);
  const columns = championTableColumns();
  const sortColumn = columns.find((column) => column.key === state.championStatsSort.key) || columns[4];
  const rows = sortChampionTableRows(champions.map((item) => ({ ...item, ...(performance.get(item.champion) || {}) })), sortColumn);
  const table = document.createElement("table");
  table.className = "champion-stats-table";
  table.innerHTML = `
    <thead>
      <tr>
        ${columns.map((column) => `
          <th class="${column.numeric ? "is-numeric" : ""}">
            <button class="stat-sort-button" type="button" data-champion-sort="${column.key}" aria-label="${column.label}で並び替え">
              ${column.label}${championSortMark(column.key)}
            </button>
          </th>
        `).join("")}
      </tr>
    </thead>
    <tbody>
      ${rows.map((item) => `
        <tr data-champion-detail="${item.champion}" tabindex="0">
          ${columns.map((column) => `<td class="${column.numeric ? "is-numeric" : ""}">${column.render(item)}</td>`).join("")}
        </tr>
      `).join("")}
    </tbody>
  `;
  table.querySelectorAll("[data-champion-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.championSort;
      const current = state.championStatsSort;
      state.championStatsSort = {
        key,
        direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
      };
      renderChampions();
    });
  });
  table.querySelectorAll("[data-champion-detail]").forEach((row) => {
    const open = () => {
      const item = rows.find((champion) => champion.champion === row.dataset.championDetail);
      if (item) openChampionStatsDetail(item, tiers, roles);
    };
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
  elements.championTable.replaceChildren(table);
  applyChampionTableState();
}

function championTableColumns() {
  return [
    { key: "champion", label: "Champion", value: (item) => item.champion, render: (item) => `<span class="game-champion">${champIcon(item.champion)}<span>${item.champion}</span></span>` },
    { key: "role", label: "Role", value: (item) => (item.roles || []).join(" / "), render: (item) => (item.roles || []).join(" / ") || "-" },
    { key: "picks", label: "Pick", numeric: true, value: (item) => item.picks, render: (item) => formatInteger(item.picks) },
    { key: "bans", label: "Ban", numeric: true, value: (item) => item.bans, render: (item) => formatInteger(item.bans) },
    { key: "presence", label: "P/B", numeric: true, value: (item) => item.presence, render: (item) => formatInteger(item.presence) },
    { key: "presenceRate", label: "登場率", numeric: true, value: (item) => item.presenceRate, render: (item) => rateWithCount(item.presence, item.matchCount) },
    { key: "winRate", label: "勝率", numeric: true, value: (item) => item.picks ? item.winRate : null, render: (item) => item.picks ? rateWithCount(item.wins, item.picks) : "-" },
    { key: "kda", label: "KDA", numeric: true, value: (item) => item.matches ? item.kda : null, render: (item) => item.matches ? formatDecimal(item.kda) : "-" },
    { key: "avgKills", label: "K", numeric: true, value: (item) => item.matches ? item.avgKills : null, render: (item) => item.matches ? formatDecimal(item.avgKills) : "-" },
    { key: "avgDeaths", label: "D", numeric: true, value: (item) => item.matches ? item.avgDeaths : null, render: (item) => item.matches ? formatDecimal(item.avgDeaths) : "-" },
    { key: "avgAssists", label: "A", numeric: true, value: (item) => item.matches ? item.avgAssists : null, render: (item) => item.matches ? formatDecimal(item.avgAssists) : "-" },
    { key: "dpm", label: "DPM", numeric: true, value: (item) => item.dpm, render: (item) => item.dpm == null ? "-" : formatDecimal(item.dpm) },
    { key: "avgCs15", label: "CS@15", numeric: true, value: (item) => item.avgCs15, render: (item) => item.avgCs15 == null ? "-" : formatInteger(item.avgCs15) },
    { key: "userCount", label: "使用者", numeric: true, value: (item) => item.userCount || 0, render: (item) => formatInteger(item.userCount || 0) }
  ];
}

function sortChampionTableRows(rows, column) {
  const direction = state.championStatsSort.direction === "asc" ? 1 : -1;
  const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
  return rows.sort((a, b) => {
    const left = column.value(a);
    const right = column.value(b);
    const leftMissing = left == null || Number.isNaN(left);
    const rightMissing = right == null || Number.isNaN(right);
    if (leftMissing || rightMissing) {
      return leftMissing === rightMissing ? collator.compare(a.champion, b.champion) : leftMissing ? 1 : -1;
    }
    const result = Number.isFinite(left) && Number.isFinite(right)
      ? left - right
      : collator.compare(String(left ?? ""), String(right ?? ""));
    return result * direction || b.presence - a.presence || collator.compare(a.champion, b.champion);
  });
}

function championSortMark(key) {
  if (state.championStatsSort.key !== key) return "";
  return state.championStatsSort.direction === "asc" ? " ▲" : " ▼";
}

function applyChampionTableState() {
  if (!elements.championTable || !elements.championTableToggle) return;
  elements.championTable.hidden = !state.championTableOpen;
  elements.championTableToggle.textContent = state.championTableOpen ? "閉じる" : "開く";
  elements.championTableToggle.setAttribute("aria-expanded", String(state.championTableOpen));
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

function championPicksBansPanel(champions, rows, selectedRoles) {
  const panel = document.createElement("section");
  panel.className = "champion-pb-panel";
  const championByName = new Map(champions.map((item) => [item.champion, item]));
  const roleRows = selectedRoles.length ? selectedRoles : ROLE_ORDER;
  panel.innerHTML = `
    <header class="champion-pb-head">
      <h4>PICKS & BANS</h4>
    </header>
    <div class="champion-pb-body">
      ${championIconRow({
        label: "All champions",
        sublabel: "Champion list",
        items: champions
          .slice()
          .sort((a, b) => b.presence - a.presence || b.picks - a.picks || b.bans - a.bans || a.champion.localeCompare(b.champion, "ja"))
          .map((item) => ({ champion: item.champion, count: null, detailMode: "presence" })),
        championByName
      })}
      <div class="champion-pb-total">Total : ${formatInteger(champions.length)}</div>
      ${championIconRow({
        label: "Bans",
        sublabel: "Bans stats",
        items: champions
          .filter((item) => item.bans > 0)
          .sort((a, b) => b.bans - a.bans || b.presence - a.presence || a.champion.localeCompare(b.champion, "ja"))
          .map((item) => ({ champion: item.champion, count: item.bans, detailMode: "ban" })),
        championByName
      })}
      ${roleRows.map((role) => championIconRow({
        label: championRoleDisplay(role),
        sublabel: "",
        items: championRolePickItems(rows, role, championByName),
        championByName
      })).join("")}
    </div>
  `;
  panel.querySelectorAll("[data-champion-pb]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = championByName.get(button.dataset.championPb);
      if (item) openChampionDetail(item, button.dataset.championTitle || "PICKS & BANS", button.dataset.championMode || "presence");
    });
  });
  return panel;
}

function championIconRow({ label, sublabel, items, championByName }) {
  return `
    <div class="champion-pb-row">
      <div class="champion-pb-label">
        <strong>${label}</strong>
        ${sublabel ? `<span>${sublabel}</span>` : ""}
      </div>
      <div class="champion-pb-icons">
        ${items.length ? items.map((item) => {
          const champion = championByName.get(item.champion);
          const title = champion
            ? `${item.champion}\nPicks: ${champion.picks}\nBans: ${champion.bans}\nWinrate: ${champion.picks ? percent(champion.wins / champion.picks) : "-"}`
            : item.champion;
          return `
            <button class="champion-pb-icon" type="button" data-champion-pb="${escapeAttr(item.champion)}" data-champion-mode="${escapeAttr(item.detailMode || "pick")}" data-champion-title="${escapeAttr(label)}" title="${escapeAttr(title)}" aria-label="${escapeAttr(item.champion)}の詳細を表示">
              ${champIcon(item.champion)}
              ${item.count == null ? "" : `<small>${formatInteger(item.count)}</small>`}
            </button>
          `;
        }).join("") : `<span class="muted">該当データなし</span>`}
      </div>
    </div>
  `;
}

function championRolePickItems(rows, role, championByName) {
  const counts = new Map();
  rows
    .filter((row) => row.type === "PICK" && row.role === role && championByName.has(row.champion))
    .forEach((row) => counts.set(row.champion, (counts.get(row.champion) || 0) + 1));
  return [...counts.entries()]
    .map(([champion, count]) => ({ champion, count, detailMode: "pick" }))
    .sort((a, b) => b.count - a.count || a.champion.localeCompare(b.champion, "ja"));
}

function championRoleDisplay(role) {
  return {
    TOP: "TOP",
    JG: "JUNGLE",
    MID: "MID",
    ADC: "BOT",
    SUP: "SUPPORT"
  }[role] || role;
}

function openChampionDetail(item, title, mode) {
  trackAnalyticsEvent("champion_detail_open", {
    champion: item.champion || "",
    detail_title: title || "",
    detail_mode: mode || "",
    source_view: state.view
  });
  elements.dialogMeta.textContent = `Champion / ${title}`;
  elements.dialogTitle.textContent = item.champion;
  const roles = selectedChampionRoles();
  const wins = competitivePlayerMatches().filter((row) => row.champion === item.champion && row.result === "WIN" && roles.includes(row.role));
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
    <div class="player-detail-metrics champion-detail-metrics">
      ${playerMetric("Pick率", rateWithCount(item.picks, item.matchCount))}
      ${playerMetric("BAN率", rateWithCount(item.bans, item.matchCount))}
      ${playerMetric("P/B率", rateWithCount(item.presence, item.matchCount))}
      ${playerMetric("勝率", item.picks ? rateWithCount(item.wins, item.picks) : "-")}
    </div>
    ${championDetailRows("勝利した使用者", wins, true)}
    ${mode === "ban" || mode === "presence" ? `<p class="muted">BANは現在の元データにBANしたチーム・選手情報がないため、件数のみ表示しています。BAN数: ${item.bans}</p>` : ""}
  `;
  elements.dialogBody.replaceChildren(body);
  if (!elements.dialog.open) elements.dialog.showModal();
  resetDialogScroll();
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

function openChampionStatsDetail(item, tiers, roles) {
  trackAnalyticsEvent("champion_detail_open", {
    champion: item.champion || "",
    detail_title: "Champion Stats",
    detail_mode: "stats",
    tiers: tiers.join(","),
    roles: roles.join(","),
    source_view: state.view
  });
  const rows = competitivePlayerMatches()
    .filter((row) => row.champion === item.champion)
    .filter((row) => tiers.includes(row.tier))
    .filter((row) => roles.includes(row.role))
    .sort((a, b) => {
      const left = scrimResults.find((match) => match.id === a.matchId);
      const right = scrimResults.find((match) => match.id === b.matchId);
      return String(left?.date || "").localeCompare(String(right?.date || ""))
        || String(left?.match || "").localeCompare(String(right?.match || ""), "ja", { numeric: true })
        || String(a.name).localeCompare(String(b.name), "ja");
    });
  elements.dialogMeta.textContent = `Champion Stats / ${(item.roles || []).join(" / ") || "ALL"}`;
  elements.dialogTitle.textContent = item.champion;

  const body = document.createElement("section");
  body.className = "champion-detail champion-stats-detail";
  body.innerHTML = `
    <div class="champion-detail-head">
      ${champIcon(item.champion)}
      <div>
        <strong>${item.champion}</strong>
        <span>Pick ${formatInteger(item.picks)} / Ban ${formatInteger(item.bans)} / 勝率 ${item.picks ? rateWithCount(item.wins, item.picks) : "-"}</span>
      </div>
    </div>
    <div class="player-detail-metrics champion-detail-metrics">
      ${playerMetric("Pick", formatInteger(item.picks))}
      ${playerMetric("Ban", formatInteger(item.bans))}
      ${playerMetric("P/B", formatInteger(item.presence))}
      ${playerMetric("登場率", rateWithCount(item.presence, item.matchCount))}
      ${playerMetric("勝率", item.picks ? rateWithCount(item.wins, item.picks) : "-")}
      ${playerMetric("KDA", item.matches ? formatDecimal(item.kda) : "-")}
      ${playerMetric("DPM", item.dpm == null ? "-" : formatDecimal(item.dpm))}
      ${playerMetric("CS@15", item.avgCs15 == null ? "-" : formatInteger(item.avgCs15))}
    </div>
    ${championUserSummary(rows)}
    ${championOpponentSummary(rows)}
    ${championMatchLog(rows)}
  `;
  elements.dialogBody.replaceChildren(body);
  if (!elements.dialog.open) elements.dialog.showModal();
  resetDialogScroll();
}

function championUserSummary(rows) {
  if (!rows.length) return `<section class="player-detail-section"><h3>使用者</h3><p class="muted">該当データなし</p></section>`;
  const users = new Map();
  rows.forEach((row) => {
    const key = `${row.team}__${row.name}__${row.role}`;
    if (!users.has(key)) users.set(key, { name: row.name, team: row.team, role: row.role, matches: 0, wins: 0 });
    const item = users.get(key);
    item.matches += 1;
    item.wins += row.result === "WIN" ? 1 : 0;
  });
  return `
    <section class="player-detail-section">
      <h3>使用者</h3>
      <div class="champion-detail-list">
        ${[...users.values()].sort((a, b) => b.matches - a.matches || b.wins - a.wins).map((user) => `
          <article>
            ${playerIcon(user.name)}
            <div>
              <strong>${user.name}</strong>
              <span>${teamLogo(user.team, "ranking-team-logo")}${teamFullName(user.team)} / ${user.role}</span>
            </div>
            <b>${user.wins}-${user.matches - user.wins}</b>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function championOpponentSummary(rows) {
  if (!rows.length) return `<section class="player-detail-section"><h3>対面別成績</h3><p class="muted">該当データなし</p></section>`;
  const opponents = new Map();
  rows.forEach((row) => {
    const opponent = opponentLaneRow(row);
    const name = opponent?.champion || "不明";
    if (!opponents.has(name)) opponents.set(name, { champion: name, matches: 0, wins: 0 });
    const item = opponents.get(name);
    item.matches += 1;
    item.wins += row.result === "WIN" ? 1 : 0;
  });
  const items = [...opponents.values()].sort((a, b) => b.matches - a.matches || b.wins / b.matches - a.wins / a.matches || a.champion.localeCompare(b.champion, "ja"));
  return `
    <section class="player-detail-section">
      <h3>対面別成績</h3>
      <div class="player-detail-table-wrap">
        <table class="player-detail-table champion-opponent-table">
          <thead>
            <tr>
              <th>Opponent</th>
              <th>Games</th>
              <th>W-L</th>
              <th>Win%</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item) => `
              <tr>
                <td><span class="game-champion">${item.champion === "不明" ? "" : champIcon(item.champion)}<span>${item.champion}</span></span></td>
                <td>${formatInteger(item.matches)}</td>
                <td>${item.wins}-${item.matches - item.wins}</td>
                <td>${percent(item.wins / item.matches)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function championMatchLog(rows) {
  if (!rows.length) return `<section class="player-detail-section"><h3>試合ログ</h3><p class="muted">該当データなし</p></section>`;
  return `
    <section class="player-detail-section">
      <h3>試合ログ</h3>
      <div class="player-detail-table-wrap">
        <table class="player-detail-table champion-log-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Player</th>
              <th>Team</th>
              <th>Role</th>
              <th>Match</th>
              <th>Result</th>
              <th>KDA</th>
              <th>DPM</th>
              <th>CS@15</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => {
              const match = scrimResults.find((result) => result.id === row.matchId);
              const minutes = matchDurationMinutes(row.matchId);
              return `
                <tr>
                  <td>${shortDate(match?.date || row.date)}</td>
                  <td>${playerMiniLabel(row)}</td>
                  <td>${playerTeamLabel(row.team)}</td>
                  <td>${row.role}</td>
                  <td>${playerMatchLabel(row, match)}</td>
                  <td>${row.result}</td>
                  <td>${row.kills}/${row.deaths}/${row.assists}</td>
                  <td>${minutes ? formatDecimal(row.damage / minutes) : "-"}</td>
                  <td>${Number.isFinite(row.cs15) && row.cs15 > 0 ? formatInteger(row.cs15) : "-"}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function playerMiniLabel(row) {
  return `
    <span class="player-match-label player-mini-label">
      ${playerIcon(row.name)}
      <span>${row.name}</span>
    </span>
  `;
}

function playerTeamLabel(teamKey) {
  return `<span class="player-match-label player-team-label">${teamLogo(teamKey, "ranking-team-logo")}<span>${teamShortName(teamKey)}</span></span>`;
}

function buildPlayerStats() {
  const map = new Map();
  const resultById = new Map(scrimResults.map((row) => [row.id, row]));
  competitivePlayerMatches().forEach((row) => {
    const key = row.name;
    if (!map.has(key)) {
      map.set(key, { name: row.name, team: row.team, tier: row.tier, role: row.role, matches: 0, wins: 0, mvp: 0, kills: 0, deaths: 0, assists: 0, damage: 0, dpmDamage: 0, dpmMinutes: 0, cs15: 0, cs15Matches: 0, gold: 0, maxDamageGame: 0, maxKillsGame: 0, champions: new Set() });
    }
    const item = map.get(key);
    item.matches += 1;
    item.wins += row.result === "WIN" ? 1 : 0;
    item.mvp += resultById.get(row.matchId)?.mvp === row.name ? 1 : 0;
    item.kills += row.kills;
    item.deaths += row.deaths;
    item.assists += row.assists;
    item.damage += row.damage;
    const minutes = matchDurationMinutes(row.matchId);
    if (minutes) {
      item.dpmDamage += row.damage;
      item.dpmMinutes += minutes;
    }
    if (Number.isFinite(row.cs15) && row.cs15 > 0) {
      item.cs15 += row.cs15;
      item.cs15Matches += 1;
    }
    item.maxDamageGame = Math.max(item.maxDamageGame, row.damage || 0);
    item.maxKillsGame = Math.max(item.maxKillsGame, row.kills || 0);
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
    dpm: item.dpmMinutes ? item.dpmDamage / item.dpmMinutes : null,
    avgCs15: item.cs15Matches ? item.cs15 / item.cs15Matches : null,
    avgGold: item.gold / item.matches,
    championCount: item.champions.size,
    champions: [...item.champions].join(" / ")
  }));
}

function buildChampionStats() {
  const picks = competitivePlayerMatches()
    .filter((row) => !isNoBanChampion(row.champion))
    .map((row) => ({ matchId: row.matchId, tier: row.tier, champion: row.champion, type: "PICK", win: row.result === "WIN", role: row.role }));
  const bans = competitiveBpRows()
    .filter((row) => row.type === "BAN" && !isNoBanChampion(row.champion))
    .map((row) => ({ matchId: row.matchId, tier: row.tier, champion: row.champion, type: "BAN", win: false, role: "" }));
  return [...picks, ...bans];
}

function isNoBanChampion(champion) {
  const key = String(champion || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[\s_\-・ー]/g, "");
  return ["NOBAN", "BANなし", "BAN無し", "バンなし", "バン無し", "なし", "無し"].includes(key);
}

function mergeChampionStats(rows) {
  const map = new Map();
  const matchCount = new Set(rows.map((row) => row.matchId).filter(Boolean)).size || 1;
  rows.forEach((row) => {
    if (!row.champion) return;
    if (!map.has(row.champion)) {
      map.set(row.champion, { champion: row.champion, tiers: new Set(), roles: new Set(), picks: 0, bans: 0, wins: 0, presenceMatches: new Set() });
    }
    const item = map.get(row.champion);
    item.tiers.add(row.tier);
    if (row.role) item.roles.add(row.role);
    if (row.type === "PICK") item.picks += 1;
    if (row.type === "BAN") item.bans += 1;
    if (row.win) item.wins += 1;
    if (row.matchId) item.presenceMatches.add(row.matchId);
  });
  return [...map.values()].map((item) => ({
    ...item,
    tiers: [...item.tiers],
    roles: [...item.roles],
    presence: item.presenceMatches.size,
    matchCount,
    pickRate: item.picks / matchCount,
    banRate: item.bans / matchCount,
    presenceRate: item.presenceMatches.size / matchCount,
    winRate: item.picks ? item.wins / item.picks : 0
  }))
    .sort((a, b) => (b.picks + b.bans) - (a.picks + a.bans) || b.picks - a.picks);
}

function championPerformanceStats(tiers, roles) {
  const map = new Map();
  competitivePlayerMatches()
    .filter((row) => tiers.includes(row.tier))
    .filter((row) => roles.includes(row.role))
    .filter((row) => !isNoBanChampion(row.champion))
    .filter((row) => filterByKeyword([row], (item) => `${item.champion} ${item.name} ${teamFullName(item.team)} ${item.role}`)[0])
    .forEach((row) => {
      if (!map.has(row.champion)) {
        map.set(row.champion, {
          matches: 0,
          kills: 0,
          deaths: 0,
          assists: 0,
          dpmDamage: 0,
          dpmMinutes: 0,
          cs15: 0,
          cs15Matches: 0,
          users: new Set()
        });
      }
      const item = map.get(row.champion);
      item.matches += 1;
      item.kills += row.kills;
      item.deaths += row.deaths;
      item.assists += row.assists;
      item.users.add(`${row.team}__${row.name}`);
      const minutes = matchDurationMinutes(row.matchId);
      if (minutes) {
        item.dpmDamage += row.damage;
        item.dpmMinutes += minutes;
      }
      if (Number.isFinite(row.cs15) && row.cs15 > 0) {
        item.cs15 += row.cs15;
        item.cs15Matches += 1;
      }
    });
  return new Map([...map.entries()].map(([champion, item]) => [champion, {
    matches: item.matches,
    kda: item.deaths === 0 ? item.kills + item.assists : (item.kills + item.assists) / item.deaths,
    avgKills: item.kills / item.matches,
    avgDeaths: item.deaths / item.matches,
    avgAssists: item.assists / item.matches,
    dpm: item.dpmMinutes ? item.dpmDamage / item.dpmMinutes : null,
    avgCs15: item.cs15Matches ? item.cs15 / item.cs15Matches : null,
    userCount: item.users.size
  }]));
}

function filterCalendarItems() {
  return allCalendarItems().filter((item) => {
    if (state.type && item.type !== state.type) return false;
    if (state.tier && !item.tier.includes(state.tier)) return false;
    if (state.team && !itemIncludesTeam(item, state.team)) return false;
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

function itemIncludesTeam(item, teamKey) {
  if (!teamKey) return true;
  return item?.left === teamKey
    || item?.right === teamKey
    || item?.winner === teamKey
    || item?.loser === teamKey
    || item?.leftLabel === teamKey
    || item?.rightLabel === teamKey;
}

function isScrimCalendarItem(item) {
  const text = [item.type, item.matchName, item.match, item.stage]
    .filter(Boolean)
    .join(" ");
  return text.includes("スクリム");
}

function isScrimLikeItem(item) {
  const text = String(item?.matchType || item?.type || "");
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
    || item?.matchName === "対視聴者";
}

function competitiveScrimResults() {
  return scrimResults.filter((row) => !isViewerScrim(row));
}

function leagueScrimResults() {
  return scrimResults.filter((row) => row.left && row.right && row.winner);
}

function competitivePlayerMatches() {
  return playerMatches.filter((row) => row.name && row.team !== VIEWER_TEAM_KEY && (!state.team || row.team === state.team) && matchPassesGlobalFilters(row.matchId));
}

function matchDurationMinutes(matchId) {
  const match = scrimResults.find((row) => row.id === matchId);
  return parseMatchDurationMinutes(match?.time);
}

function parseMatchDurationMinutes(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 1 ? value * 24 * 60 : value;
  }
  const raw = String(value).trim();
  if (!raw || raw.toUpperCase() === "REMAKE") return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return numeric > 0 && numeric < 1 ? numeric * 24 * 60 : numeric;
  }
  const parts = raw.split(":").map((part) => Number(part));
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2) return parts[0] + parts[1] / 60;

  const [first, second, third] = parts;
  if (third === 0 && first >= 10) return first + second / 60;
  if (first === 0) return second + third / 60;
  return first * 60 + second + third / 60;
}

function competitiveBpRows() {
  return bpRows.filter((row) => row.team !== VIEWER_TEAM_KEY && (!state.team || row.team === state.team) && matchPassesGlobalFilters(row.matchId));
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

function selectedChampionRoles() {
  const roles = [...document.querySelectorAll("[name='champRole']:checked")].map((input) => input.value);
  return roles.length ? roles : ROLE_ORDER;
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
  if (!team) return dialogTextTeamBlock(teamKey, tier);
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

function shortNewsDate(value) {
  if (!value) return "";
  const raw = String(value).trim().replace(/\//g, "-");
  const date = new Date(raw.includes("T") ? raw : `${raw.split(" ")[0]}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatClipDateParts(value) {
  if (!value) return { date: "", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  const dateLabel = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric"
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
  return { date: dateLabel, time: timeLabel };
}

function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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
  return formatInteger(value);
}

function formatInteger(value) {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(Math.trunc(Number(value) || 0));
}

function formatSignedInteger(value) {
  const number = Math.trunc(Number(value) || 0);
  return `${number > 0 ? "+" : ""}${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(number)}`;
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














