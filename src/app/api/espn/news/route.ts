import { NextRequest, NextResponse } from 'next/server';
import { fetchLeagueNews } from '@/lib/espn-service';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const league = searchParams.get('league') || 'nba';

  try {
    if (league === 'all') {
      const targetLeagues = ['nba', 'epl', 'nfl', 'ucl', 'f1'];
      const results = await Promise.allSettled(
        targetLeagues.map((id) => fetchLeagueNews(id, 4))
      );
      const articles = [];
      for (const r of results) {
        if (r.status === 'fulfilled') {
          articles.push(...r.value);
        }
      }
      return NextResponse.json({ articles, fetchedAt: new Date().toISOString() });
    }

    const articles = await fetchLeagueNews(league, 16);
    return NextResponse.json({ articles, fetchedAt: new Date().toISOString() });
  } catch (error: any) {
    console.error('[API /news] Error:', error);
    return NextResponse.json(
      { error: '无法从 ESPN 获取体育新闻', articles: [] },
      { status: 500 }
    );
  }
}
