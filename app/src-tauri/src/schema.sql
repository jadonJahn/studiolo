CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,          -- 'focus' | 'break'
  mode          TEXT NOT NULL,          -- 'pomodoro' | 'countdown' | 'stopwatch'
  activity_id   TEXT,
  activity_name TEXT,
  task_id       TEXT,
  task_title    TEXT,
  intent        TEXT,
  started_at    INTEGER NOT NULL,       -- unix ms
  ended_at      INTEGER NOT NULL,       -- unix ms
  day           TEXT NOT NULL,          -- local YYYY-MM-DD of start
  duration_min  REAL NOT NULL,
  planned_min   REAL NOT NULL,
  completed     INTEGER NOT NULL,
  art_style     TEXT
);
CREATE INDEX IF NOT EXISTS sessions_day ON sessions(day);
CREATE INDEX IF NOT EXISTS sessions_started ON sessions(started_at);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  activity_id   TEXT,
  activity_name TEXT,
  estimate      INTEGER NOT NULL,       -- focus blocks
  done          INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  done_at       INTEGER,
  spent_min     REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  emoji    TEXT NOT NULL,
  color    TEXT NOT NULL,
  archived INTEGER NOT NULL
);

-- 'snapshot' (full app export JSON), 'settings', 'timer'
CREATE TABLE IF NOT EXISTS kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
