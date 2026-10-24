import React from 'react';
import ScoreboardView from '@/components/ScoreboardView';

export default async function LeaguePage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  return <ScoreboardView leagueId={leagueId} />;
}
