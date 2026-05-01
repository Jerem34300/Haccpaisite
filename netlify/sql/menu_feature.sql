-- =============================================================
-- HACC.PRO — Module Menu (v36)
-- À exécuter dans Supabase → SQL Editor APRÈS schema.sql.
-- Idempotent : peut être ré-exécuté sans risque.
--
-- Le menu est stocké dans pms_records avec enr_type='enr_menu'.
-- Pas de nouvelle table — on profite des RLS existantes.
--
-- Le payload `data` contient :
--   {
--     menu_date: 'YYYY-MM-DD',
--     service:   'midi' | 'soir' | 'petitdej' | 'gouter',
--     type_repas:'normal' | 'mixe' | 'HP' | 'sans_sel',
--     categories: { entrees:[], plats:[], garnitures:[],
--                   fromages:[], desserts:[], pains:[], potages:[] },
--     menu_id:   'uuid-stable',         -- pour lier les ENR à ce menu
--     _ts: '...', _uuid: '...'
--   }
--
-- Chaque {plat} = { plat_id, nom, profil_haccp, composants[],
--                   allergenes[], statut_auto, _lien_enr:[] }
-- =============================================================

-- 1) Index pour requêtes rapides côté dashboard
--    (recherche d'un menu par site + date + service)
create index if not exists pms_records_menu_idx
  on public.pms_records (site_id, recorded_at desc)
  where enr_type = 'enr_menu';

-- 2) Index sur menu_id pour retrouver tous les ENR liés à un menu
--    (utile pour la vue "Fiche plat HACCP" du dashboard)
create index if not exists pms_records_menu_link_idx
  on public.pms_records ((data->>'_menu_id'))
  where data ? '_menu_id';

-- 3) Index sur plat_id pour retrouver tous les ENR liés à un plat précis
create index if not exists pms_records_plat_link_idx
  on public.pms_records ((data->>'_plat_id'))
  where data ? '_plat_id';

-- 4) Vue d'agrégation : "Menus du mois par site"
--    Permet au siège de lister tous les menus d'un site rapidement.
create or replace view public.v_menus_recents as
select
  r.id,
  r.site_id,
  r.tenant_id,
  r.recorded_at,
  (r.data->>'menu_date')::date as menu_date,
  r.data->>'service'           as service,
  r.data->>'type_repas'        as type_repas,
  r.data->>'menu_id'           as menu_id,
  -- compteurs par catégorie
  jsonb_array_length(coalesce(r.data->'categories'->'entrees',    '[]'::jsonb)) as nb_entrees,
  jsonb_array_length(coalesce(r.data->'categories'->'plats',      '[]'::jsonb)) as nb_plats,
  jsonb_array_length(coalesce(r.data->'categories'->'garnitures', '[]'::jsonb)) as nb_garnitures,
  jsonb_array_length(coalesce(r.data->'categories'->'fromages',   '[]'::jsonb)) as nb_fromages,
  jsonb_array_length(coalesce(r.data->'categories'->'desserts',   '[]'::jsonb)) as nb_desserts,
  jsonb_array_length(coalesce(r.data->'categories'->'pains',      '[]'::jsonb)) as nb_pains,
  jsonb_array_length(coalesce(r.data->'categories'->'potages',    '[]'::jsonb)) as nb_potages,
  r.data
from public.pms_records r
where r.enr_type = 'enr_menu';

grant select on public.v_menus_recents to authenticated;

-- 5) Fonction utilitaire : compte les ENR liés à un menu donné
--    Utilisée par le dashboard pour afficher la "couverture HACCP" du menu.
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
language sql stable security definer set search_path = public
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

-- 6) Fonction utilitaire : récupère TOUS les ENR liés à un plat donné
--    (chronologique). Utilisée par la vue "Fiche plat HACCP".
create or replace function public.plat_tracability(p_plat_id text)
returns table(
  id          uuid,
  enr_type    text,
  recorded_at timestamptz,
  site_id     text,
  data        jsonb
)
language sql stable security definer set search_path = public
as $$
  select id, enr_type, recorded_at, site_id, data
  from public.pms_records
  where data->>'_plat_id' = p_plat_id
  order by recorded_at asc;
$$;

grant execute on function public.plat_tracability(text) to authenticated;

-- =============================================================
-- FIN.
-- Pour tester :
--   select * from public.v_menus_recents order by recorded_at desc limit 10;
--   select * from public.menu_coverage('UN_MENU_ID');
--   select * from public.plat_tracability('UN_PLAT_ID');
-- =============================================================
