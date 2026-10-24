'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLeagueById } from '@/lib/espn-config';
import { NewsArticle } from '@/lib/types';
import Navbar from '@/components/Navbar';
import NewsPanel from '@/components/NewsPanel';

interface NewsViewProps {
  leagueId: string;
}

export default function NewsView({ leagueId }: NewsViewProps) {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(8);

  useEffect(() => {
    const updatePageSize = () => {
      const reservedHeight = window.innerWidth < 768 ? 155 : 135;
      const available = window.innerHeight - reservedHeight;
      const rows = Math.max(4, Math.min(10, Math.floor(available / 78)));
      setPageSize(rows);
    };
    updatePageSize();
    window.addEventListener('resize', updatePageSize);
    return () => window.removeEventListener('resize', updatePageSize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPage(1);

    const fetchNews = () => {
      fetch(`/api/espn/news?league=${encodeURIComponent(leagueId)}`)
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled) {
            setArticles(Array.isArray(data.articles) ? data.articles : []);
          }
        })
        .catch(() => {
          if (!cancelled) setArticles([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    fetchNews();
    const timer = setInterval(fetchNews, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [leagueId]);

  const totalPages = Math.max(1, Math.ceil(articles.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleArticles = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return articles.slice(start, start + pageSize);
  }, [articles, currentPage, pageSize]);

  const meta =
    leagueId === 'all' ? { name: '全部资讯' } : getLeagueById(leagueId);

  return (
    <div className="h-dvh overflow-hidden flex flex-col bg-slate-950 text-slate-100">
      <Navbar currentLeague={leagueId} />
      <main className="flex-1 min-h-0 max-w-5xl w-full mx-auto px-3 sm:px-6 py-2.5 flex flex-col gap-2.5">
        <div className="shrink-0 bg-slate-900/85 border border-slate-800 rounded-xl px-3.5 py-2 flex items-center justify-between">
          <span className="text-xs font-extrabold text-white">
            {meta.name}
          </span>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="p-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 disabled:opacity-30 hover:bg-slate-800 cursor-pointer disabled:cursor-default"
            >
              <ChevronLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
            <span className="text-xs font-bold tabular-nums text-slate-300 px-1">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="p-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 disabled:opacity-30 hover:bg-slate-800 cursor-pointer disabled:cursor-default"
            >
              <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          <NewsPanel articles={visibleArticles} loading={loading} />
        </div>
      </main>
    </div>
  );
}
