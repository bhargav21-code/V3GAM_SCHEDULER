CREATE TABLE IF NOT EXISTS orbit_tasks (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'study',
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 5 AND 1440),
  starts_at TIMESTAMPTZ,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','done','skipped')),
  detail TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orbit_tasks_user_date_idx ON orbit_tasks(user_id, due_date, starts_at);
CREATE TABLE IF NOT EXISTS orbit_habits (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '✦',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS orbit_habits_user_idx ON orbit_habits(user_id, active);
CREATE TABLE IF NOT EXISTS orbit_habit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  habit_id BIGINT NOT NULL REFERENCES orbit_habits(id) ON DELETE CASCADE,
  habit_date DATE NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, habit_id, habit_date)
);
CREATE TABLE IF NOT EXISTS orbit_preferences (
  user_id TEXT PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  notification_preferences JSONB NOT NULL DEFAULT '{"in_app":true,"push":false}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orbit_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'reminder',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orbit_notifications_user_idx ON orbit_notifications(user_id, created_at DESC);