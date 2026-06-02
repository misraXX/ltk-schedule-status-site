const STATIC_SITE_DATA_URL = "./site-data.json";
const STATIC_LIVE_DATA_URL = "./live-data.json";
const SITE_DATA_REFRESH_MS = 5 * 60 * 1000;
const SITE_DATA_CACHE_KEY = "ltkdb.siteData.v1";
const LIVE_CACHE_KEY = "ltkdb.liveData.v1";

const TEAM_LOGOS = {
  DD: "./image/dd_emblem.png",
  CC: "./image/cc_emblem.png",
  IT: "./image/it_emblem.png",
  LR: "./image/lr_emblem.png"
};

const TEAM_NAMES = {
  DD: "Dahlia Diadem",
  CC: "Camellia Crown",
  IT: "Iris Tiara",
  LR: "Laurel Regalia"
};

const VIEWER_TEAM_KEY = "__LISTENER__";

export async function loadSiteData(options = {}) {
  const sheets = await fetchSiteSheets(options);
  const teamRows = sheets["サイト_チームマスタ"] || [];
  const scheduleRows = sheets["サイト_予定"] || [];
  const profileRows = sheets["サイト_選手プロフィール"] || [];
  const resultRows = sheets["対戦結果まとめ"] || [];
  const playerRows = sheets["リザルト詳細"] || sheets["サイト_試合プレイヤー実績"] || [];
  const bpSourceRows = sheets["BP詳細"] || sheets["サイト_BP実績"] || [];
  const championRows = sheets["チャンピオンアイコン"] || [];
  const clipRows = sheets["切り抜き動画"] || sheets["クリップ"] || [];
  const twitchClipRows = sheets["Twitchクリップ一覧"] || [];
  const newsRows = sheets["サイト_NEWS"] || [];
  const lookup = buildTeamLookup(teamRows);

  return {
    teams: buildTeams(teamRows),
    schedules: buildSchedules(scheduleRows),
    scrimResults: buildScrimResults(resultRows, teamRows, lookup),
    participants: buildParticipants(profileRows, teamRows, lookup),
    playerMatches: buildPlayerMatches(playerRows, teamRows, lookup),
    bpRows: buildBpRows(bpSourceRows, teamRows, lookup),
    championIcons: buildChampionIcons(championRows),
    clipVideos: buildClipVideos(clipRows, teamRows, lookup),
    twitchClips: buildTwitchClips(twitchClipRows, teamRows, lookup),
    siteNews: buildSiteNews(newsRows, teamRows, lookup)
  };
}

export async function loadLiveStreams(options = {}) {
  try {
    const url = new URL(STATIC_LIVE_DATA_URL, window.location.href);
    url.searchParams.set("_", String(Math.floor(Date.now() / SITE_DATA_REFRESH_MS)));
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(`live-data: ${response.status}`);
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || "live-data: invalid payload");
    const liveData = normalizeLivePayload(payload);
    writeCache(LIVE_CACHE_KEY, liveData);
    return liveData;
  } catch (error) {
    const cached = readCache(LIVE_CACHE_KEY);
    if (cached) return cached;
    throw error;
  }
}

