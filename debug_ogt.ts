import { getSupabase } from "./src/supabase.js";

async function checkOgtTable() {
  const supabase = getSupabase() as any;
  
  console.log("🔍 Checking ogt_members table...");
  const { data, error } = await supabase
    .from("ogt_members")
    .select("*")
    .limit(1);

  if (error) {
    console.error("❌ Error fetching ogt_members:", error.message);
    if (error.code === '42P01') {
      console.log("💡 The table 'ogt_members' does not exist.");
    }
  } else {
    console.log("✅ ogt_members table exists.");
    console.log("📊 Sample data:", data);
  }
  
  // Try to find if the unique constraint exists by trying a dummy upsert
  console.log("🔍 Testing upsert onConflict 'team_name,member_name'...");
  const { error: upsertError } = await supabase
    .from("ogt_members")
    .upsert([{ team_name: "Test", member_name: "Test", member_role: "MEMBER" }], { onConflict: "team_name,member_name" });
    
  if (upsertError) {
    console.error("❌ Upsert failed:", upsertError.message);
    if (upsertError.message.includes("column") && upsertError.message.includes("does not exist")) {
        console.log("💡 Maybe a column name mismatch.");
    }
  } else {
    console.log("✅ Upsert successful (Unique constraint seems to work).");
  }
}

checkOgtTable();
