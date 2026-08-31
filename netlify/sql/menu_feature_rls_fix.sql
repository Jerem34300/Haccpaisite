-- =============================================================
-- menu_feature_rls_fix.sql — CORRECTIF SÉCURITÉ
--
-- Problème : menu_coverage() et plat_tracability() étaient déclarées
-- `security definer` et interrogeaient public.pms_records SANS filtre tenant.
-- Conséquence : n'importe quel utilisateur authentifié pouvait lire les
-- comptages (et, pour plat_tracability, le `data` complet) de TOUS les tenants
-- en passant un menu_id / plat_id arbitraire → fuite de données cross-tenant.
--
-- Correctif : repasser ces fonctions en `security invoker`. Elles s'exécutent
-- alors avec les droits de l'appelant, donc la RLS de pms_records (filtrage par
-- site/tenant issu du JWT) s'applique automatiquement → un appelant ne voit que
-- les données de son propre périmètre.
--
-- À exécuter dans l'éditeur SQL Supabase.
-- =============================================================

create or replace function public.menu_coverage(p_menu_id text)
returns table(
  total_enr     bigint,
  ccp_count     bigint,
  reception     bigint,
  cuisson       bigint,
  refroid       bigint,
  temoin        bigint,
  distribution  bigint,
  nc            bigint
)
language sql stable security invoker set search_path = public
as $$
  select
    count(*)                                                          as total_enr,
    count(*) filter (where enr_type in ('enr01','enr02','enr03','enr07')) as ccp_count,
    count(*) filter (where enr_type =  'enr23')                        as reception,
    count(*) filter (where enr_type in ('enr04','enr07','enr08'))      as cuisson,
    count(*) filter (where enr_type in ('enr01','enr03'))              as refroid,
    count(*) filter (where enr_type =  'enr33')                        as temoin,
    count(*) filter (where enr_type =  'enr_tc_distrib' or enr_type like 'enr_distrib_%') as distribution,
    count(*) filter (where enr_type =  'enr30')                        as nc
  from public.pms_records
  where data->>'_menu_id' = p_menu_id;
$$;

grant execute on function public.menu_coverage(text) to authenticated;

create or replace function public.plat_tracability(p_plat_id text)
returns table(
  id          uuid,
  enr_type    text,
  recorded_at timestamptz,
  site_id     text,
  data        jsonb
)
language sql stable security invoker set search_path = public
as $$
  select id, enr_type, recorded_at, site_id, data
  from public.pms_records
  where data->>'_plat_id' = p_plat_id
  order by recorded_at asc;
$$;

grant execute on function public.plat_tracability(text) to authenticated;

-- =============================================================
-- FIN. Après exécution, vérifier qu'un utilisateur ne récupère QUE les ENR de
-- son propre tenant via :
--   select * from public.plat_tracability('UN_PLAT_ID');
-- =============================================================
