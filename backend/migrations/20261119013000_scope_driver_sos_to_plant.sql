ALTER TABLE driver_sos_alerts
    ADD COLUMN plant_id UUID REFERENCES rmc_plants(id) ON DELETE SET NULL,
    ALTER COLUMN latitude DROP NOT NULL,
    ALTER COLUMN longitude DROP NOT NULL;

UPDATE driver_sos_alerts a
SET plant_id = o.plant_id
FROM order_loads l JOIN orders o ON o.id = l.order_id
WHERE a.load_id = l.id;

-- Preserve older standalone incidents when exactly one assignment covered them.
WITH candidates AS (
    SELECT a.id, ep.plant_id
    FROM driver_sos_alerts a
    JOIN driver_employment_profiles ep ON ep.driver_id = a.driver_id
    WHERE a.load_id IS NULL AND a.plant_id IS NULL AND ep.created_at <= a.created_at
      AND (ep.released_at > a.created_at OR (ep.released_at IS NULL AND ep.is_active))
    UNION
    SELECT a.id, ps.plant_id
    FROM driver_sos_alerts a
    JOIN plant_staff ps ON ps.user_id = a.driver_id AND ps.role = 'driver'
    WHERE a.load_id IS NULL AND a.plant_id IS NULL AND ps.joined_at <= a.created_at
      AND (ps.removed_at > a.created_at OR (ps.removed_at IS NULL AND ps.is_active))
), unambiguous AS (
    SELECT id, (array_agg(plant_id))[1] AS plant_id
    FROM candidates
    GROUP BY id
    HAVING count(*) = 1
)
UPDATE driver_sos_alerts a
SET plant_id = s.plant_id
FROM unambiguous s
WHERE a.id = s.id;

CREATE INDEX idx_driver_sos_plant
    ON driver_sos_alerts (plant_id, created_at DESC)
    WHERE plant_id IS NOT NULL;

-- Accept load-linked incidents written by older clients during the rollout.
CREATE VIEW driver_sos_plant_scope AS
SELECT id, plant_id FROM driver_sos_alerts WHERE plant_id IS NOT NULL
UNION ALL
SELECT a.id, o.plant_id
FROM driver_sos_alerts a
JOIN order_loads l ON l.id = a.load_id
JOIN orders o ON o.id = l.order_id
WHERE a.plant_id IS NULL;
