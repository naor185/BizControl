-- Fix Step 13: Loyalty System Ledger
DO $$ 
BEGIN 
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='client_points_ledger' AND column_name='points') THEN
        ALTER TABLE client_points_ledger RENAME COLUMN points TO delta_points;
    END IF;
END $$;

ALTER TABLE client_points_ledger ADD COLUMN IF NOT EXISTS studio_id UUID;
ALTER TABLE client_points_ledger ADD COLUMN IF NOT EXISTS appointment_id UUID;

-- Optional: Add foreign keys if they are missing
-- ALTER TABLE client_points_ledger ADD CONSTRAINT fk_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
-- ALTER TABLE client_points_ledger ADD CONSTRAINT fk_studio FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE CASCADE;
