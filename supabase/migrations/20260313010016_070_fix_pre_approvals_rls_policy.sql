/*
  # Fix pre_approvals RLS policy for user_id matching

  1. Changes
    - Drop old SELECT policy "Users can view own pre-approvals" which incorrectly matched
      `user_accounts.id` against `pre_approvals.user_id`
    - Create new SELECT policy that correctly matches `auth.uid()` against `pre_approvals.user_id`
      since the application stores `auth.uid()` as the user_id in pre_approvals

  2. Security
    - Users can only see their own pre-approvals
    - Staff policy remains unchanged
*/

DROP POLICY IF EXISTS "Users can view own pre-approvals" ON pre_approvals;

CREATE POLICY "Users can view own pre-approvals"
  ON pre_approvals
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
