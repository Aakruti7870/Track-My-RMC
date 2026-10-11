use crate::{
    auth::password::hash_password,
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct PlacesQuery {
    pub q: String,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct PlantOnboardingBody {
    pub owner_name: String,
    pub email: String,
    pub mobile: String,
    pub plant_name: String,
    pub address: String,
    pub lat: f64,
    pub lng: f64,
    pub city: Option<String>,
    pub state: Option<String>,
    pub google_place_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RejectListingBody {
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ApproveListingBody {
    pub city: String,
    pub state: String,
    pub pincode: String,
    pub plant_code: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PlantListingRequest {
    pub id: Uuid,
    pub request_number: String,
    pub source: String,
    pub google_place_id: Option<String>,
    pub name: String,
    pub address: String,
    pub city: Option<String>,
    pub state: Option<String>,
    pub lat: f64,
    pub lng: f64,
    pub contact_phone: Option<String>,
    pub status: String,
    pub requested_role: Option<String>,
    pub claim_requested: bool,
    pub applicant_owner_name: Option<String>,
    pub applicant_email: Option<String>,
    pub applicant_mobile: Option<String>,
    pub plant_id: Option<Uuid>,
    pub reject_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, sqlx::FromRow)]
struct ApprovalSource {
    request_number: String,
    source: String,
    google_place_id: Option<String>,
    name: String,
    address: String,
    lat: f64,
    lng: f64,
    contact_phone: Option<String>,
    applicant_owner_name: Option<String>,
    applicant_email: Option<String>,
    applicant_mobile: Option<String>,
    status: String,
}

fn normalized_email(raw: &str) -> Result<String, AppError> {
    let email = raw.trim().to_ascii_lowercase();
    let Some((local, domain)) = email.split_once('@') else {
        return Err(AppError::BadRequest(
            "Enter a valid email address".to_string(),
        ));
    };
    if email.len() > 254
        || local.is_empty()
        || domain.is_empty()
        || !domain.contains('.')
        || email.matches('@').count() != 1
        || email.chars().any(char::is_whitespace)
    {
        return Err(AppError::BadRequest(
            "Enter a valid email address".to_string(),
        ));
    }
    Ok(email)
}

fn normalized_mobile(raw: &str) -> Result<String, AppError> {
    let digits: String = raw.chars().filter(char::is_ascii_digit).collect();
    let phone = if digits.len() == 10 {
        format!("91{digits}")
    } else {
        digits
    };
    if !(10..=15).contains(&phone.len()) {
        return Err(AppError::BadRequest(
            "Enter a valid mobile number".to_string(),
        ));
    }
    Ok(phone)
}

fn bounded_text(value: &str, min: usize, max: usize, label: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.chars().count() < min || value.chars().count() > max {
        return Err(AppError::BadRequest(format!(
            "{label} must be between {min} and {max} characters"
        )));
    }
    Ok(value.to_string())
}

pub async fn search_places(
    State(state): State<AppState>,
    Query(query): Query<PlacesQuery>,
) -> Result<impl IntoResponse, AppError> {
    let q = bounded_text(&query.q, 3, 120, "Search query")?;
    let Some(key) = state.config.google_places_api_key.as_deref() else {
        return Ok(Json(json!({"configured": false, "places": []})));
    };
    if query.lat.is_some() != query.lng.is_some() {
        return Err(AppError::BadRequest(
            "Latitude and longitude must be supplied together".to_string(),
        ));
    }

    let mut request_body = json!({
        "textQuery": q,
        "pageSize": 6,
        "languageCode": "en",
        "regionCode": "IN"
    });
    if let (Some(lat), Some(lng)) = (query.lat, query.lng) {
        if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lng) {
            return Err(AppError::BadRequest("Invalid coordinates".to_string()));
        }
        request_body["locationBias"] = json!({
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": 50000.0
            }
        });
    }

    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|_| AppError::InternalError("Places client initialization failed".to_string()))?
        .post("https://places.googleapis.com/v1/places:searchText")
        .header("X-Goog-Api-Key", key)
        .header(
            "X-Goog-FieldMask",
            "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.businessStatus",
        )
        .json(&request_body)
        .send()
        .await
        .map_err(|_| AppError::InternalError("Location search is temporarily unavailable".to_string()))?;

    if !response.status().is_success() {
        return Err(AppError::InternalError(
            "Location search is temporarily unavailable".to_string(),
        ));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|_| AppError::InternalError("Invalid location search response".to_string()))?;
    let places = payload["places"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|place| {
            let id = place["id"].as_str()?;
            let name = place["displayName"]["text"].as_str().unwrap_or_default();
            let address = place["formattedAddress"].as_str().unwrap_or_default();
            let location = &place["location"];
            Some(json!({
                "google_place_id": id,
                "name": name,
                "address": address,
                "lat": location["latitude"],
                "lng": location["longitude"],
                "google_maps_uri": place["googleMapsUri"],
                "business_status": place["businessStatus"]
            }))
        })
        .collect::<Vec<_>>();

    Ok(Json(json!({"configured": true, "places": places})))
}

pub async fn submit_onboarding(
    State(state): State<AppState>,
    Json(payload): Json<PlantOnboardingBody>,
) -> Result<impl IntoResponse, AppError> {
    let owner_name = bounded_text(&payload.owner_name, 2, 120, "Owner name")?;
    let plant_name = bounded_text(&payload.plant_name, 2, 160, "Plant name")?;
    let address = bounded_text(&payload.address, 3, 255, "Address")?;
    if !payload.lat.is_finite()
        || !payload.lng.is_finite()
        || !(-90.0..=90.0).contains(&payload.lat)
        || !(-180.0..=180.0).contains(&payload.lng)
    {
        return Err(AppError::BadRequest(
            "Invalid plant coordinates".to_string(),
        ));
    }

    let email = normalized_email(&payload.email)?;
    let mobile = normalized_mobile(&payload.mobile)?;
    let google_place_id = payload
        .google_place_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let existing_email: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1")
            .bind(&email)
            .fetch_optional(&state.db)
            .await?;
    if existing_email.is_some() {
        return Err(AppError::Conflict(
            "This email already has a TrackMyRMC account. Use the appropriate login flow."
                .to_string(),
        ));
    }

    let existing_phone: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM users WHERE phone = $1 LIMIT 1")
            .bind(&mobile)
            .fetch_optional(&state.db)
            .await?;
    if existing_phone.is_some() {
        return Err(AppError::Conflict(
            "This mobile number already belongs to a TrackMyRMC account.".to_string(),
        ));
    }

    if let Some(place_id) = google_place_id.as_deref() {
        let registered: Option<(Uuid,)> =
            sqlx::query_as("SELECT id FROM rmc_plants WHERE google_place_id = $1 LIMIT 1")
                .bind(place_id)
                .fetch_optional(&state.db)
                .await?;
        if registered.is_some() {
            return Err(AppError::Conflict(
                "This plant is already registered in TrackMyRMC".to_string(),
            ));
        }
        let queued: Option<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM plant_listing_requests
             WHERE google_place_id = $1 AND status IN ('PENDING', 'APPROVED') LIMIT 1",
        )
        .bind(place_id)
        .fetch_optional(&state.db)
        .await?;
        if queued.is_some() {
            return Err(AppError::Conflict(
                "This plant is already under TrackMyRMC review".to_string(),
            ));
        }
    }

    let city = payload
        .city
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let region = payload
        .state
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let mut tx = state.db.begin().await?;
    let row: (Uuid, String) = sqlx::query_as(
        "INSERT INTO plant_listing_requests
            (source, google_place_id, name, address, city, state, lat, lng,
             contact_phone, requested_role, claim_requested, applicant_owner_name,
             applicant_email, applicant_mobile)
         VALUES ('self_onboarding', $1, $2, $3, $4, $5, $6, $7, $8,
                 'owner', TRUE, $9, $10, $11)
         RETURNING id, request_number",
    )
    .bind(&google_place_id)
    .bind(&plant_name)
    .bind(&address)
    .bind(city)
    .bind(region)
    .bind(payload.lat)
    .bind(payload.lng)
    .bind(&mobile)
    .bind(&owner_name)
    .bind(&email)
    .bind(&mobile)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
         VALUES (NULL, 'plant_onboarding.submit', 'plant_listing_request', $1, $2)",
    )
    .bind(row.0.to_string())
    .bind(json!({"request_number": row.1, "source": "self_onboarding"}))
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO notifications (user_id, title, body, notification_type, reference_id)
         SELECT id, 'Plant onboarding request received',
                $1, 'plant_onboarding', $2
         FROM users WHERE role = 'admin' AND is_active = TRUE",
    )
    .bind(format!(
        "A new plant partner request ({}) is waiting for review.",
        row.1
    ))
    .bind(row.0.to_string())
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({
        "status": "PENDING",
        "request_id": row.1,
        "message": "Your TrackMyRMC onboarding request has been submitted for review."
    })))
}

