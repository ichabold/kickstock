-- KickStock · Migration 007 · Google OAuth + Guest Migration
-- Adds the migrate_guest_to_user RPC used by /auth/callback.
-- Run AFTER 006_guest_auth.sql.

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RPC: migrate_guest_to_user
--
-- Links a guest (device_id) portfolio to a newly authenticated user_id.
-- Three outcomes:
--   'no_guest'         — no guest portfolio found for this device_id (normal
--                        first-time Google login, nothing to migrate)
--   'migrated'         — guest portfolio linked to user, no conflict
--   'conflict_resolved'— both existed; kept the one with higher best_score
--
-- Returns JSONB: { status, kept? }
-- Atomicity: single transaction, SECURITY DEFINER bypasses RLS.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE FUNCTION migrate_guest_to_user(
  p_device_id TEXT,
  p_user_id   UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest_id         UUID;
  v_guest_best       NUMERIC;
  v_guest_username   TEXT;
  v_user_id_existing UUID;
  v_user_best        NUMERIC;
BEGIN
  -- Find guest portfolio (must be unlinked to any user)
  SELECT id, best_score, guest_username
  INTO   v_guest_id, v_guest_best, v_guest_username
  FROM   portfolios
  WHERE  device_id = p_device_id
    AND  user_id IS NULL
  LIMIT  1;

  IF v_guest_id IS NULL THEN
    RETURN jsonb_build_object('status', 'no_guest');
  END IF;

  -- Check if this user already has a portfolio from another device
  SELECT id, best_score
  INTO   v_user_id_existing, v_user_best
  FROM   portfolios
  WHERE  user_id = p_user_id
  LIMIT  1;

  -- ── Simple case: no existing user portfolio ──────────────────────────────
  IF v_user_id_existing IS NULL THEN
    UPDATE portfolios
    SET    user_id  = p_user_id,
           -- Keep device_id so the current device still works until next reload
           device_id = p_device_id
    WHERE  id = v_guest_id;

    RETURN jsonb_build_object(
      'status',   'migrated',
      'username', v_guest_username
    );
  END IF;

  -- ── Conflict: two portfolios exist ────────────────────────────────────────
  -- Rule: keep the one with the higher best_score (auto-resolve, no UI choice).
  IF COALESCE(v_guest_best, 0) > COALESCE(v_user_best, 0) THEN
    -- Guest wins: delete old user portfolio, promote guest to user account
    DELETE FROM portfolios WHERE id = v_user_id_existing;
    UPDATE portfolios
    SET    user_id  = p_user_id,
           device_id = p_device_id
    WHERE  id = v_guest_id;

    RETURN jsonb_build_object(
      'status',   'conflict_resolved',
      'kept',     'guest',
      'username', v_guest_username
    );
  ELSE
    -- User portfolio wins: orphan the guest portfolio (keep data but unlink device)
    UPDATE portfolios SET device_id = NULL WHERE id = v_guest_id;

    RETURN jsonb_build_object(
      'status', 'conflict_resolved',
      'kept',   'user'
    );
  END IF;
END;
$$;
