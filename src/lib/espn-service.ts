import { getLeagueById, LeagueConfig } from './espn-config';
import {
  EventSummaryDetail,
  NewsArticle,
  NormalizedEvent,
  StandingEntry,
  StandingGroup,
  TeamCompetitor,
} from './types';

const SITE_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const V2_API_BASE = 'https://site.api.espn.com/apis/v2/sports';

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

function mapCompetitor(comp: any, index: number): TeamCompetitor {
  const team = comp.team || {};
  const athlete = comp.athlete || {};
  const isAthlete = !comp.team && !!comp.athlete;

  const logo =
    team.logo ||
    team.logos?.[0]?.href ||
    athlete.flag?.href ||
    athlete.headshot?.href ||
    '';

  const name =
    team.displayName ||
    team.name ||
    athlete.displayName ||
    athlete.fullName ||
    'TBD';

  const shortName =
    team.shortDisplayName ||
    team.name ||
    athlete.shortName ||
    athlete.displayName ||
    name;

  const abbreviation =
    team.abbreviation ||
    athlete.abbreviation ||
    shortName.slice(0, 3).toUpperCase();

  const recordObj = comp.records?.[0] || comp.record?.[0];
  const record =
    typeof recordObj === 'string'
      ? recordObj
      : recordObj?.summary || recordObj?.displayValue || undefined;

  const linescores = Array.isArray(comp.linescores)
    ? comp.linescores.map((ls: any) =>
        ls.displayValue !== undefined
          ? String(ls.displayValue)
          : ls.value !== undefined
          ? String(ls.value)
          : '-'
      )
    : undefined;

  let resolvedScore = '';
  if (comp.score !== undefined && comp.score !== null) {
    resolvedScore =
      typeof comp.score === 'object'
        ? String(comp.score.displayValue ?? comp.score.value ?? '0')
        : String(comp.score);
  } else if (Array.isArray(comp.linescores) && comp.linescores.length > 0) {
    // Tennis: calculate sets won from linescores[].winner
    const hasSetWinnerFlag = comp.linescores.some(
      (ls: any) => typeof ls.winner === 'boolean'
    );
    if (hasSetWinnerFlag) {
      const setsWon = comp.linescores.filter(
        (ls: any) => ls.winner === true
      ).length;
      resolvedScore = String(setsWon);
    } else {
      resolvedScore = String(
        comp.linescores[comp.linescores.length - 1]?.value ?? '0'
      );
    }
  }

  const leaders: TeamCompetitor['leaders'] = [];
  if (Array.isArray(comp.leaders)) {
    for (const l of comp.leaders.slice(0, 3)) {
      const top = l.leaders?.[0];
      if (top) {
        leaders.push({
          category: l.shortDisplayName || l.displayName || l.name || '',
          displayValue: top.displayValue || '',
          athleteName:
            top.athlete?.shortName || top.athlete?.displayName || '',
          athleteHeadshot: top.athlete?.headshot?.href,
        });
      }
    }
  }

  const statistics: TeamCompetitor['statistics'] = [];
  if (Array.isArray(comp.statistics)) {
    for (const s of comp.statistics.slice(0, 6)) {
      statistics.push({
        name: s.name || '',
        label: s.abbreviation || s.shortDisplayName || s.name || '',
        displayValue: s.displayValue || String(s.value ?? ''),
      });
    }
  }

  const rank =
    comp.curatedRank?.current && comp.curatedRank.current < 99
      ? comp.curatedRank.current
      : undefined;

  return {
    id: String(comp.id || team.id || athlete.id || index),
    name,
    shortName,
    abbreviation,
    logo,
    color: team.color ? `#${team.color}` : undefined,
    score: resolvedScore,
    winner: Boolean(comp.winner),
    homeAway:
      comp.homeAway === 'home' || comp.homeAway === 'away'
        ? comp.homeAway
        : index === 0
        ? 'away'
        : 'home',
    record,
    rank,
    linescores,
    leaders: leaders.length > 0 ? leaders : undefined,
    statistics: statistics.length > 0 ? statistics : undefined,
    order: comp.order ?? index + 1,
  };
}

/**
 * 统一「两个参赛方」的展示顺序，避免列表页与详情页左右对调。
 *  - 足球：主队在前（传统排法，ScoreCard 的胜平负也按左=主队渲染）
 *  - 其他项目：客队在前（ESPN / 北美习惯）
 */
