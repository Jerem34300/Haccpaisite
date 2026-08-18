-- Migration : limite de taille et de type de fichier sur le bucket pms-photos
-- À exécuter dans Supabase SQL Editor sur une base déjà déployée.
--
-- Contexte : le bucket n'avait aucune limite serveur — n'importe quel
-- utilisateur authentifié pouvait uploader un fichier de n'importe quelle
-- taille ou type via l'API Storage directe (en contournant l'app, qui elle
-- compresse toujours en JPEG côté client avant upload). Défense en
-- profondeur : même si un futur bug côté client envoyait un fichier brut,
-- Supabase refuse maintenant ce qui dépasse ces limites.
--
-- Les photos HACCP sont systématiquement compressées en JPEG (~50-400 Ko)
-- avant upload (voir js/supabaseservice.js:_uploadToStorage). 8 Mo laisse
-- une marge large sans autoriser des fichiers abusifs.
--
-- Idempotent : peut être ré-exécuté sans risque.

update storage.buckets
set file_size_limit = 8388608, -- 8 Mo
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'pms-photos';
