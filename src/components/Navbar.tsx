'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Newspaper } from 'lucide-react';
import { LEAGUES } from '@/lib/espn-config';
import { HOME_HREF } from '@/lib/routes';

interface NavbarProps {
  currentLeague?: string;
  currentStatus?: 'all' | 'in' | 'pre' | 'post';
}

export default function Navbar({
  currentLeague = 'all',
  currentStatus = 'all',
}: NavbarProps) {
  const pathname = usePathname();
  const isNews = pathname.startsWith('/news');

  const getLeagueHref = (leagueId: string) => {
    if (isNews) {
      return leagueId === 'all' ? '/news' : `/news/${leagueId}`;
    }
    if (currentStatus && currentStatus !== 'all') {
      return `/league/${leagueId}/${currentStatus}`;
    }
    return leagueId === 'all' ? HOME_HREF : `/league/${leagueId}`;
  };

  const scoreboardHref =
    currentStatus && currentStatus !== 'all'
      ? `/league/${currentLeague}/${currentStatus}`
      : currentLeague === 'all'
      ? HOME_HREF
      : `/league/${currentLeague}`;

  const newsHref =
    currentLeague === 'all' ? '/news' : `/news/${currentLeague}`;

  const navItems = [
    { id: 'all', label: '全部' },
    ...LEAGUES.map((l) => ({
      id: l.id,
      label: l.shortName,
    })),
  ];

  return (
    <header className="shrink-0 bg-slate-950 border-b border-slate-800 px-3 sm:px-6 py-2">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        {/* Top Row on Mobile / Left+Right on Desktop */}
        <div className="flex items-center justify-between gap-2">
          <Link href={HOME_HREF} className="flex items-center shrink-0">
            <div className="bg-gradient-to-r from-red-600 to-orange-500 text-white font-black tracking-tight text-sm sm:text-base px-3 py-1 rounded-lg shadow-md shadow-red-600/20">
              赛源网
            </div>
          </Link>

          {/* Mobile-only Scoreboard / News Switcher */}
          <div className="flex md:hidden items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800 shrink-0">
            <Link
              href={scoreboardHref}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
                !isNews
                  ? 'bg-red-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>比分</span>
            </Link>
            <Link
              href={newsHref}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
                isNews
                  ? 'bg-red-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Newspaper className="w-3.5 h-3.5" />
              <span>资讯</span>
            </Link>
          </div>
        </div>

        {/* Center: Continuous Connected Navigation Bar */}
        <nav className="inline-flex items-center bg-slate-900 border border-slate-800 rounded-xl p-0.5 sm:p-1 divide-x divide-slate-800/80 overflow-x-auto no-scrollbar w-full md:w-auto">
          {navItems.map((item) => {
            const active = currentLeague === item.id;
            return (
              <Link
                key={item.id}
                href={getLeagueHref(item.id)}
                className={`flex-1 md:flex-initial text-center px-2.5 sm:px-3.5 py-1 text-xs font-bold whitespace-nowrap transition-all first:rounded-l-lg last:rounded-r-lg ${
                  active
                    ? 'bg-red-600 text-white shadow-xs'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Desktop Scoreboard / News Switcher */}
        <div className="hidden md:inline-flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800 shrink-0">
          <Link
            href={scoreboardHref}
            className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              !isNews
                ? 'bg-red-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>比分</span>
          </Link>
          <Link
            href={newsHref}
            className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              isNews
                ? 'bg-red-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Newspaper className="w-3.5 h-3.5" />
            <span>资讯</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