pub async fn list_requests(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["admin"])?;
    let requests = sqlx::query_as::<_, PlantListingRequest>(
        "SELECT id, request_number, source, google_place_id, name, address, city, state,
                lat, lng, contact_phone, status, requested_role, claim_requested,
                applicant_owner_name, applicant_email, applicant_mobile, plant_id,
                reject_reason, created_at, updated_at
         FROM plant_listing_requests
         WHERE status = 'PENDING'
         ORDER BY updated_at DESC
         LIMIT 500",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"success": true, "requests": requests})))
}

pub async fn reject_listing(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(request_id): Path<Uuid>,
    Json(payload): Json<RejectListingBody>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["admin"])?;
    let reason = payload
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Not approved by TrackMyRMC administrator");
    if reason.chars().count() > 500 {
        return Err(AppError::BadRequest(
            "Rejection reason must be 500 characters or fewer".to_string(),
        ));
    }

    let mut tx = state.db.begin().await?;
    let updated: Option<(String,)> = sqlx::query_as(
        "UPDATE plant_listing_requests
         SET status = 'REJECTED', reject_reason = $1, reviewed_by = $2,
             reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $3 AND status = 'PENDING'
         RETURNING request_number",
    )
    .bind(reason)
    .bind(auth_user.user_id)
    .bind(request_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((request_number,)) = updated else {
        return Err(AppError::NotFound(
            "Pending plant listing request not found".to_string(),
        ));
    };

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'plant_listing.reject', 'plant_listing_request', $2, $3)",
    )
    .bind(auth_user.user_id)
    .bind(request_id.to_string())
    .bind(json!({"request_number": request_number, "reason": reason}))
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(
        json!({"success": true, "status": "REJECTED", "request_number": request_number}),
    ))
}

