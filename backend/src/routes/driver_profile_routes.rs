//! Driver self-service identity and owner-managed onboarding; preserves trip/attendance routes.
use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

fn experience_label(months: Option<i32>) -> String {
    match months {
        None => "Not provided".into(),
        Some(value) => {
            let years = value / 12;
            let remaining = value % 12;
            let year_label = if years == 1 { "Year" } else { "Years" };
            let month_label = if remaining == 1 { "Month" } else { "Months" };
            match (years, remaining) {
                (0, months) => format!("{months} {month_label}"),
                (years, 0) => format!("{years} {year_label}"),
                (years, months) => format!("{years} {year_label} {months} {month_label}"),
            }
        }
    }
}

pub async fn get_driver_identity(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;
    let name: String = sqlx::query_scalar(
        "SELECT full_name FROM users WHERE id=$1 AND role='driver' AND is_active=TRUE",
    )
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Active driver not found".into()))?;

    // Never guess between two simultaneous plant assignments.
    let plants = sqlx::query(
        r#"SELECT p.id, p.name, p.address_line FROM rmc_plants p
           WHERE p.is_active=TRUE AND (
               EXISTS (SELECT 1 FROM transit_mixers tm WHERE tm.plant_id=p.id AND tm.driver_id=$1)
               OR EXISTS (SELECT 1 FROM driver_employment_profiles ep
                          WHERE ep.plant_id=p.id AND ep.driver_id=$1 AND ep.is_active=TRUE)
           ) ORDER BY p.id LIMIT 2"#,
    )
    .bind(auth_user.user_id)
    .fetch_all(&state.db)
    .await?;
    if plants.len() > 1 {
        return Err(AppError::Conflict(
            "Multiple plant assignments detected. Contact your plant owner.".into(),
        ));
    }
    let Some(plant) = plants.first() else {
        return Ok(Json(json!({
            "success": true, "plant_name": null, "plant_address": null,
            "tm_number": null, "driver_name": name, "blood_group": null,
            "emergency_contact_1": null, "emergency_contact_2": null,
            "employment": {
                "employee_id": null, "company_joining_date": null,
                "total_driving_experience_months": null,
                "total_driving_experience_display": "Not provided"
            }
        })));
    };
    let plant_id: Uuid = plant.get("id");
    let tm: Option<String> = sqlx::query_scalar(
        "SELECT registration_number FROM transit_mixers WHERE plant_id=$1 AND driver_id=$2 ORDER BY created_at DESC LIMIT 1",
    ).bind(plant_id).bind(auth_user.user_id).fetch_optional(&state.db).await?;

    let profile = sqlx::query(
        r#"SELECT employee_code, company_joining_date, total_driving_experience_months,
                  blood_group, emergency_contact_1_name, emergency_contact_1_phone,
                  emergency_contact_2_name, emergency_contact_2_phone
           FROM driver_employment_profiles
           WHERE plant_id=$1 AND driver_id=$2 AND is_active=TRUE"#,
    )
    .bind(plant_id)
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?;

    let field = |key: &str| -> Option<String> {
        profile
            .as_ref()
            .and_then(|p| p.get::<Option<String>, _>(key))
    };
    let date = profile
        .as_ref()
        .and_then(|p| p.get::<Option<NaiveDate>, _>("company_joining_date"));
    let months = profile
        .as_ref()
        .and_then(|p| p.get::<Option<i32>, _>("total_driving_experience_months"));
    Ok(Json(json!({
        "success": true,
        "plant_name": plant.get::<String, _>("name"),
        "plant_address": plant.get::<String, _>("address_line"),
        "tm_number": tm,
        "driver_name": name,
        "blood_group": field("blood_group"),
        "emergency_contact_1": {
            "name": field("emergency_contact_1_name"),
            "phone": field("emergency_contact_1_phone")
        },
        "emergency_contact_2": {
            "name": field("emergency_contact_2_name"),
            "phone": field("emergency_contact_2_phone")
        },
        "employment": {
            "employee_id": field("employee_code"),
            "company_joining_date": date.map(|d| d.to_string()),
            "total_driving_experience_months": months,
            "total_driving_experience_display": experience_label(months)
        }
    })))
}

fn owner_role(user: &AuthUser) -> Result<(), AppError> {
    // PII, emergency contacts and medical information must not be exposed
    // to general plant staff, even when they can access fleet operations.
    check_role(user, &["owner", "plant_owner"])
}

