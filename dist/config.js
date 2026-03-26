import dotenv from "dotenv";
dotenv.config();
function numberEnv(name, fallback) {
    const value = process.env[name];
    if (!value)
        return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function booleanEnv(name, fallback) {
    const value = process.env[name];
    if (!value)
        return fallback;
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized))
        return true;
    if (["0", "false", "no", "off"].includes(normalized))
        return false;
    return fallback;
}
function stringEnv(name, fallback = "") {
    return process.env[name]?.trim() || fallback;
}
export const config = {
    port: numberEnv("PORT", 4000),
    timezone: stringEnv("TIMEZONE", "Asia/Colombo"),
    google: {
        spreadsheetId: stringEnv("GOOGLE_SPREADSHEET_ID"),
        sheetNames: stringEnv("GOOGLE_SHEET_NAME", "team1,team2").split(",").map(s => s.trim()),
        serviceAccountJson: stringEnv("GOOGLE_SERVICE_ACCOUNT_JSON"),
        columns: {
            email: stringEnv("SHEET_COL_EMAIL", "Email Address"),
            name: stringEnv("SHEET_COL_NAME", "Member Name"),
            role: stringEnv("SHEET_COL_ROLE", "Role"),
            function: stringEnv("SHEET_COL_FUNCTION", "Function"),
            team: stringEnv("SHEET_COL_TEAM", "Team"),
            timestamp: stringEnv("SHEET_COL_TIMESTAMP", "Timestamp"),
            action: stringEnv("SHEET_COL_ACTION", "Action"),
            mous: stringEnv("SHEET_COL_MOUS", "MOUs"),
            coldCalls: stringEnv("SHEET_COL_COLD_CALLS", "Cold Calls"),
            followups: stringEnv("SHEET_COL_FOLLOWUPS", "Followups")
        },
        mkt: {
            spreadsheetId: stringEnv("MKT_SPREADSHEET_ID"),
            sheetName: stringEnv("MKT_SHEET_NAME", "Sheet1")
        }
    },
    supabase: {
        url: stringEnv("SUPABASE_URL"),
        serviceRoleKey: stringEnv("SUPABASE_SERVICE_ROLE_KEY")
    },
    scoring: {
        mou: numberEnv("POINTS_MOU", 10),
        coldCall: numberEnv("POINTS_COLD_CALL", 2),
        followup: numberEnv("POINTS_FOLLOWUP", 3)
    },
    syncScheduler: {
        enabled: booleanEnv("AUTO_SYNC_ENABLED", true),
        intervalMinutes: numberEnv("AUTO_SYNC_MINUTES", 30)
    }
};
export function assertSyncConfig() {
    if (!config.google.spreadsheetId) {
        throw new Error("GOOGLE_SPREADSHEET_ID is required for sync");
    }
    if (config.google.sheetNames.length === 0) {
        throw new Error("At least one GOOGLE_SHEET_NAME is required for sync");
    }
    if (!config.google.serviceAccountJson) {
        throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is required for sync");
    }
    if (!config.supabase.url || !config.supabase.serviceRoleKey) {
        throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    }
}
