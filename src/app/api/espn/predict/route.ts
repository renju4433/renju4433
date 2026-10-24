import { NextRequest, NextResponse } from 'next/server';
import { LEAGUES, getLeagueById } from '@/lib/espn-config';
import {
  fetchEventSummary,
  fetchLeagueScoreboard,
  fetchLeagueStandings,
} from '@/lib/espn-service';
import { GBDTPrediction, StandingGroup } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PYTHON_API_URL =
  process.env.PYTHON_PREDICTOR_URL || 'http://127.0.0.1:8001/predict/soccer';

const OBSERVE_URL =
  process.env.PYTHON_OBSERVE_URL || 'http://127.0.0.1:8001/observe';

/**
 * 预测一律走 Python 服务（完全 XGBoost：count:poisson + Dixon-Coles 低比分修正）。
 * 本地先启动：cd python && python soccer_predictor_api.py
 */
async function callPythonPredictor(
  body: unknown
): Promise<Record<string, GBDTPrediction>> {
  const res = await fetch(PYTHON_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Python predictor responded ${res.status}`);
  }

  const data = await res.json();
  return (data?.predictions || {}) as Record<string, GBDTPrediction>;
}

interface FinishedMatchPayload {
  eventId: string;
  leagueId: string;
  date: string;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
}

/**
 * 把已完赛的比赛推给 Python 端并入快照。
 *
 * 主路径是 Python 服务里的整点自动更新（每小时的 :00 主动拉 ESPN），
 * 这里只是兜底：用户刚好在整点之间打开页面时，不用等到下一个整点也能看到新结果。
 * Python 端按 eventId 全局去重且会跳过训练数据已覆盖的日期，所以重复推送是安全的。
 */
async function pushFinishedMatches(
  matches: FinishedMatchPayload[]
): Promise<void> {
  if (matches.length === 0) return;
  try {
    await fetch(OBSERVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matches }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // 增量更新失败不影响本次预测返回，下一轮请求会再推一次
  }
}

interface PythonStandingItem {
  rank: number;
  gamesPlayed: number;
  wins: number;
  ties: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifferential: number;
  points: number;
}

function convertStandingsForPython(
  groups: StandingGroup[]
): Record<string, PythonStandingItem> {
  const map: Record<string, PythonStandingItem> = {};
  for (const grp of groups) {
    for (const entry of grp.entries) {
      const wins = parseFloat(entry.stats.wins || entry.stats.W || '0') || 0;
      const ties = parseFloat(entry.stats.ties || entry.stats.D || '0') || 0;
      const losses =
        parseFloat(entry.stats.losses || entry.stats.L || '0') || 0;
      const gp =
        parseFloat(entry.stats.gamesPlayed || entry.stats.GP || '0') ||
        wins + ties + losses;
      const pf =
        parseFloat(entry.stats.pointsFor || entry.stats.F || '0') || 0;
      const pa =
        parseFloat(entry.stats.pointsAgainst || entry.stats.A || '0') || 0;
      const gd =
        parseFloat(entry.stats.pointDifferential || entry.stats.GD || '0') ||
        pf - pa;
      const pts =
        parseFloat(entry.stats.points || entry.stats.P || '0') ||
        wins * 3 + ties;

      const item: PythonStandingItem = {
        rank: entry.rank,
        gamesPlayed: gp,
        wins,
        ties,
        losses,
        pointsFor: pf,
        pointsAgainst: pa,
        pointDifferential: gd,
        points: pts,
      };

      map[entry.teamId] = item;
      map[entry.abbreviation] = item;
      map[entry.teamShortName] = item;
    }
  }
  return map;
}

async function loadSoccerStandings(
  leagueId: string
): Promise<Record<string, PythonStandingItem>> {
  try {
    const groups = await fetchLeagueStandings(leagueId);
    return convertStandingsForPython(groups);
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const league = searchParams.get('league') || 'all';
  const date = searchParams.get('date') || undefined;
  const eventId = searchParams.get('eventId') || undefined;

  try {
    // 1. 单场预测（仅足球）
    if (eventId && league !== 'all') {
      const leagueCfg = getLeagueById(league);
      if (leagueCfg.sport !== 'soccer') {
        return NextResponse.json(
          {
            leagueId: league,
            eventId,
            prediction: null,
            updatedAt: new Date().toISOString(),
          },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }

      const [summary, standings] = await Promise.all([
        fetchEventSummary(league, eventId),
        loadSoccerStandings(league),
      ]);

      const state = summary.status?.state || 'pre';
      if (state === 'post') {
        return NextResponse.json(
          {
            leagueId: league,
            eventId,
            prediction: null,
            updatedAt: new Date().toISOString(),
          },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }

      const predictions = await callPythonPredictor({
        matches: [
          {
            id: eventId,
            leagueId: league,
            sport: 'soccer',
            state,
            displayClock: summary.status?.shortDetail,
            competitors: summary.competitors,
          },
        ],
        standings,
      });

      const prediction =
        predictions[`${league}-${eventId}`] || predictions[eventId] || null;

      return NextResponse.json(
        {
          leagueId: league,
          eventId,
          prediction,
          engine: 'python',
          updatedAt: new Date().toISOString(),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // 2. 记分牌批量预测（只处理足球联赛）
    //    league=all 时从配置派生，避免每加一个联赛就要改这里
    const targetSoccerLeagues =
      league === 'all'
        ? LEAGUES.filter((l) => l.sport === 'soccer').map((l) => l.id)
        : getLeagueById(league).sport === 'soccer'
        ? [league]
        : [];

    if (targetSoccerLeagues.length === 0) {
      return NextResponse.json(
        {
          leagueId: league,
          predictions: {},
          updatedAt: new Date().toISOString(),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const matchesPayload: any[] = [];
    const mergedStandings: Record<string, PythonStandingItem> = {};

    const results = await Promise.allSettled(
      targetSoccerLeagues.map(async (id) => {
        const [sb, st] = await Promise.all([
          fetchLeagueScoreboard(id, date),
          loadSoccerStandings(id),
        ]);
        return { sb, st };
      })
    );

    const finishedMatches: FinishedMatchPayload[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        Object.assign(mergedStandings, r.value.st);
        for (const ev of r.value.sb.events) {
          if (ev.sport !== 'soccer') continue;

          if (ev.status.state === 'post') {
            const home = ev.competitors.find((c) => c.homeAway === 'home');
            const away = ev.competitors.find((c) => c.homeAway === 'away');
            const homeScore = String(home?.score ?? '').trim();
            const awayScore = String(away?.score ?? '').trim();
            if (home && away && homeScore !== '' && awayScore !== '') {
              finishedMatches.push({
                eventId: ev.id,
                leagueId: ev.leagueId,
                date: ev.date,
                home: home.name,
                away: away.name,
                homeGoals: Number(homeScore),
                awayGoals: Number(awayScore),
              });
            }
            continue;
          }

          matchesPayload.push({
            id: ev.id,
            leagueId: ev.leagueId,
            sport: ev.sport,
            state: ev.status.state,
            displayClock: ev.status.displayClock || ev.status.shortDetail,
            competitors: ev.competitors,
          });
        }
      }
    }

    // 先把完赛结果并入快照，再算预测，这样本次返回的就是更新后的结果
    await pushFinishedMatches(finishedMatches);

    if (matchesPayload.length === 0) {
      return NextResponse.json(
        {
          leagueId: league,
          predictions: {},
          updatedAt: new Date().toISOString(),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const predictions = await callPythonPredictor({
      matches: matchesPayload,
      standings: mergedStandings,
    });

    return NextResponse.json(
      {
        leagueId: league,
        model: 'XGBoost (count:poisson) + Dixon-Coles',
        predictions,
        engine: 'python',
        updatedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    console.error('[API /predict] Python 预测服务异常:', error);
    return NextResponse.json(
      {
        error: 'Python 预测服务不可用',
        message: `${error?.message || 'Unknown error'}（请先启动 python/soccer_predictor_api.py）`,
        predictions: {},
      },
      { status: 503 }
    );
  }
}