function orderPairForDisplay(
  competitors: TeamCompetitor[],
  leagueCfg: LeagueConfig
): TeamCompetitor[] {
  if (competitors.length !== 2) return competitors;
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  if (!home || !away) return competitors;
  return leagueCfg.category === 'soccer' ? [home, away] : [away, home];
}

function normalizeCompetitionToEvent(
  rawEvent: any,
  competition: any,
  leagueCfg: LeagueConfig,
  groupLabel?: string
): NormalizedEvent {
  const statusObj = competition?.status || rawEvent?.status || {};
  const statusType = statusObj?.type || {};

  const rawCompetitors = Array.isArray(competition?.competitors)
    ? competition.competitors
    : [];

  const isMultiCompetitor =
    leagueCfg.category === 'racing' || rawCompetitors.length > 2;

  let competitors = rawCompetitors.map((c: any, idx: number) =>
    mapCompetitor(c, idx)
  );

  if (isMultiCompetitor) {
    competitors = competitors
      .sort((a: TeamCompetitor, b: TeamCompetitor) => (a.order ?? 99) - (b.order ?? 99))
      .slice(0, 10);
  } else {
    competitors = orderPairForDisplay(competitors, leagueCfg);
  }

  const broadcasts: string[] = [];
  if (Array.isArray(competition?.broadcasts)) {
    for (const b of competition.broadcasts) {
      if (Array.isArray(b.names)) {
        broadcasts.push(...b.names);
      }
    }
  }

  const note =
    competition?.notes?.[0]?.headline ||
    groupLabel ||
    rawEvent?.season?.slug?.replace(/-/g, ' ') ||
    undefined;

  const headlines = Array.isArray(competition?.headlines)
    ? competition.headlines.map((h: any) => ({
        description: h.description || h.shortLinkText || '',
        shortLinkText: h.shortLinkText,
      }))
    : undefined;

  const eventState: 'pre' | 'in' | 'post' =
    statusType.state === 'in' ||
    statusType.state === 'post' ||
    statusType.state === 'pre'
      ? statusType.state
      : 'pre';

  return {
    id: String(competition?.id || rawEvent?.id),
    uid: rawEvent?.uid,
    date: competition?.date || rawEvent?.date || new Date().toISOString(),
    name: rawEvent?.name || competition?.name || leagueCfg.name,
    shortName: rawEvent?.shortName || rawEvent?.name || leagueCfg.shortName,
    leagueId: leagueCfg.id,
    leagueName: leagueCfg.shortName,
    sport: leagueCfg.sport,
    status: {
      state: eventState,
      completed: Boolean(statusType.completed),
      detail: statusType.detail || statusType.description || '未开始',
      shortDetail:
        statusType.shortDetail || statusType.detail || statusType.description || '未开始',
      displayClock: statusObj.displayClock,
      period: statusObj.period,
    },
    venue: competition?.venue
      ? {
          fullName: competition.venue.fullName || '',
          city: competition.venue.address?.city,
          country: competition.venue.address?.country,
        }
      : undefined,
    broadcasts: Array.from(new Set(broadcasts)).slice(0, 3),
    note,
    isMultiCompetitor,
    competitors,
    headlines,
  };
}

