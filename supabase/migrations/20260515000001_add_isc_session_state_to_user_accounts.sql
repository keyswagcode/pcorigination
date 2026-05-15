-- Persist ISC session cookies + localStorage between credit pulls so the
-- broker only has to clear MFA once per actual ISC session expiry (typically
-- days to weeks), not on every credit pull.
--
-- After a successful login the actor writes Playwright's storageState to
-- the run's KV store; the edge function copies it into this column. On the
-- next pull, the actor restores the storageState and tries to navigate
-- straight to the ISC dashboard. If ISC kicks us back to /login.aspx, the
-- session has expired and we fall back to fresh credential login (which
-- triggers MFA again).
ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS isc_session_state JSONB,
  ADD COLUMN IF NOT EXISTS isc_session_captured_at TIMESTAMPTZ;
