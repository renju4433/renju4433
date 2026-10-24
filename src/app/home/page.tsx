import React from 'react';
import ScoreboardView from '@/components/ScoreboardView';

export const metadata = {
  title: '赛源网',
  description: '赛源网 - 足球实时比分与泊松模型预测',
};

export default function HomeAliasPage() {
  return <ScoreboardView leagueId="all" />;
}
