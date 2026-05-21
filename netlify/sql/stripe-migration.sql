-- ================================================================
-- stripe-migration.sql
-- À exécuter dans l'éditeur SQL Supabase (une seule fois)
-- Ajoute les colonnes Stripe + statut sur la table subscriptions
-- ================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS status             text    DEFAULT 'trial'
    CHECK (status IN ('trial','active','past_due','cancelled','expired')),
  ADD COLUMN IF NOT EXISTS trial_ends_at      timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id    text,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean DEFAULT false;

-- Index utile pour le webhook (lookup par stripe_subscription_id)
CREATE INDEX IF NOT EXISTS subscriptions_stripe_sub_idx
  ON public.subscriptions(stripe_subscription_id);

CREATE INDEX IF NOT EXISTS subscriptions_stripe_cust_idx
  ON public.subscriptions(stripe_customer_id);

-- Marquer les lignes existantes sans trial_ends_at (14 jours depuis création)
UPDATE public.subscriptions
  SET trial_ends_at = created_at + INTERVAL '14 days'
WHERE trial_ends_at IS NULL AND status IS NULL;

-- Marquer statut trial sur les lignes existantes
UPDATE public.subscriptions
  SET status = 'trial'
WHERE status IS NULL;
