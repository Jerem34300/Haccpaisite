-- ================================================================
-- Migration 001 — À exécuter dans Supabase → SQL Editor
-- Corrige l'enum tenants.plan + ajoute les colonnes Stripe
-- ================================================================

-- A) Corriger la contrainte CHECK sur tenants.plan
--    L'ancien enum n'acceptait que starter/pro/enterprise,
--    mais le code écrit 'solo' et 'multi' → tous les INSERTs échouaient.
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_plan_check;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_plan_check
  CHECK (plan IN ('starter','pro','enterprise','solo','multi'));

-- B) Ajouter les colonnes manquantes sur subscriptions
--    (idempotent : ADD COLUMN IF NOT EXISTS)
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS status                 text DEFAULT 'trial'
    CHECK (status IN ('trial','active','past_due','cancelled','expired')),
  ADD COLUMN IF NOT EXISTS trial_ends_at          timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_customer_id     text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id        text,
  ADD COLUMN IF NOT EXISTS current_period_end     timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end   boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS subscriptions_stripe_sub_idx
  ON public.subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS subscriptions_stripe_cust_idx
  ON public.subscriptions(stripe_customer_id);

-- Remplir le statut manquant sur les lignes existantes
UPDATE public.subscriptions
  SET trial_ends_at = created_at + INTERVAL '14 days'
WHERE trial_ends_at IS NULL AND status IS NULL;

UPDATE public.subscriptions
  SET status = 'trial'
WHERE status IS NULL;
