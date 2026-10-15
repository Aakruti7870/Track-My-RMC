use crate::error::AppError;
use bigdecimal::BigDecimal;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

#[derive(sqlx::FromRow)]
struct Load {
    order_id: Uuid,
    status: String,
    mixer_id: Option<Uuid>,
    driver_id: Option<Uuid>,
    quantity_m3: BigDecimal,
}

async fn lock(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> Result<(Load, Uuid, String), AppError> {
    let (plant,parent): (Uuid,String) = sqlx::query_as(
        "SELECT o.plant_id,o.status FROM orders o JOIN order_loads l ON l.order_id=o.id WHERE l.id=$1 FOR UPDATE OF o",
    ).bind(id).fetch_optional(&mut **tx).await?.ok_or_else(||AppError::NotFound("Load not found".into()))?;
    let load = sqlx::query_as::<_,Load>("SELECT order_id,status,mixer_id,driver_id,quantity_m3 FROM order_loads WHERE id=$1 FOR UPDATE")
        .bind(id).fetch_one(&mut **tx).await?;
    Ok((load, plant, parent))
}

pub async fn advance(
    pool: &PgPool,
    id: Uuid,
    actor: Uuid,
    action: &str,
) -> Result<&'static str, AppError> {
    let target = match action {
        "prepare" => "ready_to_dispatch",
        "dispatch" => "dispatched",
        "cancel" => "cancelled",
        _ => return Err(AppError::BadRequest("Unsupported load action".into())),
    };
    let mut tx = pool.begin().await?;
    let (load, plant, parent) = lock(&mut tx, id).await?;
    if load.status == target {
        tx.commit().await?;
        return Ok(target);
    }
    if action == "cancel" {
        if !matches!(load.status.as_str(), "planned" | "assigned") {
            return Err(AppError::Conflict(
                "Only unprepared loads can be cancelled".into(),
            ));
        }
    } else {
        if !matches!(parent.as_str(), "produced" | "dispatched" | "in_transit") {
            return Err(AppError::Conflict(
                "Complete parent production before delivery preparation".into(),
            ));
        }
        let expected = if action == "prepare" {
            "batched"
        } else {
            "ready_to_dispatch"
        };
        if (action == "prepare"
            && !matches!(
                load.status.as_str(),
                "planned" | "assigned" | "batching" | "batched"
            ))
            || (action == "dispatch" && load.status != expected)
        {
            return Err(AppError::Conflict(format!(
                "Load must be {expected} before {action}"
            )));
        }
        let mixer = load
            .mixer_id
            .ok_or_else(|| AppError::Conflict("Assign a mixer first".into()))?;
        let driver = load
            .driver_id
            .ok_or_else(|| AppError::Conflict("Assign a driver first".into()))?;
        let (mplant,capacity,assigned,mstatus): (Uuid,BigDecimal,Option<Uuid>,String)=sqlx::query_as("SELECT plant_id,capacity_m3,driver_id,status FROM transit_mixers WHERE id=$1 FOR UPDATE")
            .bind(mixer).fetch_optional(&mut *tx).await?.ok_or_else(||AppError::NotFound("Mixer not found".into()))?;
        if mplant != plant || capacity < load.quantity_m3 || assigned.is_some_and(|d| d != driver) {
            return Err(AppError::Conflict(
                "Mixer plant, capacity or driver assignment does not match this load".into(),
            ));
        }
        let active: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM users WHERE id=$1 AND role='driver' AND is_active=TRUE FOR UPDATE",
        )
        .bind(driver)
        .fetch_optional(&mut *tx)
        .await?;
        if active.is_none() {
            return Err(AppError::Conflict("Assigned driver is not active".into()));
        }
        let conflict: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM order_loads WHERE id<>$1 AND (mixer_id=$2 OR driver_id=$3) AND status IN ('ready_to_dispatch','dispatched','en_route','arrived','pouring'))")
            .bind(id).bind(mixer).bind(driver).fetch_one(&mut *tx).await?;
        if conflict {
            return Err(AppError::Conflict(
                "Mixer or driver already has an active load".into(),
            ));
        }
        if action == "prepare" {
            if !matches!(mstatus.as_str(), "idle" | "available" | "loading") {
                return Err(AppError::Conflict("Mixer is unavailable".into()));
            }
            let produced: f64 = sqlx::query_scalar(super::production_service::PRODUCED_SQL)
                .bind(load.order_id)
                .fetch_one(&mut *tx)
                .await?;
            let allocated:f64=sqlx::query_scalar("SELECT COALESCE(SUM(quantity_m3),0)::DOUBLE PRECISION FROM order_loads WHERE order_id=$1 AND id<>$2 AND status NOT IN ('planned','assigned','batching','batched','cancelled')")
              .bind(load.order_id).bind(id).fetch_one(&mut *tx).await?;
            use bigdecimal::ToPrimitive;
            let quantity = load
                .quantity_m3
                .to_f64()
                .ok_or_else(|| AppError::Conflict("Invalid load quantity".into()))?;
            if allocated + quantity > produced + 0.001 {
                return Err(AppError::Conflict(
                    "Load exceeds unallocated produced quantity".into(),
                ));
            }
            sqlx::query(
                "INSERT INTO challans (load_id,challan_number,plant_code,customer_name,site_address,concrete_grade,quantity_m3,mixer_number,driver_name)
                 SELECT l.id,$2,p.code,c.full_name,s.address_line,o.concrete_grade,l.quantity_m3,m.registration_number,d.full_name
                 FROM order_loads l JOIN orders o ON o.id=l.order_id JOIN rmc_plants p ON p.id=o.plant_id
                 JOIN users c ON c.id=o.customer_id JOIN customer_sites s ON s.id=o.site_id
                 JOIN transit_mixers m ON m.id=l.mixer_id JOIN users d ON d.id=l.driver_id WHERE l.id=$1
                 ON CONFLICT (load_id) DO NOTHING",
            ).bind(id).bind(format!("CH-{}",id.simple())).execute(&mut *tx).await?;
        } else {
            let ready: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM challans c JOIN gate_passes g ON g.load_id=c.load_id WHERE c.load_id=$1)")
                .bind(id).fetch_one(&mut *tx).await?;
            if !ready {
                return Err(AppError::Conflict(
                    "Challan and gate pass are required before dispatch".into(),
                ));
            }
            sqlx::query("UPDATE orders SET status='dispatched',updated_at=NOW() WHERE id=$1 AND status='produced'")
                .bind(load.order_id).execute(&mut *tx).await?;
        }
        sqlx::query("UPDATE transit_mixers SET status=$2,driver_id=$3 WHERE id=$1")
            .bind(mixer)
            .bind(if action == "prepare" {
                "loading"
            } else {
                "in_transit"
            })
            .bind(driver)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("UPDATE order_loads SET status=$2,dispatched_at=CASE WHEN $2='dispatched' THEN COALESCE(dispatched_at,NOW()) ELSE dispatched_at END WHERE id=$1")
        .bind(id).bind(target).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO trip_status_history (load_id,actor_id,from_status,to_status) VALUES ($1,$2,$3,$4)")
        .bind(id).bind(actor).bind(load.status).bind(target).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(target)
}
