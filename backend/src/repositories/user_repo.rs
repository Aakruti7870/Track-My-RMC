use crate::{
    error::AppError,
    models::user::{User, UserProfile},
};
use sqlx::PgPool;
use uuid::Uuid;

pub async fn find_by_phone_or_email(
    pool: &PgPool,
    identifier: &str,
) -> Result<Option<User>, AppError> {
    let user = sqlx::query_as::<_, User>(
        r#"
        SELECT id, COALESCE(phone, '') AS phone, email, hashed_password, full_name, role, is_active, is_verified, created_at, updated_at
        FROM users
        WHERE phone = $1 OR email = $1
        LIMIT 1
        "#,
    )
    .bind(identifier)
    .fetch_optional(pool)
    .await?;

    Ok(user)
}

pub async fn find_by_id(pool: &PgPool, id: Uuid) -> Result<Option<User>, AppError> {
    let user = sqlx::query_as::<_, User>(
        r#"
        SELECT id, COALESCE(phone, '') AS phone, email, hashed_password, full_name, role, is_active, is_verified, created_at, updated_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(user)
}

pub(crate) const CUSTOMER_SIGNUP_NAME: &str = "RMC Customer";

pub async fn create_whatsapp_customer(
    pool: &PgPool,
    phone: &str,
    hashed_password: &str,
) -> Result<User, AppError> {
    let mut tx = pool.begin().await?;

    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (phone, email, hashed_password, full_name, role)
        VALUES ($1, NULL, $2, $3, 'customer')
        RETURNING id, phone, email, hashed_password, full_name, role, is_active, is_verified, created_at, updated_at
        "#,
    )
    .bind(phone)
    .bind(hashed_password)
    .bind(CUSTOMER_SIGNUP_NAME)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO user_profiles (user_id, needs_kyc_name) VALUES ($1, TRUE)
        "#,
    )
    .bind(user.id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(user)
}

pub async fn get_user_profile(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<UserProfile>, AppError> {
    let profile = sqlx::query_as::<_, UserProfile>(
        r#"
        SELECT id, user_id, business_name, gst_number, kyc_status, verified_name, needs_kyc_name, address_line, city, state, pincode, created_at, updated_at
        FROM user_profiles
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(profile)
}

pub struct ProfileUpdate<'a> {
    pub user_id: Uuid,
    pub full_name: Option<&'a str>,
    pub business_name: Option<&'a str>,
    pub address_line: Option<&'a str>,
    pub city: Option<&'a str>,
    pub state: Option<&'a str>,
    pub pincode: Option<&'a str>,
}

pub async fn update_user_profile(pool: &PgPool, input: ProfileUpdate<'_>) -> Result<(), AppError> {
    let ProfileUpdate {
        user_id,
        full_name,
        business_name,
        address_line,
        city,
        state,
        pincode,
    } = input;
    let mut tx = pool.begin().await?;

    if let Some(name) = full_name {
        sqlx::query("UPDATE users SET full_name = $1, updated_at = NOW() WHERE id = $2")
            .bind(name)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
    }

    sqlx::query(
        r#"
        UPDATE user_profiles
        SET business_name = COALESCE($1, business_name),
            address_line = COALESCE($2, address_line),
            city = COALESCE($3, city),
            state = COALESCE($4, state),
            pincode = COALESCE($5, pincode),
            updated_at = NOW()
        WHERE user_id = $6
        "#,
    )
    .bind(business_name)
    .bind(address_line)
    .bind(city)
    .bind(state)
    .bind(pincode)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}
