use crate::error::AppError;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone, Copy)]
pub enum TripAction {
    Start,
    Arrive,
    Unload,
}

impl TripAction {
    pub fn target(self) -> &'static str {
        match self {
            Self::Start => "en_route",
            Self::Arrive => "arrived",
            Self::Unload => "pouring",
        }
    }

    fn predecessor(self) -> &'static str {
        match self {
            Self::Start => "dispatched",
            Self::Arrive => "en_route",
            Self::Unload => "arrived",
        }
    }

    fn validate(self, current: &str) -> Result<bool, AppError> {
        if current == self.target() {
            return Ok(false);
        }
        if current == self.predecessor() {
            return Ok(true);
        }
        Err(AppError::Conflict(format!(
            "Cannot change trip from {current} to {}",
            self.target()
        )))
    }
}

/// Serialize changes to one trip and retain its first transition timestamps.
pub async fn advance(
    pool: &PgPool,
    load_id: Uuid,
    driver_id: Uuid,
    action: TripAction,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let current: String = sqlx::query_scalar(
        "SELECT status FROM order_loads WHERE id = $1 AND driver_id = $2 FOR UPDATE",
    )
    .bind(load_id)
    .bind(driver_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Assigned trip not found".to_string()))?;

    if action.validate(&current)? {
        sqlx::query(
            "UPDATE order_loads SET status = $3,
             dispatched_at = CASE WHEN $3 = 'en_route' THEN COALESCE(dispatched_at, NOW()) ELSE dispatched_at END,
             arrived_at = CASE WHEN $3 = 'arrived' THEN COALESCE(arrived_at, NOW()) ELSE arrived_at END,
             pour_started_at = CASE WHEN $3 = 'pouring' THEN COALESCE(pour_started_at, NOW()) ELSE pour_started_at END
             WHERE id = $1 AND driver_id = $2",
        )
        .bind(load_id)
        .bind(driver_id)
        .bind(action.target())
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO trip_status_history (load_id, actor_id, from_status, to_status)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(load_id)
        .bind(driver_id)
        .bind(current)
        .bind(action.target())
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trip_actions_enforce_order_and_allow_retries() {
        for action in [TripAction::Start, TripAction::Arrive, TripAction::Unload] {
            assert!(action.validate(action.predecessor()).unwrap());
            assert!(!action.validate(action.target()).unwrap());
            for terminal in ["completed", "cancelled", "rejected", "returned"] {
                assert!(matches!(
                    action.validate(terminal),
                    Err(AppError::Conflict(_))
                ));
            }
        }
        assert!(TripAction::Unload.validate("dispatched").is_err());
        assert!(TripAction::Arrive.validate("planned").is_err());
        assert!(TripAction::Start.validate("pouring").is_err());
    }
}
