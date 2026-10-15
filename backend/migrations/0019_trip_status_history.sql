-- Additive history for atomic driver transitions. Existing loads are unchanged.
CREATE TABLE IF NOT EXISTS trip_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    load_id UUID NOT NULL REFERENCES order_loads(id),
    actor_id UUID NOT NULL REFERENCES users(id),
    from_status VARCHAR(50) NOT NULL,
    to_status VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trip_status_history_load
    ON trip_status_history(load_id, created_at);
