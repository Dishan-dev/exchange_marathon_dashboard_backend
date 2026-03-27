import { getSupabase } from "./supabase.js";
import { currentDateKey, getStartDateForPeriod, nowIso } from "./date.js";
import { config } from "./config.js";
import type {
  TeamDashboardMiniTeam,
  TeamDashboardPayload,
  TeamDashboardPerformer
} from "./types.js";

function prettifyTeamSlug(team: string): string {
  if (!team) return "Team";
  return team
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "NA";
}

export async function getTeamDashboard(
  targetSlug: string,
  period: "daily" | "weekly" | "bi-weekly" | "monthly" | "marathon" = "daily",
  asOfDate?: string,
  prefetchedDocs?: any[],
  level: "team" | "function" = "team"
): Promise<TeamDashboardPayload> {
  const supabase = getSupabase() as any;
  let dateKey = asOfDate || currentDateKey();
  const startDate = getStartDateForPeriod(period);
  
  let docs: any[] = [];

  if (prefetchedDocs) {
    if (startDate) {
      docs = prefetchedDocs.filter(d => d.dateKey >= startDate);
    } else {
      docs = prefetchedDocs;
    }
    if (!asOfDate && docs.length > 0) {
      const dates = Array.from(new Set(docs.map(d => d.dateKey))).sort().reverse();
      dateKey = dates[0] || dateKey;
    }
  } else {
    // Fetch from Supabase
    let query = supabase
      .from("daily_snapshots")
      .select("*")
      .eq(level === "team" ? "team_slug" : "function_slug", targetSlug.toLowerCase());

    if (period === "daily") {
      query = query.eq("date_key", dateKey);
    } else if (startDate) {
      query = query.gte("date_key", startDate);
    }

    const { data, error } = await query;
    if (error) throw error;
    docs = data || [];
  }

  const performerMap = new Map<string, TeamDashboardPerformer>();
  const memberGroupMap = new Map<string, string>(); 

  for (const row of docs) {
    const email = row.member_email || row.email;
    const teamValue = row.team_slug || row.team;
    const groupName = level === "function" ? (teamValue || "General") : "General";
    memberGroupMap.set(email, groupName);

    const existing = performerMap.get(email);
    const score = Number(row.points || 0);
    const counts = {
      mous: Number(row.mous || row.counts?.mous || 0),
      coldCalls: Number(row.cold_calls || row.counts?.coldCalls || 0),
      followups: Number(row.followups || row.counts?.followups || 0)
    };

      if (existing) {
        existing.score += score;
        existing.metrics.mous += counts.mous;
        existing.metrics.coldCalls += counts.coldCalls;
        existing.metrics.followups += counts.followups;
      } else {
        performerMap.set(email, {
          email, // 👈 Populate email
          name: String(row.name || "Unknown"),
          role: String(row.role || "Member"),
          score: score,
          avatar: initials(String(row.name || "Unknown")),
          metrics: counts
        });
      }
    }
  
    const groupMap = new Map<string, TeamDashboardPerformer[]>();
    for (const [email, performer] of performerMap.entries()) {
      const groupName = memberGroupMap.get(email) || "General";
      const peers = groupMap.get(groupName) || [];
      peers.push(performer);
      groupMap.set(groupName, peers);
    }
  
    const miniTeams: TeamDashboardMiniTeam[] = Array.from(groupMap.entries())
      .map(([name, performers]) => {
        const points = performers.reduce((sum, p) => sum + p.score, 0);
        // Generate a slug from the name if none exists in the data
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        return {
          slug,
          name,
          rank: 0,
          points,
          growth: 0,
          icon: initials(name),
          performers: performers.sort((a, b) => b.score - a.score)
        };
      })
      .sort((a, b) => b.points - a.points)
      .map((item, index) => ({ ...item, rank: index + 1 }));

  const totalPoints = miniTeams.reduce((sum, item) => sum + item.points, 0);
  const completedActions = miniTeams
    .flatMap((item) => item.performers)
    .reduce((sum, p) => sum + p.metrics.mous + p.metrics.coldCalls + p.metrics.followups, 0);

  return {
    name: level === "function" ? targetSlug.toUpperCase() : prettifyTeamSlug(targetSlug),
    displayName: `${level === "function" ? targetSlug.toUpperCase() : prettifyTeamSlug(targetSlug)} Performance Dashboard`,
    functionSlug: docs[0]?.function_slug || "b2b",
    miniTeams,
    totalPoints,
    totalGrowth: 0,
    completedActions,
    weeklyGrowth: 0,
    asOfDate: dateKey,
    period,
    syncInfo: {
      lastSyncTime: nowIso(), // Fallback
      nextSyncTime: nowIso(),
      intervalMinutes: config.syncScheduler.intervalMinutes
    }
  };
}

