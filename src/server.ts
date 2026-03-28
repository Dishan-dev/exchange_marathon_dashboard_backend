import cors from "cors";
import express from "express";
import type { AddressInfo } from "node:net";
import { config, assertSyncConfig } from "./config.js";
import { runSync } from "./sync.js";
import { syncMktMembers } from "./sync_mkt.js";
import { syncAllSheets } from "./sync_irm.js";
import { 
  getTeamDashboard, 
  getMktDashboard, 
  getIRMTeamDashboard, 
  getMarcomDashboardFromTable,
  getB2BDashboardFromTable,
  getOgtDashboard,
  getIgtB2BDashboard
} from "./aggregation.js";
import { getSupabase } from "./supabase.js";
const app = express();
app.use(cors());
app.use(express.json());

// Diagnostic Logger: Helps see if requests from Google are even reaching us
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} from ${req.ip} - ${req.get('user-agent')}`);
  next();
});

let schedulerBusy = false;

function startAutoSyncScheduler(): void {
  if (!config.syncScheduler.enabled) {
    console.log("Auto sync scheduler disabled (AUTO_SYNC_ENABLED=false).");
    return;
  }

  const intervalMinutes = Math.max(1, config.syncScheduler.intervalMinutes);
  const intervalMs = intervalMinutes * 60 * 1000;

  // syncState.nextSyncTime could be restored if needed, but keeping it simple for now
  console.log(`Auto sync scheduler enabled: every ${intervalMinutes} minute(s).`);

  setInterval(async () => {
    if (schedulerBusy) {
      console.log("Auto sync skipped: previous sync still running.");
      return;
    }

    schedulerBusy = true;
    try {
      await runSync();
      await syncMktMembers();
      console.log(`Auto sync completed`);
    } catch (error) {
      console.error("Auto sync failed:", error);
    } finally {
      schedulerBusy = false;
    }
  }, intervalMs);

  // High-frequency polling for manual triggers (Bypass for Render communication blocks)
  setInterval(async () => {
    if (schedulerBusy) return;
    try {
      const { getSupabase } = await import("./supabase.js");
      const supabase = getSupabase() as any;
      const { data, error } = await supabase
        .from("sync_sources")
        .select("id")
        .eq("pending_sync", true)
        .limit(1);

      if (data && data.length > 0) {
        console.log("🔔 Manual sync trigger detected in database!");
        schedulerBusy = true;
        try {
          await runSync();
          await syncMktMembers();
          await supabase.from("sync_sources").update({ pending_sync: false }).eq("pending_sync", true);
          console.log("✅ Database trigger processed and reset.");
        } finally {
          schedulerBusy = false;
        }
      }
    } catch (e) {
       // Silent fail: table might not exist yet during migration phase
    }
  }, 30000); // Check every 30 seconds
}

app.get("/", (_req, res) => {
  res.status(200).send(`
    <h1 style="color: #00ffcc; font-family: sans-serif;">🚀 Marathon Dashboard Backend</h1>
    <p style="color: #666;">Status: Connected & Healthy</p>
    <p>Current Server Time: ${new Date().toISOString()}</p>
  `);
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timezone: config.timezone });
});

app.get("/sync/run", async (req, res) => {
  // Allow GET to trigger sync for easier debugging/fallback
  if (req.query.key === "marathon") {
     if (schedulerBusy) {
        return res.status(429).send("<h1>⏳ Sync Busy</h1><p>Another sync is already in progress.</p>");
     }
     res.status(202).send("<h1>🚀 Sync Triggered</h1><p>Synchronization is now running in the background. You can close this tab.</p>");
     
     schedulerBusy = true;
     try {
       await runSync();
     } catch (e) {
       console.error("GET sync failed:", e);
     } finally {
       schedulerBusy = false;
     }
     return;
  }

  res.status(200).send(`
    <h1>📡 Marathon Sync Endpoint</h1>
    <p>This endpoint is active and healthy.</p>
    <p>To trigger a synchronization manually, add <code>?key=marathon</code> to this URL.</p>
    <p>Current Server Time: ${new Date().toISOString()}</p>
  `);
});

// Alias endpoint for troubleshooting 503s
app.get("/sync-now-direct", async (req, res) => {
  if (req.query.key === "marathon") {
     if (schedulerBusy) return res.status(429).send("Busy");
     res.status(202).send("🚀 Sync Triggered");
     schedulerBusy = true;
     try { await runSync(); } catch (e) { console.error(e); } finally { schedulerBusy = false; }
     return;
  }
  res.status(200).send("Marathon Direct Sync Endpoint Active");
});

app.post("/sync/run", async (_req, res) => {
  if (schedulerBusy) {
    res.status(429).json({ ok: false, error: "Sync already in progress." });
    return;
  }

  // Return immediately to prevent timeouts in the caller (e.g. Google Apps Script)
  res.status(202).json({ 
    ok: true, 
    message: "Sync triggered and running in background." 
  });

  // Execute sync in background
  schedulerBusy = true;
  try {
    const result = await runSync();
    console.log(`Manual background sync completed: ${result.runId}`, result);
  } catch (error) {
    console.error("Manual background sync failed:", error instanceof Error ? error.message : error);
  } finally {
    schedulerBusy = false;
  }
});

app.post("/sync/all-sheets", async (req, res) => {
  if (schedulerBusy) {
    res.status(429).json({ ok: false, error: "Sync already in progress." });
    return;
  }

  schedulerBusy = true;
  try {
    const results = await syncAllSheets(req.body);
    console.log(`✅ All-sheets sync completed:`, results);
    res.status(200).json({ ok: true, data: results });
  } catch (error) {
    console.error("Manual all-sheets sync failed:", error instanceof Error ? error.message : error);
    res.status(500).json({ ok: false, error: "Internal server error during sync" });
  } finally {
    schedulerBusy = false;
  }
});
app.post("/api/sync-b2b", async (req, res) => {
  const payload = req.body as { data?: any[] };
  const records = Array.isArray(payload?.data) ? payload.data : [];

  if (records.length === 0) {
    res.status(400).json({ ok: false, error: "Request body must include a non-empty data array." });
    return;
  }

  if (schedulerBusy) {
    res.status(429).json({ ok: false, error: "Sync already in progress." });
    return;
  }

  schedulerBusy = true;
  try {
    const supabase = getSupabase() as any;

    const mappedRows = records
      .map((row) => {
        const memberName = String(row.member_name || "").trim();
        if (!memberName) return null;

        return {
          team_name: String(row.team_name || "B2B").trim() || "B2B",
          email_address: row.email_address ? String(row.email_address).trim() : null,
          member_name: memberName,
          role: row.role ? String(row.role).trim() : null,
          timestamp_text: row.timestamp ? String(row.timestamp).trim() : null,
          mous: Number(row.mous || 0),
          cold_calls: Number(row.cold_calls || 0),
          followups: Number(row.followups || 0),
          total_pts: Number(row.total_pts || 0),
          updated_at: new Date().toISOString()
        };
      })
      .filter(Boolean);

    if (mappedRows.length === 0) {
      res.status(400).json({ ok: false, error: "No valid records found (member_name is required)." });
      return;
    }

    const { error: deleteError } = await supabase
      .from("b2b_dashboard_members")
      .delete()
      .neq("id", 0);

    if (deleteError) {
      throw deleteError;
    }

    const { error: insertError } = await supabase
      .from("b2b_dashboard_members")
      .insert(mappedRows);

    if (insertError) {
      throw insertError;
    }

    res.status(200).json({ ok: true, inserted: mappedRows.length });
  } catch (error) {
    console.error("B2B sync failed:", error instanceof Error ? error.message : error);
    res.status(500).json({ ok: false, error: "Internal server error during B2B sync" });
  } finally {
    schedulerBusy = false;
  }
});

app.post("/sync/ogt-members", async (req, res) => {
  const { rows } = req.body as { rows?: any[] };
  const records = Array.isArray(rows) ? rows : [];

  if (records.length === 0) {
    res.status(400).json({ ok: false, error: "Request body must include a non-empty rows array." });
    return;
  }

  if (schedulerBusy) {
    res.status(429).json({ ok: false, error: "Sync already in progress." });
    return;
  }

  schedulerBusy = true;
  try {
    const supabase = getSupabase() as any;

    const mappedRows = records
      .map((row) => {
        const memberName = String(row.member_name || "").trim();
        if (!memberName) return null;

        return {
          team_name: String(row.team_name || "Unknown").trim(),
          member_name: memberName,
          member_role: String(row.member_role || "MEMBER").toUpperCase(),
          no_of_su: Number(row.no_of_su || 0),
          no_of_apl: Number(row.no_of_apl || 0),
          no_of_apd: Number(row.no_of_apd || 0),
          no_of_ir_calls_taken: Number(row.no_of_ir_calls_taken || 0),
          no_of_national_campaigns: Number(row.no_of_national_campaigns || 0),
          no_of_pre_su_through_opp_flyers: Number(row.no_of_pre_su_through_opp_flyers || 0),
          total_points: Number(row.total_points || 0),
          updated_at: new Date().toISOString()
        };
      })
      .filter(Boolean);

    if (mappedRows.length === 0) {
      res.status(400).json({ ok: false, error: "No valid records found (member_name is required)." });
      return;
    }

    // Upsert logic: requires UNIQUE (team_name, member_name) in database
    const { error: upsertError } = await supabase
      .from("ogt_members")
      .upsert(mappedRows, { onConflict: "team_name,member_name" });

    if (upsertError) {
      throw upsertError;
    }

    res.status(200).json({ ok: true, upserted: mappedRows.length });
  } catch (error: any) {
    const errorMessage = error?.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
    console.error("OGT sync failed:", error);
    res.status(500).json({ ok: false, error: errorMessage });
  } finally {
    schedulerBusy = false;
  }
});

app.post("/sync/igt-b2b", async (req, res) => {
  const { rows } = req.body as { rows?: any[] };
  const records = Array.isArray(rows) ? rows : [];

  if (records.length === 0) {
    res.status(400).json({ ok: false, error: "Request body must include a non-empty rows array." });
    return;
  }

  if (schedulerBusy) {
    res.status(429).json({ ok: false, error: "Sync already in progress." });
    return;
  }

  schedulerBusy = true;
  try {
    const supabase = getSupabase() as any;

    const mappedRows = records
      .map((row) => {
        const memberName = String(row.name || row.member_name || "").trim();
        if (!memberName) return null;

        return {
          team_name: String(row.team || row.team_name || "IGT B2B").trim(),
          member_name: memberName,
          member_role: String(row.role || "MEMBER").trim(),
          cold_calls: Number(row.cold_calls || 0),
          follow_ups: Number(row.follow_ups || 0),
          meetings_scheduled: Number(row.meetings_scheduled || 0),
          leads_generated: Number(row.leads_generated || 0),
          contracts_signed: Number(row.contracts_signed || 0),
          training_attendance: Number(row.training_attendance || 0),
          team_meeting: Number(row.team_meeting || row.team_meeting_onlinephysical || 0),
          team_cold_calls_bonus: Number(row.team_cold_calls_bonus || row.completing_25_successfull_cold_calls_as_a_team_5_points || 0),
          team_totals: Number(row.team_totals || 0),
          total_points: Number(row.total_individual_score || row.total_points || 0),
          updated_at: new Date().toISOString()
        };
      })
      .filter(Boolean);

    if (mappedRows.length === 0) {
      res.status(400).json({ ok: false, error: "No valid records found (member_name is required)." });
      return;
    }

    const { error: upsertError } = await supabase
      .from("igt_b2b_members")
      .upsert(mappedRows, { onConflict: "member_name" });

    if (upsertError) throw upsertError;

    res.status(200).json({ ok: true, upserted: mappedRows.length });
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    console.error("IGT B2B sync failed:", error);
    res.status(500).json({ ok: false, error: errorMessage });
  } finally {
    schedulerBusy = false;
  }
});

// Fallback for default Apps Script which uses /sync/members
app.post("/sync/members", async (req, res) => {
  const { tableName, rows } = req.body as { tableName?: string, rows?: any[] };
  
  // If it's the IGT B2B table or has IGT B2B columns, use that logic
  const isIgtB2B = tableName === "members" || (rows && rows[0] && rows[0].noof_su !== undefined);
  
  if (isIgtB2B) {
    // Redirect to igt-b2b logic (or just execute it here)
    console.log("Routing /sync/members request to IGT B2B sync...");
    req.url = "/sync/igt-b2b";
    return (app as any)._router.handle(req, res, () => {});
  }

  res.status(404).json({ ok: false, error: "Table sync not configured for this endpoint." });
});

app.get("/api/dashboard/:team", async (req, res) => {
  const team = String(req.params.team || "").trim().toLowerCase();
  const period = String(req.query.period || "daily") as any;
  const asOfDate = typeof req.query.asOfDate === "string" ? req.query.asOfDate : undefined;

  try {
    let payload;
    if (team === "marcom") {
      try {
        payload = await getMarcomDashboardFromTable();
      } catch (e) {
        payload = await getMktDashboard("MST");
      }
    } else if (team === "igv_b2b") {
      payload = await getB2BDashboardFromTable();
    } else if (team === "igt_b2b") {
      payload = await getIgtB2BDashboard();
    } else if (team === "ogt") {
      payload = await getOgtDashboard();
    } else if (["irm1_t01", "irm2_t01", "irm1_t02", "irm2_t02"].includes(team)) {
      payload = await getIRMTeamDashboard(team, period);
    } else if (team === "mkt") {
      payload = await getMktDashboard("MKT");
    } else if (team === "members") {
      payload = await getMktDashboard("Members", "member", { applyMstWeighting: true });
    } else if (team === "tls") {
      payload = await getMktDashboard("TLs", "tl", { applyMstWeighting: true });
    } else {
      payload = await getTeamDashboard(team, period, asOfDate);
    }
    res.status(200).json({ ok: true, data: payload });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Dashboard error" });
  }
});

app.get("/api/mkt-members", async (_req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("mkt_members")
      .select("*")
      .order("Points", { ascending: false });

    if (error) throw error;
    res.status(200).json({ ok: true, data: data || [] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Database error" });
  }
});

app.post("/sync/mkt", async (_req, res) => {
  if (schedulerBusy) {
    res.status(429).json({ ok: false, error: "Sync already in progress." });
    return;
  }

  schedulerBusy = true;
  try {
    const result = await syncMktMembers();
    console.log(`Manual MKT sync completed:`, result);
    if (result.success) {
      res.status(200).json({ 
        ok: true, 
        message: `MKT sync successful. Found ${result.count} members.` 
      });
    } else {
      res.status(500).json({ ok: false, error: result.error });
    }
  } catch (error) {
    console.error("Manual MKT sync failed:", error instanceof Error ? error.message : error);
    res.status(500).json({ ok: false, error: "Internal server error during sync" });
  } finally {
    schedulerBusy = false;
  }
});

const syncOnce = process.argv.includes("--sync-once");
if (syncOnce) {
  runSync()
    .then((result) => {
      console.log("Sync completed", result);
      process.exit(0);
    })
    .catch((error) => {
      console.error("Sync failed", error);
      process.exit(1);
    });
} else {
  const server = app.listen(config.port, "0.0.0.0", () => {
    const address = server.address() as AddressInfo | null;
    const port = address?.port || config.port;
    console.log(`🚀 Backend successfully started on port ${port}`);
    console.log(`🌍 Health check available at /health`);
    
    // Start scheduler if enabled
    startAutoSyncScheduler();

    // Trigger initial sync on startup with lock
    void (async () => {
      try {
        console.log("🚦 Checking sync configuration...");
        assertSyncConfig();
        
        if (schedulerBusy) return;
        schedulerBusy = true;
        console.log("🔄 Running initial startup sync...");
        const result = await runSync();
        await syncMktMembers();
        console.log(`✅ Initial startup sync completed: ${result.runId}`, result);
      } catch (error) {
        console.warn("⚠️ Initial startup sync skipped/failed:", error instanceof Error ? error.message : error);
      } finally {
        schedulerBusy = false;
      }
    })();
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${config.port} is already in use. Stop the existing process or change PORT in .env.`);
      process.exit(1);
    }

    console.error("Server startup failed:", error.message);
    process.exit(1);
  });
}
