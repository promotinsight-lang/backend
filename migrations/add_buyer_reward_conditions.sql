ALTER TABLE dynamic_fees_config
  ADD COLUMN IF NOT EXISTS buyer_reward_conditions JSONB NOT NULL DEFAULT '{}'::jsonb;
