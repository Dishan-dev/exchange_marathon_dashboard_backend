import cors from "cors";
import express from "express";
import type { AddressInfo } from "node:net";
import { config } from "./config.js";
import { runSync } from "./sync.js";
import { getTeamDashboard } from "./aggregation.js";
const app = express();
app.use(cors());
app.use(express.json());

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
      console.log(`Auto sync completed`);
    } catch (error) {
      console.error("Auto sync failed:", error);
    } finally {
      schedulerBusy = false;
    }
  }, intervalMs);
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timezone: config.timezone });
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
    const payload = await getTeamDashboard(team, period, asOfDate);
    res.status(200).json({ ok: true, data: payload });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Dashboard error" });
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
