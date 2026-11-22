-- Public display names only; account email and private metadata stay in auth.
CREATE TABLE IF NOT EXISTS creator_profiles (
    owner_id TEXT PRIMARY KEY,
    display_name TEXT
);
