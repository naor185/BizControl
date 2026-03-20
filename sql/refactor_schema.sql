-- Step 12: Message Queue Table
CREATE TABLE IF NOT EXISTS message_jobs (
    id UUID PRIMARY KEY,
    studio_id UUID,
    client_id UUID,
    message TEXT,
    scheduled_at TIMESTAMP,
    status TEXT,
    attempts INT DEFAULT 0
);

-- Step 13: Loyalty System
CREATE TABLE IF NOT EXISTS client_points (
    client_id UUID PRIMARY KEY,
    points_balance INT
);

CREATE TABLE IF NOT EXISTS client_points_ledger (
    id UUID PRIMARY KEY,
    client_id UUID,
    points INT,
    reason TEXT,
    created_at TIMESTAMP
);
