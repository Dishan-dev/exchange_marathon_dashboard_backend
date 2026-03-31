CREATE TABLE IF NOT EXISTS xcend_b2c_members (
    id BIGSERIAL PRIMARY KEY,
    team TEXT,
    member_name TEXT NOT NULL,
    role TEXT,
    country_based INTEGER NOT NULL DEFAULT 0,
    project_based INTEGER NOT NULL DEFAULT 0,
    trend_based INTEGER NOT NULL DEFAULT 0,
    no_of_signups INTEGER NOT NULL DEFAULT 0,
    points NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS xcend_b2c_members_member_name_key
ON xcend_b2c_members (member_name);
