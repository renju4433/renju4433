import { NextRequest, NextResponse } from 'next/server';
import { fetchLeagueStandings } from '@/lib/espn-service';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const league = searchParams.get('league') || 'nba';
  const effectiveLeague = league === 'all' ? 'nba' : league;

  try {
    const groups = await fetchLeagueStandings(effectiveLeague);
    return NextResponse.json({
      leagueId: effectiveLeague,
      groups,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API /standings] Error:', error);
    return NextResponse.json(
      { error: '无法从 ESPN 获取积分榜数据', groups: [] },
      { status: 500 }
    );
  }
}
