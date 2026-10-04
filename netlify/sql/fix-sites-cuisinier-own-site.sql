-- HACC.PRO — public.sites : un cuisinier ne voit et ne modifie que SA cuisine.
-- Siège / directeur / super_admin (is_admin) et chef de secteur : toutes les cuisines de leur tenant.
-- À exécuter dans Supabase SQL Editor (prod). Ne supprime aucune cuisine.
-- Prérequis appliqué le 04/10/2026 : sites_select / sites_update / sites_admin_write
-- limités au tenant (suppression de sites_read_authenticated).

drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.is_admin() or public.current_role_text() = 'chef_secteur' or id = public.current_site_id()));

drop policy if exists sites_update on public.sites;
create policy sites_update on public.sites for update to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.is_admin() or public.current_role_text() = 'chef_secteur' or id = public.current_site_id()))
  with check (tenant_id = public.current_tenant_id()
         and (public.is_admin() or public.current_role_text() = 'chef_secteur' or id = public.current_site_id()));
