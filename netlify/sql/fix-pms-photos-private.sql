-- Migration : bucket pms-photos privé + lecture authentifiée uniquement
-- À exécuter dans Supabase SQL Editor sur une base déjà déployée avec
-- l'ancien schema.sql (bucket public + policy de lecture sans restriction
-- de rôle — voir CLAUDE.md, Audit Sécurité §2).
--
-- Idempotent : peut être ré-exécuté sans risque.

-- 1) Rendre le bucket privé — bloque les téléchargements directs via
--    /storage/v1/object/public/pms-photos/... (accessibles sans auth)
update storage.buckets set public = false where id = 'pms-photos';

-- 2) Remplacer la policy de lecture (auparavant ouverte à tout le monde,
--    y compris le rôle anon) par une lecture réservée aux utilisateurs
--    authentifiés — nécessaire pour générer des URLs signées côté client.
drop policy if exists pms_photos_public_read on storage.objects;
drop policy if exists pms_photos_auth_read on storage.objects;
create policy pms_photos_auth_read on storage.objects
  for select to authenticated
  using (bucket_id = 'pms-photos');

-- Les policies d'insert/update (pms_photos_auth_insert, pms_photos_auth_update)
-- étaient déjà restreintes à "authenticated" — inchangées.
