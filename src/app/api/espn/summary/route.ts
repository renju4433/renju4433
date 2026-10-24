import { NextRequest, NextResponse } from 'next/server';
import { fetchEventSummary } from '@/lib/espn-service';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const league = searchParams.get('league') || 'nba';
  const eventId = searchParams.get('eventId');

  if (!eventId) {
    return NextResponse.json(
      { error: '缺少赛事 eventId 参数' },
      { status: 400 }
    );
  }

  try {
    const summary = await fetchEventSummary(league, eventId);
    return NextResponse.json(summary);
  } catch (error: any) {
    console.error('[API /summary] Error:', error);
    return NextResponse.json(
      {
        error: '无法从 ESPN 获取赛事详情',
        message: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
