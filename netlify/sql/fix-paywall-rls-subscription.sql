-- Migration : filet serveur paywall sur pms_records (INSERT/UPDATE)
-- À exécuter dans Supabase SQL Editor sur une base déjà déployée avec
-- l'ancien schema.sql (aucune policy RLS ne référençait subscriptions.status
-- — voir CLAUDE.md, Audit Sécurité §4). Idempotent.
--
-- Le paywall (js/subscriptionguard.js) reste volontairement fail-open côté
-- client (erreur réseau, offline-first) ; ce filet ajoute uniquement le
-- blocage serveur manquant : un tenant sans abonnement actif ne peut plus
-- écrire de nouvelles données HACCP via l'API Supabase REST directe, même
-- avec un JWT valide contournant l'UI du paywall.
--
-- ⚠️ Si fix-pms-records-rls-site-id.sql a aussi été appliqué sur cette
-- base, ré-exécutez-le après ce fichier (il recrée pms_records_insert et
-- inclut désormais lui aussi cet appel à tenant_subscription_active()).

create or replace function public.tenant_subscription_active(p_tenant_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (
      select case
        when s.status = 'active'  then true
        when s.status = 'trial'   then (s.trial_ends_at is null or s.trial_ends_at > now())
        else false
      end
      from public.subscriptions s
      where s.tenant_id = p_tenant_id
      order by s.created_at desc
      limit 1
    ),
    true
  );
$$;

grant execute on function public.tenant_subscription_active(uuid) to authenticated;

drop policy if exists pms_records_insert on public.pms_records;
create policy pms_records_insert on public.pms_records
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      public.tenant_subscription_active(tenant_id)
      and (
        ((tenant_id)::text = (public.current_tenant_id())::text and public.is_admin())
        or (upper(site_id) = public.current_site_code()
            and (tenant_id)::text = (public.current_tenant_id())::text)
      )
    )
  );

drop policy if exists pms_records_update on public.pms_records;
create policy pms_records_update on public.pms_records
  for update to authenticated
  using (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and public.is_admin())
    or (upper(site_id) = public.current_site_code())
  )
  with check (
    public.is_super_admin()
    or (
      public.tenant_subscription_active(tenant_id)
      and (
        (tenant_id = public.current_tenant_id() and public.is_admin())
        or (upper(site_id) = public.current_site_code())
      )
    )
  );
