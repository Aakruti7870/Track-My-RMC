//! One load per row, using the exact same database date and scope as the
//! Plant Owner "Dispatches" KPI. Includes loads later delivered or returned.
use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Query, State},
    Json,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Debug, Default, Deserialize)]
pub struct DispatchPage {
    limit: Option<i64>,
    offset: Option<i64>,
}

pub async fn today(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(page): Query<DispatchPage>,
) -> Result<Json<Value>, AppError> {
    check_role(&auth, &["owner", "plant_owner", "admin"])?;
    let plants: Vec<Uuid> = super::owner_routes::visible_plant_ids(&state, &auth).await?;
    let limit = page.limit.unwrap_or(30).clamp(1, 100);
    let offset = page.offset.unwrap_or(0).clamp(0, 100_000);

    // These two predicates deliberately match get_owner_home.dispatched_loads.
    let (date, total): (NaiveDate, i64) = sqlx::query_as(
        "SELECT CURRENT_DATE, COUNT(*)
         FROM order_loads l JOIN orders o ON o.id=l.order_id
         WHERE o.plant_id=ANY($1) AND l.dispatched_at::date=CURRENT_DATE",
    )
    .bind(&plants)
    .fetch_one(&state.db)
    .await?;

    let loads: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object(
           'id',l.id,'order_id',o.id,'order_number',o.order_number,
           'plant_name',p.name,'load_number',l.load_number,
           'quantity_m3',l.quantity_m3::double precision,
           'status',upper(l.status),'grade',o.concrete_grade,
           'dispatched_at',l.dispatched_at,
           'mixer_number',m.registration_number,'driver_name',d.full_name,
           'site_name',s.name
         )
         FROM order_loads l
         JOIN orders o ON o.id=l.order_id
         JOIN rmc_plants p ON p.id=o.plant_id
         LEFT JOIN transit_mixers m ON m.id=l.mixer_id
         LEFT JOIN users d ON d.id=l.driver_id
         LEFT JOIN customer_sites s ON s.id=o.site_id
         WHERE o.plant_id=ANY($1) AND l.dispatched_at::date=CURRENT_DATE
         ORDER BY l.dispatched_at DESC,l.id DESC
         LIMIT $2 OFFSET $3",
    )
    .bind(&plants)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "window_date": date,
        "total": total,
        "loads": loads,
        "has_more": offset + (loads.len() as i64) < total
    })))
}
