CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL CHECK (char_length(type) BETWEEN 1 AND 128),
  source TEXT NOT NULL CHECK (char_length(source) BETWEEN 1 AND 128),
  payload JSONB NOT NULL,
  idempotency_key TEXT NULL CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 256),
  status TEXT NOT NULL CHECK (status IN ('accepted','pending','processing','delivered','partially_delivered','failed','dead_lettered')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX events_idempotency_key_unique ON events(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX events_created_id_idx ON events(created_at DESC, id DESC);
CREATE INDEX events_filters_idx ON events(type, source, status);

CREATE TABLE destinations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 128),
  url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  event_types JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (event_types IS NULL OR jsonb_typeof(event_types) = 'array')
);

CREATE TABLE event_replays (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE delivery_jobs (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  replay_id UUID NULL REFERENCES event_replays(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','processing','retry_scheduled','delivered','permanent_failure','dead_lettered')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX delivery_jobs_due_idx ON delivery_jobs(state, next_attempt_at, created_at);
CREATE INDEX delivery_jobs_event_idx ON delivery_jobs(event_id);

CREATE TABLE delivery_attempts (
  id UUID PRIMARY KEY,
  delivery_job_id UUID NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  status_code INTEGER NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success','retryable_failure','permanent_failure')),
  error_code TEXT NULL,
  duration_ms INTEGER NULL CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(delivery_job_id, attempt_number)
);

CREATE TABLE dead_letters (
  id UUID PRIMARY KEY,
  delivery_job_id UUID NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  replayed_at TIMESTAMPTZ NULL,
  UNIQUE(delivery_job_id)
);
CREATE INDEX dead_letters_created_id_idx ON dead_letters(created_at DESC, id DESC);
