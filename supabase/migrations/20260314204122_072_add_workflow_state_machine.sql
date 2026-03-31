/*
  # Workflow State Machine

  ## Summary
  Introduces a canonical application_status_history table to record every state transition
  for intake_submissions. This enables dashboards to derive counts and audit trails from a
  single authoritative source of truth rather than ad-hoc joins.

  ## New Tables
  - `application_status_history`
    - `id` (uuid, primary key)
    - `application_id` (uuid, FK → intake_submissions.id)
    - `previous_status` (text) - the status before the transition
    - `new_status` (text) - the status after the transition
    - `changed_by_user_id` (uuid, FK → auth.users.id, nullable for system events)
    - `changed_at` (timestamptz, default now())
    - `notes` (text, nullable) - optional reason or notes for the transition

  ## Workflow Status Enum Values (documented, enforced by application layer)
  draft | in_progress | submitted | pending_review | needs_revision |
  preapproved | declined | placed | funded

  ## Security
  - RLS enabled on application_status_history
  - SELECT: authenticated users can view history for applications in their organization
  - INSERT: authenticated users can insert (transitions recorded by service layer)
  - No UPDATE or DELETE allowed (immutable audit log)

  ## Indexes
  - application_id for fast lookup
  - changed_at DESC for timeline queries
*/

CREATE TABLE IF NOT EXISTS application_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES intake_submissions(id) ON DELETE CASCADE,
  previous_status text,
  new_status text NOT NULL,
  changed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE INDEX IF NOT EXISTS idx_app_status_history_application_id
  ON application_status_history(application_id);

CREATE INDEX IF NOT EXISTS idx_app_status_history_changed_at
  ON application_status_history(changed_at DESC);

ALTER TABLE application_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view status history for their applications"
  ON application_status_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM intake_submissions s
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE s.id = application_status_history.application_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
    )
    OR
    EXISTS (
      SELECT 1
      FROM intake_submissions s
      WHERE s.id = application_status_history.application_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can record status transitions"
  ON application_status_history
  FOR INSERT
  TO authenticated
  WITH CHECK (changed_by_user_id = auth.uid());
