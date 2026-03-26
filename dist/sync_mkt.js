import { config } from "./config.js";
import { getSupabase } from "./supabase.js";
import { fetchMultipleSheets } from "./sheets.js";
export async function syncMktMembers() {
    const spreadsheetId = config.google.mkt?.spreadsheetId;
    const sheetName = config.google.mkt?.sheetName || "Sheet1";
    if (!spreadsheetId) {
        console.warn("⚠️ MKT_SPREADSHEET_ID is not configured. Skipping MKT sync.");
        return { success: false, error: "MKT_SPREADSHEET_ID missing" };
    }
    console.log(`🔄 Starting MKT sync from sheet: ${sheetName} (${spreadsheetId})`);
    try {
        const multiSheetData = await fetchMultipleSheets([sheetName], spreadsheetId);
        const rows = multiSheetData[sheetName];
        if (!rows || rows.length === 0) {
            console.warn(`⚠️ No data found in MKT sheet "${sheetName}"`);
            return { success: true, count: 0 };
        }
        console.log(`📊 Found ${rows.length} rows in MKT sheet. Mapping columns...`);
        const firstRow = rows[0];
        const headers = Object.keys(firstRow);
        console.log(`📝 Headers found in sheet: ${headers.join(", ")}`);
        const findKey = (name) => headers.find(h => h.toLowerCase() === name.toLowerCase()) || name;
        const memberKey = findKey("Member");
        const positionKey = findKey("Position");
        const pointsKey = findKey("Points");
        console.log(`🔑 Mapping results: Member -> "${memberKey}", Position -> "${positionKey}", Points -> "${pointsKey}"`);
        const records = rows
            .map((row) => {
            const member = String(row[memberKey] || "").trim();
            const position = String(row[positionKey] || "").trim();
            const points = String(row[pointsKey] || "0").trim();
            return {
                Member: member,
                Position: position,
                Points: points
            };
        })
            .filter((r) => r.Member !== "" && r.Position !== "");
        console.log(`📦 Prepared ${records.length} MKT records for upsert.`);
        if (records.length === 0) {
            console.warn("⚠️ No valid MKT records to sync after filtering empty rows.");
            return { success: true, count: 0 };
        }
        const supabase = getSupabase();
        const { error } = await supabase
            .from("mkt_members")
            .upsert(records, { onConflict: "Member,Position" });
        if (error) {
            throw error;
        }
        console.log(`✅ Successfully synced ${records.length} MktMembers.`);
        return { success: true, count: records.length };
    }
    catch (error) {
        console.error("❌ MKT sync failed:", error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}
