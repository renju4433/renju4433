'use client';

import React from 'react';
import { Newspaper, ExternalLink, Clock } from 'lucide-react';
import { NewsArticle } from '@/lib/types';

interface NewsPanelProps {
  articles: NewsArticle[];
  loading?: boolean;
}

export default function NewsPanel({
  articles,
  loading = false,
}: NewsPanelProps) {
  const formatTimeAgo = (iso: string) => {
    try {
      const diffMs = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) return '刚刚';
      if (mins < 60) return `${mins}分钟前`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}小时前`;
      const days = Math.floor(hours / 24);
      return `${days}天前`;
    } catch {
      return '';
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-2 content-start">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div
            key={n}
            className="h-[68px] sm:h-[72px] rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse px-4"
          />
        ))}
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-900/50 rounded-xl border border-slate-800 text-slate-400 text-xs">
        暂无资讯
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 content-start">
      {articles.map((art) => (
        <a
          key={art.id}
          href={art.externalUrl || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="group h-[68px] sm:h-[72px] bg-slate-900/80 border border-slate-800 hover:border-slate-700 hover:bg-slate-900 rounded-xl px-3 sm:px-4 flex items-center justify-between gap-3 transition-all"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {art.imageUrl ? (
              <img
                src={art.imageUrl}
                alt={art.headline}
                className="w-16 h-12 sm:w-20 sm:h-13 object-cover rounded-lg bg-slate-950 shrink-0"
              />
            ) : (
              <div className="w-16 h-12 sm:w-20 sm:h-13 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0">
                <Newspaper className="w-5 h-5 text-red-500/40" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-xs sm:text-sm text-slate-100 group-hover:text-red-400 transition-colors truncate">
                {art.headline}
              </h3>

              <div className="flex items-center gap-2 mt-1 text-[10px] sm:text-[11px] text-slate-500">
                <span className="flex items-center gap-1 shrink-0">
                  <Clock className="w-3 h-3" />
                  {formatTimeAgo(art.published)}
                </span>
                {art.categories[0] && (
                  <span className="truncate text-slate-400">
                    · {art.categories[0]}
                  </span>
                )}
              </div>
            </div>
          </div>

          <ExternalLink className="w-3.5 h-3.5 text-red-400 shrink-0 opacity-75 group-hover:opacity-100" />
        </a>
      ))}
    </div>
  );
}
