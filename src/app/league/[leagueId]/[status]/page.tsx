import React from 'react';
import ScoreboardView from '@/components/ScoreboardView';

export default async function LeagueStatusPage({
  params,
}: {
  params: Promise<{ leagueId: string; status: string }>;
}) {
  const { leagueId, status } = await params;
  const validStatus =
    status === 'in' || status === 'pre' || status === 'post' ? status : 'all';

  return <ScoreboardView leagueId={leagueId} initialStatus={validStatus} />;
}
