/**
   * supabaseConfig.js — Configuration Supabase centralisée
   *
   * SÉCURITÉ — Pourquoi la clé est ici en clair :
   * ─────────────────────────────────────────────
   * La clé ci-dessous est la clé "anon" (anonyme) de Supabase.
   * Ce type de clé est CONÇU pour être exposé côté client et front-end.
   * Supabase le documente explicitement : https://supabase.com/docs/guides/api/api-keys
   *
   * La sécurité des données est assurée par les politiques RLS
   * (Row Level Security) configurées côté Supabase, qui filtrent
   * les accès selon l'utilisateur authentifié (JWT).
   *
   * ⚠️  NE JAMAIS remplacer par la clé "service_role" qui bypass le RLS.
   *
   * Si un environnement multi-tenant est souhaité, passer par un proxy
   * Node.js qui valide le JWT avant de transmettre la requête.
   */

  const SUPABASE_URL = 'https://lthxpucxjcwzphshdhmp.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0aHhwdWN4amN3enBoc2hkaG1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMTU5MzIsImV4cCI6MjA4OTY5MTkzMn0._tLh6V35KkWu7p2eUyK0J03MaIqzHmMSYhQFZ3o8c80';
  