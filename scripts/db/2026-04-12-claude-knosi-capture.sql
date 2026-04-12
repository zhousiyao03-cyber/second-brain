CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  code_preview TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  scopes TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_at INTEGER,
  consumed_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS oauth_authorization_codes_code_hash_idx
  ON oauth_authorization_codes (code_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS oauth_authorization_codes_user_client_idx
  ON oauth_authorization_codes (user_id, client_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS oauth_authorization_codes_expires_at_idx
  ON oauth_authorization_codes (expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_preview TEXT NOT NULL,
  scopes TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS oauth_refresh_tokens_token_hash_idx
  ON oauth_refresh_tokens (token_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_user_client_idx
  ON oauth_refresh_tokens (user_id, client_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_expires_at_idx
  ON oauth_refresh_tokens (expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  refresh_token_id TEXT,
  token_hash TEXT NOT NULL,
  token_preview TEXT NOT NULL,
  scopes TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (refresh_token_id) REFERENCES oauth_refresh_tokens(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS oauth_access_tokens_token_hash_idx
  ON oauth_access_tokens (token_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS oauth_access_tokens_user_client_idx
  ON oauth_access_tokens (user_id, client_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS oauth_access_tokens_refresh_token_idx
  ON oauth_access_tokens (refresh_token_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS oauth_access_tokens_expires_at_idx
  ON oauth_access_tokens (expires_at);
