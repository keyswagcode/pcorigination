/*
  # App error log — make silently-swallowed errors visible

  Every bug reported this week had been throwing invisibly for days/weeks
  (best-effort .catch(console.warn), generic "An error occurred"). This table +
  the logError() client helper capture those failures so staff can see them.

  - Authenticated users (incl. borrowers) can INSERT their own error rows.
  - Staff (admin/reviewer) can read all; nobody else can read.
*/

CREATE TABLE IF NOT EXISTS app_error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  user_id uuid DEFAULT auth.uid(),
  context text NOT NULL,
  message text,
  detail jsonb,
  url text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS idx_app_error_log_created ON app_error_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_error_log_context ON app_error_log(context);

ALTER TABLE app_error_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can log errors" ON app_error_log;
CREATE POLICY "Authenticated can log errors"
  ON app_error_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Staff can read error log" ON app_error_log;
CREATE POLICY "Staff can read error log"
  ON app_error_log FOR SELECT
  TO authenticated
  USING (fn_caller_is_staff());

NOTIFY pgrst, 'reload schema';
