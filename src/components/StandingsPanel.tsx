'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trophy, Loader2, ShieldAlert, LayoutGrid, Rows3 } from 'lucide-react';
import { StandingGroup } from '@/lib/types';
import { LEAGUES, SPORT_ZONES, getLeagueById } from '@/lib/espn-config';

interface StandingsPanelProps {
  leagueId: string;
}

function translatePartitionName(rawName: string): string {
  const map: Record<string, string> = {
    'Eastern Conference': '东部联盟 (Eastern)',
    'Western Conference': '西部联盟 (Western)',
    'American Football Conference': '美联 (AFC)',
    'National Football Conference': '国联 (NFC)',
    'American League': '美联 (AL)',
    'National League': '国联 (NL)',
    'AFC East': '美联东区',
    'AFC North': '美联北区',
    'AFC South': '美联南区',
    'AFC West': '美联西区',
    'NFC East': '国联东区',
    'NFC North': '国联北区',
    'NFC South': '国联南区',
    'NFC West': '国联西区',
    'Atlantic Division': '大西洋分区',
    'Metropolitan Division': '大都会分区',
    'Central Division': '中央分区',
    'Pacific Division': '太平洋分区',
    'Driver Standings': '车手积分榜',
    'Constructor Standings': '车队积分榜',
  };
  return map[rawName] || rawName;
}

