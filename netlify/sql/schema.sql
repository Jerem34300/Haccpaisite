-- =============================================================
-- HACC.PRO — Schéma Supabase complet
-- À exécuter dans Supabase → SQL Editor (une seule fois, puis à
-- ré-exécuter sans risque : tout est idempotent).
--
-- Ordre :
--   1) extensions
--   2) tables (tenants → territories → sectors → sites → profiles
--              → subscriptions → pms_records → pms_config → gmo)
--   3) contraintes uniques / index
--   4) helpers (fonctions SECURITY DEFINER pour RLS)
--   5) RLS + policies
--   6) bucket storage + policies
--
-- Le fichier corrective_actions.sql (actions correctives HACCP)
-- reste séparé et doit être exécuté APRÈS ce fichier.
-- =============================================================

create extension if not exists pgcrypto;

-- =============================================================
-- 1) TENANTS (entreprise / multi-tenant racine)
-- =============================================================
create table if not exists public.tenants (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text unique,
  tagline        text,
  primary_color  text default '#0F2240',
  accent_color   text default '#8DC63F',
  logo_url       text,
  plan           text not null default 'pro' check (plan in ('starter','pro','enterprise')),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

-- =============================================================
-- 2) HIÉRARCHIE Territoires → Secteurs → Sites
-- =============================================================
create table if not exists public.territories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  code       text,
  created_at timestamptz not null default now()
);
create index if not exists territories_tenant_idx on public.territories(tenant_id);

create table if not exists public.sectors (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  territory_id  uuid references public.territories(id) on delete set null,
  name          text not null,
  code          text,
  created_at    timestamptz not null default now()
);
create index if not exists sectors_tenant_idx    on public.sectors(tenant_id);
create index if not exists sectors_territory_idx on public.sectors(territory_id);

create table if not exists public.sites (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  sector_id  uuid references public.sectors(id) on delete set null,
  name       text not null,
  code       text not null,
  address    text,
  config     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sites_tenant_idx on public.sites(tenant_id);
create index if not exists sites_sector_idx on public.sites(sector_id);
-- Le code site est utilisé comme identifiant texte par les tablettes
create unique index if not exists sites_code_uniq
  on public.sites (upper(code));

-- =============================================================
-- 3) PROFILES (miroir de auth.users)
-- =============================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  email         text,
  phone         text,
  role          text not null default 'cuisinier'
                check (role in ('super_admin','siege','directeur','chef_secteur','cuisinier')),
  tenant_id     uuid references public.tenants(id) on delete set null,
  territory_id  uuid references public.territories(id) on delete set null,
  sector_id     uuid references public.sectors(id) on delete set null,
  site_id       uuid references public.sites(id) on delete set null,
  data_locked   boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists profiles_tenant_idx on public.profiles(tenant_id);
create index if not exists profiles_site_idx   on public.profiles(site_id);
create index if not exists profiles_role_idx   on public.profiles(role);

-- =============================================================
-- 4) SUBSCRIPTIONS
-- =============================================================
create table if not exists public.subscriptions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  plan            text,
  price_per_month numeric(10,2),
  created_at      timestamptz not null default now()
);
create index if not exists subscriptions_tenant_idx on public.subscriptions(tenant_id);