export async function fetchLeagueScoreboard(
  leagueId: string,
  dateParam?: string
): Promise<{
  league: LeagueConfig;
  seasonLabel?: string;
  events: NormalizedEvent[];
  activeDate?: string;
  fetchedAt: string;
}> {
  const leagueCfg = getLeagueById(leagueId);
  const query = dateParam ? `?dates=${encodeURIComponent(dateParam)}` : '';
  const url = `${SITE_API_BASE}/${leagueCfg.sport}/${leagueCfg.league}/scoreboard${query}`;

  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`ESPN Scoreboard API returned ${res.status}`);
  }

  const data = await res.json();
  const rawEvents = Array.isArray(data?.events) ? data.events : [];
  const normalizedEvents: NormalizedEvent[] = [];

  for (const ev of rawEvents) {
    // Tennis events often store competitions inside groupings[]
    if (Array.isArray(ev.groupings) && ev.groupings.length > 0) {
      for (const grp of ev.groupings) {
        const grpLabel =
          grp.grouping?.displayName || ev.name || leagueCfg.shortName;
        const comps = Array.isArray(grp.competitions) ? grp.competitions : [];
        for (const comp of comps.slice(0, 20)) {
          if (Array.isArray(comp.competitors) && comp.competitors.length >= 2) {
            const evNorm = normalizeCompetitionToEvent(
              ev,
              comp,
              leagueCfg,
              grpLabel
            );
            const allTbd = evNorm.competitors.every(
              (c) => c.name === 'TBD' || c.shortName === 'TBD'
            );
            if (!allTbd) {
              normalizedEvents.push(evNorm);
            }
          }
        }
      }
    } else if (Array.isArray(ev.competitions) && ev.competitions.length > 0) {
      // For F1, the race/qualifying is usually the latest or main competition
      if (leagueCfg.category === 'racing') {
        for (const comp of ev.competitions) {
          if (Array.isArray(comp.competitors) && comp.competitors.length > 0) {
            const compType = comp.type?.abbreviation || comp.type?.text || '';
            normalizedEvents.push(
              normalizeCompetitionToEvent(
                ev,
                comp,
                leagueCfg,
                `${ev.name} ${compType}`.trim()
              )
            );
          }
        }
      } else {
        normalizedEvents.push(
          normalizeCompetitionToEvent(ev, ev.competitions[0], leagueCfg)
        );
      }
    }
  }

  // Sort: live ('in') first, then upcoming ('pre'), then finished ('post')
  const statePriority: Record<string, number> = { in: 0, pre: 1, post: 2 };
  normalizedEvents.sort((a, b) => {
    const pa = statePriority[a.status.state] ?? 1;
    const pb = statePriority[b.status.state] ?? 1;
    if (pa !== pb) return pa - pb;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  const seasonLabel =
    data?.leagues?.[0]?.season?.displayName ||
    data?.season?.slug ||
    undefined;

  const activeDate =
    data?.day?.date ||
    normalizedEvents[0]?.date?.slice(0, 10) ||
    undefined;

  return {
    league: leagueCfg,
    seasonLabel,
    events: normalizedEvents,
    activeDate,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchLeagueNews(
  leagueId: string,
  limit = 16
): Promise<NewsArticle[]> {
  const leagueCfg = getLeagueById(leagueId);
  const url = `${SITE_API_BASE}/${leagueCfg.sport}/${leagueCfg.league}/news?limit=${limit}`;

  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    return [];
  }

  const data = await res.json();
  const rawArticles = Array.isArray(data?.articles) ? data.articles : [];

  return rawArticles.map((art: any, idx: number): NewsArticle => {
    const img = art.images?.[0];
    const cats = Array.isArray(art.categories)
      ? art.categories
          .map((c: any) => c.description || c.Team?.description || '')
          .filter(Boolean)
          .slice(0, 3)
      : [];

    return {
      id: String(art.id || art.dataSourceIdentifier || idx),
      headline: art.headline || 'ESPN 体育快讯',
      description: art.description || '',
      published: art.published || new Date().toISOString(),
      imageUrl: img?.url,
      imageCaption: img?.caption || img?.alt,
      externalUrl: art.links?.web?.href || art.links?.mobile?.href,
      categories: cats,
      byline: art.byline,
    };
  });
}

export async function fetchLeagueStandings(
  leagueId: string
): Promise<StandingGroup[]> {
  const leagueCfg = getLeagueById(leagueId);
  if (!leagueCfg.supportsStandings) {
    return [];
  }

  const url = `${V2_API_BASE}/${leagueCfg.sport}/${leagueCfg.league}/standings`;
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    cache: 'no-store',
  });

  if (!res.ok) {
    return [];
  }

  const data = await res.json();
  const groups: StandingGroup[] = [];

  // Preferred stat columns per sport category
  const desiredStatsByCategory: Record<
    string,
    { key: string; label: string; title: string }[]
  > = {
    basketball: [
      { key: 'wins', label: '胜', title: '胜场 (Wins)' },
      { key: 'losses', label: '负', title: '负场 (Losses)' },
      { key: 'winPercent', label: '胜率', title: '胜率 (PCT)' },
      { key: 'gamesBehind', label: '胜差', title: '胜差 (GB)' },
      { key: 'streak', label: '连胜/负', title: '近期状态 (Streak)' },
      { key: 'avgPointsFor', label: '场均得分', title: '场均得分 (PPG)' },
      { key: 'avgPointsAgainst', label: '场均失分', title: '场均失分 (OPPG)' },
    ],
    soccer: [
      { key: 'gamesPlayed', label: '赛', title: '已赛场次 (GP)' },
      { key: 'wins', label: '胜', title: '胜 (W)' },
      { key: 'ties', label: '平', title: '平 (D)' },
      { key: 'losses', label: '负', title: '负 (L)' },
      { key: 'pointsFor', label: '进', title: '进球 (GF)' },
      { key: 'pointsAgainst', label: '失', title: '失球 (GA)' },
      { key: 'pointDifferential', label: '净', title: '净胜球 (GD)' },
      { key: 'points', label: '积分', title: '积分 (PTS)' },
    ],
    football: [
      { key: 'wins', label: '胜', title: '胜 (W)' },
      { key: 'losses', label: '负', title: '负 (L)' },
      { key: 'ties', label: '平', title: '平 (T)' },
      { key: 'winPercent', label: '胜率', title: '胜率 (PCT)' },
      { key: 'pointsFor', label: '得分', title: '总得分 (PF)' },
      { key: 'pointsAgainst', label: '失分', title: '总失分 (PA)' },
      { key: 'streak', label: '走势', title: '近期走势 (STRK)' },
    ],
    baseball: [
      { key: 'wins', label: '胜', title: '胜 (W)' },
      { key: 'losses', label: '负', title: '负 (L)' },
      { key: 'winPercent', label: '胜率', title: '胜率 (PCT)' },
      { key: 'gamesBehind', label: '胜差', title: '胜差 (GB)' },
      { key: 'pointDifferential', label: '净胜分', title: '得失分差 (DIFF)' },
      { key: 'streak', label: '走势', title: '近期走势 (STRK)' },
    ],
    hockey: [
      { key: 'gamesPlayed', label: '赛', title: '场次 (GP)' },
      { key: 'wins', label: '胜', title: '胜 (W)' },
      { key: 'losses', label: '负', title: '负 (L)' },
      { key: 'otLosses', label: '加时负', title: '加时负 (OTL)' },
      { key: 'points', label: '积分', title: '积分 (PTS)' },
      { key: 'pointDifferential', label: '净胜', title: '净胜球 (DIFF)' },
    ],
    racing: [
      { key: 'championshipPts', label: '积分', title: '车手积分 (PTS)' },
      { key: 'wins', label: '分站冠军', title: '分站冠军数 (W)' },
      { key: 'top5', label: '前五', title: '前五完赛' },
      { key: 'top10', label: '前十', title: '前十完赛' },
    ],
  };

  const defaultHeaders =
    desiredStatsByCategory[leagueCfg.category] ||
    desiredStatsByCategory.basketball;

  function parseGroupNode(node: any, fallbackName: string) {
    if (node?.standings?.entries && Array.isArray(node.standings.entries)) {
      const rawEntries = node.standings.entries;
      const entries: StandingEntry[] = rawEntries.map(
        (entry: any, idx: number) => {
          const team = entry.team || entry.athlete || {};
          const statsMap: Record<string, string> = {};
          let rankVal = idx + 1;

          if (Array.isArray(entry.stats)) {
            for (const st of entry.stats) {
              if (st.name) {
                statsMap[st.name] =
                  st.displayValue !== undefined
                    ? String(st.displayValue)
                    : String(st.value ?? '-');
              }
              if (st.abbreviation) {
                statsMap[st.abbreviation] =
                  st.displayValue !== undefined
                    ? String(st.displayValue)
                    : String(st.value ?? '-');
              }
              if (
                (st.name === 'playoffSeed' || st.name === 'rank') &&
                typeof st.value === 'number' &&
                st.value > 0
              ) {
                rankVal = st.value;
              }
            }
          }

          return {
            rank: rankVal,
            teamId: String(team.id || idx),
            teamName:
              team.displayName || team.name || team.shortDisplayName || 'Team',
            teamShortName:
              team.shortDisplayName || team.name || team.displayName || 'Team',
            abbreviation:
              team.abbreviation ||
              (team.shortDisplayName || 'TM').slice(0, 3).toUpperCase(),
            logo:
              team.logos?.[0]?.href ||
              team.flag?.href ||
              team.headshot?.href ||
              '',
            noteColor: entry.note?.color,
            noteDescription: entry.note?.description,
            stats: statsMap,
          };
        }
      );

      // Sort by rank or wins/points
      entries.sort((a, b) => a.rank - b.rank);

      groups.push({
        name: node.name || node.abbreviation || fallbackName,
        abbreviation: node.abbreviation,
        headers: defaultHeaders,
        entries: entries.map((e, i) => ({ ...e, rank: i + 1 })),
      });
    }

    if (Array.isArray(node?.children)) {
      for (const child of node.children) {
        parseGroupNode(child, child.name || fallbackName);
      }
    }
  }

  parseGroupNode(data, leagueCfg.shortName);
  return groups;
}

