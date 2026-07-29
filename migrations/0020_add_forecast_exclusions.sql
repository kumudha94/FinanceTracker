-- Per-cycle opt-out of specific items from the Next Cycle Plan Income/Outflow/Balance totals
CREATE TABLE IF NOT EXISTS forecast_exclusions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_type VARCHAR(20) NOT NULL,
  item_id VARCHAR(50) NOT NULL,
  cycle_start TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS forecast_exclusions_user_item_cycle_unique
  ON forecast_exclusions (user_id, item_type, item_id, cycle_start);
