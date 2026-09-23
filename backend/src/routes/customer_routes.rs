use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::{
        order::CreateOrderRequest,
        plant::CreateSiteRequest,
    },
    repositories::{order_repo, plant_repo},
    services::order_service,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use serde_json::json;
use uuid::Uuid;

pub async fn list_plants(
    State(state): State<AppState>,
    _auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let plants = plant_repo::list_plants(&state.db).await?;
    Ok(Json(json!({ "success": true, "plants": plants })))
}

pub async fn get_grades() -> impl IntoResponse {
    Json(json!({
        "success": true,
        "grades": ["M-10", "M-15", "M-20", "M-25", "M-30", "M-35", "M-40", "M-45"]
    }))
}

pub async fn list_sites(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let sites = plant_repo::list_customer_sites(&state.db, auth_user.user_id).await?;
    Ok(Json(json!({ "success": true, "sites": sites })))
}

pub async fn create_site(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateSiteRequest>,
) -> Result<impl IntoResponse, AppError> {
    let site = sqlx::query_as::<_, crate::models::plant::CustomerSite>(
        r#"
        INSERT INTO customer_sites (customer_id, name, address_line, city, state, pincode, latitude, longitude, contact_person, contact_phone)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, customer_id, name, address_line, city, state, pincode, latitude, longitude, contact_person, contact_phone, created_at
        "#,
    )
    .bind(auth_user.user_id)
    .bind(&req.name)
    .bind(&req.address_line)
    .bind(&req.city)
    .bind(&req.state)
    .bind(&req.pincode)
    .bind(req.latitude)
    .bind(req.longitude)
    .bind(&req.contact_person)
    .bind(&req.contact_phone)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "site": site })))
}

pub async fn place_order(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateOrderRequest>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer", "owner", "admin"])?;
    let order = order_service::place_order(&state, auth_user.user_id, req).await?;
    Ok(Json(json!({
        "success": true,
        "order_id": order.id,
        "order_number": order.order_number,
        "order": order,
    })))
}

pub async fn list_orders(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let orders = order_repo::list_customer_orders(&state.db, auth_user.user_id).await?;
    Ok(Json(json!({ "success": true, "orders": orders })))
}

pub async fn get_order_details(
    State(state): State<AppState>,
    _auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let (order, loads) = order_service::get_order_with_loads(&state, id).await?;
    Ok(Json(json!({
        "success": true,
        "order": order,
        "loads": loads,
    })))
}
