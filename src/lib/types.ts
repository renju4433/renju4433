export interface TeamCompetitor {
  id: string;
  name: string;
  shortName: string;
  abbreviation: string;
  logo: string;
  color?: string;
  score: string;
  winner?: boolean;
  homeAway: 'home' | 'away' | 'neutral';
  record?: string;
  rank?: number;
  linescores?: string[];
  leaders?: {
    category: string;
    displayValue: string;
    athleteName: string;
    athleteHeadshot?: string;
  }[];
  statistics?: {
    name: string;
    label: string;
    displayValue: string;
  }[];
  order?: number;
}

export interface GBDTPrediction {
  hasDraw: boolean;
  winProb: number; // Team A (left) win probability (0-100)
  drawProb?: number; // Draw probability (0-100, only when hasDraw is true)
  lossProb: number; // Team B (right) win probability (0-100)
  predictedOutcome: '胜' | '平' | '负';
  predictedWinnerName: string;
  expectedGoals?: {
    home: number;
    away: number;
  };
  scoreHeatmap?: {
    maxGoals: number;
    matrix: number[][];
    topScores: {
      score: string;
      prob: number;
    }[];
  };
}

export interface NormalizedEvent {
  id: string;
  uid?: string;
  date: string;
  name: string;
  shortName: string;
  leagueId: string;
  leagueName: string;
  sport: string;
  status: {
    state: 'pre' | 'in' | 'post';
    completed: boolean;
    detail: string;
    shortDetail: string;
    displayClock?: string;
    period?: number;
  };
  venue?: {
    fullName: string;
    city?: string;
    country?: string;
  };
  broadcasts: string[];
  note?: string;
  isMultiCompetitor?: boolean; // e.g., F1 racing
  competitors: TeamCompetitor[]; // 2 for team/tennis, or N for racing
  gbdtPrediction?: GBDTPrediction;
  headlines?: {
    description: string;
    shortLinkText?: string;
  }[];
}

export interface NewsArticle {
  id: string;
  headline: string;
  description: string;
  published: string;
  imageUrl?: string;
  imageCaption?: string;
  externalUrl?: string;
  categories: string[];
  byline?: string;
}

export interface StandingEntry {
  rank: number;
  teamId: string;
  teamName: string;
  teamShortName: string;
  abbreviation: string;
  logo: string;
  noteColor?: string;
  noteDescription?: string;
  stats: Record<string, string>;
}

export interface StandingGroup {
  name: string;
  abbreviation?: string;
  headers: {
    key: string;
    label: string;
    title: string;
  }[];
  entries: StandingEntry[];
}

export interface EventSummaryDetail {
  eventId: string;
  leagueId?: string;
  leagueName?: string;
  sport?: string;
  name?: string;
  shortName?: string;
  isMultiCompetitor?: boolean;
  status?: {
    state: 'pre' | 'in' | 'post';
    completed: boolean;
    detail: string;
    shortDetail: string;
  };
  header?: {
    venue?: string;
    attendance?: number;
    statusDetail?: string;
    note?: string;
  };
  linescoreHeaders: string[];
  competitors: TeamCompetitor[];
  gbdtPrediction?: GBDTPrediction;
  teamStats: {
    label: string;
    homeValue: string;
    awayValue: string;
    homePercent?: number;
  }[];
  boxscoreGroups: {
    teamName: string;
    teamLogo: string;
    teamAbbrev: string;
    statLabels: string[];
    players: {
      id: string;
      name: string;
      shortName: string;
      jersey?: string;
      position?: string;
      starter?: boolean;
      headshot?: string;
      stats: string[];
      didNotPlay?: boolean;
      reason?: string;
    }[];
  }[];
  keyEvents: {
    id: string;
    clock: string;
    period: string;
    type: string;
    text: string;
    teamLogo?: string;
    scoringPlay?: boolean;
    scoreValue?: string;
  }[];
  CommentaryOrPlays: {
    id: string;
    clock: string;
    period: string;
    text: string;
    scoringPlay?: boolean;
    awayScore?: number;
    homeScore?: number;
  }[];
}
