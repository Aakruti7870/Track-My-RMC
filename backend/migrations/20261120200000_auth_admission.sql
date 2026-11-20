-- Fixed-window source counters. Expired identities are pruned on use.
CREATE TABLE auth_source_windows (
    source_key BYTEA PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL
);
CREATE INDEX auth_source_windows_by_start ON auth_source_windows(started_at);

-- All replicas reserve from the same pool before starting external provider I/O.
CREATE TABLE otp_delivery_slots (
    slot SMALLINT PRIMARY KEY,
    reservation UUID,
    expires_at TIMESTAMPTZ
);
INSERT INTO otp_delivery_slots(slot) SELECT generate_series(1,64);

-- Counts attempts, including uncertain delivery after a provider timeout.
CREATE TABLE otp_delivery_budget (
    singleton BOOLEAN PRIMARY KEY CHECK(singleton),
    utc_day DATE NOT NULL,
    used INTEGER NOT NULL CHECK (used >= 0),
    daily_limit INTEGER NOT NULL CHECK (daily_limit >= 0)
);
INSERT INTO otp_delivery_budget VALUES (TRUE, (now() AT TIME ZONE 'UTC')::date, 0, 2000);
