'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronRight, Trophy } from 'lucide-react';
import { NormalizedEvent } from '@/lib/types';

interface ScoreCardProps {
  event: NormalizedEvent;
  showLeagueBadge?: boolean;
}

export default function ScoreCard({
  event,
  showLeagueBadge = false,
}: ScoreCardProps) {
  const isLive = event.status.state === 'in';
  const isPost = event.status.state === 'post';
  const isPre = event.status.state === 'pre';

  const formatKickoffTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return event.status.shortDetail;
    }
  };

  const teamA = event.competitors[0];
  const teamB = event.competitors[1];
  const pred = !isPost ? event.gbdtPrediction : undefined;

  const handleCacheEvent = () => {
    try {
      sessionStorage.setItem(`match_${event.id}`, JSON.stringify(event));
    } catch {
      // ignore storage errors
    }
  };

  return (
    <Link
      href={`/match/${event.leagueId}/${event.id}`}
      onClick={handleCacheEvent}
      className={`group relative h-[68px] sm:h-[72px] rounded-xl border transition-all duration-150 cursor-pointer px-3 sm:px-4 flex items-center justify-between gap-2 sm:gap-3 ${
        isLive
          ? 'bg-slate-900/95 border-red-500/50 shadow-sm shadow-red-950/30 hover:border-red-400'
          : 'bg-slate-900/80 border-slate-800/90 hover:border-slate-700 hover:bg-slate-900'
      }`}
    >
      {/* Left: League Badge & Match Status/Time */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 whitespace-nowrap">
        {showLeagueBadge && (
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-bold text-[10px] sm:text-[11px] shrink-0">
            {event.leagueName}
          </span>
        )}
        {isLive ? (
          <span className="inline-flex items-center gap-1 font-bold text-[11px] sm:text-xs text-red-400 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping shrink-0" />
            {event.status.shortDetail}
          </span>
        ) : isPost ? (
          <span className="font-semibold text-[11px] sm:text-xs text-slate-400 whitespace-nowrap">
            {event.status.shortDetail}
          </span>
        ) : (
          <span className="font-medium text-[11px] sm:text-xs text-emerald-400 whitespace-nowrap tabular-nums">
            {formatKickoffTime(event.date)}
          </span>
        )}
      </div>

      {/* Center: Matchup Content with Win/Loss rates on the outer sides of the two teams & Draw rate below score */}
      <div className="flex-1 min-w-0">
        {event.isMultiCompetitor ? (
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-white truncate">
              <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="truncate text-xs sm:text-sm">
                {event.shortName}
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-3 text-xs text-slate-300 shrink-0">
              {event.competitors.slice(0, 3).map((driver, idx) => (
                <span key={driver.id} className="inline-flex items-center gap-1">
                  <span className="text-[10px] font-bold text-amber-400">
                    #{idx + 1}
                  </span>
                  <span>{driver.shortName}</span>
                </span>
              ))}
            </div>
          </div>
        ) : teamA && teamB ? (
          <div className="grid grid-cols-9 items-center gap-1 sm:gap-2">
            {/* Team A + Outer Left Win Probability & xG */}
            <div className="col-span-4 flex items-center justify-end gap-1.5 sm:gap-2.5 min-w-0 text-right">
              {pred && (
                <div className="flex flex-col items-end shrink-0">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-bold tabular-nums leading-none ${
                      pred.predictedOutcome === '胜'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-slate-800/80 text-slate-400'
                    }`}
                  >
                    {pred.winProb}%
                  </span>
                  {pred.expectedGoals && (
                    <span className="block text-[9px] sm:text-[10px] text-slate-400 font-mono mt-0.5 whitespace-nowrap leading-none">
                      xG {pred.expectedGoals.home.toFixed(2)}
                    </span>
                  )}
                </div>
              )}
              <div className="min-w-0">
                <span
                  className={`block text-xs sm:text-sm font-bold truncate ${
                    isPost && !teamA.winner ? 'text-slate-400' : 'text-white'
                  }`}
                >
                  {teamA.shortName}
                </span>
                {teamA.record && (
                  <span className="hidden md:block text-[10px] text-slate-500">
                    {teamA.record}
                  </span>
                )}
              </div>
              {teamA.logo ? (
                <img
                  src={teamA.logo}
                  alt={teamA.name}
                  className="w-6 h-6 sm:w-7 sm:h-7 object-contain shrink-0"
                />
              ) : (
                <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-300 shrink-0">
                  {teamA.abbreviation.slice(0, 3)}
                </div>
              )}
            </div>

            {/* Center Score / VS + Draw Rate Below */}
            <div className="col-span-1 flex flex-col items-center justify-center">
              {isPre ? (
                <span className="px-2 py-0.5 rounded-lg bg-slate-800/80 text-xs font-bold text-slate-400">
                  VS
                </span>
              ) : (
                <div className="flex items-center gap-1 sm:gap-1.5 text-sm sm:text-base font-extrabold tabular-nums leading-none">
                  <span
                    className={
                      teamA.winner
                        ? 'text-white'
                        : isLive
                        ? 'text-red-400'
                        : 'text-slate-400'
                    }
                  >
                    {teamA.score || '0'}
                  </span>
                  <span className="text-slate-600">:</span>
                  <span
                    className={
                      teamB.winner
                        ? 'text-white'
                        : isLive
                        ? 'text-red-400'
                        : 'text-slate-400'
                    }
                  >
                    {teamB.score || '0'}
                  </span>
                </div>
              )}

              {/* Draw Rate Below Score */}
              {pred && pred.hasDraw && pred.drawProb !== undefined ? (
                <span
                  className={`mt-1 px-1.5 py-0.2 rounded text-[10px] font-bold tabular-nums whitespace-nowrap leading-none ${
                    pred.predictedOutcome === '平'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'text-slate-400'
                  }`}
                >
                  平 {pred.drawProb}%
                </span>
              ) : (
                !isPre &&
                event.sport === 'tennis' &&
                teamA.linescores &&
                teamB.linescores &&
                teamA.linescores.length > 0 && (
                  <div className="hidden sm:flex items-center gap-1 mt-1 text-[10px] text-slate-500 tabular-nums whitespace-nowrap leading-none">
                    {teamA.linescores.map((sA, idx) => (
                      <span key={idx}>
                        {sA}-{teamB.linescores?.[idx] ?? '0'}
                      </span>
                    ))}
                  </div>
                )
              )}
            </div>

            {/* Team B + Outer Right Loss Probability */}
            <div className="col-span-4 flex items-center justify-start gap-1.5 sm:gap-2.5 min-w-0 text-left">
              {teamB.logo ? (
                <img
                  src={teamB.logo}
                  alt={teamB.name}
                  className="w-6 h-6 sm:w-7 sm:h-7 object-contain shrink-0"
                />
              ) : (
                <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-300 shrink-0">
                  {teamB.abbreviation.slice(0, 3)}
                </div>
              )}
              <div className="min-w-0">
                <span
                  className={`block text-xs sm:text-sm font-bold truncate ${
                    isPost && !teamB.winner ? 'text-slate-400' : 'text-white'
                  }`}
                >
                  {teamB.shortName}
                </span>
                {teamB.record && (
                  <span className="hidden md:block text-[10px] text-slate-500">
                    {teamB.record}
                  </span>
                )}
              </div>
              {pred && (
                <div className="flex flex-col items-start shrink-0">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-bold tabular-nums leading-none ${
                      pred.predictedOutcome === '负'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-slate-800/80 text-slate-400'
                    }`}
                  >
                    {pred.lossProb}%
                  </span>
                  {pred.expectedGoals && (
                    <span className="block text-[9px] sm:text-[10px] text-slate-400 font-mono mt-0.5 whitespace-nowrap leading-none">
                      xG {pred.expectedGoals.away.toFixed(2)}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Right Arrow */}
      <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors shrink-0" />
    </Link>
  );
}
