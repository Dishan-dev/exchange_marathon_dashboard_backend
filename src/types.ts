export interface CriteriaCounts {
  mous: number;
  coldCalls: number;
  followups: number;
}

export interface MemberProfile {
  email: string;
  name: string;
  role: string;
  functionSlug: string;
  team: string;
  squad?: string;
}

export interface MemberSnapshot {
  id: string;
  email: string;
  name: string;
  role: string;
  functionSlug: string;
  team: string;
  squad?: string;
  dateKey: string;
  weekKey: string;
  counts: CriteriaCounts;
  points: number;
  sourceUpdatedAt: string;
  syncedAt: string;
}

export interface ActionLog {
  id?: number;
  memberEmail: string;
  functionSlug: string;
  teamSlug: string;
  actionType: string;
  actionTimestamp: string;
  syncedAt?: string;
}

export interface TeamDashboardPerformer {
  email: string; // 👈 Added for unique keys
  name: string;
  role: string;
  score: number;
  avatar: string;
  metrics: CriteriaCounts;
}

export interface TeamDashboardMiniTeam {
  slug: string; // 👈 Added for display
  name: string;
  rank: number;
  points: number;
  growth: number;
  icon: string;
  performers: TeamDashboardPerformer[];
  allPerformers?: TeamDashboardPerformer[];
}

export interface TeamDashboardPayload {
  name: string;
  displayName: string;
  functionSlug?: string;
  miniTeams: TeamDashboardMiniTeam[];
  totalPoints: number;
  totalGrowth: number;
  completedActions: number;
  weeklyGrowth: number;
  asOfDate: string;
  period: "daily" | "weekly" | "bi-weekly" | "monthly" | "marathon";
  syncInfo?: {
    lastSyncTime: string;
    nextSyncTime: string;
    intervalMinutes: number;
    runId?: string;
    rowCount?: number;
    sheetName?: string;
  };
}

export interface SyncSource {
  id: string;
  functionSlug: string;
  spreadsheetId: string;
  sheetNames: string[];
  columnMapping: {
    email: string;
    name: string;
    role: string;
    mous: string;
    coldCalls: string;
    followups: string;
    timestamp: string;
  };
  scoringRules: {
    mou: number;
    coldCall: number;
    followup: number;
  };
  isActive: boolean;
  lastSyncAt?: string;
}

export interface MktMember {
  Member: string;
  Position: string;
  Points: string | number;
}

export interface IRMTableEntry {
  name: string;
  ir_calls: number;
  ir_applications: number;
  ir_approvals: number;
  total_points: number;
}

export interface MarcomTableEntry {
  name: string;
  flyers: number;
  videos: number;
  presentations: number;
  total_points: number;
}

export interface SyncTablePayload {
  tableName: string;
  rows: (IRMTableEntry | MarcomTableEntry)[];
}

export interface SyncAllSheetsPayload {
  tables: SyncTablePayload[];
}
