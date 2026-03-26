import { getSupabase } from "../src/supabase.js";

async function inspectTables() {
  const supabase = getSupabase() as any;
  
  const tables = ["irm1_t01", "marcom"];
  
  for (const table of tables) {
    console.log(`\n--- Inspecting table: ${table} ---`);
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .limit(1);

    if (error) {
      console.error(`Error fetching from ${table}:`, error.message);
      // Try to get columns from information_schema
      const { data: cols, error: colError } = await supabase.rpc('exec_sql', { 
        sql: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${table}'` 
      });
      if (colError) {
        console.error(`Could not get columns for ${table}:`, colError.message);
      } else {
        console.log(`Columns for ${table}:`, cols);
      }
    } else {
      console.log(`Sample data from ${table}:`, data);
      if (data && data.length > 0) {
        console.log(`Column keys:`, Object.keys(data[0]));
      }
    }
  }
}

inspectTables();
