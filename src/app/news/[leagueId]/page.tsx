import React from 'react';
import NewsView from '@/components/NewsView';

export default async function LeagueNewsPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  return <NewsView leagueId={leagueId} />;
}
