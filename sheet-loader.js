const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzjVYyvZ-x_LMo4Jl3261MRbAuBXrt7ZtgtzTAKT_mcU0bHVK7LiPKR13TdEgi30xY/exec";

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
  const playerRows = sheets["サイト_試合プレイヤー実績"] || [];
  const bpSourceRows = sheets["サイト_BP実績"] || [];
  const championRows = sheets["チャンピオンアイコン"] || [];
  const lookup = buildTeamLookup(teamRows);
  const teams = buildTeams(teamRows);

  return {
    teams,
    schedules: buildSchedules(scheduleRows),
    scrimResults: buildScrimResults(resultRows, teamRows, lookup),
    participants: buildParticipants(profileRows, teamRows, lookup),
    playerMatches: buildPlayerMatchesStable(playerRows, teamRows, lookup),
    bpRows: buildBpRows(bpSourceRows),
    championIcons: buildChampionIcons(championRows)
  };
}

export async function loadLiveStreams(options = {}) {
  const url = new URL(GAS_WEB_APP_URL);
  url.searchParams.set("api", "live");
  url.searchParams.set("_", Date.now().toString());
  if (options.refresh) url.searchParams.set("refresh", "1");

  const payload = await fetchJsonp(url);
  if (!payload.ok) throw new Error(payload.error || "live-api: invalid payload");
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

export function twitchLoginFromUrl(value) {
  const raw = clean(value);
  if (!raw) return "";
  const match = raw.match(/twitch\.tv\/([^/?#]+)/i);
  if (match) return match[1].replace(/^@/, "").toLowerCase();
  return raw.replace(/^@/, "").toLowerCase();
}

async function fetchSiteSheets(options = {}) {
  const url = new URL(GAS_WEB_APP_URL);
  url.searchParams.set("api", "site");
  url.searchParams.set("_", Date.now().toString());
  if (options.refresh) url.searchParams.set("refresh", "1");

  const payload = await fetchJsonp(url);
  if (!payload.ok || !payload.sheets) throw new Error("site-api: invalid payload");
  return payload.sheets;
}

function fetchJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `__ltkdbSiteData_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("site-api: timeout"));
    }, 15000);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("site-api: script load failed"));
    };

    url.searchParams.set("callback", callbackName);
    script.src = url.toString();
    document.head.append(script);
  });
}

function buildTeams(rows) {
  return Object.fromEntries(
    rows
      .filter((row) => clean(row.team_key))
      .map((row) => {
        const key = clean(row.team_key);
        return [
          key,
          {
            key,
            name: TEAM_NAMES[key] || compactTeamName(row.team_name),
            fullName: compactTeamName(row.team_name),
            accent: clean(row.accent) || "#64748b",
            mark: key,
            logo: TEAM_LOGOS[key] || ""
          }
        ];
      })
  );
}

function buildSchedules(rows) {
  return rows
    .filter((row) => clean(row.schedule_id))
    .map((row) => {
      const right = clean(row.right_team_key);
      return {
        id: clean(row.schedule_id),
        date: dateValue(row.event_date),
        eventTime: eventTimeValue(row.event_time),
        matchName: clean(row.match_name) || clean(row.schedule_id),
        displayTitle: clean(row.display_title),
        day: clean(row.day_label),
        match: clean(row.match_no),
        type: clean(row.match_type),
        stage: clean(row.stage) || "GROUP",
        tier: tierValue(row.tier),
        left: clean(row.left_team_key),
        right: isViewerTeamName(right) ? VIEWER_TEAM_KEY : right,
        blue: clean(row.blue_team_key),
        red: clean(row.red_team_key),
        status: clean(row.status) || "scheduled",
        linkedResultIds: clean(row.linked_result_ids)
          .split(/[,\n、，]+/u)
          .map((item) => item.trim())
          .filter(Boolean)
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

function buildPlayerMatchesStable(rows, teamRows, lookup) {
  const keys = inferPlayerMatchKeys(rows);
  if (!keys.matchId) return [];
  return rows
    .map((row) => {
      const rawTeam = row[keys.team];
      return {
        matchId: clean(row[keys.matchId]),
        team: isViewerTeamName(rawTeam) ? VIEWER_TEAM_KEY : resolveTeam(rawTeam, teamRows, lookup),
        tier: tierFrom(rawTeam),
        role: clean(row[keys.role]).toUpperCase(),
        name: clean(row[keys.name]),
        summoner: clean(row[keys.summoner]),
        champion: clean(row[keys.champion]),
        result: clean(row[keys.result]).toUpperCase(),
        kills: numberValue(row.K ?? row[keys.kills]),
        deaths: numberValue(row.D ?? row[keys.deaths]),
        assists: numberValue(row.A ?? row[keys.assists]),
        damage: numberValue(row[keys.damage]),
        cs15: numberValue(row[keys.cs15]),
        gold: numberValue(row[keys.gold])
      };
    })
    .filter((row) => row.matchId && row.team && (row.name || row.summoner || row.champion));
}

function inferPlayerMatchKeys(rows) {
  const sample = rows.find((row) => {
    const keys = Object.keys(row);
    return keys.length >= 16 && row.K !== undefined && row.D !== undefined && row.A !== undefined;
  }) || rows.find((row) => Object.keys(row).length >= 12) || {};
  const keys = Object.keys(sample);
  const damageKey = keys.find((key, index) => index > 13 && numberValue(sample[key]) >= 1000) || keys[15];
  const damageIndex = keys.indexOf(damageKey);
  return {
    matchId: keys[0],
    team: keys[3],
    result: keys[5],
    role: keys[6],
    name: keys[7],
    summoner: keys[8],
    champion: keys[9],
    kills: keys.find((key) => key === "K") || keys[11],
    deaths: keys.find((key) => key === "D") || keys[12],
    assists: keys.find((key) => key === "A") || keys[13],
    damage: damageKey,
    cs15: keys[damageIndex + 1],
    gold: keys[keys.length - 1]
  };
}

function buildScrimResults(rows, teamRows, lookup) {
  return rows
    .filter((row) => clean(row["試合ID"]))
    .map((row) => {
      const left = resolveTeam(row["チーム1名"], teamRows, lookup);
      const rawRight = row["チーム2名"];
      const rawWinner = row["勝利チーム"];
      const right = resolveTeam(rawRight, teamRows, lookup);
      const winner = resolveTeam(rawWinner, teamRows, lookup);
      const viewerMatch = !left || !right || !winner || isViewerTeamName(row["チーム1名"]) || isViewerTeamName(rawRight) || isViewerTeamName(rawWinner);
      return {
        id: clean(row["試合ID"]),
        date: dateValue(row["試合日"]),
        matchName: viewerMatch ? "対視聴者" : "スクリム",
        day: "RESULT",
        match: `G${clean(row["試合番号"])}`,
        type: viewerMatch ? "対視聴者" : "スクリム結果",
        stage: "RESULT",
        tier: tierFrom(row["チーム1名"], row["チーム2名"]),
        left,
        right: viewerMatch && !right ? VIEWER_TEAM_KEY : right,
        leftLabel: compactTeamName(row["チーム1名"]),
        rightLabel: compactTeamName(row["チーム2名"]),
        winner: viewerMatch && !winner && isViewerTeamName(rawWinner) ? VIEWER_TEAM_KEY : winner,
        time: timeValue(row["試合時間"]),
        leftKda: clean(row["チーム1KDA"]),
        rightKda: clean(row["チーム2KDA"]),
        leftGold: numberValue(row["チーム1ゴールド"]),
        rightGold: numberValue(row["チーム2ゴールド"]),
        carry: clean(row["最大ダメージ選手"]),
        maxDamage: numberValue(row["最大ダメージ"]),
        status: "completed",
        viewerMatch
      };
    });
}

function buildPlayerMatchesLoose(rows, teamRows, lookup) {
  return rows
    .map((row) => {
      const rawTeam = row["繝√・繝蜷・"];
      return {
        matchId: clean(row["隧ｦ蜷・D"]),
        team: isViewerTeamName(rawTeam) ? VIEWER_TEAM_KEY : resolveTeam(rawTeam, teamRows, lookup),
        tier: tierFrom(rawTeam),
        role: clean(row["繝ｭ繝ｼ繝ｫ"]).toUpperCase(),
        name: clean(row["繝励Ξ繧､繝､繝ｼ蜷・"]),
        summoner: clean(row["繧ｵ繝｢繝翫・繝阪・繝"]),
        champion: clean(row["繝√Ε繝ｳ繝斐が繝ｳ蜷・"]),
        result: clean(row["蜍晄風"]).toUpperCase(),
        kills: numberValue(row.K),
        deaths: numberValue(row.D),
        assists: numberValue(row.A),
        damage: numberValue(row["繝繝｡繝ｼ繧ｸ"]),
        cs15: numberValue(row["15蛻・S"]),
        gold: numberValue(row["繧ｴ繝ｼ繝ｫ繝・"])
      };
    })
    .filter((row) => row.matchId && (row.name || row.summoner || row.champion));
}

function buildPlayerMatches(rows, teamRows, lookup) {
  return rows
    .filter((row) => clean(row["試合ID"]) && clean(row["プレイヤー名"]))
    .map((row) => {
      const rawTeam = row["チーム名"];
      return {
        matchId: clean(row["試合ID"]),
        team: isViewerTeamName(rawTeam) ? VIEWER_TEAM_KEY : resolveTeam(rawTeam, teamRows, lookup),
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

function buildBpRows(rows) {
  return rows
    .filter((row) => clean(row["種別"]).toUpperCase() === "BAN")
    .map((row) => {
      const rawTeam = row["チーム名"];
      return {
        matchId: clean(row["試合ID"]),
        team: isViewerTeamName(rawTeam) ? VIEWER_TEAM_KEY : "",
        tier: tierFrom(rawTeam),
        champion: clean(row["BAN/PICK集計用名"]) || clean(row["チャンピオン名"]),
        type: "BAN"
      };
    })
    .filter((row) => row.champion);
}

function buildChampionIcons(rows) {
  const icons = {};
  rows.forEach((row) => {
    const champion = clean(row.Champion) || clean(row["チャンピオン名"]) || clean(row["チャンピオン"]);
    const icon = clean(row.iconURL) || clean(row.iconUrl) || clean(row.IconURL) || clean(row["アイコンURL"]) || clean(row.URL);
    if (champion && icon) icons[champion] = icon;
  });
  if (!icons["スカーナー"] && icons["スキルダー"]) icons["スカーナー"] = icons["スキルダー"];
  if (!icons["ユナラ"]) icons["ユナラ"] = "https://ddragon.leagueoflegends.com/cdn/15.13.1/img/champion/Yunara.png";
  return icons;
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
  const raw = clean(value);
  return raw.includes("視聴者") || raw.includes("リスナー") || /^チーム\d+/u.test(compactTeamName(raw));
}

function compactTeamName(value) {
  return clean(value).replace(/^[^\p{L}\p{N}\u3040-\u30ff\u3400-\u9fff]+/u, "").trim();
}

function clean(value) {
  return String(value ?? "").trim();
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

function numberValue(value) {
  const raw = clean(value).replace(/,/g, "");
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
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
