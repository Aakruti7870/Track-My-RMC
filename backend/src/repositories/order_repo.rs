use bigdecimal::FromPrimitive;
use crate::{
    error::AppError,
    models::order::{Order, OrderLoad},
};
use bigdecimal::BigDecimal;
use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn create_order(
    pool: &PgPool,
    order_number: &str,
    customer_id: Uuid,
    plant_id: Uuid,
    site_id: Uuid,
    concrete_grade: &str,
    quantity_m3: f64,
    delivery_date: NaiveDate,
    delivery_time_slot: &str,
    pump_required: bool,
    special_instructions: Option<&str>,
    total_amount: f64,
    tax_amount: f64,
) -> Result<Order, AppError> {
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

pub async fn list_customer_orders(pool: &PgPool, customer_id: Uuid) -> Result<Vec<Order>, AppError> {
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

pub async fn update_order_status(pool: &PgPool, order_id: Uuid, status: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2")
        .bind(status)
        .bind(order_id)
        .execute(pool)
        .await?;

    Ok(())
}
