export interface LeagueConfig {
  id: string;
  name: string;
  shortName: string;
  englishName: string;
  sport: string;
  league: string;
  category:
    | 'basketball'
    | 'soccer'
    | 'football'
    | 'baseball'
    | 'hockey'
    | 'tennis'
    | 'racing';
  zoneId: 'basketball' | 'soccer' | 'american' | 'global';
  zoneName: string;
  accentColor: string;
  badgeText: string;
  supportsStandings: boolean;
}

export interface SportZone {
  id: 'basketball' | 'soccer' | 'american' | 'global';
  name: string;
  englishName: string;
  description: string;
  accentColor: string;
  leagueIds: string[];
}

export const SPORT_ZONES: SportZone[] = [
  {
    id: 'basketball',
    name: '篮球专区',
    englishName: 'BASKETBALL ZONE',
    description: 'NBA 常规赛、季后赛实时比分与东西部排名',
    accentColor: '#f97316',
    leagueIds: ['nba'],
  },
  {
    id: 'soccer',
    name: '足球专区',
    englishName: 'FOOTBALL / SOCCER ZONE',
    description: '欧洲顶级豪门赛事：英超、欧冠、西甲实时赛况与积分榜，含中超',
    accentColor: '#10b981',
    leagueIds: ['epl', 'ucl', 'laliga', 'csl'],
  },
  {
    id: 'american',
    name: '美式四大联盟专区',
    englishName: 'US MAJOR LEAGUES',
    description: 'NFL 橄榄球、MLB 棒球、NHL 冰球全美职业联赛实况',
    accentColor: '#3b82f6',
    leagueIds: ['nfl', 'mlb', 'nhl'],
  },
  {
    id: 'global',
    name: '网球与极速竞技专区',
    englishName: 'TENNIS & MOTORSPORT',
    description: 'ATP 世界男子网球巡回赛与 F1 世界一级方程式锦标赛',
    accentColor: '#ef4444',
    leagueIds: ['atp', 'f1'],
  },
];

export const LEAGUES: LeagueConfig[] = [
  {
    id: 'nba',
    name: 'NBA 职业篮球联赛',
    shortName: 'NBA',
    englishName: 'National Basketball Association',
    sport: 'basketball',
    league: 'nba',
    category: 'basketball',
    zoneId: 'basketball',
    zoneName: '篮球专区',
    accentColor: '#f97316',
    badgeText: '篮球',
    supportsStandings: true,
  },
  {
    id: 'epl',
    name: '英格兰超级联赛',
    shortName: '英超',
    englishName: 'Premier League',
    sport: 'soccer',
    league: 'eng.1',
    category: 'soccer',
    zoneId: 'soccer',
    zoneName: '足球专区',
    accentColor: '#10b981',
    badgeText: '足球',
    supportsStandings: true,
  },
  {
    id: 'ucl',
    name: '欧洲冠军联赛',
    shortName: '欧冠',
    englishName: 'UEFA Champions League',
    sport: 'soccer',
    league: 'uefa.champions',
    category: 'soccer',
    zoneId: 'soccer',
    zoneName: '足球专区',
    accentColor: '#3b82f6',
    badgeText: '足球',
    supportsStandings: true,
  },
  {
    id: 'laliga',
    name: '西班牙足球甲级联赛',
    shortName: '西甲',
    englishName: 'LaLiga',
    sport: 'soccer',
    league: 'esp.1',
    category: 'soccer',
    zoneId: 'soccer',
    zoneName: '足球专区',
    accentColor: '#eab308',
    badgeText: '足球',
    supportsStandings: true,
  },
  {
    id: 'csl',
    name: '中国足球超级联赛',
    shortName: '中超',
    englishName: 'Chinese Super League',
    sport: 'soccer',
    league: 'chn.1',
    category: 'soccer',
    zoneId: 'soccer',
    zoneName: '足球专区',
    accentColor: '#e11d48',
    badgeText: '足球',
    supportsStandings: true,
  },
  {
    id: 'nfl',
    name: 'NFL 美式职业橄榄球',
    shortName: 'NFL',
    englishName: 'National Football League',
    sport: 'football',
    league: 'nfl',
    category: 'football',
    zoneId: 'american',
    zoneName: '美式联盟专区',
    accentColor: '#ef4444',
    badgeText: '橄榄球',
    supportsStandings: true,
  },
  {
    id: 'mlb',
    name: 'MLB 职业棒球大联盟',
    shortName: 'MLB',
    englishName: 'Major League Baseball',
    sport: 'baseball',
    league: 'mlb',
    category: 'baseball',
    zoneId: 'american',
    zoneName: '美式联盟专区',
    accentColor: '#06b6d4',
    badgeText: '棒球',
    supportsStandings: true,
  },
  {
    id: 'nhl',
    name: 'NHL 国家冰球联盟',
    shortName: 'NHL',
    englishName: 'National Hockey League',
    sport: 'hockey',
    league: 'nhl',
    category: 'hockey',
    zoneId: 'american',
    zoneName: '美式联盟专区',
    accentColor: '#8b5cf6',
    badgeText: '冰球',
    supportsStandings: true,
  },
  {
    id: 'atp',
    name: 'ATP',
    shortName: 'ATP',
    englishName: 'ATP Tour',
    sport: 'tennis',
    league: 'atp',
    category: 'tennis',
    zoneId: 'global',
    zoneName: '网球与赛车专区',
    accentColor: '#84cc16',
    badgeText: '网球',
    supportsStandings: false,
  },
  {
    id: 'f1',
    name: 'F1',
    shortName: 'F1',
    englishName: 'Formula 1',
    sport: 'racing',
    league: 'f1',
    category: 'racing',
    zoneId: 'global',
    zoneName: '网球与赛车专区',
    accentColor: '#dc2626',
    badgeText: '赛车',
    supportsStandings: true,
  },
];

export function getLeagueById(id: string): LeagueConfig {
  return LEAGUES.find((l) => l.id === id) || LEAGUES[0];
}
