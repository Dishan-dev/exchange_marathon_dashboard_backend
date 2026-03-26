import { getSupabase } from "./supabase.js";
export async function syncAllSheets(payload) {
    const supabase = getSupabase();
    const results = {};
    for (const table of payload.tables) {
        const tableName = table.tableName.toLowerCase();
        // We only allow specific tables to prevent arbitrary table writes
        const allowedTables = ["irm1_t01", "irm2_t01", "irm1_t02", "irm2_t02", "marcom"];
        if (!allowedTables.includes(tableName)) {
            console.warn(`⚠️ Table ${tableName} is not in the allowed list for sync.`);
            continue;
        }
        try {
            console.log(`🔄 Syncing table: ${tableName} with ${table.rows.length} rows...`);
            // Strategy: Truncate and Insert (to keep it simple for these dashboard tables)
            // Note: Delete all existing rows for this sheet sync
            const { error: deleteError } = await supabase
                .from(tableName)
                .delete()
                .neq("id", -1); // Delete all rows
            if (deleteError) {
                throw new Error(`Failed to clear table ${tableName}: ${deleteError.message}`);
            }
            if (table.rows.length > 0) {
                const { error: insertError } = await supabase
                    .from(tableName)
                    .insert(table.rows);
                if (insertError) {
                    throw new Error(`Failed to insert into ${tableName}: ${insertError.message}`);
                }
            }
            results[tableName] = { count: table.rows.length, status: "success" };
            console.log(`✅ Table ${tableName} synced successfully.`);
        }
        catch (e) {
            console.error(`❌ Error syncing table ${tableName}:`, e);
            results[tableName] = { count: 0, status: `error: ${e instanceof Error ? e.message : e}` };
        }
    }
    return results;
}