pub async fn list_plant_drivers(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    owner_role(&auth_user)?;
    super::business_routes::ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    let drivers: Vec<Value> = sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
            'driver_id', d.id, 'driver_name', d.full_name, 'phone', d.phone,
            'employee_id', ep.employee_code, 'company_joining_date', ep.company_joining_date,
            'total_driving_experience_months', ep.total_driving_experience_months,
            'blood_group', ep.blood_group,
            'emergency_contact_1_name', ep.emergency_contact_1_name,
            'emergency_contact_1_phone', ep.emergency_contact_1_phone,
            'emergency_contact_2_name', ep.emergency_contact_2_name,
            'emergency_contact_2_phone', ep.emergency_contact_2_phone,
            'is_active', ep.is_active,
            'tm_number', (SELECT tm.registration_number FROM transit_mixers tm
                          WHERE tm.plant_id=ep.plant_id AND tm.driver_id=d.id
                          ORDER BY tm.created_at DESC LIMIT 1)
        ) FROM driver_employment_profiles ep
        JOIN users d ON d.id=ep.driver_id AND d.role='driver'
        WHERE ep.plant_id=$1 ORDER BY d.full_name LIMIT 500"#,
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"success": true, "drivers": drivers})))
}

#[derive(Debug, Deserialize)]
pub struct UpsertDriverProfile {
    pub phone: String,
    pub employee_id: String,
    pub company_joining_date: String,
    pub total_driving_experience_months: i32,
    pub blood_group: Option<String>,
    pub emergency_contact_1_name: Option<String>,
    pub emergency_contact_1_phone: Option<String>,
    pub emergency_contact_2_name: Option<String>,
    pub emergency_contact_2_phone: Option<String>,
    pub transit_mixer_id: Option<Uuid>,
}

fn bounded_optional(
    value: Option<String>,
    max: usize,
    field: &str,
) -> Result<Option<String>, AppError> {
    let value = value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if value.as_ref().is_some_and(|s| s.len() > max) {
        return Err(AppError::BadRequest(format!("{field} is too long")));
    }
    Ok(value)
}
fn normalized_phone(value: &str) -> Result<String, AppError> {
    let phone: String = value.chars().filter(|c| c.is_ascii_digit()).collect();
    let canonical = if phone.len() == 10 {
        format!("91{phone}")
    } else {
        phone
    };
    if !(10..=15).contains(&canonical.len()) {
        return Err(AppError::BadRequest(
            "Enter a valid registered driver mobile number".into(),
        ));
    }
    Ok(canonical)
}
fn validate_contact(value: Option<String>) -> Result<Option<String>, AppError> {
    let Some(phone) = bounded_optional(value, 20, "Emergency contact")? else {
        return Ok(None);
    };
    if !phone
        .chars()
        .all(|c| c.is_ascii_digit() || c == '+' || c == '-' || c == ' ')
        || phone.chars().filter(|c| c.is_ascii_digit()).count() < 10
        || phone.chars().filter(|c| c.is_ascii_digit()).count() > 15
    {
        return Err(AppError::BadRequest(
            "Invalid emergency contact number".into(),
        ));
    }
    Ok(Some(phone))
}

