-- =============================================================
-- photos_bucket_rls_fix.sql — CORRECTIF SÉCURITÉ (bucket pms-photos)
--
-- Problèmes d'origine (schema.sql §10) :
--   1) Les policies INSERT/UPDATE ne vérifiaient que `bucket_id = 'pms-photos'`
--      → tout utilisateur authentifié pouvait écrire/écraser N'IMPORTE quel objet
--        du bucket, y compris les photos d'autres tenants.
--   2) Le bucket est `public = true` → lecture publique non authentifiée des
--      photos (enjeu RGPD).
--
-- Convention de chemin (cf. supabaseservice.js) :
--   <code_site>/<enr_type>/<date>/<fichier>.jpg
--   → le 1er segment est le CODE du site.
--
-- PARTIE 1 (sûre, à appliquer) : restreint les écritures au périmètre du tenant.
-- PARTIE 2 (optionnelle, RGPD) : privatise la lecture — NÉCESSITE que le client
--   passe par des URL signées (createSignedUrl) au lieu des URL publiques.
--
-- À exécuter dans l'éditeur SQL Supabase.
-- =============================================================

-- ── PARTIE 1 — Écritures scopées au tenant ───────────────────

-- Sites (codes) accessibles à l'appelant = ceux de son tenant.
-- (auth.uid() → profiles.tenant_id → sites.code)

drop policy if exists pms_photos_auth_insert on storage.objects;
create policy pms_photos_auth_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pms-photos'
    and (storage.foldername(name))[1] in (
      select s.code
      from public.sites s
      join public.profiles p on p.tenant_id = s.tenant_id
      where p.id = auth.uid()
    )
  );

drop policy if exists pms_photos_auth_update on storage.objects;
create policy pms_photos_auth_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'pms-photos'
    and (storage.foldername(name))[1] in (
      select s.code
      from public.sites s
      join public.profiles p on p.tenant_id = s.tenant_id
      where p.id = auth.uid()
    )
  )
  with check (
    bucket_id = 'pms-photos'
    and (storage.foldername(name))[1] in (
      select s.code
      from public.sites s
      join public.profiles p on p.tenant_id = s.tenant_id
      where p.id = auth.uid()
    )
  );

-- Empêche la suppression cross-tenant (aucune policy DELETE n'existait → bloqué
-- par défaut pour les non-service, mais on l'explicite par cohérence).
drop policy if exists pms_photos_auth_delete on storage.objects;
create policy pms_photos_auth_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pms-photos'
    and (storage.foldername(name))[1] in (
      select s.code
      from public.sites s
      join public.profiles p on p.tenant_id = s.tenant_id
      where p.id = auth.uid()
    )
  );

-- ── PARTIE 2 — Privatisation de la lecture (RGPD) ────────────
-- ⚠️ N'appliquer QUE lorsque le client génère des URL signées
--    (supabase.storage.from('pms-photos').createSignedUrl(path, ttl)).
--    Tant que le client utilise /object/public/..., garder le bucket public.
--
-- update storage.buckets set public = false where id = 'pms-photos';
--
-- drop policy if exists pms_photos_public_read on storage.objects;
-- create policy pms_photos_tenant_read on storage.objects
--   for select to authenticated
--   using (
--     bucket_id = 'pms-photos'
--     and (storage.foldername(name))[1] in (
--       select s.code
--       from public.sites s
--       join public.profiles p on p.tenant_id = s.tenant_id
--       where p.id = auth.uid()
--     )
--   );
-- =============================================================
