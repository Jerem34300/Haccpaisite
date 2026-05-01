-- HACCP corrective actions linked to non-conformities
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.corrective_actions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text not null check (category in ('temperature','hygiene','storage','autre')),
  is_default boolean not null default false
);

create unique index if not exists corrective_actions_name_category_uniq
  on public.corrective_actions (lower(name), category);

create table if not exists public.nc_action_mapping (
  id uuid primary key default gen_random_uuid(),
  non_conformity_type text not null check (non_conformity_type in ('temperature','hygiene','storage','autre')),
  corrective_action_id uuid not null references public.corrective_actions(id) on delete cascade
);

create unique index if not exists nc_action_mapping_type_action_uniq
  on public.nc_action_mapping (non_conformity_type, corrective_action_id);

alter table public.corrective_actions enable row level security;
alter table public.nc_action_mapping enable row level security;

drop policy if exists corrective_actions_select on public.corrective_actions;
create policy corrective_actions_select
on public.corrective_actions
for select
to authenticated
using (true);

drop policy if exists corrective_actions_admin_write on public.corrective_actions;
create policy corrective_actions_admin_write
on public.corrective_actions
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('super_admin','siege','directeur')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('super_admin','siege','directeur')
  )
);

drop policy if exists nc_action_mapping_select on public.nc_action_mapping;
create policy nc_action_mapping_select
on public.nc_action_mapping
for select
to authenticated
using (true);

drop policy if exists nc_action_mapping_admin_write on public.nc_action_mapping;
create policy nc_action_mapping_admin_write
on public.nc_action_mapping
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('super_admin','siege','directeur')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('super_admin','siege','directeur')
  )
);

insert into public.corrective_actions (id, name, description, category, is_default) values
  ('11111111-1111-4111-8111-111111111111', 'Remise en température immédiate', 'Rétablir immédiatement une température conforme.', 'temperature', true),
  ('11111111-1111-4111-8111-111111111112', 'Destruction du produit', 'Retirer et détruire le produit non conforme.', 'temperature', true),
  ('11111111-1111-4111-8111-111111111113', 'Contrôle du matériel', 'Vérifier sonde, enceinte ou équipement concerné.', 'temperature', true),
  ('11111111-1111-4111-8111-111111111114', 'Isolement du lot', 'Isoler le lot et empêcher sa distribution.', 'temperature', true),
  ('22222222-2222-4222-8222-222222222221', 'Nettoyage et désinfection immédiate', 'Réaliser immédiatement nettoyage + désinfection.', 'hygiene', true),
  ('22222222-2222-4222-8222-222222222222', 'Renforcement du plan de nettoyage', 'Augmenter la fréquence et les contrôles du plan.', 'hygiene', true),
  ('22222222-2222-4222-8222-222222222223', 'Contrôle visuel par responsable', 'Faire valider visuellement la remise en conformité.', 'hygiene', true),
  ('33333333-3333-4333-8333-333333333331', 'Réorganisation des denrées', 'Réorganiser les denrées pour éviter les contaminations croisées.', 'storage', true),
  ('33333333-3333-4333-8333-333333333332', 'Vérification DLC/DDM', 'Contrôler les DLC/DDM avant remise en stock.', 'storage', true),
  ('33333333-3333-4333-8333-333333333333', 'Mise en quarantaine', 'Mettre en quarantaine les produits concernés.', 'storage', true)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  is_default = excluded.is_default;

insert into public.nc_action_mapping (non_conformity_type, corrective_action_id) values
  ('temperature', '11111111-1111-4111-8111-111111111111'),
  ('temperature', '11111111-1111-4111-8111-111111111112'),
  ('temperature', '11111111-1111-4111-8111-111111111113'),
  ('temperature', '11111111-1111-4111-8111-111111111114'),
  ('hygiene', '22222222-2222-4222-8222-222222222221'),
  ('hygiene', '22222222-2222-4222-8222-222222222222'),
  ('hygiene', '22222222-2222-4222-8222-222222222223'),
  ('storage', '33333333-3333-4333-8333-333333333331'),
  ('storage', '33333333-3333-4333-8333-333333333332'),
  ('storage', '33333333-3333-4333-8333-333333333333')
on conflict (non_conformity_type, corrective_action_id) do nothing;
