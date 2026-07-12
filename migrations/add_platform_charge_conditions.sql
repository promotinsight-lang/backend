ALTER TABLE dynamic_fees_config
  ADD COLUMN IF NOT EXISTS platform_charge_conditions JSONB NOT NULL DEFAULT '{}'::jsonb;
