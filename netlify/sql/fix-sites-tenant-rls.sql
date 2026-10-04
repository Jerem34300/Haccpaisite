-- Isolation public.sites
-- Appliqué en production le 4 octobre 2026 (SQL editor, Success).
-- Ne supprime aucune ligne de sites.
--
-- Le trou des 42 cuisines était sites_read_authenticated
-- (SELECT pour tout compte connecté). L'ancienne version de ce fichier
-- ne recréait pas le UPDATE des cuisiniers : ne pas la réexécuter.

alter table public.sites enable row level security;
drop policy if exists sites_read_authenticated on public.sites;
drop policy if exists sites_insert on public.sites;
drop policy if exists sites_delete on public.sites;
drop policy if exists sites_update on public.sites;
drop policy if exists sites_update_config on public.sites;

drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy sites_update on public.sites for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists sites_admin_write on public.sites;
create policy sites_admin_write on public.sites for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());
