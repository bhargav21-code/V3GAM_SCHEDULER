CREATE TABLE IF NOT EXISTS orbit_security_rate_limits (
  bucket TEXT NOT NULL CHECK (char_length(bucket) BETWEEN 1 AND 80),
  subject_hash TEXT NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (bucket, subject_hash)
);

CREATE INDEX IF NOT EXISTS orbit_security_rate_limits_expires_idx
  ON orbit_security_rate_limits (expires_at);