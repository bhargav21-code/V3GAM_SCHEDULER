CREATE TABLE IF NOT EXISTS orbit_workspaces (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  owner_id TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orbit_workspace_members (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES orbit_workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS orbit_workspace_members_user_idx ON orbit_workspace_members(user_id, workspace_id);
ALTER TABLE orbit_tasks ADD COLUMN IF NOT EXISTS workspace_id BIGINT REFERENCES orbit_workspaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS orbit_tasks_workspace_date_idx ON orbit_tasks(workspace_id, due_date, starts_at);