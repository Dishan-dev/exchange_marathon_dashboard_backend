import cors from "cors";
import express from "express";
import type { AddressInfo } from "node:net";
import { config, assertSyncConfig } from "./config.js";
import { runSync } from "./sync.js";
import { syncMktMembers } from "./sync_mkt.js";
import { getTeamDashboard, getMktDashboard } from "./aggregation.js";
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

app.get("/api/dashboard/:team", async (req, res) => {
  const team = String(req.params.team || "").trim().toLowerCase();
  const period = String(req.query.period || "daily") as any;
  const asOfDate = typeof req.query.asOfDate === "string" ? req.query.asOfDate : undefined;

  try {
    let payload;
    if (team === "marcom") {
      payload = await getMktDashboard("MST");
    } else if (team === "mkt") {
      payload = await getMktDashboard("MKT");
    } else if (team === "members") {
      payload = await getMktDashboard("Members", "member");
    } else if (team === "tls") {
      payload = await getMktDashboard("TLs", "tl");
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
