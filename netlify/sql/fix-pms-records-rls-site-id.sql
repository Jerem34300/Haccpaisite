-- Migration : validation site_id sur pms_records INSERT
-- À exécuter dans Supabase SQL Editor

DROP POLICY IF EXISTS pms_records_insert ON pms_records;

CREATE POLICY pms_records_insert ON pms_records
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR (
      (tenant_id)::text = (current_tenant_id())::text
      AND (
        is_admin()
        OR upper(site_id) = current_site_code()
      )
      AND upper(site_id) IN (
        SELECT upper(code) FROM sites WHERE tenant_id = current_tenant_id()
      )
    )
  );
