-- Production schema rollout for oauth_clients table.
-- Enables RFC 7591 Dynamic Client Registration for MCP clients
-- (Claude Code, Cursor, etc.) that can't use static client_id allowlists.

CREATE TABLE IF NOT EXISTS oauth_clients (
  id text PRIMARY KEY NOT NULL,
  client_id text NOT NULL,
  client_name text NOT NULL,
  redirect_uris text NOT NULL,
  allowed_scopes text NOT NULL,
  token_endpoint_auth_method text DEFAULT 'none' NOT NULL,
  grant_types text DEFAULT 'authorization_code refresh_token' NOT NULL,
  client_uri text,
  logo_uri text,
  created_at integer,
  updated_at integer
);

CREATE UNIQUE INDEX IF NOT EXISTS oauth_clients_client_id_idx ON oauth_clients (client_id);
