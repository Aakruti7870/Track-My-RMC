use crate::{error::AppError, models::order::Order};
use bigdecimal::BigDecimal;
use bigdecimal::FromPrimitive;
use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

pub struct NewOrder<'a> {
    pub order_number: &'a str,
    pub customer_id: Uuid,
    pub plant_id: Uuid,
    pub site_id: Uuid,
    pub concrete_grade: &'a str,
    pub quantity_m3: f64,
    pub delivery_date: NaiveDate,
    pub delivery_time_slot: &'a str,
    pub pump_required: bool,
    pub special_instructions: Option<&'a str>,
    pub total_amount: f64,
    pub tax_amount: f64,
}

pub async fn create_order(pool: &PgPool, input: NewOrder<'_>) -> Result<Order, AppError> {
    let NewOrder {
        order_number,
        customer_id,
        plant_id,
        site_id,
        concrete_grade,
        quantity_m3,
        delivery_date,
        delivery_time_slot,
        pump_required,
        special_instructions,
        total_amount,
        tax_amount,
    } = input;
    let order = sqlx::query_as::<_, Order>(
        r#"
        INSERT INTO orders (
            order_number, customer_id, plant_id, site_id, concrete_grade,
            total_quantity_m3, delivery_date, delivery_time_slot, pump_required,
            special_instructions, total_amount, tax_amount, status, payment_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', 'unpaid')
        RETURNING id, order_number, customer_id, plant_id, site_id, concrete_grade,
                  total_quantity_m3, delivery_date, delivery_time_slot, pump_required,
                  special_instructions, total_amount, tax_amount, status, payment_status,
                  created_at, updated_at
        "#,
    )
    .bind(order_number)
    .bind(customer_id)
    .bind(plant_id)
    .bind(site_id)
    .bind(concrete_grade)
    .bind(BigDecimal::from_f64(quantity_m3).unwrap_or_default())
    .bind(delivery_date)
    .bind(delivery_time_slot)
    .bind(pump_required)
    .bind(special_instructions)
    .bind(BigDecimal::from_f64(total_amount).unwrap_or_default())
    .bind(BigDecimal::from_f64(tax_amount).unwrap_or_default())
    .fetch_one(pool)
    .await?;

    Ok(order)
}

pub async fn find_order_by_id(pool: &PgPool, order_id: Uuid) -> Result<Option<Order>, AppError> {
    let order = sqlx::query_as::<_, Order>(
        r#"
        SELECT id, order_number, customer_id, plant_id, site_id, concrete_grade,
               total_quantity_m3, delivery_date, delivery_time_slot, pump_required,
               special_instructions, total_amount, tax_amount, status, payment_status,
               created_at, updated_at
        FROM orders
        WHERE id = $1
        "#,
    )
    .bind(order_id)
    .fetch_optional(pool)
    .await?;

    Ok(order)
}

pub async fn list_customer_orders(
    pool: &PgPool,
    customer_id: Uuid,
) -> Result<Vec<Order>, AppError> {
    let orders = sqlx::query_as::<_, Order>(
        r#"
        SELECT id, order_number, customer_id, plant_id, site_id, concrete_grade,
               total_quantity_m3, delivery_date, delivery_time_slot, pump_required,
               special_instructions, total_amount, tax_amount, status, payment_status,
               created_at, updated_at
        FROM orders
        WHERE customer_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(customer_id)
    .fetch_all(pool)
    .await?;

    Ok(orders)
}

pub async fn list_plant_orders(pool: &PgPool, plant_id: Uuid) -> Result<Vec<Order>, AppError> {
    let orders = sqlx::query_as::<_, Order>(
        r#"
        SELECT id, order_number, customer_id, plant_id, site_id, concrete_grade,
               total_quantity_m3, delivery_date, delivery_time_slot, pump_required,
               special_instructions, total_amount, tax_amount, status, payment_status,
               created_at, updated_at
        FROM orders
        WHERE plant_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(plant_id)
    .fetch_all(pool)
    .await?;

    Ok(orders)
}

pub async fn update_order_status(
    pool: &PgPool,
    order_id: Uuid,
    status: &str,
) -> Result<(), AppError> {
    let allowed = [
        "pending",
        "confirmed",
        "scheduled",
        "dispatched",
        "in_transit",
        "delivered",
        "completed",
        "cancelled",
    ];
    if !allowed.contains(&status) {
        return Err(AppError::BadRequest("Unsupported order status".to_string()));
    }

    let current: Option<String> = sqlx::query_scalar("SELECT status FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_optional(pool)
        .await?;
    let current = current.ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    if current == status {
        return Ok(());
    }

    let valid_transition = matches!(
        (current.as_str(), status),
        ("pending", "confirmed" | "cancelled")
            | ("confirmed", "scheduled" | "in_production" | "cancelled")
            | ("scheduled", "in_production" | "dispatched" | "cancelled")
            | ("in_production", "produced")
            | ("produced", "dispatched")
            | ("dispatched", "in_transit" | "cancelled")
            | ("in_transit", "delivered")
            | ("delivered", "completed")
    );

    if !valid_transition {
        return Err(AppError::BadRequest(format!(
            "Invalid order status transition: {} -> {}",
            current, status
        )));
    }

    sqlx::query("UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2")
        .bind(status)
        .bind(order_id)
        .execute(pool)
        .await?;

    Ok(())
}
