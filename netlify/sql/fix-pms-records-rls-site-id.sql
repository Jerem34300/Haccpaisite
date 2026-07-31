-- Migration : validation site_id sur pms_records INSERT
-- À exécuter dans Supabase SQL Editor
--
-- Inclut aussi le filet paywall (tenant_subscription_active) ajouté dans
-- schema.sql : ce fichier RECRÉE la policy pms_records_insert et doit donc
-- rester cohérent avec elle si les deux sont appliqués sur la même base.
-- La fonction public.tenant_subscription_active(uuid) doit déjà exister
-- (voir schema.sql, section 8 — helpers RLS).

DROP POLICY IF EXISTS pms_records_insert ON pms_records;

CREATE POLICY pms_records_insert ON pms_records
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR (
      tenant_subscription_active(tenant_id)
      AND (tenant_id)::text = (current_tenant_id())::text
      AND (
        is_admin()
        OR upper(site_id) = current_site_code()
      )
      AND upper(site_id) IN (
        SELECT upper(code) FROM sites WHERE tenant_id = current_tenant_id()
      )
    )
  );
