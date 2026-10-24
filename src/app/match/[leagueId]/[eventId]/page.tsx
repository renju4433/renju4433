import React from 'react';
import MatchDetailView from '@/components/MatchDetailView';

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ leagueId: string; eventId: string }>;
}) {
  const { leagueId, eventId } = await params;
  return <MatchDetailView leagueId={leagueId} eventId={eventId} />;
}
