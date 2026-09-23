use crate::{
    error::AppError,
    models::user::{User, UserProfile, UserResponse},
};
use sqlx::PgPool;
use uuid::Uuid;

pub async fn find_by_phone_or_email(pool: &PgPool, identifier: &str) -> Result<Option<User>, AppError> {
    let user = sqlx::query_as::<_, User>(
        r#"
        SELECT id, phone, email, hashed_password, full_name, role, is_active, is_verified, created_at, updated_at
        FROM users
        WHERE phone = $1 OR email = $2
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
        SELECT id, phone, email, hashed_password, full_name, role, is_active, is_verified, created_at, updated_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(user)
}

pub async fn create_user(
    pool: &PgPool,
    phone: &str,
    email: Option<&str>,
    hashed_password: &str,
    full_name: &str,
    role: &str,
    business_name: Option<&str>,
) -> Result<User, AppError> {
    let mut tx = pool.begin().await?;

    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (phone, email, hashed_password, full_name, role)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, phone, email, hashed_password, full_name, role, is_active, is_verified, created_at, updated_at
        "#,
    )
    .bind(phone)
    .bind(email)
    .bind(hashed_password)
    .bind(full_name)
    .bind(role)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO user_profiles (user_id, business_name, kyc_status)
        VALUES ($1, $2, 'unverified')
        "#,
    )
    .bind(user.id)
    .bind(business_name)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(user)
}

pub async fn get_user_profile(pool: &PgPool, user_id: Uuid) -> Result<Option<UserProfile>, AppError> {
    let profile = sqlx::query_as::<_, UserProfile>(
        r#"
        SELECT id, user_id, business_name, gst_number, kyc_status, verified_name, address_line, city, state, pincode, created_at, updated_at
        FROM user_profiles
        WHERE user_id = $6
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(profile)
}

pub async fn update_user_profile(
    pool: &PgPool,
    user_id: Uuid,
    full_name: Option<&str>,
    business_name: Option<&str>,
    address_line: Option<&str>,
    city: Option<&str>,
    state: Option<&str>,
    pincode: Option<&str>,
) -> Result<(), AppError> {
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