export function twitchLoginFromUrl(value) {
  const raw = clean(value);
  if (!raw) return "";
  const match = raw.match(/twitch\.tv\/([^/?#]+)/i);
  if (match) return match[1].replace(/^@/, "").toLowerCase();
  return raw.replace(/^@/, "").toLowerCase();
}

async function fetchSiteSheets(options = {}) {
  try {
    const url = new URL(STATIC_SITE_DATA_URL, window.location.href);
    url.searchParams.set("_", String(Math.floor(Date.now() / SITE_DATA_REFRESH_MS)));
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(`site-data: ${response.status}`);
    const payload = await response.json();
    if (!payload.ok || !payload.sheets) throw new Error("site-data: invalid payload");
    writeCache(SITE_DATA_CACHE_KEY, payload);
    return payload.sheets;
  } catch (error) {
    const cached = readCache(SITE_DATA_CACHE_KEY);
    if (cached?.sheets) return cached.sheets;
    throw error;
  }
}

function normalizeLivePayload(payload) {
  return {
    streams: (payload.streams || []).map((item) => ({
      name: clean(item.name),
      iconUrl: clean(item.iconUrl),
      teamName: clean(item.teamName),
      teamShortName: clean(item.teamShortName),
      teamKey: clean(item.teamKey),
      rank: tierValue(item.rank),
      role: clean(item.role).toUpperCase(),
      streamTitle: clean(item.streamTitle),
      streamUrl: clean(item.streamUrl),
      platform: clean(item.platform) || "twitch"
    })),
    updatedAt: clean(payload.updatedAt),
    configured: Boolean(payload.configured)
  };
}

function readCache(key, maxAgeMs = 0) {
  try {
    const raw = window.localStorage?.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (maxAgeMs && Date.now() - Number(cached.savedAt || 0) > maxAgeMs) return null;
    return cached.value || null;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    window.localStorage?.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    // Ignore storage failures; the live page can still render from the current response.
  }
}

function buildTeams(rows) {
  return Object.fromEntries(rows
    .filter((row) => clean(row.team_key))
    .map((row) => {
      const key = clean(row.team_key);
      return [key, {
        key,
        name: TEAM_NAMES[key] || compactTeamName(row.team_name),
        fullName: compactTeamName(row.team_name),
        accent: clean(row.accent) || "#64748b",
        mark: clean(row.logo_text) || key,
        logo: TEAM_LOGOS[key] || clean(row.logo_url)
      }];
    }));
}

function buildSchedules(rows) {
  return rows
    .filter((row) => clean(row.schedule_id))
    .map((row) => {
      const rawLeft = clean(row.left_team_key);
      const rawRight = clean(row.right_team_key);
      const matchType = clean(row.match_type);
      return {
        id: clean(row.schedule_id),
        date: dateValue(row.event_date),
        eventTime: eventTimeValue(row.event_time),
        matchName: clean(row.match_name) || clean(row.schedule_id),
        displayTitle: clean(row.display_title),
        day: clean(row.day_label),
        match: clean(row.match_no),
        type: matchType,
        matchType,
        stage: clean(row.stage) || "GROUP",
        tier: tierValue(row.tier),
        left: isViewerTeamName(rawLeft) ? VIEWER_TEAM_KEY : rawLeft,
        right: isViewerTeamName(rawRight) ? VIEWER_TEAM_KEY : rawRight,
        blue: clean(row.blue_team_key),
        red: clean(row.red_team_key),
        status: clean(row.status) || "scheduled",
        linkedResultIds: clean(row.linked_result_ids).split(/[,\n]+/).map((item) => item.trim()).filter(Boolean),
        viewerMatch: isViewerTeamName(rawLeft) || isViewerTeamName(rawRight)
      };
    });
}

function buildParticipants(rows, teamRows, lookup) {
  return rows
    .map((row) => ({
      team: resolveTeam(row["チーム名"], teamRows, lookup),
      tier: tierValue(row["階級"]),
      role: clean(row["ロール"]).toUpperCase(),
      name: clean(row["名前"]),
      org: clean(row["所属"]),
      x: clean(row["X URL"]),
      youtube: clean(row["YouTubeチャンネル"]),
      twitch: clean(row["Twitchチャンネル"]),
      icon: clean(row["アイコン"])
    }))
    .filter((row) => row.team && row.name);
}

function buildScrimResults(rows, teamRows, lookup) {
  return rows
    .filter((row) => clean(row["試合ID"]))
    .map((row) => {
      const rawLeft = row["チーム1名"];
      const rawRight = row["チーム2名"];
      const rawWinner = row["勝利チーム"];
      const left = resolveTeam(rawLeft, teamRows, lookup) || compactTeamName(rawLeft);
      const right = resolveTeam(rawRight, teamRows, lookup) || compactTeamName(rawRight);
      const winner = resolveTeam(rawWinner, teamRows, lookup) || compactTeamName(rawWinner);
      const viewerMatch = isViewerTeamName(rawLeft) || isViewerTeamName(rawRight) || isViewerTeamName(rawWinner);
      const matchKind = clean(row["スクリム/本番"]) || "スクリム";

      return {
        id: clean(row["試合ID"]),
        date: dateValue(row["試合日"]),
        matchName: viewerMatch ? "対視聴者" : matchKind,
        day: "RESULT",
        match: `G${clean(row["試合番号"])}`,
        type: viewerMatch ? "対視聴者" : `${matchKind}結果`,
        stage: "RESULT",
        tier: tierFrom(rawLeft, rawRight),
        left: isViewerTeamName(rawLeft) ? VIEWER_TEAM_KEY : left,
        right: isViewerTeamName(rawRight) ? VIEWER_TEAM_KEY : right,
        leftLabel: compactTeamName(rawLeft),
        rightLabel: compactTeamName(rawRight),
        winner: isViewerTeamName(rawWinner) ? VIEWER_TEAM_KEY : winner,
        time: timeValue(row["試合時間"]),
        leftKda: clean(row["チーム1KDA"]),
        rightKda: clean(row["チーム2KDA"]),
        leftGold: numberValue(row["チーム1ゴールド"]),
        rightGold: numberValue(row["チーム2ゴールド"]),
        goldDiff15: goldDiff15Value(row),
        carry: clean(row["最大ダメージ選手"]),
        maxDamage: numberValue(row["最大ダメージ"]),
        mvp: clean(row.MVP),
        eventId: clean(row["イベントID"]),
        matchKind,
        matchType: matchKind,
        resultImageUrl: clean(row["リザルト画像URL"]),
        bpImageUrl: clean(row["BP画像URL"]),
        minute15ImageUrl: clean(row["15分画像URL"]),
        videoUrl: clean(row["動画URL"]),
        banMemo: clean(row["BANメモ"]),
        status: "completed",
        viewerMatch
      };
    });
}

function buildPlayerMatches(rows, teamRows, lookup) {
  return rows
    .filter((row) => clean(row["試合ID"]) && (clean(row["プレイヤー名"]) || clean(row["サモナーネーム"]) || clean(row["チャンピオン名"])))
    .map((row) => {
      const rawTeam = row["チーム名"];
      return {
        matchId: clean(row["試合ID"]),
        team: isViewerTeamName(rawTeam) ? VIEWER_TEAM_KEY : resolveTeam(rawTeam, teamRows, lookup) || compactTeamName(rawTeam),
        tier: tierFrom(rawTeam),
        role: clean(row["ロール"]).toUpperCase(),
        name: clean(row["プレイヤー名"]),
        summoner: clean(row["サモナーネーム"]),
        champion: clean(row["チャンピオン名"]),
        result: clean(row["勝敗"]).toUpperCase(),
        kills: numberValue(row.K),
        deaths: numberValue(row.D),
        assists: numberValue(row.A),
        damage: numberValue(row["ダメージ"]),
        cs15: numberValue(row["15分CS"]),
        gold: numberValue(row["ゴールド"])
      };
    });
}

function buildBpRows(rows, teamRows, lookup) {
  return rows
    .map((row) => {
      const rawTeam = row["チーム名"];
      const type = clean(row["種別"]).toUpperCase();
      return {
        matchId: clean(row["試合ID"]),
        team: isViewerTeamName(rawTeam) ? VIEWER_TEAM_KEY : resolveTeam(rawTeam, teamRows, lookup) || compactTeamName(rawTeam),
        side: clean(row["サイド"]).toUpperCase(),
        tier: tierFrom(rawTeam),
        type,
        bpOrder: numberValue(row["BP順"]),
        phase: clean(row["フェーズ"]),
        role: clean(row["ロール"]).toUpperCase(),
        champion: clean(row["BAN/PICK集計用名"]) || clean(row["チャンピオン名"])
      };
    })
    .filter((row) => row.matchId && row.champion && !isNoBanChampion(row.champion) && (row.type === "BAN" || row.type === "PICK"));
}

function buildChampionIcons(rows) {
  const icons = {};
  rows.forEach((row) => {
    const champion = clean(row.Champion) || clean(row["チャンピオン名"]) || clean(row["チャンピオン"]);
    const icon = clean(row.iconURL) || clean(row.iconUrl) || clean(row.IconURL) || clean(row["アイコンURL"]) || clean(row.URL);
    if (champion && icon) icons[champion] = icon;
  });
  if (!icons["ユナラ"]) icons["ユナラ"] = "https://ddragon.leagueoflegends.com/cdn/15.13.1/img/champion/Yunara.png";
  return icons;
}

function buildClipVideos(rows, teamRows, lookup) {
  return rows
    .filter((row) => {
      const visible = clean(row["サイト表示"]) || clean(row.site_visible) || clean(row.visible);
      return !visible || truthyValue(visible);
    })
    .map((row) => {
      const teamKey = clean(row.team_key) || resolveTeam(row["チーム名"], teamRows, lookup);
      const publishedAt = dateTimeValue(
        row.published_at ||
        row["投稿日"] ||
        row["投稿日時"],
        row.publish_time ||
        row["投稿時間"]
      );
      return {
        videoId: clean(row.video_id) || youtubeVideoIdFromUrl(row.url || row["動画URL"]),
        title: clean(row.title) || clean(row["動画タイトル"]) || "無題の動画",
        url: clean(row.url) || clean(row["動画URL"]),
        thumbnail: clean(row.thumbnail) || clean(row.thumbnail_url) || clean(row["サムネイルURL"]),
        publishedAt,
        publishDate: dateValue(row.publish_date || row["投稿日"]),
        publishTime: eventTimeValue(row.publish_time || row["投稿時間"]),
        channelId: clean(row.channel_id) || clean(row["チャンネルID"]),
        channelTitle: clean(row.channel_title) || clean(row["チャンネル名"]),
        memberName: clean(row.member_name) || clean(row["メンバー名"]) || clean(row["名前"]),
        teamKey,
        tier: tierValue(row.tier || row["階級"]),
        role: clean(row.role || row["ロール"]).toUpperCase(),
        iconUrl: clean(row.icon_url) || clean(row["アイコン"]),
        youtubeUrl: clean(row.youtube_url) || clean(row["YouTubeチャンネル"]),
        videoType: clean(row.video_type) || clean(row["動画種別"]),
        related: truthyValue(row.related || row["LTK/LOL判定"]),
        siteVisible: truthyValue(row.site_visible || row["サイト表示"])
      };
    })
    .filter((item) => item.url && item.title)
    .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());
}

function buildTwitchClips(rows, teamRows, lookup) {
  return rows
    .filter((row) => clean(row["ステータス"]) === "掲載OK")
    .map((row) => {
      const teamKey = clean(row.team_key) || resolveTeam(row["チーム名"], teamRows, lookup);
      const createdAt = dateTimeValue(row.created_at || row["created_at"], "");
      return {
        source: "twitch",
        clipId: clean(row.clip_id),
        title: clean(row.title) || "Twitch Clip",
        thumbnailUrl: clean(row.thumbnail_url),
        url: clean(row.clip_url),
        embedUrl: clean(row.embed_url),
        broadcasterId: clean(row.broadcaster_id),
        broadcasterName: clean(row.broadcaster_name),
        creatorId: clean(row.creator_id),
        creatorName: clean(row.creator_name),
        videoId: clean(row.video_id),
        gameId: clean(row.game_id),
        language: clean(row.language),
        viewCount: numberValue(row.view_count),
        likeCount: numberValue(row.like_count || row["いいね数"]),
        createdAt,
        duration: numberValue(row.duration),
        relatedPlayerName: clean(row["関連選手名"]),
        teamKey,
        teamName: clean(row["チーム名"]),
        tier: tierValue(row["階級"]),
        role: clean(row["ロール"]).toUpperCase(),
        matchId: clean(row["関連試合ID"]),
        tags: clean(row["タグ"]),
        comment: clean(row["コメント"])
      };
    })
    .filter((item) => item.clipId && item.url)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
}

function buildSiteNews(rows, teamRows, lookup) {
  return rows
    .map((row) => {
      const createdAt = dateTimeValue(row.created_at || row["作成日時"], "");
      const newsDate = dateValue(row.news_date || row["日付"] || row.created_at || row["作成日時"]);
      const team = clean(row.team || row["チーム"]);
      return {
        id: clean(row.news_id),
        createdAt,
        newsDate,
        category: clean(row.category || row["カテゴリ"]),
        title: clean(row.title || row["タイトル"] || row["表示文"]),
        body: clean(row.body || row["本文"]),
        scheduleId: clean(row.related_schedule_id || row.schedule_id),
        matchId: clean(row.related_match_id || row["試合ID"]),
        tier: tierValue(row.tier || row["階級"]),
        team: resolveTeam(team, teamRows, lookup) || team,
        published: newsPublishedValue(row.is_published || row["公開"]),
        priority: numberValue(row.priority || row["優先度"])
      };
    })
    .filter((item) => item.title)
    .filter((item) => item.published !== false)
    .sort((a, b) => {
      const left = new Date(a.createdAt || a.newsDate || 0).getTime();
      const right = new Date(b.createdAt || b.newsDate || 0).getTime();
      if (left !== right) return right - left;
      return (b.priority || 0) - (a.priority || 0);
    });
}

function newsPublishedValue(value) {
  const raw = clean(value);
  if (!raw) return true;
  const normalized = raw.normalize("NFKC").toUpperCase();
  return !["FALSE", "0", "NO", "OFF", "非公開"].includes(normalized);
}

function buildTeamLookup(rows) {
  const lookup = {};
  rows.forEach((row) => {
    const key = clean(row.team_key);
    const fullName = clean(row.team_name);
    const compact = compactTeamName(fullName);
    if (!key) return;
    lookup[key] = key;
    lookup[clean(row.short_name)] = key;
    lookup[fullName] = key;
    lookup[compact] = key;
  });
  return lookup;
}

function resolveTeam(value, teamRows, lookup) {
  const raw = clean(value);
  if (lookup[raw]) return lookup[raw];
  const compact = compactTeamName(raw);
  if (lookup[compact]) return lookup[compact];

  for (const row of teamRows) {
    const key = clean(row.team_key);
    const fullName = clean(row.team_name);
    const compactName = compactTeamName(fullName);
    if ((fullName && raw.includes(fullName)) || (compactName && compact.includes(compactName))) return key;
  }

  return TEAM_LOGOS[raw] ? raw : "";
}

function isViewerTeamName(value) {
  const raw = clean(value).normalize("NFKC");
  return raw.includes("リスナー") || raw.includes("視聴者");
}

function compactTeamName(value) {
  return clean(value).replace(/^[^\p{L}\p{N}\u3040-\u30ff\u3400-\u9fff]+/u, "").trim();
}

function clean(value) {
  return String(value ?? "").trim();
}

function truthyValue(value) {
  const normalized = clean(value).normalize("NFKC").toUpperCase();
  if (!normalized) return false;
  return ["TRUE", "1", "YES", "ON", "表示", "対象"].includes(normalized);
}

function isNoBanChampion(value) {
  const key = clean(value).normalize("NFKC").toUpperCase().replace(/[\s_\-・ー]/g, "");
  return ["NOBAN", "BANなし", "BAN無し", "バンなし", "バン無し", "なし", "無し"].includes(key);
}

function dateValue(value) {
  const raw = clean(value).replace(/\//g, "-");
  return raw.includes(" ") ? raw.split(" ")[0] : raw;
}

function timeValue(value) {
  const raw = clean(value);
  return raw.match(/^\d{1,2}:\d{2}:00$/) ? raw.replace(/:00$/, "") : raw;
}

function eventTimeValue(value) {
  const raw = clean(value);
  if (!raw) return "";
  const clock = raw.match(/(?:^|[T\s])(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (clock) return `${clock[1].padStart(2, "0")}:${clock[2]}`;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric < 1) {
    const minutes = Math.round(numeric * 24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(parsed);
  }
  return "";
}

function dateTimeValue(dateInput, timeInput) {
  const date = dateValue(dateInput);
  const time = eventTimeValue(timeInput);
  if (date && time) return `${date}T${time}:00+09:00`;
  const raw = clean(dateInput);
  if (!raw) return "";
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return date;
}

function youtubeVideoIdFromUrl(value) {
  const raw = clean(value);
  if (!raw) return "";
  const match = raw.match(/(?:watch\?v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : "";
}

function numberValue(value) {
  const raw = clean(value).replace(/,/g, "");
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumberValue(value) {
  const raw = clean(value).replace(/,/g, "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function goldDiff15Value(row) {
  const leftGold15 = optionalNumberValue(row["チーム1ゴールド@15"]);
  const rightGold15 = optionalNumberValue(row["チーム2ゴールド@15"]);
  if (leftGold15 != null && rightGold15 != null) {
    return leftGold15 - rightGold15;
  }

  const explicitValue = optionalNumberValue(row["15分ゴールド優勢"]);
  if (explicitValue != null) return explicitValue;

  const explicitTextValue = goldDiff15TextValue(row["15分ゴールド優勢"]);
  if (explicitTextValue != null) return explicitTextValue;

  const key = Object.keys(row).find((name) => {
    const normalized = clean(name).normalize("NFKC").toLowerCase();
    const hasMinute15 = normalized.includes("15") || normalized.includes("@15");
    const hasGold = normalized.includes("gold") || normalized.includes("ゴールド");
    const hasDiff = normalized.includes("diff") || normalized.includes("差");
    return hasMinute15 && hasGold && hasDiff;
  });
  if (!key) return null;

  const keyedValue = optionalNumberValue(row[key]);
  if (keyedValue != null) return keyedValue;
  return goldDiff15TextValue(row[key]);
}

function goldDiff15TextValue(value) {
  const raw = clean(value).normalize("NFKC");
  if (!raw) return null;
  const match = raw.match(/[()]\s*([+\-±]?\s*\d+(?:\.\d+)?)\s*(k|K)?\s*[)]/);
  if (!match) return null;
  const normalized = match[1].replace(/\s/g, "");
  if (normalized.startsWith("±")) return 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * (match[2] ? 1000 : 1));
}

function tierValue(value) {
  return tierFrom(value);
}

function tierFrom(...values) {
  const raw = values.map(clean).join(" ").toUpperCase();
  if (raw.includes("MASTER")) return "MASTERS";
  if (raw.includes("CORE")) return "CORE";
  if (raw.includes("NEXT")) return "NEXT";
  return clean(values[0]).toUpperCase();
}
