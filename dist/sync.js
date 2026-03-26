import { config, assertSyncConfig } from "./config.js";
import { toDateKey, toWeekKey, nowIso } from "./date.js";
import { getSupabase } from "./supabase.js";
import { computePoints } from "./scoring.js";
import { fetchMultipleSheets } from "./sheets.js";
import { getTeamDashboard } from "./aggregation.js";
function normalizeEmail(value) {
    return value.trim().toLowerCase();
}
function normalizeKey(value) {
    return value.trim().toLowerCase().replace(/\s+/g, "_");
}
function parseNumber(value) {
    const n = Number(value || "0");
    return Number.isFinite(n) ? n : 0;
}
function normalizeTimestamp(value, fallbackIso) {
    if (!value)
        return fallbackIso;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return fallbackIso;
    return parsed.toISOString();
}
/**
 * Fetches all active sync sources from the database.
 */
async function getActiveSources() {
    const supabase = getSupabase();
    const { data, error } = await supabase
        .from("sync_sources")
        .select("*")
        .eq("is_active", true);
    if (error || !data || data.length === 0) {
        if (error && !error.message.includes("PGRST116") && !error.message.includes("cache")) {
            console.error("❌ Failed to fetch sync sources:", error.message);
        }
        console.warn("⚠️ Sync sources table missing or empty. Falling back to .env configuration.");
        return [{
                id: "env-fallback",
                functionSlug: "b2b",
                spreadsheetId: config.google.spreadsheetId,
                sheetNames: config.google.sheetNames,
                columnMapping: {
                    email: config.google.columns.email,
                    name: config.google.columns.name,
                    role: config.google.columns.role,
                    mous: config.google.columns.mous,
                    coldCalls: config.google.columns.coldCalls,
                    followups: config.google.columns.followups,
                    timestamp: config.google.columns.timestamp
                },
                scoringRules: {
                    mou: config.scoring.mou,
                    coldCall: config.scoring.coldCall,
                    followup: config.scoring.followup
                },
                isActive: true
            }];
    }
    return (data || []).map((s) => ({
        id: s.id,
        functionSlug: s.function_slug,
        spreadsheetId: s.spreadsheet_id,
        sheetNames: s.sheet_names,
        columnMapping: s.column_mapping,
        scoringRules: s.scoring_rules,
        isActive: s.is_active,
        lastSyncAt: s.last_sync_at
    }));
}
export async function runSync() {
    assertSyncConfig();
    const supabase = getSupabase();
    const runId = `run_${Date.now()}`;
    const syncStart = nowIso();
    const syncedAt = syncStart;
    const sources = await getActiveSources();
    console.log(`📡 Found ${sources.length} active sync sources.`);
    const dailyMap = new Map();
    const functionsSet = new Map();
    const teamsSet = new Map();
    const memberAggregator = new Map();
    let totalRowsRead = 0;
    for (const source of sources) {
        console.log(`🔄 Syncing source: ${source.functionSlug} (${source.spreadsheetId})`);
        try {
            const multiSheetData = await fetchMultipleSheets(source.sheetNames, source.spreadsheetId);
            for (const [sheetName, rows] of Object.entries(multiSheetData)) {
                totalRowsRead += rows.length;
                const functionSlug = source.functionSlug;
                const teamSlug = normalizeKey(sheetName);
                functionsSet.set(functionSlug, { slug: functionSlug, name: functionSlug.toUpperCase() });
                teamsSet.set(teamSlug, {
                    slug: teamSlug,
                    name: sheetName,
                    functionSlug: functionSlug
                });
                console.log(`📑 Processing: ${functionSlug}/${sheetName} (${rows.length} rows)`);
                for (const row of rows) {
                    const email = normalizeEmail(row[source.columnMapping.email] || "");
                    if (!email)
                        continue;
                    const sourceTimestamp = normalizeTimestamp(row[source.columnMapping.timestamp] || "", syncStart);
                    const dayKey = toDateKey(sourceTimestamp);
                    const weekKey = toWeekKey(sourceTimestamp);
                    const name = row[source.columnMapping.name] || email.split("@")[0];
                    const role = row[source.columnMapping.role] || "Member";
                    const mous = parseNumber(row[source.columnMapping.mous]);
                    const coldCalls = parseNumber(row[source.columnMapping.coldCalls]);
                    const followups = parseNumber(row[source.columnMapping.followups]);
                    // Update/Aggregate Member Lifetime Stats
                    let m = memberAggregator.get(email);
                    if (!m) {
                        m = { email, name, role, team_slug: teamSlug, mous: 0, cold_calls: 0, followups: 0, scoring: source.scoringRules };
                        memberAggregator.set(email, m);
                    }
                    m.mous += mous;
                    m.cold_calls += coldCalls;
                    m.followups += followups;
                    // Aggregate for Snapshots
                    const snapshotKey = `${dayKey}_${email}`;
                    let acc = dailyMap.get(snapshotKey);
                    if (!acc) {
                        const profile = { email, name, role, functionSlug, team: teamSlug };
                        acc = {
                            profile,
                            counts: { mous: 0, coldCalls: 0, followups: 0 },
                            sourceUpdatedAt: sourceTimestamp,
                            dayKey,
                            weekKey
                        };
                        dailyMap.set(snapshotKey, acc);
                    }
                    acc.counts.mous += mous;
                    acc.counts.coldCalls += coldCalls;
                    acc.counts.followups += followups;
                    if (sourceTimestamp > acc.sourceUpdatedAt)
                        acc.sourceUpdatedAt = sourceTimestamp;
                }
            }
            // Update source last_sync_at
            await supabase.from("sync_sources").update({ last_sync_at: syncedAt, last_sync_status: "success" }).eq("id", source.id);
        }
        catch (e) {
            console.error(`❌ Source sync failed: ${source.functionSlug}`, e);
            await supabase.from("sync_sources").update({ last_sync_status: `error: ${e instanceof Error ? e.message : e}` }).eq("id", source.id);
        }
    }
    if (totalRowsRead === 0 && sources.length > 0) {
        console.log("⚠️ No rows read across all sources.");
    }
    // 2. Perform Upserts to Supabase
    console.log("📤 Finalizing Sync to Supabase...");
    // 2.1 Upsert Functions
    const functionsData = Array.from(functionsSet.values()).map(f => ({
        slug: f.slug,
        display_name: f.name
    }));
    if (functionsData.length > 0)
        await supabase.from("functions").upsert(functionsData);
    // 2.2 Upsert Teams
    const teamsData = Array.from(teamsSet.values()).map(t => ({
        slug: t.slug,
        display_name: t.name,
        function_slug: t.functionSlug
    }));
    if (teamsData.length > 0)
        await supabase.from("teams").upsert(teamsData);
    // 2.3 Upsert Members
    const membersToUpsert = Array.from(memberAggregator.values()).map(m => ({
        email: m.email,
        name: m.name,
        role: m.role,
        team_slug: m.team_slug,
        mou: m.mous,
        cold_calls: m.cold_calls,
        followups: m.followups,
        points: computePoints({ mous: m.mous, coldCalls: m.cold_calls, followups: m.followups }, m.scoring),
        updated_at: syncedAt
    }));
    if (membersToUpsert.length > 0) {
        const { error: membersError } = await supabase.from("members").upsert(membersToUpsert);
        if (membersError)
            console.error("❌ Members upsert failed:", membersError.message);
    }
    // 2.4 Upsert Snapshots
    const snapshotsToUpsert = Array.from(dailyMap.values()).map(acc => {
        // Lookup scoring rules based on functionSlug
        const source = sources.find(s => s.functionSlug === acc.profile.functionSlug);
        return {
            id: `${acc.dayKey}_${acc.profile.email}`,
            member_email: acc.profile.email,
            function_slug: acc.profile.functionSlug,
            team_slug: acc.profile.team,
            date_key: acc.dayKey,
            week_key: acc.weekKey,
            mous: acc.counts.mous,
            cold_calls: acc.counts.coldCalls,
            followups: acc.counts.followups,
            points: computePoints(acc.counts, source?.scoringRules),
            source_updated_at: acc.sourceUpdatedAt,
            synced_at: syncedAt
        };
    });
    if (snapshotsToUpsert.length > 0) {
        await supabase.from("daily_snapshots").upsert(snapshotsToUpsert);
    }
    // 3. Update Dashboard Cache
    const periods = ["daily", "weekly", "marathon"];
    const allDailySnapshots = snapshotsToUpsert.map(s => {
        const m = memberAggregator.get(s.member_email);
        return {
            id: s.id,
            email: s.member_email,
            name: m?.name || "Member",
            role: m?.role || "Member",
            functionSlug: s.function_slug,
            team: s.team_slug,
            dateKey: s.date_key,
            weekKey: s.week_key,
            counts: { mous: s.mous, coldCalls: s.cold_calls, followups: s.followups },
            points: s.points,
            sourceUpdatedAt: s.source_updated_at,
            syncedAt
        };
    });
    // 3.1 Update Dashboard Cache for Teams
    const cachePromises = Array.from(teamsSet.values()).flatMap(team => periods.map(async (period) => {
        try {
            const dashboard = await getTeamDashboard(team.slug, period, undefined, allDailySnapshots);
            dashboard.syncInfo = { lastSyncTime: syncStart, nextSyncTime: nowIso(), intervalMinutes: config.syncScheduler.intervalMinutes, runId };
            await supabase.from("dashboard_cache").upsert({
                id: `${team.slug}_${period}`,
                team_slug: team.slug,
                period,
                payload: dashboard,
                synced_at: syncedAt
            });
        }
        catch (e) {
            console.error(`Failed to update cache for ${team.slug}/${period}:`, e);
        }
    }));
    await Promise.all(cachePromises);
    // 3.2 Update Dashboard Cache for Functions
    const functionCachePromises = Array.from(functionsSet.values()).flatMap(func => periods.map(async (period) => {
        try {
            const dashboard = await getTeamDashboard(func.slug, period, undefined, allDailySnapshots, "function");
            dashboard.syncInfo = { lastSyncTime: syncStart, nextSyncTime: nowIso(), intervalMinutes: config.syncScheduler.intervalMinutes, runId };
            await supabase.from("dashboard_cache").upsert({
                id: `${func.slug}_${period}`,
                function_slug: func.slug,
                period,
                payload: dashboard,
                synced_at: syncedAt
            });
        }
        catch (e) {
            console.error(`Failed to update Function cache for ${func.slug}/${period}:`, e);
        }
    }));
    await Promise.all(functionCachePromises);
    return {
        rowsRead: totalRowsRead,
        logsUpserted: 0,
        snapshotsUpserted: snapshotsToUpsert.length,
        runId
    };
}
