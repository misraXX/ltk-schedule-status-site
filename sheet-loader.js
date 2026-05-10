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
  const teamRows = sheets["繧ｵ繧､繝・繝√・繝繝槭せ繧ｿ"] || [];
  const scheduleRows = sheets["繧ｵ繧､繝・莠亥ｮ・] || [];
  const profileRows = sheets["繧ｵ繧､繝・驕ｸ謇九・繝ｭ繝輔ぅ繝ｼ繝ｫ"] || [];
  const resultRows = sheets["蟇ｾ謌ｦ邨先棡縺ｾ縺ｨ繧・] || [];
  const playerRows = sheets["繝ｪ繧ｶ繝ｫ繝郁ｩｳ邏ｰ"] || sheets["繧ｵ繧､繝・隧ｦ蜷医・繝ｬ繧､繝､繝ｼ螳溽ｸｾ"] || [];
  const bpSourceRows = sheets["BP隧ｳ邏ｰ"] || sheets["繧ｵ繧､繝・BP螳溽ｸｾ"] || [];
  const championRows = sheets["繝√Ε繝ｳ繝斐が繝ｳ繧｢繧､繧ｳ繝ｳ"] || [];
  const lookup = buildTeamLookup(teamRows);
  const teams = buildTeams(teamRows);

  return {
    teams,
    schedules: buildSchedules(scheduleRows),
    scrimResults: buildScrimResults(resultRows, teamRows, lookup),
    participants: buildParticipants(profileRows, teamRows, lookup),
    playerMatches: buildPlayerMatchesStable(playerRows, teamRows, lookup),
    bpRows: buildBpRows(bpSourceRows, teamRows, lookup),
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
          .split(/[,\n縲・ｼ珪+/u)
          .map((item) => item.trim())
          .filter(Boolean)
      };
    });
}