export async function getMktDashboard(
  title: string = "MKT",
  filterByPosition?: string,
  options?: { applyMstWeighting?: boolean }
): Promise<TeamDashboardPayload> {
  const supabase = getSupabase() as any;
  const { data, error } = await supabase
    .from("mkt_members")
    .select("*")
    .order("Points", { ascending: false });

  if (error) throw error;
  const members = data || [];
  const applyMstWeighting = !!options?.applyMstWeighting;

  if (applyMstWeighting) {
    type ParsedRow = {
      groupName: string;
      performer: TeamDashboardPerformer;
      roleLower: string;
    };

    const parsedRows: ParsedRow[] = members.map((m: any) => {
      const rawPosition = String(m.Position || "Member").trim();
      let teamPrefix = "";
      let roleName = rawPosition;

      if (rawPosition.includes("|")) {
        const parts = rawPosition.split("|");
        teamPrefix = parts[0]?.trim() || "";
        roleName = parts[1]?.trim() || rawPosition;
      }

      const roleLower = roleName.toLowerCase();
      let groupName = "Members";
      let normalizedRole = roleName.charAt(0).toUpperCase() + roleName.slice(1).toLowerCase();

      if (roleLower === "tl") {
        groupName = "TLs";
        normalizedRole = "TL";
      } else if (roleLower === "member") {
        groupName = "Members";
        normalizedRole = "Member";
      } else {
        groupName = normalizedRole;
      }

      if (teamPrefix) {
        groupName = teamPrefix;
      }

      return {
        groupName,
        roleLower,
        performer: {
          email: `${String(m.Member || "unknown").toLowerCase().replace(/\s+/g, ".")}_mkt@example.com`,
          name: String(m.Member || "Unknown"),
          role: normalizedRole,
          score: Number(m.Points || 0),
          avatar: initials(String(m.Member || "Unknown")),
          metrics: { mous: 0, coldCalls: 0, followups: 0 }
        }
      };
    });

    const teamRowsMap = new Map<string, ParsedRow[]>();
    for (const row of parsedRows) {
      const teamRows = teamRowsMap.get(row.groupName) || [];
      teamRows.push(row);
      teamRowsMap.set(row.groupName, teamRows);
    }

    const filterRole = filterByPosition?.toLowerCase();
    const miniTeams: TeamDashboardMiniTeam[] = Array.from(teamRowsMap.entries())
      .map(([name, rows]) => {
        const membersRows = rows.filter((r) => r.roleLower === "member");
        const tlRows = rows.filter((r) => r.roleLower === "tl");

        const memberPoints = membersRows.reduce((sum, r) => sum + r.performer.score, 0);
        const tlPoints = tlRows.reduce((sum, r) => sum + r.performer.score, 0);
        const basePoints = memberPoints + tlPoints;
        const weightedPoints = membersRows.length === 2 ? (basePoints * 4) / 3 : basePoints;

        const visibleRows = filterRole
          ? rows.filter((r) => r.roleLower === filterRole)
          : rows;

        return {
          slug: name.toLowerCase(),
          name,
          rank: 0,
          points: weightedPoints,
          growth: 0,
          icon: initials(name),
          performers: visibleRows.map((r) => r.performer).sort((a, b) => b.score - a.score),
          allPerformers: rows.map((r) => r.performer).sort((a, b) => b.score - a.score)
        };
      })
      .filter((t) => t.performers.length > 0)
      .sort((a, b) => b.points - a.points)
      .map((t, i) => ({ ...t, rank: i + 1 }));

    const totalPoints = miniTeams.reduce((sum, t) => sum + t.points, 0);

    return {
      name: title,
      displayName: `${title} Performance Dashboard`,
      functionSlug: title.toLowerCase(),
      miniTeams,
      totalPoints,
      totalGrowth: 0,
      completedActions: 0,
      weeklyGrowth: 0,
      asOfDate: currentDateKey(),
      period: "marathon",
      syncInfo: {
        lastSyncTime: nowIso(),
        nextSyncTime: nowIso(),
        intervalMinutes: config.syncScheduler.intervalMinutes
      }
    };
  }

  const groupMap = new Map<string, TeamDashboardPerformer[]>();

  for (const m of members) {
    const rawPosition = String(m.Position || "Member").trim();
    let teamPrefix = "";
    let roleName = rawPosition;

    if (rawPosition.includes("|")) {
      const parts = rawPosition.split("|");
      teamPrefix = parts[0]?.trim() || "";
      roleName = parts[1]?.trim() || rawPosition;
    }

    const roleLower = roleName.toLowerCase();

    if (filterByPosition && roleLower !== filterByPosition.toLowerCase()) continue;

    let groupName = "Members";
    let normalizedRole = roleName.charAt(0).toUpperCase() + roleName.slice(1).toLowerCase();

    if (roleLower === "tl") {
      groupName = "TLs";
      normalizedRole = "TL";
    } else if (roleLower === "member") {
      groupName = "Members";
      normalizedRole = "Member";
    } else {
      groupName = normalizedRole;
    }

    if (teamPrefix) {
      groupName = teamPrefix;
    }

    const performers = groupMap.get(groupName) || [];
    performers.push({
      email: `${m.Member.toLowerCase().replace(/\s+/g, '.')}_mkt@example.com`,
      name: m.Member,
      role: normalizedRole,
      score: Number(m.Points || 0),
      avatar: initials(m.Member),
      metrics: { mous: 0, coldCalls: 0, followups: 0 }
    });
    groupMap.set(groupName, performers);
  }

  const miniTeams: TeamDashboardMiniTeam[] = Array.from(groupMap.entries())
    .map(([name, performers]) => {
      const points = performers.reduce((sum, p) => sum + p.score, 0);
      return {
        slug: name.toLowerCase(),
        name,
        rank: 0,
        points,
        growth: 0,
        icon: initials(name),
        performers: performers.sort((a, b) => b.score - a.score)
      };
    })
    .sort((a, b) => b.points - a.points)
    .map((t, i) => ({ ...t, rank: i + 1 }));

  const totalPoints = miniTeams.reduce((sum, t) => sum + t.points, 0);

  return {
    name: title,
    displayName: `${title} Performance Dashboard`,
    functionSlug: title.toLowerCase(),
    miniTeams,
    totalPoints,
    totalGrowth: 0,
    completedActions: 0,
    weeklyGrowth: 0,
    asOfDate: currentDateKey(),
    period: "marathon",
    syncInfo: {
      lastSyncTime: nowIso(),
      nextSyncTime: nowIso(),
      intervalMinutes: config.syncScheduler.intervalMinutes
    }
  };
}

