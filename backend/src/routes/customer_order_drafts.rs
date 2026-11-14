//! Customer-owned editable forms. A draft has no order, payment or plant-side effects.
use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DraftForm {
    pub(crate) plant_id: Option<String>,
    pub(crate) grade: Option<String>,
    pub(crate) quantity: String,
    pub(crate) date: String,
    pub(crate) time: Option<String>,
    pub(crate) site_name: String,
    pub(crate) address: String,
    pub(crate) contact: String,
    pub(crate) mobile: String,
    pub(crate) notes: String,
    pub(crate) payment_mode: Option<String>,
    pub(crate) quotation_id: Option<String>,
    pub(crate) site_id: Option<String>,
    pub(crate) lat: Option<f64>,
    pub(crate) lng: Option<f64>,
    pub(crate) pump_required: bool,
}

impl DraftForm {
    fn validate(&self) -> Result<(), AppError> {
        for (value, max) in [
            (self.plant_id.as_deref().unwrap_or(""), 64),
            (self.grade.as_deref().unwrap_or(""), 30),
            (self.quantity.as_str(), 40),
            (self.date.as_str(), 32),
            (self.time.as_deref().unwrap_or(""), 50),
            (self.site_name.as_str(), 160),
            (self.address.as_str(), 500),
            (self.contact.as_str(), 150),
            (self.mobile.as_str(), 20),
            (self.notes.as_str(), 2000),
            (self.payment_mode.as_deref().unwrap_or(""), 40),
            (self.quotation_id.as_deref().unwrap_or(""), 64),
            (self.site_id.as_deref().unwrap_or(""), 64),
        ] {
            if value.len() > max {
                return Err(AppError::BadRequest(
                    "Draft field exceeds its supported length".into(),
                ));
            }
        }
        if self.lat.is_some() != self.lng.is_some()
            || self
                .lat
                .is_some_and(|v| !v.is_finite() || !(-90.0..=90.0).contains(&v))
            || self
                .lng
                .is_some_and(|v| !v.is_finite() || !(-180.0..=180.0).contains(&v))
        {
            return Err(AppError::BadRequest("Invalid draft coordinates".into()));
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveDraft {
    id: Option<Uuid>,
    form: DraftForm,
}

async fn active_customer(state: &AppState, user: &AuthUser) -> Result<(), AppError> {
    check_role(user, &["customer"])?;
    let active: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND role='customer' AND is_active)",
    )
    .bind(user.user_id)
    .fetch_one(&state.db)
    .await?;
    if !active {
        return Err(AppError::Forbidden(
            "Active customer account required".into(),
        ));
    }
    Ok(())
}

pub async fn save(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<SaveDraft>,
) -> Result<Json<Value>, AppError> {
    active_customer(&state, &user).await?;
    input.form.validate()?;
    let form = serde_json::to_value(input.form)
        .map_err(|_| AppError::BadRequest("Invalid draft".into()))?;
    let id: Uuid = if let Some(id) = input.id {
        sqlx::query_scalar("UPDATE customer_order_drafts SET form=$3,updated_at=NOW() WHERE id=$1 AND customer_id=$2 RETURNING id")
            .bind(id).bind(user.user_id).bind(form).fetch_optional(&state.db).await?
            .ok_or_else(|| AppError::NotFound("Draft not found".into()))?
    } else {
        sqlx::query_scalar(
            "INSERT INTO customer_order_drafts(customer_id,form) VALUES($1,$2) RETURNING id",
        )
        .bind(user.user_id)
        .bind(form)
        .fetch_one(&state.db)
        .await?
    };
    Ok(Json(json!({"id":id})))
}

pub async fn list(State(state): State<AppState>, user: AuthUser) -> Result<Json<Value>, AppError> {
    active_customer(&state, &user).await?;
    let drafts: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',d.id,'form',d.form,'updated_at',d.updated_at,'provisional_id',p.id,'provisional_status',CASE WHEN p.status='PENDING_KYC' AND p.expires_at<=NOW() THEN 'EXPIRED' ELSE p.status END,'plant_response',p.plant_response) FROM customer_order_drafts d LEFT JOIN customer_provisional_requests p ON p.draft_id=d.id AND p.customer_id=d.customer_id WHERE d.customer_id=$1 ORDER BY d.updated_at DESC LIMIT 100")
        .bind(user.user_id).fetch_all(&state.db).await?;
    Ok(Json(json!({"drafts":drafts})))
}

pub async fn get_one(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    active_customer(&state, &user).await?;
    let draft: Value = sqlx::query_scalar("SELECT jsonb_build_object('id',d.id,'form',d.form,'updated_at',d.updated_at,'provisional_id',p.id,'provisional_status',CASE WHEN p.status='PENDING_KYC' AND p.expires_at<=NOW() THEN 'EXPIRED' ELSE p.status END,'plant_response',p.plant_response) FROM customer_order_drafts d LEFT JOIN customer_provisional_requests p ON p.draft_id=d.id AND p.customer_id=d.customer_id WHERE d.id=$1 AND d.customer_id=$2")
        .bind(id).bind(user.user_id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Draft not found".into()))?;
    Ok(Json(draft))
}

pub async fn remove(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    active_customer(&state, &user).await?;
    let result = sqlx::query("DELETE FROM customer_order_drafts d WHERE id=$1 AND customer_id=$2 AND NOT EXISTS(SELECT 1 FROM customer_provisional_requests p WHERE p.draft_id=d.id AND p.status='PENDING_KYC' AND p.expires_at>NOW())")
        .bind(id)
        .bind(user.user_id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Draft not found".into()));
    }
    Ok(Json(json!({"success":true})))
}
