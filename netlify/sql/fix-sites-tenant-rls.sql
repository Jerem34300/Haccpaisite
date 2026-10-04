-- Isolation public.sites
-- À exécuter sur le projet Supabase de production (SQL editor).
-- Ne supprime aucune ligne de sites.
--
-- Bug : sites_select et sites_admin_write (FOR ALL, donc aussi SELECT)
-- autorisaient is_super_admin() sans filtre tenant. Policies permissives
-- en OR → un compte super_admin (ou toute policy USING (true) résiduelle)
-- lisait et pouvait supprimer les cuisines des autres sociétés.
-- Un directeur / siège reste couvert par tenant_id = current_tenant_id().

alter table public.sites enable row level security;

-- Retirer toute policy hors des 3 connues (un USING (true) oublié
-- s'OR-e avec sites_select et réouvre toute la table).
do $$
declare r record;
begin
  for r in
    select pol.polname as polname
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and cls.relname = 'sites'
      and pol.polname not in ('sites_select', 'sites_admin_write', 'sites_own_update')
  loop
    execute format('drop policy if exists %I on public.sites', r.polname);
  end loop;
end $$;

drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists sites_admin_write on public.sites;
create policy sites_admin_write on public.sites
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());
