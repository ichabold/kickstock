-- 008_user_game_state.sql
-- Cross-device sync for registered users (offline mode).
--
-- One row per user. The full game state (dayIndex, prices, portfolio,
-- matchResults, pools…) is stored as a single JSONB blob so there is
-- no schema churn when the game engine evolves.
--
-- Only the user themselves can read/write their row (RLS).

CREATE TABLE IF NOT EXISTS user_game_states (
  user_id     UUID          PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  game_state  JSONB         NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE user_game_states ENABLE ROW LEVEL SECURITY;

-- Single policy: user can SELECT / INSERT / UPDATE / DELETE their own row
CREATE POLICY "user_game_states_self"
  ON user_game_states
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast user lookups (primary key already covers it, but explicit is clear)
-- No extra index needed — PK on user_id suffices.
