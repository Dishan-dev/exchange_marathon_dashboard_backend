import { getSupabase } from "./supabase.js";
import type { XcendB2cSyncPayload } from "./types.js";

/**
 * Synchronizes oGV B2C member performance data from Google Sheets.
 * Follows the "clear and insert" pattern used by other specialized dashboards.
 */
export async function syncXcendB2cData(payload: XcendB2cSyncPayload) {
  if (!payload || !payload.xcend_b2c_members) {
    throw new Error("Missing or invalid oGV B2C sync payload.");
  }

  const supabase = getSupabase() as any;
  const tableName = "xcend_b2c_members";
  const rows = payload.xcend_b2c_members;

  try {
    console.log(`🔄 Syncing table: ${tableName} with ${rows.length} rows...`);

    // 1. Clear existing data to ensure a fresh state
    const { error: deleteError } = await supabase
      .from(tableName)
      .delete()
      .neq("id", -1);

    if (deleteError) {
      throw new Error(`Failed to clear table ${tableName}: ${deleteError.message}`);
    }

    // 2. Insert new rows
    if (rows.length > 0) {
      const mappedRows = rows.map(r => ({
        ...r,
        updated_at: new Date().toISOString()
      }));

      const { error: insertError } = await supabase
        .from(tableName)
        .insert(mappedRows);

      if (insertError) {
        throw new Error(`Failed to insert into ${tableName}: ${insertError.message}`);
      }
    }

    console.log(`✅ Table ${tableName} synced successfully.`);
    return {
      success: true,
      count: rows.length,
      tableName
    };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error(`❌ Error syncing table ${tableName}:`, errorMsg);
    throw new Error(`Sync failed for ${tableName}: ${errorMsg}`);
  }
}
