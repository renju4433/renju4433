'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  MapPin,
  Users,
  Activity,
  BarChart3,
  ListOrdered,
  Clock,
  Trophy,
  Loader2,
  AlertCircle,
  Grid,
} from 'lucide-react';
import {
  EventSummaryDetail,
  GBDTPrediction,
  NormalizedEvent,
} from '@/lib/types';
import { getLeagueById } from '@/lib/espn-config';
import Navbar from '@/components/Navbar';

interface MatchDetailViewProps {
  leagueId: string;
  eventId: string;
}

export default function MatchDetailView({
  leagueId,
  eventId,
}: MatchDetailViewProps) {
  const router = useRouter();
  const [cachedEvent, setCachedEvent] = useState<NormalizedEvent | null>(null);
  const [summary, setSummary] = useState<EventSummaryDetail | null>(null);
  const [livePrediction, setLivePrediction] = useState<GBDTPrediction | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    'heatmap' | 'boxscore' | 'stats' | 'plays'
  >('boxscore');
  const [selectedTeamIdx, setSelectedTeamIdx] = useState(0);

  const leagueCfg = getLeagueById(leagueId);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`match_${eventId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        setCachedEvent(parsed);
        if (parsed?.gbdtPrediction?.scoreHeatmap) {
          setActiveTab('heatmap');
        }
      }
    } catch {
      // ignore storage errors
    }
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchDetail = (silent = false) => {
      if (!silent) setLoading(true);
      fetch(
        `/api/espn/summary?league=${encodeURIComponent(
          leagueId
        )}&eventId=${encodeURIComponent(eventId)}`
      )
        .then(async (res) => {
          if (!res.ok) throw new Error('暂无数据');
          return res.json();
        })
        .then((data: EventSummaryDetail) => {
          if (cancelled) return;
          setSummary(data);
          if (!silent && leagueCfg.sport !== 'soccer') {
            if (data.boxscoreGroups?.length > 0) {
              setActiveTab('boxscore');
            } else if (data.teamStats?.length > 0) {
              setActiveTab('stats');
            } else if (data.keyEvents?.length > 0) {
              setActiveTab('plays');
            }
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err.message || '暂无数据');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    const fetchPrediction = (firstLoad = false) => {
      fetch(
        `/api/espn/predict?league=${encodeURIComponent(
          leagueId
        )}&eventId=${encodeURIComponent(eventId)}`,
        { cache: 'no-store' }
      )
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!cancelled && data?.prediction) {
            setLivePrediction(data.prediction);
            if (firstLoad && data.prediction.scoreHeatmap) {
              setActiveTab('heatmap');
            }
          }
        })
        .catch(() => {});
    };

    fetchDetail(false);
    fetchPrediction(true);
    const timer = setInterval(() => fetchDetail(true), 30000);
    const predTimer = setInterval(() => fetchPrediction(false), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearInterval(predTimer);
    };
  }, [leagueId, eventId, leagueCfg.sport]);

  const comps =
    summary?.competitors && summary.competitors.length > 0
      ? summary.competitors
      : cachedEvent?.competitors || [];

  const isMulti =
    summary?.isMultiCompetitor ||
    cachedEvent?.isMultiCompetitor ||
    comps.length > 2;
  const teamA = comps[0];
  const teamB = comps[1];

  const statusState =
    summary?.status?.state || cachedEvent?.status.state || 'pre';
  const pred =
    statusState !== 'post'
      ? livePrediction ||
        summary?.gbdtPrediction ||
        cachedEvent?.gbdtPrediction
      : undefined;

  const statusDetail =
    summary?.status?.detail ||
    summary?.header?.statusDetail ||
    cachedEvent?.status.detail ||
    '';
  const statusShortDetail =
    summary?.status?.shortDetail || cachedEvent?.status.shortDetail || '';

  const fallbackLinescoreHeaders = (() => {
    if (summary?.linescoreHeaders && summary.linescoreHeaders.length > 0) {
      return summary.linescoreHeaders;
    }
    const maxLen = Math.max(
      0,
      ...comps.map((c) => c.linescores?.length || 0)
    );
    return Array.from({ length: maxLen }, (_, i) =>
      leagueCfg.sport === 'tennis' ? `S${i + 1}` : `${i + 1}`
    );
  })();

  return (
    <div className="h-dvh overflow-hidden flex flex-col bg-slate-950 text-slate-100">
      <Navbar currentLeague={leagueId} />

      <main className="flex-1 min-h-0 max-w-5xl w-full mx-auto px-3 sm:px-6 py-2.5 flex flex-col gap-2.5">
        {/* Top Back Bar */}
        <div className="shrink-0 flex items-center justify-between bg-slate-900/85 border border-slate-800 rounded-xl px-3.5 py-2">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-300 hover:text-white cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>

          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs font-bold rounded bg-red-500/15 text-red-400 border border-red-500/30">
              {leagueCfg.shortName}
            </span>
            {(summary?.header?.note || cachedEvent?.note) && (
              <span className="text-xs text-slate-400 truncate max-w-xs">
                {summary?.header?.note || cachedEvent?.note}
              </span>
            )}
          </div>
        </div>

        {/* Scoreboard Banner */}
        <div className="shrink-0 bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden">
          {!isMulti && teamA && teamB ? (
            <div className="px-4 sm:px-6 py-3.5 bg-gradient-to-b from-slate-900 to-slate-950">
              <div className="grid grid-cols-3 items-center gap-2 sm:gap-4">
                {/* Team A */}
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  {pred && (
                    <div className="flex flex-col items-start shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold tabular-nums ${
                          pred.predictedOutcome === '胜'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {pred.winProb}%
                      </span>
                      {pred.expectedGoals && (
                        <span className="text-[10px] text-slate-400 font-mono mt-0.5 whitespace-nowrap">
                          xG {pred.expectedGoals.home.toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                  {teamA.logo ? (
                    <img
                      src={teamA.logo}
                      alt={teamA.name}
                      className="w-10 h-10 sm:w-12 sm:h-12 object-contain shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-slate-800 flex items-center justify-center font-bold text-sm text-slate-300 shrink-0">
                      {teamA.abbreviation}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      {teamA.rank && (
                        <span className="text-xs font-semibold text-amber-400">
                          #{teamA.rank}
                        </span>
                      )}
                      <h3 className="font-bold text-xs sm:text-base text-white truncate">
                        {teamA.shortName}
                      </h3>
                    </div>
                    {teamA.record && (
                      <p className="text-[11px] text-slate-400">
                        {teamA.record}
                      </p>
                    )}
                  </div>
                </div>

                {/* Center Score & Status + Draw Rate Below */}
                <div className="flex flex-col items-center justify-center">
                  <div className="flex items-center gap-2 sm:gap-5">
                    <span
                      className={`text-2xl sm:text-3xl font-extrabold tabular-nums ${
                        teamA.winner ? 'text-white' : 'text-slate-300'
                      }`}
                    >
                      {statusState === 'pre' ? '-' : teamA.score || '0'}
                    </span>
                    <span className="text-slate-600 font-bold text-lg">:</span>
                    <span
                      className={`text-2xl sm:text-3xl font-extrabold tabular-nums ${
                        teamB.winner ? 'text-white' : 'text-slate-300'
                      }`}
                    >
                      {statusState === 'pre' ? '-' : teamB.score || '0'}
                    </span>
                  </div>
                  {pred && pred.hasDraw && pred.drawProb !== undefined && (
                    <span
                      className={`mt-1 px-2 py-0.5 rounded text-xs font-bold tabular-nums ${
                        pred.predictedOutcome === '平'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'text-slate-400'
                      }`}
                    >
                      平 {pred.drawProb}%
                    </span>
                  )}
                  <div className="mt-1">
                    {statusState === 'in' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                        {statusShortDetail || statusDetail}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300">
                        {statusDetail || statusShortDetail}
                      </span>
                    )}
                  </div>
                </div>

                {/* Team B */}
                <div className="flex items-center justify-end gap-2 sm:gap-3 min-w-0 text-right">
                  <div className="min-w-0">
                    <div className="flex items-center justify-end gap-1">
                      {teamB.rank && (
                        <span className="text-xs font-semibold text-amber-400">
                          #{teamB.rank}
                        </span>
                      )}
                      <h3 className="font-bold text-xs sm:text-base text-white truncate">
                        {teamB.shortName}
                      </h3>
                    </div>
                    {teamB.record && (
                      <p className="text-[11px] text-slate-400">
                        {teamB.record}
                      </p>
                    )}
                  </div>
                  {teamB.logo ? (
                    <img
                      src={teamB.logo}
                      alt={teamB.name}
                      className="w-10 h-10 sm:w-12 sm:h-12 object-contain shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-slate-800 flex items-center justify-center font-bold text-sm text-slate-300 shrink-0">
                      {teamB.abbreviation}
                    </div>
                  )}
                  {pred && (
                    <div className="flex flex-col items-end shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold tabular-nums ${
                          pred.predictedOutcome === '负'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {pred.lossProb}%
                      </span>
                      {pred.expectedGoals && (
                        <span className="text-[10px] text-slate-400 font-mono mt-0.5 whitespace-nowrap">
                          xG {pred.expectedGoals.away.toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Period Linescore Table */}
              {fallbackLinescoreHeaders.length > 0 &&
                comps.some((c) => c.linescores && c.linescores.length > 0) && (
                  <div className="mt-3 pt-2.5 border-t border-slate-800/80 overflow-x-auto">
                    <table className="w-full text-xs text-center border-collapse">
                      <thead>
                        <tr className="text-slate-400 border-b border-slate-800">
                          <th className="py-1 text-left font-medium pl-2">
                            球队/选手
                          </th>
                          {fallbackLinescoreHeaders.map((h, i) => (
                            <th key={i} className="py-1 px-2 font-medium">
                              {h}
                            </th>
                          ))}
                          <th className="py-1 px-3 font-bold text-slate-200">
                            总分
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {[teamA, teamB].map((tm) => (
                          <tr key={tm.id} className="text-slate-300">
                            <td className="py-1 text-left font-semibold pl-2 flex items-center gap-2">
                              {tm.logo && (
                                <img
                                  src={tm.logo}
                                  alt=""
                                  className="w-4 h-4 object-contain"
                                />
                              )}
                              <span className="truncate">{tm.shortName}</span>
                            </td>
                            {fallbackLinescoreHeaders.map((_, idx) => (
                              <td
                                key={idx}
                                className="py-1 px-2 tabular-nums text-slate-400"
                              >
                                {tm.linescores?.[idx] ?? '-'}
                              </td>
                            ))}
                            <td className="py-1 px-3 font-bold text-white tabular-nums">
                              {tm.score || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

              {(summary?.header?.venue || cachedEvent?.venue?.fullName) && (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-slate-500" />
                    {summary?.header?.venue || cachedEvent?.venue?.fullName}
                  </span>
                  {summary?.header?.attendance && (
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3 text-slate-500" />
                      {summary.header.attendance.toLocaleString()}
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="px-5 py-3.5 bg-slate-950 flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-400" />
                {summary?.name || cachedEvent?.name || leagueCfg.name}
              </h3>
              <span className="text-xs text-slate-400">{statusDetail}</span>
            </div>
          )}

          {/* Navigation Tabs */}
          {!isMulti && (
            <div className="flex border-t border-slate-800 bg-slate-900/90 px-4 overflow-x-auto no-scrollbar">
              {pred?.scoreHeatmap && (
                <button
                  onClick={() => setActiveTab('heatmap')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                    activeTab === 'heatmap'
                      ? 'border-red-500 text-white'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Grid className="w-3.5 h-3.5" />
                  比分热力图
                </button>
              )}
              <button
                onClick={() => setActiveTab('boxscore')}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === 'boxscore'
                    ? 'border-red-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <ListOrdered className="w-3.5 h-3.5" />
                球员统计
              </button>
              <button
                onClick={() => setActiveTab('stats')}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === 'stats'
                    ? 'border-red-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                球队数据
              </button>
              <button
                onClick={() => setActiveTab('plays')}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === 'plays'
                    ? 'border-red-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                比赛进程
              </button>
            </div>
          )}
        </div>

        {/* Detail Content Area */}
        <div className="flex-1 min-h-0 bg-slate-900/70 border border-slate-800 rounded-xl p-3.5 sm:p-4 overflow-y-auto">
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
          ) : loading && !summary && !pred ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-red-500" />
            </div>
          ) : error && comps.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
              <AlertCircle className="w-7 h-7 text-amber-400" />
              <p className="text-xs">{error}</p>
            </div>
          ) : (
            <>
              {/* TAB 0: 10x10 SCORELINE HEATMAP */}
              {activeTab === 'heatmap' && pred?.scoreHeatmap && (
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 overflow-x-auto">
                  <table className="w-full text-center border-separate border-spacing-0.5">
                    <thead>
                      <tr>
                        <th className="p-0.5 text-[10px] text-slate-500 font-semibold">
                          主\客
                        </th>
                        {Array.from(
                          {
                            length: pred.scoreHeatmap.matrix[0]?.length || 10,
                          },
                          (_, col) => {
                            const maxG =
                              (pred.scoreHeatmap?.matrix[0]?.length || 10) - 1;
                            return (
                              <th
                                key={col}
                                className="p-0.5 text-[10px] font-bold text-slate-300"
                              >
                                {col === maxG ? `${maxG}+` : col}
                              </th>
                            );
                          }
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const maxCell = Math.max(
                          0.1,
                          ...pred.scoreHeatmap.matrix.flat()
                        );
                        const maxG = pred.scoreHeatmap.matrix.length - 1;
                        return pred.scoreHeatmap.matrix.map((row, rIdx) => (
                          <tr key={rIdx}>
                            <td className="p-0.5 text-[10px] font-bold text-slate-300">
                              {rIdx === maxG ? `${maxG}+` : rIdx}
                            </td>
                            {row.map((prob, cIdx) => {
                              const intensity = Math.min(1, prob / maxCell);
                              const bgAlpha =
                                prob > 0
                                  ? (0.08 + intensity * 0.72).toFixed(2)
                                  : '0.02';
                              return (
                                <td
                                  key={cIdx}
                                  className="px-1 py-1 rounded border border-slate-800/50 transition-transform hover:scale-105"
                                  style={{
                                    backgroundColor: `rgba(16, 185, 129, ${bgAlpha})`,
                                  }}
                                >
                                  <div className="text-[9px] text-slate-400 font-medium leading-none">
                                    {rIdx}:{cIdx}
                                  </div>
                                  <div
                                    className={`text-[10px] font-extrabold tabular-nums mt-0.5 leading-none ${
                                      prob >= 1.0
                                        ? 'text-white'
                                        : prob > 0
                                        ? 'text-slate-300'
                                        : 'text-slate-600'
                                    }`}
                                  >
                                    {prob.toFixed(1)}%
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              )}

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
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
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
                                    <td className="py-1.5 px-3 font-medium text-white sticky left-0 bg-slate-900 z-10 flex items-center gap-2 whitespace-nowrap">
                                      {pl.headshot ? (
                                        <img
                                          src={pl.headshot}
                                          alt=""
                                          className="w-5 h-5 rounded-full object-cover bg-slate-800 shrink-0"
                                        />
                                      ) : (
                                        <div className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] text-slate-400 shrink-0">
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
                                        className="py-1.5 px-3 text-center text-slate-500"
                                      >
                                        DNP
                                      </td>
                                    ) : (
                                      pl.stats.map((st, idx) => (
                                        <td
                                          key={idx}
                                          className="py-1.5 px-2.5 text-right tabular-nums text-slate-300 whitespace-nowrap"
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {comps.map((tm) => (
                        <div
                          key={tm.id}
                          className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2"
                        >
                          <div className="flex items-center gap-2 font-bold text-xs sm:text-sm text-white border-b border-slate-800 pb-2">
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
      </main>
    </div>
  );
}