function buildParticipants(rows, teamRows, lookup) {
  return rows
    .map((row) => ({
      team: resolveTeam(row["繝√・繝蜷・], teamRows, lookup),
      tier: tierValue(row["髫守ｴ・]),
      role: clean(row["繝ｭ繝ｼ繝ｫ"]).toUpperCase(),
      name: clean(row["蜷榊燕"]),
      org: clean(row["謇螻・]),
      x: clean(row["X URL"]),
      youtube: clean(row["YouTube繝√Ε繝ｳ繝阪Ν"]),
      twitch: clean(row["Twitch繝√Ε繝ｳ繝阪Ν"]),
      icon: clean(row["繧｢繧､繧ｳ繝ｳ"])
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
  const cs15Key = keys.find((key) => clean(key).includes("15") && clean(key).toUpperCase().includes("CS"));
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
    cs15: cs15Key || keys[damageIndex + 3] || keys[damageIndex + 2] || keys[damageIndex + 1],
    gold: keys[keys.length - 1]
  };
}

function buildScrimResults(rows, teamRows, lookup) {
  return rows
    .filter((row) => clean(row["隧ｦ蜷・D"]))
    .map((row) => {
      const rawLeft = row["繝√・繝1蜷・"];
      const left = resolveTeam(rawLeft, teamRows, lookup);
      const rawRight = row["繝√・繝2蜷・];
      const rawWinner = row["蜍晏茜繝√・繝"];
      const right = resolveTeam(rawRight, teamRows, lookup);
      const winner = resolveTeam(rawWinner, teamRows, lookup);
      const viewerMatch = isViewerTeamName(rawLeft) || isViewerTeamName(rawRight) || isViewerTeamName(rawWinner);
      return {
        id: clean(row["隧ｦ蜷・D"]),
        date: dateValue(row["隧ｦ蜷域律"]),
        matchName: viewerMatch ? "蟇ｾ隕冶・閠・ : "繧ｹ繧ｯ繝ｪ繝",
        day: "RESULT",
        match: `G${clean(row["隧ｦ蜷育分蜿ｷ"])}`,
        type: viewerMatch ? "蟇ｾ隕冶・閠・ : "繧ｹ繧ｯ繝ｪ繝邨先棡",
        stage: "RESULT",
        tier: tierFrom(row["繝√・繝1蜷・], row["繝√・繝2蜷・]),
        left: isViewerTeamName(rawLeft) ? VIEWER_TEAM_KEY : left || compactTeamName(rawLeft),
        right: isViewerTeamName(rawRight) ? VIEWER_TEAM_KEY : right || compactTeamName(rawRight),
        leftLabel: compactTeamName(row["繝√・繝1蜷・]),
        rightLabel: compactTeamName(row["繝√・繝2蜷・]),
        winner: isViewerTeamName(rawWinner) ? VIEWER_TEAM_KEY : winner || compactTeamName(rawWinner),
        time: timeValue(row["隧ｦ蜷域凾髢・]),
        leftKda: clean(row["繝√・繝1KDA"]),
        rightKda: clean(row["繝√・繝2KDA"]),
        leftGold: numberValue(row["繝√・繝1繧ｴ繝ｼ繝ｫ繝・]),
        rightGold: numberValue(row["繝√・繝2繧ｴ繝ｼ繝ｫ繝・]),
        carry: clean(row["譛螟ｧ繝繝｡繝ｼ繧ｸ驕ｸ謇・]),
        maxDamage: numberValue(row["譛螟ｧ繝繝｡繝ｼ繧ｸ"]),
        eventId: clean(rowValue(row, 19)),
        matchKind: clean(rowValue(row, 20)),
        resultImageUrl: clean(rowValue(row, 17)),
        bpImageUrl: clean(rowValue(row, 21)),
        minute15ImageUrl: clean(rowValue(row, 22)),
        videoUrl: clean(rowValue(row, 23)),
        banMemo: clean(rowValue(row, 24)),
        status: "completed",
        viewerMatch
      };
    });
}

function rowValue(row, index) {
  const keys = Object.keys(row);
  return keys[index] === undefined ? "" : row[keys[index]];
}

function buildPlayerMatchesLoose(rows, teamRows, lookup) {
  return rows
    .map((row) => {
      const rawTeam = row["郢昶・繝ｻ郢晢｣ｰ陷ｷ繝ｻ"];
      return {
        matchId: clean(row["髫ｧ・ｦ陷ｷ繝ｻD"]),
        team: isViewerTeamName(rawTeam) ? VIEWER_TEAM_KEY : resolveTeam(rawTeam, teamRows, lookup),
        tier: tierFrom(rawTeam),
        role: clean(row["郢晢ｽｭ郢晢ｽｼ郢晢ｽｫ"]).toUpperCase(),
        name: clean(row["郢晏干ﾎ樒ｹｧ・､郢晢ｽ､郢晢ｽｼ陷ｷ繝ｻ"]),
        summoner: clean(row["郢ｧ・ｵ郢晢ｽ｢郢晉ｿｫ繝ｻ郢晞亂繝ｻ郢晢｣ｰ"]),
        champion: clean(row["郢昶・ﾎ慕ｹ晢ｽｳ郢晄鱒縺檎ｹ晢ｽｳ陷ｷ繝ｻ"]),
        result: clean(row["陷肴刋鬚ｨ"]).toUpperCase(),
        kills: numberValue(row.K),
        deaths: numberValue(row.D),
        assists: numberValue(row.A),
        damage: numberValue(row["郢敖郢晢ｽ｡郢晢ｽｼ郢ｧ・ｸ"]),
        cs15: numberValue(row["15陋ｻ繝ｻS"]),
        gold: numberValue(row["郢ｧ・ｴ郢晢ｽｼ郢晢ｽｫ郢昴・"])
      };
    })
    .filter((row) => row.matchId && (row.name || row.summoner || row.champion));
}

function buildPlayerMatches(rows, teamRows, lookup) {
  return rows
    .filter((row) => clean(row["隧ｦ蜷・D"]) && clean(row["繝励Ξ繧､繝､繝ｼ蜷・]))
    .map((row) => {
      const rawTeam = row["繝√・繝蜷・];
      return {
        matchId: clean(row["隧ｦ蜷・D"]),
        team: isViewerTeamName(rawTeam) ? VIEWER_TEAM_KEY : resolveTeam(rawTeam, teamRows, lookup),
        tier: tierFrom(rawTeam),
        role: clean(row["繝ｭ繝ｼ繝ｫ"]).toUpperCase(),
        name: clean(row["繝励Ξ繧､繝､繝ｼ蜷・]),
        summoner: clean(row["繧ｵ繝｢繝翫・繝阪・繝"]),
        champion: clean(row["繝√Ε繝ｳ繝斐が繝ｳ蜷・]),
        result: clean(row["蜍晄風"]).toUpperCase(),
        kills: numberValue(row.K),
        deaths: numberValue(row.D),
        assists: numberValue(row.A),
        damage: numberValue(row["繝繝｡繝ｼ繧ｸ"]),
        cs15: numberValue(row["15蛻・S"]),
        gold: numberValue(row["繧ｴ繝ｼ繝ｫ繝・])
      };
    });
}

function buildBpRows(rows, teamRows, lookup) {
  return rows
    .map((row) => {
      const keys = Object.keys(row);
      const rawTeam = row["繝√・繝蜷・] ?? row[keys[3]];
      const type = clean(row["遞ｮ蛻･"] ?? row[keys[5]]).toUpperCase();
      return {
        matchId: clean(row["隧ｦ蜷・D"] ?? row[keys[0]]),
        team: isViewerTeamName(rawTeam) ? VIEWER_TEAM_KEY : resolveTeam(rawTeam, teamRows, lookup),
        side: clean(row["繧ｵ繧､繝・] ?? row[keys[4]]).toUpperCase(),
        tier: tierFrom(rawTeam),
        type,
        bpOrder: numberValue(row["BP鬆・] ?? row[keys[6]]),
        phase: clean(row["繝輔ぉ繝ｼ繧ｺ"] ?? row[keys[7]]),
        role: clean(row["繝ｭ繝ｼ繝ｫ"] ?? row[keys[8]]).toUpperCase(),
        champion: clean(row["BAN/PICK髮・ｨ育畑蜷・] ?? row[keys[12]]) || clean(row["繝√Ε繝ｳ繝斐が繝ｳ蜷・] ?? row[keys[11]])
      };
    })
    .filter((row) => row.matchId && row.champion && !isNoBanChampion(row.champion) && (row.type === "BAN" || row.type === "PICK"));
}

function buildChampionIcons(rows) {
  const icons = {};
  rows.forEach((row) => {
    const champion = clean(row.Champion) || clean(row["繝√Ε繝ｳ繝斐が繝ｳ蜷・]) || clean(row["繝√Ε繝ｳ繝斐が繝ｳ"]);
    const icon = clean(row.iconURL) || clean(row.iconUrl) || clean(row.IconURL) || clean(row["繧｢繧､繧ｳ繝ｳURL"]) || clean(row.URL);
    if (champion && icon) icons[champion] = icon;
  });
  if (!icons["繧ｹ繧ｫ繝ｼ繝翫・"] && icons["繧ｹ繧ｭ繝ｫ繝繝ｼ"]) icons["繧ｹ繧ｫ繝ｼ繝翫・"] = icons["繧ｹ繧ｭ繝ｫ繝繝ｼ"];
  if (!icons["繝ｦ繝翫Λ"]) icons["繝ｦ繝翫Λ"] = "https://ddragon.leagueoflegends.com/cdn/15.13.1/img/champion/Yunara.png";
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
  return raw.includes("隕冶・閠・) || raw.includes("繝ｪ繧ｹ繝翫・") || /^繝√・繝\d+/u.test(compactTeamName(raw));
}

function compactTeamName(value) {
  return clean(value).replace(/^[^\p{L}\p{N}\u3040-\u30ff\u3400-\u9fff]+/u, "").trim();
}

function clean(value) {
  return String(value ?? "").trim();
}

function isNoBanChampion(value) {
  const key = clean(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s_\-繝ｻ繝ｼ]/g, "");
  return ["NOBAN", "BAN縺ｪ縺・, "BAN辟｡縺・, "繝舌Φ縺ｪ縺・, "繝舌Φ辟｡縺・, "縺ｪ縺・, "辟｡縺・].includes(key);
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