export default function StandingsPanel({ leagueId }: StandingsPanelProps) {
  const effectiveLeagueId =
    leagueId === 'all' || !getLeagueById(leagueId).supportsStandings
      ? 'nba'
      : leagueId;
  const [groups, setGroups] = useState<StandingGroup[]>([]);
  const [activeGroupIdx, setActiveGroupIdx] = useState<number | 'all'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const fetchStandings = () => {
      fetch(
        `/api/espn/standings?league=${encodeURIComponent(effectiveLeagueId)}`
      )
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return;
          const fetchedGroups = Array.isArray(data.groups) ? data.groups : [];
          setGroups(fetchedGroups);
          setActiveGroupIdx((prev) =>
            prev === 'all' || typeof prev === 'number'
              ? fetchedGroups.length <= 2
                ? 'all'
                : 0
              : 'all'
          );
        })
        .catch(() => {
          if (!cancelled) setGroups([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    fetchStandings();
    const timer = setInterval(fetchStandings, 60000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [effectiveLeagueId]);

  const currentLeagueCfg = getLeagueById(effectiveLeagueId);

  const displayedGroups =
    activeGroupIdx === 'all'
      ? groups
      : groups[activeGroupIdx]
      ? [groups[activeGroupIdx]]
      : [];

  return (
    <div className="space-y-5">
      {/* Top Zone-Grouped League Selector */}
      <div className="bg-slate-900/85 p-4 rounded-2xl border border-slate-800 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-extrabold text-white">
              {currentLeagueCfg.name} · 积分榜
            </h2>
          </div>

          {groups.length > 1 && (
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setActiveGroupIdx('all')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeGroupIdx === 'all'
                    ? 'bg-red-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                全部分区 ({groups.length})
              </button>
              <button
                onClick={() => setActiveGroupIdx(0)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeGroupIdx !== 'all'
                    ? 'bg-red-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Rows3 className="w-3.5 h-3.5" />
                单分区
              </button>
            </div>
          )}
        </div>

        {/* Grouped by Sport Zones */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {SPORT_ZONES.map((zone) => {
            const zoneLeagues = LEAGUES.filter(
              (l) => l.zoneId === zone.id && l.supportsStandings
            );
            if (zoneLeagues.length === 0) return null;

            return (
              <div
                key={zone.id}
                className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/90 space-y-2"
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: zone.accentColor }}
                  />
                  <span>{zone.name}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {zoneLeagues.map((lg) => (
                    <Link
                      key={lg.id}
                      href={`/standings/${lg.id}`}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                        effectiveLeagueId === lg.id
                          ? 'bg-red-600 text-white shadow-md shadow-red-600/20'
                          : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
                      }`}
                    >
                      {lg.shortName}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 bg-slate-900/50 rounded-2xl border border-slate-800">
          <Loader2 className="w-8 h-8 animate-spin text-red-500" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-slate-900/50 rounded-2xl border border-slate-800 text-slate-400 gap-2">
          <ShieldAlert className="w-7 h-7 text-amber-400" />
          <p className="text-xs">暂无数据</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Partition Quick Filter Tabs */}
          {groups.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
              <button
                onClick={() => setActiveGroupIdx('all')}
                className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                  activeGroupIdx === 'all'
                    ? 'bg-white text-slate-950 border-white'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                }`}
              >
                全部 ({groups.length})
              </button>
              {groups.map((grp, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveGroupIdx(idx)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    activeGroupIdx === idx
                      ? 'bg-white text-slate-950 border-white'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  {translatePartitionName(grp.name)}
                </button>
              ))}
            </div>
          )}

          {/* Qualification Zone Legend for NBA */}
          {currentLeagueCfg.id === 'nba' && (
            <div className="flex flex-wrap items-center gap-4 px-4 py-2 rounded-xl bg-slate-900/50 border border-slate-800/80 text-xs text-slate-300">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500" />
                1-6 季后赛直通区
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-amber-500" />
                7-10 附加赛区
              </span>
            </div>
          )}

          {/* Standings Tables Grid */}
          <div
            className={`grid gap-5 ${
              activeGroupIdx === 'all' && displayedGroups.length === 2
                ? 'grid-cols-1 xl:grid-cols-2'
                : 'grid-cols-1'
            }`}
          >
            {displayedGroups.map((grp, gIdx) => (
              <div
                key={gIdx}
                className="bg-slate-900/85 border border-slate-800 rounded-2xl overflow-hidden shadow-xl flex flex-col"
              >
                <div
                  className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between"
                  style={{
                    borderLeft: `4px solid ${currentLeagueCfg.accentColor}`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30 text-[11px] font-bold">
                      {currentLeagueCfg.zoneName}
                    </span>
                    <h3 className="font-extrabold text-sm text-white">
                      {translatePartitionName(grp.name)}
                    </h3>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs sm:text-sm text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-950/50 text-slate-400 border-b border-slate-800/80 text-xs">
                        <th className="py-2.5 px-3 font-semibold w-12 text-center">
                          #
                        </th>
                        <th className="py-2.5 px-3 font-semibold min-w-[150px]">
                          球队
                        </th>
                        {grp.headers.map((h) => (
                          <th
                            key={h.key}
                            title={h.title}
                            className="py-2.5 px-2.5 font-semibold text-right whitespace-nowrap"
                          >
                            {h.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {grp.entries.map((entry, idx) => {
                        const isNBA = currentLeagueCfg.id === 'nba';
                        const isPlayoffDirect = isNBA && idx < 6;
                        const isPlayIn = isNBA && idx >= 6 && idx < 10;

                        return (
                          <React.Fragment key={entry.teamId + idx}>
                            {isNBA && idx === 6 && (
                              <tr className="bg-amber-500/10 border-y border-amber-500/30">
                                <td
                                  colSpan={grp.headers.length + 2}
                                  className="py-1 px-4 text-[11px] font-bold text-amber-400 text-center"
                                >
                                  附加赛分界线
                                </td>
                              </tr>
                            )}
                            {isNBA && idx === 10 && (
                              <tr className="bg-slate-800/60 border-y border-slate-700/60">
                                <td
                                  colSpan={grp.headers.length + 2}
                                  className="py-1 px-4 text-[11px] font-semibold text-slate-400 text-center"
                                >
                                  季后赛资格线
                                </td>
                              </tr>
                            )}
                            <tr
                              className={`hover:bg-slate-800/40 transition-colors ${
                                isPlayoffDirect
                                  ? 'border-l-2 border-l-emerald-500'
                                  : isPlayIn
                                  ? 'border-l-2 border-l-amber-500'
                                  : ''
                              }`}
                            >
                              <td className="py-2.5 px-3 text-center font-bold tabular-nums">
                                <span
                                  className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs ${
                                    isPlayoffDirect
                                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                      : isPlayIn
                                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                      : idx < 4
                                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  {entry.rank}
                                </span>
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-2.5">
                                  {entry.logo ? (
                                    <img
                                      src={entry.logo}
                                      alt={entry.teamName}
                                      className="w-6 h-6 object-contain shrink-0"
                                    />
                                  ) : (
                                    <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-400 shrink-0">
                                      {entry.abbreviation}
                                    </div>
                                  )}
                                  <div>
                                    <span className="font-semibold text-white block leading-snug">
                                      {entry.teamName}
                                    </span>
                                    {entry.noteDescription && (
                                      <span className="text-[10px] text-emerald-400">
                                        {entry.noteDescription}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              {grp.headers.map((h) => (
                                <td
                                  key={h.key}
                                  className="py-2.5 px-2.5 text-right tabular-nums text-slate-300 font-medium whitespace-nowrap"
                                >
                                  {entry.stats[h.key] ?? '-'}
                                </td>
                              ))}
                            </tr>
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