pub async fn approve_listing(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(request_id): Path<Uuid>,
    Json(payload): Json<ApproveListingBody>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["admin"])?;
    let city = bounded_text(&payload.city, 2, 100, "City")?;
    let region = bounded_text(&payload.state, 2, 100, "State")?;
    let pincode = bounded_text(&payload.pincode, 4, 10, "PIN code")?;
    if !pincode
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err(AppError::BadRequest("Invalid PIN code".to_string()));
    }

    let mut tx = state.db.begin().await?;
    let req: Option<ApprovalSource> = sqlx::query_as(
        "SELECT request_number, source, google_place_id, name, address, lat, lng,
                contact_phone, applicant_owner_name, applicant_email, applicant_mobile, status
         FROM plant_listing_requests WHERE id = $1 FOR UPDATE",
    )
    .bind(request_id)
    .fetch_optional(&mut *tx)
    .await?;
    let req =
        req.ok_or_else(|| AppError::NotFound("Plant listing request not found".to_string()))?;
    if req.status != "PENDING" {
        return Err(AppError::Conflict(
            "Only pending plant listings can be approved".to_string(),
        ));
    }
    if req.source != "self_onboarding" {
        return Err(AppError::BadRequest(
            "This approval path currently supports self-onboarding requests only".to_string(),
        ));
    }

    let owner_name = req.applicant_owner_name.as_deref().ok_or_else(|| {
        AppError::BadRequest("Onboarding request is missing owner name".to_string())
    })?;
    let owner_email = req.applicant_email.as_deref().ok_or_else(|| {
        AppError::BadRequest("Onboarding request is missing owner email".to_string())
    })?;
    let owner_phone = req.applicant_mobile.as_deref().ok_or_else(|| {
        AppError::BadRequest("Onboarding request is missing owner mobile".to_string())
    })?;

    if let Some(place_id) = req.google_place_id.as_deref() {
        let exists: Option<(Uuid,)> =
            sqlx::query_as("SELECT id FROM rmc_plants WHERE google_place_id = $1 LIMIT 1")
                .bind(place_id)
                .fetch_optional(&mut *tx)
                .await?;
        if exists.is_some() {
            return Err(AppError::Conflict(
                "This Google plant is already registered".to_string(),
            ));
        }
    }

    let matches: Vec<(Uuid, String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, role, phone, email FROM users
         WHERE LOWER(email) = $1 OR phone = $2
         ORDER BY id
         FOR UPDATE",
    )
    .bind(owner_email)
    .bind(owner_phone)
    .fetch_all(&mut *tx)
    .await?;
    if matches.len() > 1 {
        return Err(AppError::Conflict(
            "Owner email and mobile belong to different accounts".to_string(),
        ));
    }

    let owner_id = if let Some((id, role, phone, email)) = matches.first() {
        if role != "owner"
            || phone != owner_phone
            || email.as_deref().map(str::to_ascii_lowercase).as_deref() != Some(owner_email)
        {
            return Err(AppError::Conflict(
                "The submitted email or mobile already belongs to a different account".to_string(),
            ));
        }
        *id
    } else {
        let random_password = Uuid::new_v4().to_string();
        let hashed = hash_password(&random_password)?;
        let owner_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (phone, email, hashed_password, full_name, role)
             VALUES ($1, $2, $3, $4, 'owner')
             RETURNING id",
        )
        .bind(owner_phone)
        .bind(owner_email)
        .bind(&hashed)
        .bind(owner_name)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO user_profiles (user_id, business_name, kyc_status)
             VALUES ($1, $2, 'unverified')",
        )
        .bind(owner_id)
        .bind(&req.name)
        .execute(&mut *tx)
        .await?;
        owner_id
    };

    let plant_code = payload
        .plant_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&req.request_number);
    if plant_code.len() > 50 {
        return Err(AppError::BadRequest(
            "Plant code must be 50 characters or fewer".to_string(),
        ));
    }

    let plant_id: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants
            (owner_id, name, code, latitude, longitude, address_line, city, state,
             pincode, contact_phone, contact_email, google_place_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id",
    )
    .bind(owner_id)
    .bind(&req.name)
    .bind(plant_code)
    .bind(req.lat)
    .bind(req.lng)
    .bind(&req.address)
    .bind(&city)
    .bind(&region)
    .bind(&pincode)
    .bind(owner_phone)
    .bind(owner_email)
    .bind(&req.google_place_id)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE plant_listing_requests
         SET status = 'APPROVED', plant_id = $1, reviewed_by = $2,
             reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $3",
    )
    .bind(plant_id)
    .bind(auth_user.user_id)
    .bind(request_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'plant_listing.approve', 'plant_listing_request', $2, $3)",
    )
    .bind(auth_user.user_id)
    .bind(request_id.to_string())
    .bind(json!({"request_number": req.request_number, "plant_id": plant_id, "owner_id": owner_id}))
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO notifications (user_id, title, body, notification_type, reference_id)
         VALUES ($1, 'Plant Owner access enabled', $2, 'plant_onboarding', $3)",
    )
    .bind(owner_id)
    .bind(format!(
        "Your plant {} was approved. Sign in using email OTP to continue setup.",
        req.name
    ))
    .bind(plant_id.to_string())
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({
        "success": true,
        "status": "APPROVED",
        "request_number": req.request_number,
        "plant_id": plant_id,
        "owner_id": owner_id
    })))
}

#[cfg(test)]
mod tests {
    use super::{normalized_email, normalized_mobile};

    #[test]
    fn normalizes_onboarding_identifiers() {
        assert_eq!(
            normalized_email(" OWNER@Example.com ").unwrap(),
            "owner@example.com"
        );
        assert_eq!(normalized_mobile("98765 43210").unwrap(), "919876543210");
    }

    #[test]
    fn rejects_invalid_onboarding_identifiers() {
        assert!(normalized_email("owner@localhost").is_err());
        assert!(normalized_mobile("123").is_err());
    }
}
