-- Rookery schema v1 (SQLite). All tables are free-tier: there is no plan/tier/premium column anywhere.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  recovery_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','mod','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','banned')),
  suspended_until INTEGER,
  status_reason TEXT,
  avatar TEXT,
  bio TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  prefs TEXT NOT NULL DEFAULT '{}',
  fair_flags INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT, ua TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE ratings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('bullet','blitz','rapid','classical','puzzle')),
  rating REAL NOT NULL DEFAULT 1500,
  rd REAL NOT NULL DEFAULT 350,
  vol REAL NOT NULL DEFAULT 0.06,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, category)
);
CREATE INDEX idx_ratings_cat ON ratings(category, rating DESC);
CREATE TABLE rating_history (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  rating REAL NOT NULL,
  delta REAL NOT NULL,
  ref TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_rh_user ON rating_history(user_id, category, ts);
CREATE INDEX idx_rh_ts ON rating_history(category, ts);
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  white_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  black_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  white_name TEXT NOT NULL,
  black_name TEXT NOT NULL,
  ai_level INTEGER,
  category TEXT NOT NULL,
  tc_initial INTEGER NOT NULL,
  tc_inc INTEGER NOT NULL,
  rated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','active','finished','aborted')),
  result TEXT,
  reason TEXT,
  fen TEXT NOT NULL,
  start_fen TEXT NOT NULL,
  moves TEXT NOT NULL DEFAULT '[]',
  clocks TEXT NOT NULL DEFAULT '[0,0]',
  last_tick INTEGER,
  invite_code TEXT UNIQUE,
  private INTEGER NOT NULL DEFAULT 0,
  tournament_id INTEGER,
  white_rating_before REAL, black_rating_before REAL,
  white_rating_after REAL, black_rating_after REAL,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX idx_games_white ON games(white_id, created_at);
CREATE INDEX idx_games_black ON games(black_id, created_at);
CREATE INDEX idx_games_status ON games(status);
CREATE TABLE moves (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply INTEGER NOT NULL,
  san TEXT NOT NULL,
  uci TEXT NOT NULL,
  fen_after TEXT NOT NULL,
  think_ms INTEGER,
  clock_ms INTEGER,
  PRIMARY KEY (game_id, ply)
);
CREATE TABLE friends (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);
CREATE TABLE blocks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, blocked_id)
);
CREATE TABLE clubs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  private INTEGER NOT NULL DEFAULT 0,
  join_code TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE club_members (
  club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin','owner')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (club_id, user_id)
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
  game_id TEXT,
  body TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_msg_dm ON messages(to_id, from_id, ts);
CREATE INDEX idx_msg_club ON messages(club_id, ts);
CREATE INDEX idx_msg_game ON messages(game_id, ts);
CREATE TABLE puzzles (
  id TEXT PRIMARY KEY,
  fen TEXT NOT NULL,
  kind TEXT NOT NULL,
  solution TEXT NOT NULL,
  solutions TEXT NOT NULL,
  themes TEXT NOT NULL DEFAULT '[]',
  rating REAL NOT NULL DEFAULT 1500,
  rd REAL NOT NULL DEFAULT 200,
  mate INTEGER,
  explanation TEXT NOT NULL DEFAULT '',
  opening TEXT,
  plays INTEGER NOT NULL DEFAULT 0,
  solved INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_puzzles_kind ON puzzles(kind, rating);
CREATE TABLE puzzle_attempts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  solved INTEGER NOT NULL,
  rating_before REAL, rating_after REAL,
  ms INTEGER,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_pa_user ON puzzle_attempts(user_id, ts);
CREATE TABLE puzzle_runs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('rush','survival','streak')),
  score INTEGER NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_runs_user ON puzzle_runs(user_id, mode, score);
CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 5,
  steps TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE lesson_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  step INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);
CREATE TABLE tournaments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('arena','swiss','knockout')),
  tc_initial INTEGER NOT NULL,
  tc_inc INTEGER NOT NULL,
  category TEXT NOT NULL,
  rated INTEGER NOT NULL DEFAULT 1,
  rounds INTEGER,
  duration_min INTEGER,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','running','finished','cancelled')),
  private INTEGER NOT NULL DEFAULT 0,
  join_code TEXT,
  club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
  creator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  max_players INTEGER NOT NULL DEFAULT 256,
  current_round INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE tournament_players (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score REAL NOT NULL DEFAULT 0,
  tiebreak REAL NOT NULL DEFAULT 0,
  games INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  seed INTEGER,
  eliminated INTEGER NOT NULL DEFAULT 0,
  withdrawn INTEGER NOT NULL DEFAULT 0,
  had_bye INTEGER NOT NULL DEFAULT 0,
  rating_at_join REAL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, user_id)
);
CREATE TABLE tournament_games (
  id INTEGER PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  game_id TEXT,
  round INTEGER NOT NULL,
  white_id INTEGER,
  black_id INTEGER,
  result TEXT
);
CREATE INDEX idx_tg_t ON tournament_games(tournament_id, round);
CREATE TABLE achievements (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL
);
CREATE TABLE user_achievements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  PRIMARY KEY (user_id, achievement_id)
);
CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  resolved_by INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE TABLE fair_play_flags (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  ts INTEGER NOT NULL,
  reviewed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ts INTEGER NOT NULL
);
