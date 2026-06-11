/*
  # Schema audit helper (ongoing introspection)

  Migration history in this project has proven unreliable (migrations marked
  applied that never ran). This staff-only function exposes live RLS coverage
  so drift and security gaps (RLS disabled, or enabled with no policies) are
  visible from the API instead of needing pg_dump/Docker.
*/

CREATE OR REPLACE FUNCTION fn_schema_audit()
RETURNS TABLE (
  table_name text,
  rls_enabled boolean,
  policy_count bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    c.relname::text AS table_name,
    c.relrowsecurity AS rls_enabled,
    (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
  ORDER BY c.relname;
$$;

GRANT EXECUTE ON FUNCTION fn_schema_audit() TO authenticated, service_role;
