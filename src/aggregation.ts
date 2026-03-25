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

export async function getMktDashboard(title: string = "MKT", filterByPosition?: string): Promise<TeamDashboardPayload> {
  const supabase = getSupabase() as any;
  const { data, error } = await supabase
    .from("mkt_members")
    .select("*")
    .order("Points", { ascending: false });

  if (error) throw error;
  const members = data || [];

  const groupMap = new Map<string, TeamDashboardPerformer[]>();
  
  for (const m of members) {
    const position = String(m.Position || "Member").trim().toLowerCase();
    
    // If filtering is requested, only include matching positions
    if (filterByPosition && position !== filterByPosition.toLowerCase()) continue;

    let groupName = "Members";
    if (position === "tl") {
      groupName = "TLs";
    } else if (position !== "member") {
      groupName = position.charAt(0).toUpperCase() + position.slice(1);
    }
    
    const performers = groupMap.get(groupName) || [];
    performers.push({
      email: `${m.Member.toLowerCase().replace(/\s+/g, '.')}_mkt@example.com`,
      name: m.Member,
      role: groupName,
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
