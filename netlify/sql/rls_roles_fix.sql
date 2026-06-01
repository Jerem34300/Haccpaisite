-- =============================================================
-- rls_roles_fix.sql — Durcissement RLS par rôle (décisions métier)
-- À exécuter dans l'éditeur SQL Supabase.
--
-- NB : les comparaisons de tenant_id sont castées en ::text car selon les tables
-- tenant_id peut être uuid (sites/profiles) OU text (pms_records côté faits).
-- Le cast ::text fonctionne dans les deux cas (uuid::text = text).
--
-- 1) chef_secteur borné à SON secteur (au lieu de tout le tenant).
-- 2) pms_config / gmo : lecture tenant-wide réservée aux admins ; le cuisinier
--    ne lit QUE la config de son propre site (et pas le GMO du tenant).
-- 3) Défense en profondeur : UPDATE pms_records par code site exige le tenant.
-- =============================================================

-- ---------- PMS_RECORDS : lecture (chef_secteur = son secteur) ----------
drop policy if exists pms_records_select on public.pms_records;
create policy pms_records_select on public.pms_records
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      tenant_id::text = public.current_tenant_id()::text
      and (
        public.is_admin()
        or (public.current_role_text() = 'chef_secteur'
            and upper(site_id) in (
              select upper(s.code) from public.sites s
              where s.sector_id::text = (select sector_id::text from public.profiles where id = auth.uid())
            ))
        or (public.current_role_text() = 'cuisinier'
            and upper(site_id) = public.current_site_code())
      )
    )
  );

-- ---------- PMS_RECORDS : update (tenant + code) ----------
drop policy if exists pms_records_update on public.pms_records;
create policy pms_records_update on public.pms_records
  for update to authenticated
  using (
    public.is_super_admin()
    or (tenant_id::text = public.current_tenant_id()::text and public.is_admin())
    or (upper(site_id) = public.current_site_code() and tenant_id::text = public.current_tenant_id()::text)
  )
  with check (
    public.is_super_admin()
    or (tenant_id::text = public.current_tenant_id()::text and public.is_admin())
    or (upper(site_id) = public.current_site_code() and tenant_id::text = public.current_tenant_id()::text)
  );

-- ---------- PMS_CONFIG : lecture (admins tenant-wide ; cuisinier = son site) ----------
drop policy if exists pms_config_select on public.pms_config;
create policy pms_config_select on public.pms_config
  for select to authenticated
  using (
    public.is_super_admin()
    or (tenant_id::text = public.current_tenant_id()::text and public.is_admin())
    or upper(site_id) = public.current_site_code()
  );

-- ---------- GMO : lecture réservée aux admins du tenant ----------
drop policy if exists gmo_select on public.gmo;
create policy gmo_select on public.gmo
  for select to authenticated
  using (
    public.is_super_admin()
    or (tenant_id::text = public.current_tenant_id()::text and public.is_admin())
  );

-- =============================================================
-- Vérifs post-migration :
--   • un chef_secteur ne voit que les fiches des sites de son secteur ;
--   • un cuisinier ne lit que la config de son propre site ;
--   • le GMO n'est lisible que par directeur/siège/super_admin.
-- =============================================================