pub async fn save_driver_profile(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(input): Json<UpsertDriverProfile>,
) -> Result<impl IntoResponse, AppError> {
    owner_role(&auth_user)?;
    super::business_routes::ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    let phone = normalized_phone(&input.phone)?;
    let employee_id = input.employee_id.trim().to_ascii_uppercase();
    if employee_id.len() < 2
        || employee_id.len() > 50
        || !employee_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::BadRequest(
            "Employee ID must use 2-50 letters, digits, _ or -".into(),
        ));
    }
    let date = NaiveDate::parse_from_str(&input.company_joining_date, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Joining date must be YYYY-MM-DD".into()))?;
    if date > Utc::now().date_naive() {
        return Err(AppError::BadRequest(
            "Joining date cannot be in the future".into(),
        ));
    }
    if !(0..=960).contains(&input.total_driving_experience_months) {
        return Err(AppError::BadRequest(
            "Experience must be between 0 and 960 months".into(),
        ));
    }
    let blood_group = bounded_optional(input.blood_group, 3, "Blood group")?;
    if blood_group
        .as_ref()
        .is_some_and(|v| !["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].contains(&v.as_str()))
    {
        return Err(AppError::BadRequest("Unsupported blood group".into()));
    }
    let ec1_name = bounded_optional(input.emergency_contact_1_name, 120, "Contact 1 name")?;
    let ec2_name = bounded_optional(input.emergency_contact_2_name, 120, "Contact 2 name")?;
    let ec1_phone = validate_contact(input.emergency_contact_1_phone)?;
    let ec2_phone = validate_contact(input.emergency_contact_2_phone)?;

    let mut tx = state.db.begin().await?;
    let driver_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE regexp_replace(phone, '[^0-9]', '', 'g') = $1 AND role='driver' AND is_active=TRUE AND is_verified=TRUE FOR UPDATE",
    ).bind(&phone).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::NotFound("Registered active driver not found; complete driver WhatsApp registration first".into()))?;

    let cross_plant: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(
            SELECT 1 FROM driver_employment_profiles WHERE driver_id=$1 AND plant_id<>$2 AND is_active=TRUE
            UNION ALL
            SELECT 1 FROM transit_mixers WHERE driver_id=$1 AND plant_id<>$2
        )"#,
    ).bind(driver_id).bind(plant_id).fetch_one(&mut *tx).await?;
    if cross_plant {
        return Err(AppError::Conflict(
            "Driver is already assigned to another plant".into(),
        ));
    }
    if let Some(mixer_id) = input.transit_mixer_id {
        let other: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM transit_mixers WHERE plant_id=$1 AND driver_id=$2 AND id<>$3)",
        ).bind(plant_id).bind(driver_id).bind(mixer_id).fetch_one(&mut *tx).await?;
        if other {
            return Err(AppError::Conflict(
                "Driver already has another mixer. Reassign it in Fleet first".into(),
            ));
        }
        let result = sqlx::query(
            "UPDATE transit_mixers SET driver_id=$1 WHERE id=$2 AND plant_id=$3 AND (driver_id IS NULL OR driver_id=$1)",
        ).bind(driver_id).bind(mixer_id).bind(plant_id).execute(&mut *tx).await?;
        if result.rows_affected() != 1 {
            return Err(AppError::Conflict(
                "Mixer is unavailable or belongs to a different plant".into(),
            ));
        }
    }
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM driver_employment_profiles WHERE plant_id=$1 AND driver_id=$2)",
    ).bind(plant_id).bind(driver_id).fetch_one(&mut *tx).await?;

    let update = sqlx::query(
        r#"INSERT INTO driver_employment_profiles
          (plant_id,driver_id,employee_code,company_joining_date,total_driving_experience_months,
           blood_group,emergency_contact_1_name,emergency_contact_1_phone,
           emergency_contact_2_name,emergency_contact_2_phone,is_active,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,NOW())
          ON CONFLICT(plant_id,driver_id) DO UPDATE SET
          employee_code=EXCLUDED.employee_code, company_joining_date=EXCLUDED.company_joining_date,
          total_driving_experience_months=EXCLUDED.total_driving_experience_months,
          blood_group=EXCLUDED.blood_group,
          emergency_contact_1_name=EXCLUDED.emergency_contact_1_name,
          emergency_contact_1_phone=EXCLUDED.emergency_contact_1_phone,
          emergency_contact_2_name=EXCLUDED.emergency_contact_2_name,
          emergency_contact_2_phone=EXCLUDED.emergency_contact_2_phone,
          is_active=TRUE,updated_at=NOW()"#,
    )
    .bind(plant_id)
    .bind(driver_id)
    .bind(&employee_id)
    .bind(date)
    .bind(input.total_driving_experience_months)
    .bind(&blood_group)
    .bind(&ec1_name)
    .bind(&ec1_phone)
    .bind(&ec2_name)
    .bind(&ec2_phone)
    .execute(&mut *tx)
    .await;
    if let Err(err) = update {
        if err
            .as_database_error()
            .is_some_and(|e| e.is_unique_violation())
        {
            return Err(AppError::Conflict(
                "Employee ID already belongs to another driver in this plant".into(),
            ));
        }
        return Err(err.into());
    }
    sqlx::query(
        r#"INSERT INTO driver_employment_audit
           (plant_id,driver_id,actor_user_id,action,changed_fields)
           VALUES ($1,$2,$3,$4,$5)"#,
    )
    .bind(plant_id)
    .bind(driver_id)
    .bind(auth_user.user_id)
    .bind(if exists { "UPDATED" } else { "CREATED" })
    .bind(vec![
        "employment",
        "blood_group",
        "emergency_contacts",
        "mixer_assignment",
    ])
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"success": true, "driver_id": driver_id, "message": "Driver profile saved"}),
    ))
}

#[cfg(test)]
mod tests {
    use super::experience_label;
    #[test]
    fn experience_months_display() {
        assert_eq!(experience_label(Some(102)), "8 Years 6 Months");
        assert_eq!(experience_label(Some(12)), "1 Year");
        assert_eq!(experience_label(Some(1)), "1 Month");
        assert_eq!(experience_label(None), "Not provided");
    }
    #[test]
    fn phone_normalization() {
        assert_eq!(
            super::normalized_phone("+91 98765 43210").unwrap(),
            "919876543210"
        );
        assert!(super::normalized_phone("12").is_err());
    }
}
