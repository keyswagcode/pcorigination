-- Add invited_by_user_id to organization_members to track invite hierarchy
ALTER TABLE organization_members
  ADD COLUMN IF NOT EXISTS invited_by_user_id UUID REFERENCES auth.users(id);

-- Backfill: set existing members' invited_by to the org owner
UPDATE organization_members om
SET invited_by_user_id = (
  SELECT om2.user_id
  FROM organization_members om2
  WHERE om2.organization_id = om.organization_id
    AND om2.role = 'owner'
  LIMIT 1
)
WHERE om.invited_by_user_id IS NULL
  AND om.role != 'owner';