export async function getIRMTeamDashboard(
  tableName: string,
  period: string = "marathon"
): Promise<TeamDashboardPayload> {
  const supabase = getSupabase() as any;
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .order("total_points", { ascending: false });

  if (error) throw error;
  const rows = data || [];

  const performers: TeamDashboardPerformer[] = rows.map((r: any) => ({
    email: `${r.name.toLowerCase().replace(/\s+/g, ".")}_irm@example.com`,
    name: r.name,
    role: "IRM Member",
    score: Number(r.total_points || 0),
    avatar: initials(r.name),
    metrics: {
      mous: Number(r.ir_applications || 0),
      coldCalls: Number(r.ir_calls || 0),
      followups: Number(r.ir_approvals || 0),
    },
  }));

  const miniTeams: TeamDashboardMiniTeam[] = [
    {
      slug: tableName,
      name: prettifyTeamSlug(tableName),
      rank: 1,
      points: performers.reduce((sum, p) => sum + p.score, 0),
      growth: 0,
      icon: "IR",
      performers: performers.sort((a, b) => b.score - a.score),
    },
  ];

  return {
    name: prettifyTeamSlug(tableName),
    displayName: `${prettifyTeamSlug(tableName)} Performance Dashboard`,
    functionSlug: "irm",
    miniTeams,
    totalPoints: miniTeams[0].points,
    totalGrowth: 0,
    completedActions: performers.reduce((sum, p) => sum + p.metrics.mous + p.metrics.coldCalls + p.metrics.followups, 0),
    weeklyGrowth: 0,
    asOfDate: currentDateKey(),
    period: period as any,
    syncInfo: {
      lastSyncTime: nowIso(),
      nextSyncTime: nowIso(),
      intervalMinutes: config.syncScheduler.intervalMinutes,
    },
  };
}

