import React from 'react';
import Navbar from '@/components/Navbar';
import StandingsPanel from '@/components/StandingsPanel';

export default function StandingsIndexPage() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <Navbar currentLeague="nba" />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        <StandingsPanel leagueId="nba" />
      </main>
    </div>
  );
}
