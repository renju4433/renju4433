'use client';

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Flame,
  Search,
  Sparkles,
} from 'lucide-react';
import { GBDTPrediction, NormalizedEvent } from '@/lib/types';
import { HOME_HREF } from '@/lib/routes';
import Navbar from '@/components/Navbar';
import ScoreCard from '@/components/ScoreCard';

type StatusFilter = 'all' | 'in' | 'pre' | 'post';

function formatToInputDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatToESPNDate(inputDate: string): string {
  return inputDate.replace(/-/g, '');
}

interface ScoreboardViewProps {
  leagueId: string;
  initialStatus?: StatusFilter;
}

function ScoreboardInner({
  leagueId,
  initialStatus = 'all',
}: ScoreboardViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Read filters from URL route & searchParams
  const urlStatus = searchParams.get('status') as StatusFilter | null;
  const statusFilter: StatusFilter =
    initialStatus !== 'all'
      ? initialStatus
      : urlStatus === 'in' || urlStatus === 'pre' || urlStatus === 'post'
      ? urlStatus
      : 'all';

  const todayStr = formatToInputDate(new Date());
  const selectedDate = searchParams.get('date') || '';
  const searchQuery = searchParams.get('q') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);

  const [pageSize, setPageSize] = useState<number>(9);
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [predictionsMap, setPredictionsMap] = useState<
    Record<string, GBDTPrediction>
  >({});
  const [loadingScores, setLoadingScores] = useState<boolean>(true);

  // Helper to build route URL with current query params
  const buildFilterUrl = useCallback(
    (overrides: {
      status?: StatusFilter;
      date?: string;
      q?: string;
      page?: number;
    }) => {
      const nextStatus = overrides.status ?? statusFilter;
      const nextDate = overrides.date ?? selectedDate;
      const nextQ = overrides.q ?? searchQuery;
      const nextPage = overrides.page ?? page;

      const basePath =
        nextStatus === 'all'
          ? leagueId === 'all'
            ? HOME_HREF
            : `/league/${leagueId}`
          : `/league/${leagueId}/${nextStatus}`;

      const params = new URLSearchParams();
      if (nextDate) params.set('date', nextDate);
      if (nextQ.trim()) params.set('q', nextQ.trim());
      if (nextPage > 1) params.set('page', String(nextPage));

      const qs = params.toString();
      return qs ? `${basePath}?${qs}` : basePath;
    },
    [leagueId, statusFilter, selectedDate, searchQuery, page]
  );

  const updateRouteFilters = useCallback(
    (overrides: {
      status?: StatusFilter;
      date?: string;
      q?: string;
      page?: number;
    }) => {
      const targetUrl = buildFilterUrl(overrides);
      router.push(targetUrl);
    },
    [buildFilterUrl, router]
  );

  // Dynamically calculate how many 1-row match bars fit in the current viewport height
  useEffect(() => {
    const updatePageSize = () => {
      const reservedHeight = window.innerWidth < 1024 ? 195 : 145;
      const available = window.innerHeight - reservedHeight;
      const rows = Math.max(4, Math.min(10, Math.floor(available / 78)));
      setPageSize(rows);
    };
    updatePageSize();
    window.addEventListener('resize', updatePageSize);
    return () => window.removeEventListener('resize', updatePageSize);
  }, []);

  const fetchScoreboardData = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingScores(true);

      try {
        const dateParam = selectedDate
          ? `&date=${formatToESPNDate(selectedDate)}`
          : '';
        const res = await fetch(
          `/api/espn/scoreboard?league=${encodeURIComponent(
            leagueId
          )}${dateParam}`
        );
        const data = await res.json();
        if (Array.isArray(data.events)) {
          setEvents(data.events);
        }
      } catch (err) {
        console.error('Failed to fetch scoreboard:', err);
      } finally {
        setLoadingScores(false);
      }
    },
    [leagueId, selectedDate]
  );

  const fetchPredictionsData = useCallback(async () => {
    try {
      const dateParam = selectedDate
        ? `&date=${formatToESPNDate(selectedDate)}`
        : '';
      const res = await fetch(
        `/api/espn/predict?league=${encodeURIComponent(leagueId)}${dateParam}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data?.predictions && typeof data.predictions === 'object') {
        setPredictionsMap(data.predictions);
      }
    } catch (err) {
      console.error('Failed to fetch real-time GBDT predictions:', err);
    }
  }, [leagueId, selectedDate]);

  useEffect(() => {
    fetchScoreboardData(false);
    fetchPredictionsData();
  }, [fetchScoreboardData, fetchPredictionsData]);

  // Silent background auto-refresh for scores & real-time GBDT predictions
  useEffect(() => {
    const scoreTimer = setInterval(() => {
      fetchScoreboardData(true);
    }, 30000);
    const predictTimer = setInterval(() => {
      fetchPredictionsData();
    }, 15000);
    return () => {
      clearInterval(scoreTimer);
      clearInterval(predictTimer);
    };
  }, [fetchScoreboardData, fetchPredictionsData]);

  const shiftDate = (days: number) => {
    let base = new Date();
    if (selectedDate) {
      const parts = selectedDate.split('-').map(Number);
      if (parts.length === 3 && !parts.some(isNaN)) {
        base = new Date(parts[0], parts[1] - 1, parts[2]);
      }
    }
    base.setDate(base.getDate() + days);
    updateRouteFilters({ date: formatToInputDate(base), page: 1 });
  };

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      if (statusFilter !== 'all' && ev.status.state !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName =
          ev.name.toLowerCase().includes(q) ||
          ev.leagueName.toLowerCase().includes(q) ||
          ev.competitors.some(
            (c) =>
              c.name.toLowerCase().includes(q) ||
              c.shortName.toLowerCase().includes(q) ||
              c.abbreviation.toLowerCase().includes(q)
          );
        if (!matchName) return false;
      }
      return true;
    });
  }, [events, statusFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleEvents = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredEvents.slice(start, start + pageSize);
  }, [filteredEvents, currentPage, pageSize]);

  const counts = useMemo(() => {
    return {
      all: events.length,
      in: events.filter((e) => e.status.state === 'in').length,
      pre: events.filter((e) => e.status.state === 'pre').length,
      post: events.filter((e) => e.status.state === 'post').length,
    };
  }, [events]);

  return (
    <div className="h-dvh overflow-hidden flex flex-col bg-slate-950 text-slate-100">
      <Navbar currentLeague={leagueId} currentStatus={statusFilter} />

      <main className="flex-1 min-h-0 max-w-5xl w-full mx-auto px-3 sm:px-6 py-2.5 flex flex-col gap-2.5">
        {/* Responsive Control Bar */}
        <div className="shrink-0 bg-slate-900/85 border border-slate-800 rounded-xl p-2 sm:px-3.5 sm:py-2 flex flex-col lg:flex-row lg:items-center justify-between gap-2">
          {/* Top Row on Mobile/Tablet: Status Filter Route Links + Pagination */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {(
                [
                  { id: 'all', label: '全部', count: counts.all },
                  { id: 'in', label: '进行中', count: counts.in },
                  { id: 'pre', label: '未开赛', count: counts.pre },
                  { id: 'post', label: '已结束', count: counts.post },
                ] as const
              ).map((tab) => (
                <Link
                  key={tab.id}
                  href={buildFilterUrl({ status: tab.id, page: 1 })}
                  className={`px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-semibold transition-all flex items-center gap-1 whitespace-nowrap shrink-0 ${
                    statusFilter === tab.id
                      ? 'bg-slate-100 text-slate-950 font-bold'
                      : 'bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {tab.id === 'in' && counts.in > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                  )}
                  <span>{tab.label}</span>
                  <span className="text-[10px] opacity-75">({tab.count})</span>
                </Link>
              ))}
            </div>

            {/* Mobile/Tablet Pagination */}
            <div className="flex lg:hidden items-center gap-1 shrink-0">
              <button
                onClick={() =>
                  updateRouteFilters({ page: Math.max(1, currentPage - 1) })
                }
                disabled={currentPage <= 1}
                className="p-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-bold tabular-nums text-slate-300 px-1 whitespace-nowrap">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() =>
                  updateRouteFilters({
                    page: Math.min(totalPages, currentPage + 1),
                  })
                }
                disabled={currentPage >= totalPages}
                className="p-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Second Row on Mobile/Tablet: Date Selector + Search + Desktop Pagination */}
          <div className="flex items-center justify-between lg:justify-end gap-2 min-w-0">
            <div className="flex items-center gap-1 bg-slate-950 p-0.5 sm:p-1 rounded-lg border border-slate-800 shrink-0">
              <Link
                href={buildFilterUrl({ date: todayStr, page: 1 })}
                className={`px-2 py-0.5 rounded text-[11px] sm:text-xs font-semibold transition-colors flex items-center gap-1 whitespace-nowrap ${
                  selectedDate === todayStr
                    ? 'bg-red-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                今天
              </Link>

              <button
                onClick={() => shiftDate(-1)}
                className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <div className="relative flex items-center">
                <Calendar className="w-3 h-3 text-slate-400 ml-1 pointer-events-none hidden sm:block" />
                <input
                  type="date"
                  value={selectedDate || formatToInputDate(new Date())}
                  onChange={(e) =>
                    updateRouteFilters({ date: e.target.value, page: 1 })
                  }
                  className="bg-transparent text-[11px] sm:text-xs font-medium text-slate-200 px-1 py-0.5 focus:outline-none cursor-pointer w-26 sm:w-28"
                />
              </div>

              <button
                onClick={() => shiftDate(1)}
                className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="relative flex-1 lg:flex-initial lg:w-44 min-w-0">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) =>
                  updateRouteFilters({ q: e.target.value, page: 1 })
                }
                placeholder="搜索球队..."
                className="w-full pl-7 pr-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-[11px] sm:text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-red-500/60"
              />
            </div>

            {/* Desktop Pagination */}
            <div className="hidden lg:flex items-center gap-1.5 shrink-0">
              <button
                onClick={() =>
                  updateRouteFilters({ page: Math.max(1, currentPage - 1) })
                }
                disabled={currentPage <= 1}
                className="p-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 disabled:opacity-30 hover:bg-slate-800 cursor-pointer disabled:cursor-default"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-bold tabular-nums text-slate-300 px-1 whitespace-nowrap">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() =>
                  updateRouteFilters({
                    page: Math.min(totalPages, currentPage + 1),
                  })
                }
                disabled={currentPage >= totalPages}
                className="p-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 disabled:opacity-30 hover:bg-slate-800 cursor-pointer disabled:cursor-default"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* 1-Per-Row Match List */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {loadingScores ? (
            <div className="grid grid-cols-1 gap-2 content-start">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <div
                  key={n}
                  className="h-[68px] sm:h-[72px] rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse px-4"
                />
              ))}
            </div>
          ) : visibleEvents.length === 0 ? (
            <div className="h-full bg-slate-900/60 border border-slate-800 rounded-xl flex flex-col items-center justify-center gap-2">
              <Flame className="w-8 h-8 text-slate-600" />
              <div className="text-sm font-bold text-slate-300">暂无赛事</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 content-start">
              {visibleEvents.map((ev) => {
                const livePred =
                  predictionsMap[`${ev.leagueId}-${ev.id}`] ||
                  predictionsMap[ev.id] ||
                  ev.gbdtPrediction;
                return (
                  <ScoreCard
                    key={`${ev.leagueId}-${ev.id}`}
                    event={{ ...ev, gbdtPrediction: livePred }}
                    showLeagueBadge={leagueId === 'all'}
                  />
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function ScoreboardView(props: ScoreboardViewProps) {
  return (
    <Suspense
      fallback={
        <div className="h-dvh bg-slate-950 text-slate-100 flex flex-col" />
      }
    >
      <ScoreboardInner {...props} />
    </Suspense>
  );
}
