'use client';

import React, { useEffect, useState } from 'react';
import {
  X,
  MapPin,
  Users,
  Activity,
  BarChart3,
  ListOrdered,
  Clock,
  Trophy,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { EventSummaryDetail, NormalizedEvent } from '@/lib/types';

interface MatchDetailModalProps {
  event: NormalizedEvent | null;
  onClose: () => void;
}

export default function MatchDetailModal({
  event,
  onClose,
}: MatchDetailModalProps) {
  const [summary, setSummary] = useState<EventSummaryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'boxscore' | 'stats' | 'plays'>(
    'boxscore'
  );
  const [selectedTeamIdx, setSelectedTeamIdx] = useState(0);

  useEffect(() => {
    if (!event) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSummary(null);
    setSelectedTeamIdx(0);

    fetch(
      `/api/espn/summary?league=${encodeURIComponent(
        event.leagueId
      )}&eventId=${encodeURIComponent(event.id)}`
    )
      .then(async (res) => {
        if (!res.ok) throw new Error('暂无数据');
        return res.json();
      })
      .then((data: EventSummaryDetail) => {
        if (cancelled) return;
        setSummary(data);
        if (data.boxscoreGroups?.length > 0) {
          setActiveTab('boxscore');
        } else if (data.teamStats?.length > 0) {
          setActiveTab('stats');
        } else if (data.keyEvents?.length > 0) {
          setActiveTab('plays');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || '暂无数据');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [event]);

  if (!event) return null;

  const comps =
    summary?.competitors && summary.competitors.length >= 2
      ? summary.competitors
      : event.competitors;

  const isMulti = event.isMultiCompetitor || comps.length > 2;
  const teamA = comps[0];
  const teamB = comps[1];

  const fallbackLinescoreHeaders = (() => {
    if (summary?.linescoreHeaders && summary.linescoreHeaders.length > 0) {
      return summary.linescoreHeaders;
    }
    const maxLen = Math.max(
      0,
      ...comps.map((c) => c.linescores?.length || 0)
    );
    return Array.from({ length: maxLen }, (_, i) =>
      event.sport === 'tennis' ? `S${i + 1}` : `${i + 1}`
    );
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-slate-950/80 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
              {event.leagueName}
            </span>
            <span className="text-xs text-slate-400 truncate max-w-xs sm:max-w-md">
              {event.note || event.shortName}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scoreboard Banner */}
        {!isMulti && teamA && teamB ? (
          <div className="px-6 py-5 bg-gradient-to-b from-slate-900 to-slate-950 border-b border-slate-800/80">
            <div className="grid grid-cols-3 items-center gap-4">
              {/* Team A */}
              <div className="flex flex-col sm:flex-row items-center gap-3 text-center sm:text-left">
                {teamA.logo ? (
                  <img
                    src={teamA.logo}
                    alt={teamA.name}
                    className="w-14 h-14 object-contain"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center font-bold text-lg text-slate-300">
                    {teamA.abbreviation}
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-center sm:justify-start gap-1.5">
                    {teamA.rank && (
                      <span className="text-xs font-semibold text-amber-400">
                        #{teamA.rank}
                      </span>
                    )}
                    <h3 className="font-bold text-base sm:text-lg text-white leading-tight">
                      {teamA.shortName}
                    </h3>
                  </div>
                  {teamA.record && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {teamA.record}
                    </p>
                  )}
                </div>
              </div>

              {/* Center Score & Status */}
              <div className="flex flex-col items-center justify-center">
                <div className="flex items-center gap-3 sm:gap-6">
                  <span
                    className={`text-3xl sm:text-4xl font-extrabold tabular-nums ${
                      teamA.winner ? 'text-white' : 'text-slate-300'
                    }`}
                  >
                    {event.status.state === 'pre' ? '-' : teamA.score || '0'}
                  </span>
                  <span className="text-slate-600 font-bold text-xl">:</span>
                  <span
                    className={`text-3xl sm:text-4xl font-extrabold tabular-nums ${
                      teamB.winner ? 'text-white' : 'text-slate-300'
                    }`}
                  >
                    {event.status.state === 'pre' ? '-' : teamB.score || '0'}
                  </span>
                </div>
                <div className="mt-2">
                  {event.status.state === 'in' ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      {event.status.shortDetail}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-3 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300">
                      {event.status.detail}
                    </span>
                  )}
                </div>
              </div>

              {/* Team B */}
              <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 text-center sm:text-right">
                <div>
                  <div className="flex items-center justify-center sm:justify-end gap-1.5">
                    {teamB.rank && (
                      <span className="text-xs font-semibold text-amber-400">
                        #{teamB.rank}
                      </span>
                    )}
                    <h3 className="font-bold text-base sm:text-lg text-white leading-tight">
                      {teamB.shortName}
                    </h3>
                  </div>
                  {teamB.record && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {teamB.record}
                    </p>
                  )}
                </div>
                {teamB.logo ? (
                  <img
                    src={teamB.logo}
                    alt={teamB.name}
                    className="w-14 h-14 object-contain"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center font-bold text-lg text-slate-300">
                    {teamB.abbreviation}
                  </div>
                )}
              </div>
            </div>

            {/* Period Linescore Table */}
            {fallbackLinescoreHeaders.length > 0 &&
              comps.some((c) => c.linescores && c.linescores.length > 0) && (
                <div className="mt-4 pt-3 border-t border-slate-800/80 overflow-x-auto">
                  <table className="w-full text-xs text-center border-collapse">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800">
                        <th className="py-1.5 text-left font-medium pl-2">球队/选手</th>
                        {fallbackLinescoreHeaders.map((h, i) => (
                          <th key={i} className="py-1.5 px-2 font-medium">
                            {h}
                          </th>
                        ))}
                        <th className="py-1.5 px-3 font-bold text-slate-200">
                          总分
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {[teamA, teamB].map((tm) => (
                        <tr key={tm.id} className="text-slate-300">
                          <td className="py-1.5 text-left font-semibold pl-2 flex items-center gap-2">
                            {tm.logo && (
                              <img
                                src={tm.logo}
                                alt=""
                                className="w-4 h-4 object-contain"
                              />
                            )}
                            <span>{tm.shortName}</span>
                          </td>
                          {fallbackLinescoreHeaders.map((_, idx) => (
                            <td
                              key={idx}
                              className="py-1.5 px-2 tabular-nums text-slate-400"
                            >
                              {tm.linescores?.[idx] ?? '-'}
                            </td>
                          ))}
                          <td className="py-1.5 px-3 font-bold text-white tabular-nums">
                            {tm.score || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

            {/* Venue & Attendance */}
            {(summary?.header?.venue || event.venue?.fullName) && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-500" />
                  {summary?.header?.venue || event.venue?.fullName}
                </span>
                {summary?.header?.attendance && (
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-slate-500" />
                    {summary.header.attendance.toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="px-6 py-4 bg-slate-950 border-b border-slate-800">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              {event.name}
            </h3>
          </div>
        )}

        {/* Navigation Tabs */}
        {!isMulti && (
          <div className="flex border-b border-slate-800 bg-slate-900/90 px-6">
            <button
              onClick={() => setActiveTab('boxscore')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === 'boxscore'
                  ? 'border-red-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <ListOrdered className="w-4 h-4" />
              球员统计
            </button>
            <button
              onClick={() => setActiveTab('stats')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === 'stats'
                  ? 'border-red-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              球队数据
            </button>
            <button
              onClick={() => setActiveTab('plays')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === 'plays'
                  ? 'border-red-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-4 h-4" />
              比赛进程
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {isMulti ? (
            <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
              {comps.map((driver, i) => (
                <div
                  key={driver.id}
                  className="flex items-center justify-between px-4 py-2.5 bg-slate-900/60"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        i === 0
                          ? 'bg-amber-500 text-slate-950'
                          : i === 1
                          ? 'bg-slate-300 text-slate-950'
                          : i === 2
                          ? 'bg-amber-700 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {driver.order ?? i + 1}
                    </span>
                    {driver.logo && (
                      <img
                        src={driver.logo}
                        alt=""
                        className="w-6 h-4 object-contain"
                      />
                    )}
                    <span className="font-semibold text-sm text-white">
                      {driver.name}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-slate-300">
                    {driver.score}
                  </span>
                </div>
              ))}
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-red-500" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
              <AlertCircle className="w-7 h-7 text-amber-400" />
              <p className="text-xs">{error}</p>
            </div>
          ) : (
            <>
              {/* TAB 1: BOXSCORE */}
              {activeTab === 'boxscore' && (
                <div>
                  {summary?.boxscoreGroups &&
                  summary.boxscoreGroups.length > 0 ? (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        {summary.boxscoreGroups.map((grp, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedTeamIdx(idx)}
                            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                              selectedTeamIdx === idx
                                ? 'bg-red-600 text-white'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {grp.teamLogo && (
                              <img
                                src={grp.teamLogo}
                                alt=""
                                className="w-4 h-4 object-contain"
                              />
                            )}
                            {grp.teamName}
                          </button>
                        ))}
                      </div>

                      {(() => {
                        const activeGrp =
                          summary.boxscoreGroups[selectedTeamIdx] ||
                          summary.boxscoreGroups[0];
                        if (!activeGrp) return null;

                        return (
                          <div className="overflow-x-auto border border-slate-800 rounded-xl">
                            <table className="w-full text-xs text-left border-collapse">
                              <thead>
                                <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                                  <th className="py-2 px-3 font-semibold sticky left-0 bg-slate-950 z-10 min-w-[130px]">
                                    球员
                                  </th>
                                  {activeGrp.statLabels.map((lbl, i) => (
                                    <th
                                      key={i}
                                      className="py-2 px-2.5 font-semibold text-right whitespace-nowrap"
                                    >
                                      {lbl}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60">
                                {activeGrp.players.map((pl) => (
                                  <tr
                                    key={pl.id}
                                    className="hover:bg-slate-800/40 transition-colors"
                                  >
                                    <td className="py-2 px-3 font-medium text-white sticky left-0 bg-slate-900 z-10 flex items-center gap-2 whitespace-nowrap">
                                      {pl.headshot ? (
                                        <img
                                          src={pl.headshot}
                                          alt=""
                                          className="w-6 h-6 rounded-full object-cover bg-slate-800 shrink-0"
                                        />
                                      ) : (
                                        <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] text-slate-400 shrink-0">
                                          {pl.jersey || '#'}
                                        </div>
                                      )}
                                      <div>
                                        <span className="text-slate-100">
                                          {pl.shortName}
                                        </span>
                                        {pl.position && (
                                          <span className="ml-1 text-[10px] text-slate-500">
                                            {pl.position}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    {pl.didNotPlay || pl.stats.length === 0 ? (
                                      <td
                                        colSpan={
                                          activeGrp.statLabels.length || 1
                                        }
                                        className="py-2 px-3 text-center text-slate-500"
                                      >
                                        DNP
                                      </td>
                                    ) : (
                                      pl.stats.map((st, idx) => (
                                        <td
                                          key={idx}
                                          className="py-2 px-2.5 text-right tabular-nums text-slate-300 whitespace-nowrap"
                                        >
                                          {st}
                                        </td>
                                      ))
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {comps.map((tm) => (
                        <div
                          key={tm.id}
                          className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5"
                        >
                          <div className="flex items-center gap-2 font-bold text-sm text-white border-b border-slate-800 pb-2">
                            {tm.logo && (
                              <img
                                src={tm.logo}
                                alt=""
                                className="w-5 h-5 object-contain"
                              />
                            )}
                            {tm.name}
                          </div>
                          {tm.leaders && tm.leaders.length > 0 ? (
                            tm.leaders.map((ld, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between text-xs"
                              >
                                <span className="text-slate-400">
                                  {ld.category}
                                </span>
                                <span className="text-slate-200 font-medium">
                                  {ld.athleteName}{' '}
                                  <strong className="text-amber-400 ml-1">
                                    {ld.displayValue}
                                  </strong>
                                </span>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-slate-500">暂无数据</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: TEAM STATS */}
              {activeTab === 'stats' && (
                <div className="space-y-3">
                  {summary?.teamStats && summary.teamStats.length > 0 ? (
                    <>
                      <div className="flex justify-between text-xs font-bold text-slate-300 pb-2 border-b border-slate-800">
                        <span>{teamA?.shortName}</span>
                        <span>{teamB?.shortName}</span>
                      </div>
                      {summary.teamStats.map((st, idx) => {
                        const homePct = st.homePercent ?? 50;
                        const leftIsHome = teamA?.homeAway === 'home';
                        const leftPct = leftIsHome ? homePct : 100 - homePct;
                        const rightPct = leftIsHome ? 100 - homePct : homePct;
                        const leftValue = leftIsHome ? st.homeValue : st.awayValue;
                        const rightValue = leftIsHome ? st.awayValue : st.homeValue;
                        return (
                          <div key={idx} className="space-y-1">
                            <div className="flex justify-between text-xs">
                              <span className="font-bold text-white tabular-nums">
                                {leftValue}
                              </span>
                              <span className="text-slate-400">{st.label}</span>
                              <span className="font-bold text-white tabular-nums">
                                {rightValue}
                              </span>
                            </div>
                            <div className="flex h-2 rounded-full overflow-hidden bg-slate-800 gap-0.5">
                              <div
                                className="bg-blue-500 transition-all"
                                style={{ width: `${leftPct}%` }}
                              />
                              <div
                                className="bg-red-500 transition-all"
                                style={{ width: `${rightPct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </>
                  ) : (
                    <p className="text-center py-10 text-xs text-slate-500">
                      暂无数据
                    </p>
                  )}
                </div>
              )}

              {/* TAB 3: KEY PLAYS / TIMELINE */}
              {activeTab === 'plays' && (
                <div className="space-y-2">
                  {summary?.keyEvents && summary.keyEvents.length > 0 ? (
                    summary.keyEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className={`p-3 rounded-xl border flex items-start gap-3 ${
                          ev.scoringPlay
                            ? 'bg-amber-500/5 border-amber-500/25'
                            : 'bg-slate-950/60 border-slate-800/80'
                        }`}
                      >
                        {ev.teamLogo ? (
                          <img
                            src={ev.teamLogo}
                            alt=""
                            className="w-5 h-5 object-contain mt-0.5 shrink-0"
                          />
                        ) : (
                          <Clock className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-slate-400">
                              {ev.period} {ev.clock}
                            </span>
                            {ev.scoreValue && (
                              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[11px] font-bold tabular-nums">
                                {ev.scoreValue}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-200 mt-1">
                            {ev.text}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-center py-10 text-xs text-slate-500">
                      暂无数据
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
