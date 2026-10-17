//! Customer service enquiries: authenticated capture, per-type validation and customer-only history.
//! These are leads, not orders, payments, supplier assignments or official quotations.
use crate::{auth::{middleware::check_role, AuthUser}, error::AppError, state::AppState};
use axum::{extract::{Path, State}, http::StatusCode, Json};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(tag = "service_type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum NewServiceEnquiry {
    Cement {
        customer_name: String,
        contact_number: String,
        cement_brand: String,
        required_bags: i32,
        location: String,
        required_date: NaiveDate,
    },
    LabourContractor {
        work_name: String,
        location: String,
        duration_days: i32,
        work_start_date: NaiveDate,
        total_sq_ft: f64,
        expected_price_per_sq_ft: f64,
    },
    BuildingMaterial {
        material_type: String,
        location: String,
        contact_person_name: String,
        mobile_number: String,
        delivery_date: NaiveDate,
    },
}

fn field(value: &str, label: &str, minimum: usize, maximum: usize) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.chars().count() < minimum || trimmed.chars().count() > maximum || trimmed.chars().any(char::is_control) {
        return Err(AppError::BadRequest(format!("{label} must contain {minimum}–{maximum} valid characters")));
    }
    Ok(trimmed.to_owned())
}

fn phone(value: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    let digits = trimmed.trim_start_matches('+');
    if digits.len() < 10 || digits.len() > 15 || !digits.bytes().all(|b| b.is_ascii_digit())
        || trimmed.matches('+').count() > 1 || (trimmed.contains('+') && !trimmed.starts_with('+')) {
        return Err(AppError::BadRequest("Enter a valid 10–15 digit contact number".into()));
    }
    Ok(trimmed.to_owned())
}

fn valid_date(date: NaiveDate) -> Result<NaiveDate, AppError> {
    if date < chrono::Utc::now().date_naive() {
        return Err(AppError::BadRequest("Required date cannot be in the past".into()));
    }
    Ok(date)
}

fn positive_number(value: f64, label: &str, maximum: f64) -> Result<f64, AppError> {
    if !value.is_finite() || value <= 0.0 || value > maximum {
        return Err(AppError::BadRequest(format!("{label} must be greater than zero and within supported limits")));
    }
    Ok(value)
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<NewServiceEnquiry>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    check_role(&auth, &["customer"])?;

    // The labour form intentionally uses the verified session identity for contact,
    // because its requested fields do not include a customer phone/name.
    let (kind, name, mobile, location, date, details) = match req {
        NewServiceEnquiry::Cement { customer_name, contact_number, cement_brand, required_bags, location, required_date } => {
            if !(1..=100_000).contains(&required_bags) {
                return Err(AppError::BadRequest("Required bags must be between 1 and 100000".into()));
            }
            ("CEMENT", field(&customer_name, "Customer name", 2, 150)?, phone(&contact_number)?,
                field(&location, "Location", 3, 500)?, valid_date(required_date)?,
                json!({"cement_brand": field(&cement_brand, "Cement brand", 2, 100)?, "required_bags": required_bags}))
        },
        NewServiceEnquiry::LabourContractor { work_name, location, duration_days, work_start_date, total_sq_ft, expected_price_per_sq_ft } => {
            if !(1..=3650).contains(&duration_days) {
                return Err(AppError::BadRequest("Duration must be between 1 and 3650 days".into()));
            }
            let name: String = sqlx::query_scalar("SELECT full_name FROM users WHERE id = $1").bind(auth.user_id).fetch_one(&state.db).await?;
            ("LABOUR_CONTRACTOR", field(&name, "Customer name", 2, 150)?, phone(&auth.phone)?,
                field(&location, "Location", 3, 500)?, valid_date(work_start_date)?,
                json!({"work_name": field(&work_name, "Work name", 2, 150)?, "duration_days": duration_days,
                    "total_sq_ft": positive_number(total_sq_ft, "Total area", 1_000_000_000.0)?,
                    "expected_price_per_sq_ft": positive_number(expected_price_per_sq_ft, "Expected rate", 10_000_000.0)?}))
        },
        NewServiceEnquiry::BuildingMaterial { material_type, location, contact_person_name, mobile_number, delivery_date } => {
            const MATERIALS: [&str; 6] = ["10 MM", "20 MM", "40 MM", "Crushed Sand", "Gujrat Washed Sand", "Cement Bag"];
            if !MATERIALS.contains(&material_type.as_str()) {
                return Err(AppError::BadRequest("Choose a supported building material".into()));
            }
            ("BUILDING_MATERIAL", field(&contact_person_name, "Contact person", 2, 150)?, phone(&mobile_number)?,
                field(&location, "Location", 3, 500)?, valid_date(delivery_date)?,
                json!({"material_type": material_type}))
        }
    };
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO customer_service_enquiries (customer_id, service_type, contact_name, contact_phone, location, required_date, details) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    )
    .bind(auth.user_id).bind(kind).bind(name).bind(mobile).bind(location).bind(date).bind(details)
    .fetch_one(&state.db).await?;
    Ok((StatusCode::CREATED, Json(json!({"success": true, "id": id, "status": "NEW", "message": "Enquiry submitted. Our team will contact you."}))))
}

pub async fn list_customer(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Value>, AppError> {
    check_role(&auth, &["customer"])?;
    let enquiries: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id', id, 'service_type', service_type, 'contact_name', contact_name, 'contact_phone', contact_phone, 'location', location, 'required_date', required_date, 'details', details, 'status', status, 'created_at', created_at) FROM customer_service_enquiries WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 100",
    ).bind(auth.user_id).fetch_all(&state.db).await?;
    Ok(Json(json!({"enquiries": enquiries})))
}

pub async fn list_admin(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Value>, AppError> {
    check_role(&auth, &["admin"])?;
    let enquiries: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id', id, 'customer_id', customer_id, 'service_type', service_type, 'contact_name', contact_name, 'contact_phone', contact_phone, 'location', location, 'required_date', required_date, 'details', details, 'status', status, 'created_at', created_at) FROM customer_service_enquiries ORDER BY created_at DESC LIMIT 200",
    ).fetch_all(&state.db).await?;
    Ok(Json(json!({"enquiries": enquiries})))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusUpdate { pub status: String }

pub async fn update_status(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(update): Json<StatusUpdate>,
) -> Result<Json<Value>, AppError> {
    check_role(&auth, &["admin"])?;
    if !["NEW", "CONTACTED", "QUOTED", "CLOSED"].contains(&update.status.as_str()) {
        return Err(AppError::BadRequest("Invalid enquiry status".into()));
    }
    let changed: Option<Uuid> = sqlx::query_scalar(
        "UPDATE customer_service_enquiries SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING id",
    ).bind(&update.status).bind(id).fetch_optional(&state.db).await?;
    changed.ok_or_else(|| AppError::NotFound("Enquiry not found".into()))?;
    Ok(Json(json!({"success": true, "id": id, "status": update.status})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validate_phones_and_fields() {
        assert!(phone("+919876543210").is_ok());
        assert!(phone("98765").is_err());
        assert!(phone("abc1234567890").is_err());
        assert!(field("  Pune  ", "Location", 3, 500).is_ok());
        assert!(field("\n", "Location", 3, 500).is_err());
        assert!(positive_number(f64::NAN, "area", 1_000.0).is_err());
    }
}