-- =============================================================
-- 5) PMS_RECORDS (table de faits : toutes les saisies ENR)
--    Note : site_id est ici le CODE du site (texte), pas l'UUID.
-- =============================================================
create table if not exists public.pms_records (
  id          uuid primary key default gen_random_uuid(),
  site_id     text not null,
  tenant_id   uuid references public.tenants(id) on delete set null,
  enr_type    text not null,
  client_id   text not null,
  recorded_at timestamptz not null,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create unique index if not exists pms_records_client_id_uniq on public.pms_records(client_id);
create index if not exists pms_records_site_idx     on public.pms_records(site_id);
create index if not exists pms_records_tenant_idx   on public.pms_records(tenant_id);
create index if not exists pms_records_type_idx     on public.pms_records(enr_type);
create index if not exists pms_records_recorded_idx on public.pms_records(recorded_at desc);
-- Index composites pour les requêtes dashboard fréquentes
create index if not exists pms_records_tenant_recorded_idx
  on public.pms_records(tenant_id, recorded_at desc);
create index if not exists pms_records_site_recorded_idx
  on public.pms_records(site_id, recorded_at desc);
create index if not exists pms_records_tenant_type_recorded_idx
  on public.pms_records(tenant_id, enr_type, recorded_at desc);
create index if not exists pms_records_site_type_recorded_idx
  on public.pms_records(site_id, enr_type, recorded_at desc);

-- =============================================================
-- 6) PMS_CONFIG (enceintes, canicule, …)
-- =============================================================
create table if not exists public.pms_config (
  id         uuid primary key default gen_random_uuid(),
  site_id    text not null,
  tenant_id  uuid references public.tenants(id) on delete set null,
  type       text not null check (type in ('enceintes','canicule')),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create unique index if not exists pms_config_site_type_uniq
  on public.pms_config(site_id, type);

-- =============================================================
-- 7) GMO (Grille Mesure d'Observation — visites mensuelles)
-- =============================================================
create table if not exists public.gmo (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references public.tenants(id) on delete set null,
  site_id          uuid references public.sites(id) on delete cascade,
  sector_id        uuid references public.sectors(id) on delete set null,
  chef_secteur_id  uuid references public.profiles(id) on delete set null,
  visit_date       date not null,
  periode          text,
  scores           jsonb not null default '{}'::jsonb,
  observations     text,
  created_at       timestamptz not null default now()
);
create index if not exists gmo_tenant_idx on public.gmo(tenant_id);
create index if not exists gmo_site_idx   on public.gmo(site_id);
create index if not exists gmo_sector_idx on public.gmo(sector_id);
create index if not exists gmo_date_idx   on public.gmo(visit_date desc);

-- =============================================================
-- 8) HELPERS RLS
--    Fonctions SECURITY DEFINER pour éviter les récursions de
--    policies lors de self-join sur public.profiles.
-- =============================================================
create or replace function public.current_role_text()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_site_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select site_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_site_code()
returns text
language sql stable security definer set search_path = public
as $$
  select upper(s.code)
    from public.profiles p
    join public.sites s on s.id = p.site_id
   where p.id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select role in ('super_admin','siege','directeur')
       from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select role = 'super_admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

grant execute on function public.current_role_text() to authenticated;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.current_site_id()   to authenticated;
grant execute on function public.current_site_code() to authenticated;
grant execute on function public.is_admin()          to authenticated;
grant execute on function public.is_super_admin()    to authenticated;

-- =============================================================
-- 9) RLS
-- =============================================================
alter table public.tenants        enable row level security;
alter table public.territories    enable row level security;
alter table public.sectors        enable row level security;
alter table public.sites          enable row level security;
alter table public.profiles       enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.pms_records    enable row level security;
alter table public.pms_config     enable row level security;
alter table public.gmo            enable row level security;

-- ---------- TENANTS ----------
drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants
  for select to authenticated
  using (
    public.is_super_admin()
    or id = public.current_tenant_id()
  );

drop policy if exists tenants_admin_write on public.tenants;
create policy tenants_admin_write on public.tenants
  for all to authenticated
  using (public.is_super_admin() or id = public.current_tenant_id() and public.is_admin())
  with check (public.is_super_admin() or id = public.current_tenant_id() and public.is_admin());

-- ---------- TERRITORIES / SECTORS / SITES ----------
drop policy if exists territories_select on public.territories;
create policy territories_select on public.territories
  for select to authenticated
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());

drop policy if exists territories_admin_write on public.territories;
create policy territories_admin_write on public.territories
  for all to authenticated
  using (public.is_super_admin() or (tenant_id = public.current_tenant_id() and public.is_admin()))
  with check (public.is_super_admin() or (tenant_id = public.current_tenant_id() and public.is_admin()));

drop policy if exists sectors_select on public.sectors;
create policy sectors_select on public.sectors
  for select to authenticated
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());

drop policy if exists sectors_admin_write on public.sectors;
create policy sectors_admin_write on public.sectors
  for all to authenticated
  using (public.is_super_admin() or (tenant_id = public.current_tenant_id() and public.is_admin()))
  with check (public.is_super_admin() or (tenant_id = public.current_tenant_id() and public.is_admin()));

drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites
  for select to authenticated
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());

-- Admins : CRUD total dans leur tenant ;
-- Cuisinier : peut PATCH son propre site (config jsonb)
drop policy if exists sites_admin_write on public.sites;
create policy sites_admin_write on public.sites
  for all to authenticated
  using (public.is_super_admin() or (tenant_id = public.current_tenant_id() and public.is_admin()))
  with check (public.is_super_admin() or (tenant_id = public.current_tenant_id() and public.is_admin()));

drop policy if exists sites_own_update on public.sites;
create policy sites_own_update on public.sites
  for update to authenticated
  using (id = public.current_site_id())
  with check (id = public.current_site_id());

