-- Migration : RLS pms_records SELECT — cloisonner chef_secteur par secteur
-- À exécuter manuellement dans Supabase SQL Editor (SQL → New query → Run).
-- Netlify ne déploie PAS automatiquement les fichiers netlify/sql/ ; schema.sql
-- documente l'état cible, cette migration patch une base déjà provisionnée.
--
-- Problème : pms_records_select laissait chef_secteur lire TOUTES les lignes
-- du tenant ; le filtre secteur n'existait que côté client (app-dashboard.js
-- loadData : profiles.sector_id → sites.sector_id → codes → pms_records.site_id).
--
-- Correctif : même règle côté Postgres. siège / directeur / super_admin
-- inchangés (is_admin / is_super_admin). Cuisinier inchangé (site code).
--
-- Idempotent : DROP POLICY IF EXISTS + CREATE POLICY + CREATE OR REPLACE FUNCTION.

create or replace function public.current_sector_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select sector_id from public.profiles where id = auth.uid();
$$;

drop policy if exists pms_records_select on public.pms_records;
create policy pms_records_select on public.pms_records
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      tenant_id = public.current_tenant_id()
      and (
        public.is_admin()
        or (
          public.current_role_text() = 'chef_secteur'
          and public.current_sector_id() is not null
          and upper(site_id) in (
            select upper(s.code)
              from public.sites s
             where s.sector_id = public.current_sector_id()
               and s.tenant_id = public.current_tenant_id()
          )
        )
        or (public.current_role_text() = 'cuisinier'
            and upper(site_id) = public.current_site_code())
      )
    )
  );
