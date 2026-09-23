use crate::{
    error::AppError,
    models::plant::{CustomerSite, RmcPlant},
};
use sqlx::PgPool;
use uuid::Uuid;

pub async fn list_plants(pool: &PgPool) -> Result<Vec<RmcPlant>, AppError> {
    let plants = sqlx::query_as::<_, RmcPlant>(
        r#"
        SELECT id, owner_id, name, code, latitude, longitude, address_line, city, state, pincode,
               contact_phone, contact_email, capacity_m3_per_hr, rating, is_active, created_at, updated_at
        FROM rmc_plants
        WHERE is_active = TRUE
        ORDER BY rating DESC, name ASC
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(plants)
}

pub async fn find_plant_by_id(pool: &PgPool, plant_id: Uuid) -> Result<Option<RmcPlant>, AppError> {
    let plant = sqlx::query_as::<_, RmcPlant>(
        r#"
        SELECT id, owner_id, name, code, latitude, longitude, address_line, city, state, pincode,
               contact_phone, contact_email, capacity_m3_per_hr, rating, is_active, created_at, updated_at
        FROM rmc_plants
        WHERE id = $1
        "#,
    )
    .bind(plant_id)
    .fetch_optional(pool)
    .await?;

    Ok(plant)
}

pub async fn create_plant(
    pool: &PgPool,
    owner_id: Uuid,
    name: &str,
    code: &str,
    lat: f64,
    lng: f64,
    address_line: &str,
    city: &str,
    state: &str,
    pincode: &str,
    contact_phone: &str,
    contact_email: Option<&str>,
    capacity: f64,
) -> Result<RmcPlant, AppError> {
    let plant = sqlx::query_as::<_, RmcPlant>(
        r#"
        INSERT INTO rmc_plants (owner_id, name, code, latitude, longitude, address_line, city, state, pincode, contact_phone, contact_email, capacity_m3_per_hr)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, owner_id, name, code, latitude, longitude, address_line, city, state, pincode,
                  contact_phone, contact_email, capacity_m3_per_hr, rating, is_active, created_at, updated_at
        "#,
    )
    .bind(owner_id)
    .bind(name)
    .bind(code)
    .bind(lat)
    .bind(lng)
    .bind(address_line)
    .bind(city)
    .bind(state)
    .bind(pincode)
    .bind(contact_phone)
    .bind(contact_email)
    .bind(bigdecimal::BigDecimal::from_f64(capacity).unwrap_or_default())
    .fetch_one(pool)
    .await?;

    Ok(plant)
}

pub async fn list_customer_sites(pool: &PgPool, customer_id: Uuid) -> Result<Vec<CustomerSite>, AppError> {
    let sites = sqlx::query_as::<_, CustomerSite>(
        r#"
        SELECT id, customer_id, name, address_line, city, state, pincode, latitude, longitude, contact_person, contact_phone, created_at
        FROM customer_sites
        WHERE customer_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(customer_id)
    .fetch_all(pool)
    .await?;

    Ok(sites)
}