-- ---------- PROFILES ----------
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_select_tenant_admin on public.profiles;
create policy profiles_select_tenant_admin on public.profiles
  for select to authenticated
  using (
    public.is_super_admin()
    or (public.is_admin() and tenant_id = public.current_tenant_id())
    or (public.current_role_text() = 'chef_secteur'
        and sector_id is not null
        and sector_id in (select sector_id from public.profiles where id = auth.uid()))
  );

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_super_admin() or (public.is_admin() and tenant_id = public.current_tenant_id()))
  with check (public.is_super_admin() or (public.is_admin() and tenant_id = public.current_tenant_id()));

-- ---------- SUBSCRIPTIONS ----------
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());

drop policy if exists subscriptions_admin_write on public.subscriptions;
create policy subscriptions_admin_write on public.subscriptions
  for all to authenticated
  using (public.is_super_admin() or (public.is_admin() and tenant_id = public.current_tenant_id()))
  with check (public.is_super_admin() or (public.is_admin() and tenant_id = public.current_tenant_id()));

-- ---------- PMS_RECORDS ----------
-- Lecture : super_admin partout ; sinon mêmes tenant ; cuisinier restreint à son site.
drop policy if exists pms_records_select on public.pms_records;
create policy pms_records_select on public.pms_records
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      tenant_id = public.current_tenant_id()
      and (
        public.is_admin()
        or public.current_role_text() = 'chef_secteur'
        or (public.current_role_text() = 'cuisinier'
            and upper(site_id) = public.current_site_code())
      )
    )
  );

-- Écriture : cuisinier sur son site ; admins sur leur tenant
drop policy if exists pms_records_insert on public.pms_records;
create policy pms_records_insert on public.pms_records
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and public.is_admin())
    or (upper(site_id) = public.current_site_code()
        and tenant_id = public.current_tenant_id())
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
    or (tenant_id = public.current_tenant_id() and public.is_admin())
    or (upper(site_id) = public.current_site_code())
  );

drop policy if exists pms_records_delete on public.pms_records;
create policy pms_records_delete on public.pms_records
  for delete to authenticated
  using (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and public.is_admin())
  );

-- ---------- PMS_CONFIG ----------
drop policy if exists pms_config_select on public.pms_config;
create policy pms_config_select on public.pms_config
  for select to authenticated
  using (
    public.is_super_admin()
    or tenant_id = public.current_tenant_id()
    or upper(site_id) = public.current_site_code()
  );

drop policy if exists pms_config_write on public.pms_config;
create policy pms_config_write on public.pms_config
  for all to authenticated
  using (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and public.is_admin())
    or upper(site_id) = public.current_site_code()
  )
  with check (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and public.is_admin())
    or upper(site_id) = public.current_site_code()
  );

-- ---------- GMO ----------
drop policy if exists gmo_select on public.gmo;
create policy gmo_select on public.gmo
  for select to authenticated
  using (
    public.is_super_admin()
    or tenant_id = public.current_tenant_id()
  );

drop policy if exists gmo_write on public.gmo;
create policy gmo_write on public.gmo
  for all to authenticated
  using (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and public.is_admin())
    or (public.current_role_text() = 'chef_secteur'
        and sector_id in (select sector_id from public.profiles where id = auth.uid()))
  )
  with check (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and public.is_admin())
    or (public.current_role_text() = 'chef_secteur'
        and sector_id in (select sector_id from public.profiles where id = auth.uid()))
  );

-- =============================================================
-- 10) STORAGE — bucket pms-photos (public en lecture)
-- =============================================================
insert into storage.buckets (id, name, public)
values ('pms-photos', 'pms-photos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists pms_photos_public_read on storage.objects;
create policy pms_photos_public_read on storage.objects
  for select
  using (bucket_id = 'pms-photos');

drop policy if exists pms_photos_auth_insert on storage.objects;
create policy pms_photos_auth_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pms-photos');

drop policy if exists pms_photos_auth_update on storage.objects;
create policy pms_photos_auth_update on storage.objects
  for update to authenticated
  using (bucket_id = 'pms-photos')
  with check (bucket_id = 'pms-photos');

-- =============================================================
-- 11) TRIGGER : création auto du profil à l'inscription
--     (copie id + email depuis auth.users, rôle par défaut cuisinier)
-- =============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'cuisinier'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================
-- FIN.
-- Après ce script, exécuter : corrective_actions.sql
-- Puis créer le 1er super_admin manuellement :
--   update public.profiles set role = 'super_admin'
--     where email = 'votre.email@domaine.fr';
-- =============================================================
