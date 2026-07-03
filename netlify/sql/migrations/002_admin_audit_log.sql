-- ================================================================
-- Migration 002 — À exécuter dans Supabase → SQL Editor
-- Crée la table de journal d'audit des actions super-admin
-- ================================================================

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now() NOT NULL,
  actor_email   text        NOT NULL,
  action        text        NOT NULL,
  tenant_id     uuid        REFERENCES public.tenants(id) ON DELETE SET NULL,
  tenant_name   text,
  payload       jsonb
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON public.admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_tenant_idx  ON public.admin_audit_log(tenant_id);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Seul le super_admin peut lire (accès direct avec JWT utilisateur)
-- En pratique, les lectures/écritures passent par admin-proxy (service_role qui bypass RLS)
DROP POLICY IF EXISTS admin_audit_log_super_admin ON public.admin_audit_log;
CREATE POLICY admin_audit_log_super_admin ON public.admin_audit_log
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );
