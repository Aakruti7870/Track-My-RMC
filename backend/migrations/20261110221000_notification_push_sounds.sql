-- Sound-targeted notifications use existing role-scoped in-app notifications.
-- All fan-out and push enqueueing commit in the same transaction as the source event.
CREATE TABLE IF NOT EXISTS notification_push_outbox (
    id BIGSERIAL PRIMARY KEY,
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(notification_id, device_token)
);
CREATE INDEX IF NOT EXISTS idx_notification_push_due
    ON notification_push_outbox(next_attempt_at, id)
    WHERE status IN ('pending', 'processing');

-- Fan out only to active plant staff who actually hold dispatch_queue VIEW.
-- Do not notify unrelated plants, customers, accountants or revoked staff.
CREATE OR REPLACE FUNCTION fanout_new_order_to_plant_staff()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.notification_type = 'new_order' THEN
        INSERT INTO notifications(user_id, title, body, notification_type, reference_id)
        SELECT DISTINCT ps.user_id, 'New concrete order', 'A new customer order requires plant review.',
               'new_order_staff', NEW.reference_id
          FROM orders o
          JOIN rmc_plants p ON p.id = o.plant_id AND p.is_active
          JOIN plant_staff ps ON ps.plant_id = p.id AND ps.is_active
          JOIN users u ON u.id = ps.user_id AND u.is_active AND u.role = ps.role
          JOIN plant_staff_module_permissions perm
            ON perm.plant_id = ps.plant_id AND perm.user_id = ps.user_id
           AND perm.module_key = 'dispatch_queue' AND perm.can_view
         WHERE o.id::text = NEW.reference_id
           AND ps.user_id <> NEW.user_id
           AND ps.role IN ('admin', 'dispatcher', 'operator', 'supervisor', 'fleet_manager')
           AND NOT EXISTS (
             SELECT 1 FROM notifications n
              WHERE n.user_id = ps.user_id AND n.notification_type = 'new_order_staff'
                AND n.reference_id = NEW.reference_id
           );
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fanout_new_order_staff ON notifications;
CREATE TRIGGER trg_fanout_new_order_staff AFTER INSERT ON notifications
FOR EACH ROW WHEN (NEW.notification_type = 'new_order')
EXECUTE FUNCTION fanout_new_order_to_plant_staff();

-- All assignment endpoints share the order_loads row. New driver only;
-- reassignment to the same driver cannot produce duplicate alerts.
CREATE OR REPLACE FUNCTION alert_driver_on_trip_assignment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.driver_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.driver_id IS NOT DISTINCT FROM NEW.driver_id THEN
        RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM users WHERE id = NEW.driver_id AND role = 'driver' AND is_active)
    THEN
        INSERT INTO notifications(user_id, title, body, notification_type, reference_id)
        VALUES (NEW.driver_id, 'New trip assigned', 'Open TrackMyRMC to review your assigned trip.',
                'trip_assigned', NEW.id::text);
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_driver_trip_assignment_insert ON order_loads;
CREATE TRIGGER trg_driver_trip_assignment_insert AFTER INSERT ON order_loads
FOR EACH ROW EXECUTE FUNCTION alert_driver_on_trip_assignment();
DROP TRIGGER IF EXISTS trg_driver_trip_assignment_update ON order_loads;
CREATE TRIGGER trg_driver_trip_assignment_update AFTER UPDATE OF driver_id ON order_loads
FOR EACH ROW EXECUTE FUNCTION alert_driver_on_trip_assignment();

-- Only operational events are pushed; generic in-app events remain unchanged.
-- Token rows are maintained by existing opt-in + Android permission flows.
CREATE OR REPLACE FUNCTION enqueue_operational_notification_push()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.notification_type IN ('new_order', 'new_order_staff', 'trip_assigned') THEN
        INSERT INTO notification_push_outbox(notification_id, user_id, device_token)
        SELECT NEW.id, NEW.user_id, t.token FROM device_push_tokens t
         WHERE t.user_id = NEW.user_id AND t.platform = 'android'
        ON CONFLICT (notification_id, device_token) DO NOTHING;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_enqueue_operational_push ON notifications;
CREATE TRIGGER trg_enqueue_operational_push AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION enqueue_operational_notification_push();