export async function getMarcomDashboardFromTable(): Promise<TeamDashboardPayload> {
  const supabase = getSupabase() as any;
  const { data, error } = await supabase
    .from("marcom")
    .select("*")
    .order("total_points", { ascending: false });

  if (error) throw error;
  const rows = data || [];

  const performers: TeamDashboardPerformer[] = rows.map((r: any) => ({
    email: `${r.name.toLowerCase().replace(/\s+/g, ".")}_marcom@example.com`,
    name: r.name,
    role: "Marcom Member",
    score: Number(r.total_points || 0),
    avatar: initials(r.name),
    metrics: {
      mous: Number(r.flyers || 0),
      coldCalls: Number(r.videos || 0),
      followups: Number(r.presentations || 0),
    },
  }));

  const miniTeams: TeamDashboardMiniTeam[] = [
    {
      slug: "marcom",
      name: "Marcom",
      rank: 1,
      points: performers.reduce((sum, p) => sum + p.score, 0),
      growth: 0,
      icon: "MC",
      performers: performers.sort((a, b) => b.score - a.score),
    },
  ];

  return {
    name: "MARCOM",
    displayName: "Marcom Performance Dashboard",
    functionSlug: "marcom",
    miniTeams,
    totalPoints: miniTeams[0].points,
    totalGrowth: 0,
    completedActions: performers.reduce((sum, p) => sum + p.metrics.mous + p.metrics.coldCalls + p.metrics.followups, 0),
    weeklyGrowth: 0,
    asOfDate: currentDateKey(),
    period: "marathon",
    syncInfo: {
      lastSyncTime: nowIso(),
      nextSyncTime: nowIso(),
      intervalMinutes: config.syncScheduler.intervalMinutes,
    },
  };
}