export async function fetchEventSummary(
  leagueId: string,
  eventId: string
): Promise<EventSummaryDetail> {
  const leagueCfg = getLeagueById(leagueId);
  const url = `${SITE_API_BASE}/${leagueCfg.sport}/${leagueCfg.league}/summary?event=${encodeURIComponent(
    eventId
  )}`;

  let data: any = null;
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      cache: 'no-store',
    });
    if (res.ok) {
      data = await res.json();
    }
  } catch {
    data = null;
  }

  const headerComp = data?.header?.competitions?.[0];
  const rawCompetitors = Array.isArray(headerComp?.competitors)
    ? headerComp.competitors
    : [];

  let competitors: TeamCompetitor[] = rawCompetitors.map(
    (c: any, idx: number) => mapCompetitor(c, idx)
  );

  // 与记分牌保持同一顺序，否则从列表点进详情会出现主客队左右互换
  if (!(leagueCfg.category === 'racing' || competitors.length > 2)) {
    competitors = orderPairForDisplay(competitors, leagueCfg);
  }

  let statusObj = headerComp?.status?.type;
  let matchName =
    data?.header?.competitions?.[0]?.name || leagueCfg.name;
  let matchShortName = leagueCfg.shortName;
  let isMultiCompetitor =
    leagueCfg.category === 'racing' || competitors.length > 2;

  // Fallback to scoreboard if summary has no competitors (e.g. ATP Tennis / F1)
  if (competitors.length === 0) {
    try {
      const sb = await fetchLeagueScoreboard(leagueId);
      const found = sb.events.find((e) => e.id === eventId);
      if (found) {
        competitors = found.competitors;
        matchName = found.name;
        matchShortName = found.shortName;
        isMultiCompetitor = Boolean(found.isMultiCompetitor);
        statusObj = {
          state: found.status.state,
          completed: found.status.completed,
          detail: found.status.detail,
          shortDetail: found.status.shortDetail,
        };
      }
    } catch {
      // ignore fallback error
    }
  }

  // Determine linescore headers
  const maxPeriods = Math.max(
    0,
    ...competitors.map((c) => c.linescores?.length || 0)
  );
  const linescoreHeaders: string[] = [];
  for (let i = 1; i <= maxPeriods; i++) {
    if (leagueCfg.category === 'basketball') {
      linescoreHeaders.push(i <= 4 ? `Q${i}` : `OT${i - 4}`);
    } else if (leagueCfg.category === 'football') {
      linescoreHeaders.push(i <= 4 ? `Q${i}` : `OT`);
    } else if (leagueCfg.category === 'hockey') {
      linescoreHeaders.push(i <= 3 ? `P${i}` : `OT`);
    } else if (leagueCfg.category === 'tennis') {
      linescoreHeaders.push(`S${i}`);
    } else {
      linescoreHeaders.push(`${i}`);
    }
  }

  // Team Stats Comparison
  const teamStats: EventSummaryDetail['teamStats'] = [];
  const boxTeams = Array.isArray(data?.boxscore?.teams)
    ? data.boxscore.teams
    : [];
  if (boxTeams.length === 2) {
    const statList = (team: any) =>
      Array.isArray(team?.statistics) ? team.statistics : [];
    const teamId = (team: any) => String(team?.team?.id ?? '');

    // 按 homeAway 精确对齐，而不是假设 boxscore.teams 一定是「客、主」顺序
    const homeComp = competitors.find((c) => c.homeAway === 'home');
    const awayComp = competitors.find((c) => c.homeAway === 'away');
    const homeBox = homeComp
      ? boxTeams.find((t: any) => teamId(t) === homeComp.id)
      : undefined;
    const awayBox = awayComp
      ? boxTeams.find((t: any) => teamId(t) === awayComp.id)
      : undefined;

    const stats0 = statList(awayBox || boxTeams[0]);
    const stats1 = statList(homeBox || boxTeams[1]);

    for (const s0 of stats0.slice(0, 14)) {
      const s1 = stats1.find((x: any) => x.name === s0.name || x.label === s0.label);
      if (s1) {
        const v0 = String(s0.displayValue ?? s0.value ?? '0');
        const v1 = String(s1.displayValue ?? s1.value ?? '0');
        const n0 = parseFloat(v0.replace(/[^0-9.-]/g, '')) || 0;
        const n1 = parseFloat(v1.replace(/[^0-9.-]/g, '')) || 0;
        const total = Math.abs(n0) + Math.abs(n1);
        const pct = total > 0 ? Math.round((Math.abs(n0) / total) * 100) : 50;

        teamStats.push({
          label: s0.label || s0.abbreviation || s0.name || '',
          awayValue: v0,
          homeValue: v1,
          homePercent: 100 - pct,
        });
      }
    }
  }

  // Player Boxscores
  const boxscoreGroups: EventSummaryDetail['boxscoreGroups'] = [];
  const boxPlayers = Array.isArray(data?.boxscore?.players)
    ? data.boxscore.players
    : [];

  for (const bp of boxPlayers) {
    const team = bp.team || {};
    const statBlock = bp.statistics?.[0];
    if (!statBlock) continue;

    const labels: string[] = Array.isArray(statBlock.labels)
      ? statBlock.labels
      : Array.isArray(statBlock.names)
      ? statBlock.names
      : [];

    const athletesRaw = Array.isArray(statBlock.athletes)
      ? statBlock.athletes
      : [];

    const players = athletesRaw.slice(0, 18).map((ath: any, idx: number) => ({
      id: String(ath.athlete?.id || idx),
      name: ath.athlete?.displayName || 'Player',
      shortName:
        ath.athlete?.shortName || ath.athlete?.displayName || 'Player',
      jersey: ath.athlete?.jersey,
      position: ath.athlete?.position?.abbreviation,
      starter: Boolean(ath.starter),
      headshot: ath.athlete?.headshot?.href,
      stats: Array.isArray(ath.stats) ? ath.stats.map(String) : [],
      didNotPlay: Boolean(ath.didNotPlay),
      reason: ath.reason,
    }));

    if (players.length > 0) {
      boxscoreGroups.push({
        teamName: team.displayName || team.name || 'Team',
        teamLogo: team.logo || team.logos?.[0]?.href || '',
        teamAbbrev: team.abbreviation || 'TM',
        statLabels: labels,
        players,
      });
    }
  }

  // Key Events / Scoring Plays / Commentary
  const keyEvents: EventSummaryDetail['keyEvents'] = [];
  const rawKeyEvents =
    data?.keyEvents ||
    data?.scoringPlays ||
    data?.commentary?.slice(-25) ||
    data?.plays?.slice(-30) ||
    [];

  if (Array.isArray(rawKeyEvents)) {
    for (const ke of rawKeyEvents.slice(-30).reverse()) {
      const text = ke.text || ke.shortText || ke.headline || '';
      if (!text) continue;
      keyEvents.push({
        id: String(ke.id || Math.random()),
        clock: ke.clock?.displayValue || ke.time?.displayValue || '',
        period:
          ke.period?.displayValue ||
          (ke.period?.number ? `第${ke.period.number}节/段` : ''),
        type: ke.type?.text || (ke.scoringPlay ? '得分' : '事件'),
        text,
        teamLogo: ke.team?.logo || ke.team?.logos?.[0]?.href,
        scoringPlay: Boolean(ke.scoringPlay),
        scoreValue:
          ke.awayScore !== undefined && ke.homeScore !== undefined
            ? `${ke.awayScore} - ${ke.homeScore}`
            : undefined,
      });
    }
  }

  const resolvedState: 'pre' | 'in' | 'post' =
    statusObj?.state === 'in' ||
    statusObj?.state === 'post' ||
    statusObj?.state === 'pre'
      ? statusObj.state
      : 'pre';

  return {
    eventId,
    leagueId: leagueCfg.id,
    leagueName: leagueCfg.shortName,
    sport: leagueCfg.sport,
    name: matchName,
    shortName: matchShortName,
    isMultiCompetitor,
    status: statusObj
      ? {
          state: resolvedState,
          completed: Boolean(statusObj.completed),
          detail: statusObj.detail || statusObj.description || '',
          shortDetail:
            statusObj.shortDetail ||
            statusObj.detail ||
            statusObj.description ||
            '',
        }
      : undefined,
    header: {
      venue:
        data?.gameInfo?.venue?.fullName ||
        headerComp?.venue?.fullName ||
        undefined,
      attendance: data?.gameInfo?.attendance,
      statusDetail:
        statusObj?.detail ||
        statusObj?.description,
      note: headerComp?.notes?.[0]?.headline,
    },
    linescoreHeaders,
    competitors,
    teamStats,
    boxscoreGroups,
    keyEvents,
    CommentaryOrPlays: [],
  };
}
