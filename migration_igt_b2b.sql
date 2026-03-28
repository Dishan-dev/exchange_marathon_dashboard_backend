-- SQL Migration to add rewards and team totals to igt_b2b_members table

-- 1. Add new columns
ALTER TABLE igt_b2b_members 
ADD COLUMN IF NOT EXISTS team_meeting INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS team_cold_calls_bonus INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS team_totals NUMERIC DEFAULT 0;

-- 2. Verify columns (optional, for manual check)
-- SELECT column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'igt_b2b_members';
