-- Add user_id to usage_records (rollout for moving usage-reporter into knosi-cli).
-- Strategy: create new table, backfill existing rows to the single known owner,
-- swap tables, recreate unique index.
--
-- Preconditions (verified before writing this migration):
--   - production usage_records has rows that all belong to one user
--     (email zhousiyao03@gmail.com; resolved at rollout time)
--   - no FK references point at usage_records
--
-- If these change, this script must be rewritten.
--
-- Note: libsql client auto-commits each execute(), so BEGIN/COMMIT is omitted.
-- If any step fails mid-way, manual cleanup is needed.

CREATE TABLE usage_records_new (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date text NOT NULL,
    provider text NOT NULL,
    model text DEFAULT '' NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    cache_read_tokens integer DEFAULT 0 NOT NULL,
    cache_write_tokens integer DEFAULT 0 NOT NULL,
    created_at integer,
    updated_at integer
);

INSERT INTO usage_records_new (
    id, user_id, date, provider, model,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
    created_at, updated_at
)
SELECT
    id,
    (SELECT id FROM users WHERE email = 'zhousiyao03@gmail.com' LIMIT 1) AS user_id,
    date, provider, model,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
    created_at, updated_at
FROM usage_records;

DROP TABLE usage_records;
ALTER TABLE usage_records_new RENAME TO usage_records;

CREATE UNIQUE INDEX usage_records_user_date_provider_model_idx
    ON usage_records (user_id, date, provider, model);
