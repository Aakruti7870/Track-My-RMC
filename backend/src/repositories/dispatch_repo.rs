use bigdecimal::FromPrimitive;
use crate::{
    error::AppError,
    models::{
        challan::{Challan, ProofOfDelivery},
        mixer::TransitMixer,
        order::OrderLoad,
    },
};
use bigdecimal::BigDecimal;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn list_plant_mixers(pool: &PgPool, plant_id: Uuid) -> Result<Vec<TransitMixer>, AppError> {
    let mixers = sqlx::query_as::<_, TransitMixer>(
        r#"
        SELECT id, plant_id, registration_number, capacity_m3, driver_id, status, last_latitude, last_longitude, last_ping_at, created_at
        FROM transit_mixers
        WHERE plant_id = $1
        ORDER BY registration_number ASC
        "#,
    )
    .bind(plant_id)
    .fetch_all(pool)
    .await?;

    Ok(mixers)
}

pub async fn assign_order_load(
    pool: &PgPool,
    order_id: Uuid,
    load_number: i32,
    mixer_id: Uuid,
    driver_id: Uuid,
    quantity_m3: f64,
) -> Result<OrderLoad, AppError> {
    if load_number <= 0 {
        return Err(AppError::BadRequest("Load number must be greater than zero".to_string()));
    }
    if quantity_m3 <= 0.0 || !quantity_m3.is_finite() {
        return Err(AppError::BadRequest("Load quantity must be greater than zero".to_string()));
    }

    let mut tx = pool.begin().await?;

    let order: (Uuid, String, bigdecimal::BigDecimal) = sqlx::query_as(
        "SELECT plant_id, status, total_quantity_m3 FROM orders WHERE id = $1 FOR UPDATE",
    )
    .bind(order_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    if matches!(order.1.as_str(), "cancelled" | "completed" | "delivered") {
        return Err(AppError::BadRequest("Order cannot accept another load in its current state".to_string()));
    }

    let mixer: (Uuid, bigdecimal::BigDecimal, Option<Uuid>) = sqlx::query_as(
        "SELECT plant_id, capacity_m3, driver_id FROM transit_mixers WHERE id = $1 FOR UPDATE",
    )
    .bind(mixer_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Transit mixer not found".to_string()))?;

    if mixer.0 != order.0 {
        return Err(AppError::BadRequest("Transit mixer belongs to a different plant".to_string()));
    }

    let driver_role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM users WHERE id = $1 AND is_active = TRUE",
    )
    .bind(driver_id)
    .fetch_optional(&mut *tx)
    .await?;
    if driver_role.as_deref() != Some("driver") {
        return Err(AppError::BadRequest("Selected user is not an active driver".to_string()));
    }

    if let Some(assigned_driver) = mixer.2 {
        if assigned_driver != driver_id {
            return Err(AppError::BadRequest("Transit mixer is assigned to a different driver".to_string()));
        }
    }

    if BigDecimal::from_f64(quantity_m3).unwrap_or_default() > mixer.1 {
        return Err(AppError::BadRequest("Load quantity exceeds mixer capacity".to_string()));
    }

    let duplicate: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM order_loads WHERE order_id = $1 AND load_number = $2",
    )
    .bind(order_id)
    .bind(load_number)
    .fetch_optional(&mut *tx)
    .await?;
    if duplicate.is_some() {
        return Err(AppError::BadRequest("Load number already exists for this order".to_string()));
    }

    let load = sqlx::query_as::<_, OrderLoad>(
        r#"
        INSERT INTO order_loads (order_id, load_number, mixer_id, driver_id, quantity_m3, status, dispatched_at)
        VALUES ($1, $2, $3, $4, $5, 'dispatched', NOW())
        RETURNING id, order_id, load_number, mixer_id, driver_id, quantity_m3, status,
                  batch_started_at, batch_completed_at, dispatched_at, arrived_at,
                  pour_started_at, pour_completed_at, returned_at, created_at
        "#,
    )
    .bind(order_id)
    .bind(load_number)
    .bind(mixer_id)
    .bind(driver_id)
    .bind(BigDecimal::from_f64(quantity_m3).unwrap_or_default())
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query("UPDATE transit_mixers SET status = 'in_transit', driver_id = $1 WHERE id = $2")
        .bind(driver_id)
        .bind(mixer_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(load)
}

pub async fn list_loads_for_order(pool: &PgPool, order_id: Uuid) -> Result<Vec<OrderLoad>, AppError> {
    let loads = sqlx::query_as::<_, OrderLoad>(
        r#"
        SELECT id, order_id, load_number, mixer_id, driver_id, quantity_m3, status,
               batch_started_at, batch_completed_at, dispatched_at, arrived_at,
               pour_started_at, pour_completed_at, returned_at, created_at
        FROM order_loads
        WHERE order_id = $1
        ORDER BY load_number ASC
        "#,
    )
    .bind(order_id)
    .fetch_all(pool)
    .await?;

    Ok(loads)
}

pub async fn find_driver_active_trips(pool: &PgPool, driver_id: Uuid) -> Result<Vec<OrderLoad>, AppError> {
    let loads = sqlx::query_as::<_, OrderLoad>(
        r#"
        SELECT id, order_id, load_number, mixer_id, driver_id, quantity_m3, status,
               batch_started_at, batch_completed_at, dispatched_at, arrived_at,
               pour_started_at, pour_completed_at, returned_at, created_at
        FROM order_loads
        WHERE driver_id = $1 AND status IN ('dispatched', 'arrived', 'pouring')
        ORDER BY dispatched_at DESC
        "#,
    )
    .bind(driver_id)
    .fetch_all(pool)
    .await?;

    Ok(loads)
}

pub async fn get_challan_by_load(pool: &PgPool, load_id: Uuid) -> Result<Option<Challan>, AppError> {
    let challan = sqlx::query_as::<_, Challan>(
        r#"
        SELECT id, load_id, challan_number, plant_code, customer_name, site_address,
               concrete_grade, quantity_m3, slump_mm, water_cement_ratio, batch_time,
               mixer_number, driver_name, digital_signature, receiver_name, receiver_phone,
               status, created_at
        FROM challans
        WHERE load_id = $1
        "#,
    )
    .bind(load_id)
    .fetch_optional(pool)
    .await?;

    Ok(challan)
}

pub async fn record_pod(
    pool: &PgPool,
    load_id: Uuid,
    receiver_name: &str,
    receiver_phone: &str,
    signature_url: Option<&str>,
    photo_url: Option<&str>,
    notes: Option<&str>,
) -> Result<ProofOfDelivery, AppError> {
    let mut tx = pool.begin().await?;

    let pod = sqlx::query_as::<_, ProofOfDelivery>(
        r#"
        INSERT INTO proof_of_deliveries (load_id, receiver_name, receiver_phone, signature_url, photo_url, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (load_id) DO UPDATE
        SET receiver_name = EXCLUDED.receiver_name,
            receiver_phone = EXCLUDED.receiver_phone,
            signature_url = EXCLUDED.signature_url,
            photo_url = EXCLUDED.photo_url,
            notes = EXCLUDED.notes,
            delivered_at = NOW()
        RETURNING id, load_id, receiver_name, receiver_phone, signature_url, photo_url, notes, delivered_at
        "#,
    )
    .bind(load_id)
    .bind(receiver_name)
    .bind(receiver_phone)
    .bind(signature_url)
    .bind(photo_url)
    .bind(notes)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query("UPDATE order_loads SET status = 'completed', pour_completed_at = NOW() WHERE id = $1")
        .bind(load_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(pod)
}
