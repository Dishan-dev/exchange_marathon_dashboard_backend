import { google } from "googleapis";
import { config } from "./config.js";
function getGoogleAuth() {
    if (!config.google.serviceAccountJson) {
        throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not configured");
    }
    const credentials = JSON.parse(config.google.serviceAccountJson);
    return new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    });
}
export async function fetchMultipleSheets(sheetNames, spreadsheetId) {
    const targetId = spreadsheetId || config.google.spreadsheetId;
    if (!targetId) {
        throw new Error("Spreadsheet ID is not configured");
    }
    const sheets = google.sheets({ version: "v4", auth: getGoogleAuth() });
    const results = {};
    const promises = sheetNames.map(async (sheetName) => {
        const range = `${sheetName}!A:Z`;
        try {
            console.log(`📡 Fetching range: "${range}" from ${targetId}...`);
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: targetId,
                range
            });
            const values = response.data.values || [];
            console.log(`📥 Received ${values.length} raw rows from "${sheetName}"`);
            if (values.length < 2) {
                results[sheetName] = [];
                return;
            }
            const headers = values[0].map((h) => String(h).trim());
            const rows = values.slice(1);
            results[sheetName] = rows.map((cells) => {
                const obj = {};
                headers.forEach((header, index) => {
                    obj[header] = String(cells[index] ?? "").trim();
                });
                return obj;
            });
        }
        catch (error) {
            console.error(`❌ Failed to fetch sheet "${sheetName}":`, error);
            results[sheetName] = [];
        }
    });
    await Promise.all(promises);
    return results;
}
