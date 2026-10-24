import { NextRequest, NextResponse } from 'next/server';
import { LEAGUES } from '@/lib/espn-config';
import { fetchLeagueScoreboard } from '@/lib/espn-service';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const league = searchParams.get('league') || 'nba';
  const date = searchParams.get('date') || undefined;

  try {
    if (league === 'all') {
      // 首页「全部热门」聚合的联赛清单（每个最多 6 场）。
      // 注意：这里不完全等于 LEAGUES，是按首页版面挑的热门项。
      const featuredLeagues = ['nba', 'epl', 'ucl', 'csl', 'nfl', 'mlb', 'atp', 'f1'];
      const results = await Promise.allSettled(
        featuredLeagues.map((id) => fetchLeagueScoreboard(id, date))
      );

      const combinedEvents = [];
      for (const res of results) {
        if (res.status === 'fulfilled') {
          combinedEvents.push(...res.value.events.slice(0, 6));
        }
      }

      // Sort live ('in') first, then upcoming ('pre'), then finished ('post')
      const statePriority: Record<string, number> = { in: 0, pre: 1, post: 2 };
      combinedEvents.sort((a, b) => {
        const pa = statePriority[a.status.state] ?? 1;
        const pb = statePriority[b.status.state] ?? 1;
        if (pa !== pb) return pa - pb;
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });

      return NextResponse.json({
        league: {
          id: 'all',
          name: '全球热门赛事综合',
          shortName: '全部热门',
          englishName: 'ESPN Global Sports Hub',
          sport: 'all',
          league: 'all',
          category: 'basketball',
          accentColor: '#ef4444',
          badgeText: '综合',
          supportsStandings: false,
        },
        events: combinedEvents,
        fetchedAt: new Date().toISOString(),
      });
    }

    const data = await fetchLeagueScoreboard(league, date);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[API /scoreboard] Error:', error);
    return NextResponse.json(
      {
        error: '无法从 ESPN 获取实时比分数据',
        message: error?.message || 'Unknown error',
        leagues: LEAGUES,
      },
      { status: 500 }
    );
  }
}
