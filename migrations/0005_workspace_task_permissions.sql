-- Task assignment is deliberately separate from task ownership. Assignment grants
-- completion only; it never grants edit, reschedule, skip, snooze, or delete rights.
ALTER TABLE orbit_tasks
  ADD COLUMN IF NOT EXISTS assigned_to_user_id TEXT;

CREATE INDEX IF NOT EXISTS orbit_tasks_workspace_assignee_idx
  ON orbit_tasks (workspace_id, assigned_to_user_id)
  WHERE workspace_id IS NOT NULL;