export async function getB2BDashboardFromTable(): Promise<TeamDashboardPayload> {
  const supabase = getSupabase() as any;
  const { data, error } = await supabase
    .from("b2b_dashboard_members")
    .select("*")
    .order("total_pts", { ascending: false });

  if (error) throw error;
  const rows = data || [];

  const teamMap = new Map<string, TeamDashboardPerformer[]>();

  for (const row of rows) {
    const teamName = String(row.team_name || "B2B").trim() || "B2B";
    const members = teamMap.get(teamName) || [];
    const memberName = String(row.member_name || "Unknown").trim() || "Unknown";

    members.push({
      email: String(row.email_address || `${memberName.toLowerCase().replace(/\s+/g, ".")}@example.com`),
      name: memberName,
      role: String(row.role || "B2B Member"),
      score: Math.ceil(Number(row.total_pts || 0)),
      avatar: initials(memberName),
      metrics: {
        mous: Number(row.mous || 0),
        coldCalls: Number(row.cold_calls || 0),
        followups: Number(row.followups || 0)
      }
    });

    teamMap.set(teamName, members);
  }

  const miniTeams: TeamDashboardMiniTeam[] = Array.from(teamMap.entries())
    .map(([name, performers]) => ({
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      name,
      rank: 0,
      points: performers.reduce((sum, p) => sum + p.score, 0),
      growth: 0,
      icon: initials(name),
      performers: performers.sort((a, b) => b.score - a.score)
    }))
    .sort((a, b) => b.points - a.points)
    .map((team, index) => ({ ...team, rank: index + 1 }));

  const totalPoints = miniTeams.reduce((sum, team) => sum + team.points, 0);
  const completedActions = miniTeams
    .flatMap((team) => team.performers)
    .reduce((sum, performer) => sum + performer.metrics.mous + performer.metrics.coldCalls + performer.metrics.followups, 0);

  return {
    name: "IGV",
    displayName: "Incoming Global Volunteer - B2B",
    functionSlug: "igv_b2b",
    miniTeams,
    totalPoints,
    totalGrowth: 0,
    completedActions,
    weeklyGrowth: 0,
    asOfDate: currentDateKey(),
    period: "marathon",
    syncInfo: {
      lastSyncTime: nowIso(),
      nextSyncTime: nowIso(),
      intervalMinutes: config.syncScheduler.intervalMinutes
    }
  };
}

export async function getOgtDashboard(): Promise<TeamDashboardPayload> {
  const supabase = getSupabase() as any;
  const { data, error } = await supabase
    .from("ogt_members")
    .select("*")
    .order("total_points", { ascending: false });

  if (error) throw error;
  const rows = data || [];

  const teamMap = new Map<string, TeamDashboardPerformer[]>();
  const seenMembers = new Set<string>();

  for (const row of rows) {
    const teamName = String(row.team_name || "OGT").trim() || "OGT";
    const memberName = String(row.member_name || "Unknown").trim() || "Unknown";
    const dedupKey = `${teamName}-${memberName.toLowerCase()}`;
    
    if (seenMembers.has(dedupKey)) continue;
    seenMembers.add(dedupKey);

    const members = teamMap.get(teamName) || [];
    members.push({
      email: `${memberName.toLowerCase().replace(/\s+/g, ".")}_ogt@example.com`,
      name: memberName,
      role: String(row.member_role || "MEMBER"),
      score: Math.ceil(Number(row.total_points || 0)),
      avatar: initials(memberName),
      metrics: {
        mous: Number(row.no_of_su || 0),
        coldCalls: Number(row.no_of_apl || 0), // Use APL for second metric
        followups: Number(row.no_of_apd || 0), // Use APD for third metric
        // Additional metrics for OGT
        ogt_su: Number(row.no_of_su || 0),
        ogt_apl: Number(row.no_of_apl || 0),
        ogt_apd: Number(row.no_of_apd || 0),
        ogt_ir_calls: Number(row.no_of_ir_calls_taken || 0),
        ogt_campaigns: Number(row.no_of_national_campaigns || 0),
        ogt_flyers: Number(row.no_of_pre_su_through_opp_flyers || 0)
      }
    } as any);

    teamMap.set(teamName, members);
  }

  const miniTeams: TeamDashboardMiniTeam[] = Array.from(teamMap.entries())
    .map(([name, performers]) => ({
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      name,
      rank: 0,
      points: performers.reduce((sum, p) => sum + p.score, 0),
      growth: 0,
      icon: initials(name),
      performers: performers.sort((a, b) => b.score - a.score)
    }))
    .sort((a, b) => b.points - a.points)
    .map((team, index) => ({ ...team, rank: index + 1 }));

  const totalPoints = miniTeams.reduce((sum, team) => sum + team.points, 0);
  const completedActions = miniTeams
    .flatMap((team) => team.performers)
    .reduce((sum, performer) => sum + performer.metrics.mous + performer.metrics.coldCalls + performer.metrics.followups, 0);

  return {
    name: "OGT",
    displayName: "Outgoing Global Talent Performance Dashboard",
    functionSlug: "ogt",
    miniTeams,
    totalPoints,
    totalGrowth: 0,
    completedActions,
    weeklyGrowth: 0,
    asOfDate: currentDateKey(),
    period: "marathon",
    syncInfo: {
      lastSyncTime: nowIso(),
      nextSyncTime: nowIso(),
      intervalMinutes: config.syncScheduler.intervalMinutes
    }
  };
}

