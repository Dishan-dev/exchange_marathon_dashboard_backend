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

export interface IgvMatchingMember {
  name: string;
  role: string;
  team: string;
  matching_interviews: number;
  acceptance: number;
  approvals: number;
  total: number;
}

export interface IgvIrMember {
  name: string;
  role: string;
  team: string;
  ir_calls: number;
  ir_application: number;
  ir_approvals: number;
  total: number;
}

export interface IgvMarcomMember {
  name: string;
  role: string;
  flyers: number;
  videos: number;
  presentations: number;
  total: number;
}

export interface IgvIrmSyncPayload {
  matching_members: IgvMatchingMember[];
  ir_members: IgvIrMember[];
  marcom_members: IgvMarcomMember[];
}

export interface IgtIrMember {
  name: string;
  role: string;
  ir_calls_scheduled: number;
  ir_cvs_collected: number;
  ir_calls_participated: number;
  points: number;
}

export interface IgtMatchingMember {
  name: string;
  role: string;
  eps_reached_out_to: number;
  interviews_scheduled: number;
  interviews_successful: number;
  apds: number;
  points: number;
}

export interface IgtIrmSyncPayload {
  igt_ir_members: IgtIrMember[];
  igt_matching_members: IgtMatchingMember[];
  synced_at: string;
}

export interface XcendCrMember {
  person: string;
  role: string;
  number_of_sign_ups: number;
  number_of_applications: number;
  number_of_approvals: number;
  points: number;
}

export interface XcendIrMember {
  person: string;
  role: string;
  number_of_ir_scheduled: number;
  number_of_ir_calls_taken: number;
  matching: number;
  points: number;
}

export interface XcendPsSyncPayload {
  xcend_cr: XcendCrMember[];
  xcend_ir: XcendIrMember[];
  synced_at: string;
}
export interface XcendB2cMember {
  team: string;
  member_name: string;
  role: string;
  country_based: number;
  project_based: number;
  trend_based: number;
  no_of_signups: number;
  points: number;
}

export interface XcendB2cSyncPayload {
  xcend_b2c_members: XcendB2cMember[];
  synced_at: string;
}