export async function getIgtB2BDashboard(): Promise<TeamDashboardPayload> {
  const supabase = getSupabase() as any;
  const { data, error } = await supabase
    .from("igt_b2b_members")
    .select("*")
    .order("total_points", { ascending: false });

  if (error) throw error;
  const rows = data || [];

  const teamMap = new Map<string, TeamDashboardPerformer[]>();
  const seenMembers = new Set<string>();

  for (const row of rows) {
    const teamName = String(row.team_name || "IGT").trim() || "IGT";
    const memberName = String(row.member_name || "Unknown").trim() || "Unknown";
    const dedupKey = `${teamName}-${memberName.toLowerCase()}`;
    
    if (seenMembers.has(dedupKey)) continue;
    seenMembers.add(dedupKey);

    const members = teamMap.get(teamName) || [];
    members.push({
      email: `${memberName.toLowerCase().replace(/\s+/g, ".")}_igtb2b@example.com`,
      name: memberName,
      role: "MEMBER", // Generic role as not in table
      score: Math.ceil(Number(row.total_points || 0)),
      avatar: initials(memberName),
      metrics: {
        mous: Number(row.noof_su || 0),
        coldCalls: Number(row.noof_apl || 0), 
        followups: Number(row.noof_apd || 0),
        igt_su: Number(row.noof_su || 0),
        igt_apl: Number(row.noof_apl || 0),
        igt_apd: Number(row.noof_apd || 0),
        igt_ir_calls: Number(row.ir_calls || 0),
        igt_campaigns: Number(row.national_campaigns || 0),
        igt_flyers: Number(row.pre_su_opp_flyers || 0)
      }
    } as any);

    teamMap.set(teamName, members);
  }

  const miniTeams: TeamDashboardMiniTeam[] = Array.from(teamMap.entries())
    .map(([name, performers]) => ({
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      name,
      rank: 0,
      points: performers.reduce((sum, p) => sum + p.score, 0),
      growth: 0,
      icon: initials(name),
      performers: performers.sort((a, b) => b.score - a.score)
    }))
    .sort((a, b) => b.points - a.points)
    .map((team, index) => ({ ...team, rank: index + 1 }));

  const totalPoints = miniTeams.reduce((sum, team) => sum + team.points, 0);
  const completedActions = miniTeams
    .flatMap((team) => team.performers)
    .reduce((sum, performer) => sum + performer.metrics.mous + performer.metrics.coldCalls + performer.metrics.followups, 0);

  return {
    name: "IGT B2B",
    displayName: "Incoming Global Talent B2B Performance Dashboard",
    functionSlug: "igt_b2b",
    miniTeams,
    totalPoints,
    totalGrowth: 0,
    completedActions,
    weeklyGrowth: 0,
    asOfDate: currentDateKey(),
    period: "marathon",
    syncInfo: {
      lastSyncTime: nowIso(),
      nextSyncTime: nowIso(),
      intervalMinutes: 0
    }
  };
}
