//! Authenticated discovery. Coordinates stay in POST bodies, outside access-log URLs.
use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{extract::State, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct Search {
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub radius_km: Option<f64>,
    pub q: Option<String>,
    pub grade: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub verified: Option<bool>,
}

impl Search {
    fn validate(&self) -> Result<(), AppError> {
        if self.lat.is_some() != self.lng.is_some()
            || self
                .lat
                .is_some_and(|v| !v.is_finite() || !(-90.0..=90.0).contains(&v))
            || self
                .lng
                .is_some_and(|v| !v.is_finite() || !(-180.0..=180.0).contains(&v))
            || self
                .radius_km
                .is_some_and(|v| !v.is_finite() || !(1.0..=200.0).contains(&v))
            || self.page.is_some_and(|v| !(1..=1000).contains(&v))
            || self.page_size.is_some_and(|v| !(1..=100).contains(&v))
            || self.q.as_ref().is_some_and(|v| v.len() > 160)
            || self.grade.as_ref().is_some_and(|v| v.len() > 30)
        {
            return Err(AppError::BadRequest(
                "Invalid plant search parameters".into(),
            ));
        }
        Ok(())
    }
}

// Bound per-process state; shared deployments should also enforce an ingress limit.
fn allow_search(user: Uuid) -> bool {
    static BUCKETS: OnceLock<Mutex<HashMap<Uuid, (Instant, u32)>>> = OnceLock::new();
    let Ok(mut buckets) = BUCKETS.get_or_init(Default::default).lock() else {
        return false;
    };
    let now = Instant::now();
    buckets.retain(|_, (at, _)| now.duration_since(*at) < Duration::from_secs(60));
    if !buckets.contains_key(&user) && buckets.len() >= 10000 {
        return false;
    }
    let (_, count) = buckets.entry(user).or_insert((now, 0));
    *count += 1;
    *count <= 60
}

pub async fn search(
    State(state): State<AppState>,
    user: AuthUser,
    Json(query): Json<Search>,
) -> Result<Json<Value>, AppError> {
    check_role(&user, &["customer"])?;
    query.validate()?;
    if !allow_search(user.user_id) {
        return Err(AppError::RateLimited(
            "Please wait before searching again".into(),
        ));
    }
    let size = query.page_size.unwrap_or(30);
    let page = query.page.unwrap_or(1);
    let rows: Vec<Value> = sqlx::query_scalar(r#"
        WITH candidates AS (
            SELECT p.*, EXISTS(SELECT 1 FROM plant_listing_requests r WHERE r.plant_id=p.id AND r.status='APPROVED') verified,
                ARRAY(SELECT DISTINCT grade FROM plant_rate_cards r WHERE r.plant_id=p.id AND r.active
                    AND r.effective_from<=CURRENT_DATE AND (r.effective_to IS NULL OR r.effective_to>=CURRENT_DATE) ORDER BY grade) grades,
                CASE WHEN $2::double precision IS NOT NULL THEN 6371.0 * 2 * asin(sqrt(least(1.0, greatest(0.0,
                    power(sin(radians(p.latitude-$2)/2),2) + cos(radians($2))*cos(radians(p.latitude))*power(sin(radians(p.longitude-$3)/2),2)
                )))) END distance_km
            FROM rmc_plants p WHERE p.is_active
            AND EXISTS(SELECT 1 FROM play_review_fixtures f WHERE f.user_id=$1 AND f.role='customer' AND f.enabled)
                = EXISTS(SELECT 1 FROM play_review_fixtures f WHERE f.plant_id=p.id AND f.role='customer' AND f.enabled)
        )
        SELECT jsonb_build_object('id',id,'name',name,'address',address_line,'city',city,'district',state,'pincode',pincode,
            'lat',latitude,'lng',longitude,'contact_phone',contact_phone,'verified',verified,'order_enabled',verified,
            'status','active','grades',grades,'distance_km',distance_km)
        FROM candidates WHERE (distance_km IS NULL OR distance_km <= $4)
          AND ($5='' OR strpos(lower(name||' '||address_line||' '||city||' '||state||' '||pincode),lower($5))>0)
          AND ($6='' OR EXISTS(SELECT 1 FROM unnest(grades) g WHERE lower(replace(g,'-',''))=lower(replace($6,'-',''))))
          AND (NOT $7 OR verified)
        ORDER BY distance_km NULLS LAST, name, id LIMIT $8 OFFSET $9
    "#).bind(user.user_id).bind(query.lat).bind(query.lng).bind(query.radius_km.unwrap_or(50.0))
        .bind(query.q.unwrap_or_default().trim()).bind(query.grade.unwrap_or_default().trim())
        .bind(query.verified.unwrap_or(false)).bind(size+1).bind((page-1)*size).fetch_all(&state.db).await?;
    let more = rows.len() > size as usize;
    Ok(Json(
        json!({"plants":rows.into_iter().take(size as usize).collect::<Vec<_>>(),"page":page,"has_more":more}),
    ))
}

#[derive(Deserialize)]
pub struct Address {
    address: String,
}

pub async fn locate(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<Address>,
) -> Result<Json<Value>, AppError> {
    check_role(&user, &["customer"])?;
    if !(3..=200).contains(&input.address.trim().len()) {
        return Err(AppError::BadRequest(
            "Enter an area, city or PIN code".into(),
        ));
    }
    if !allow_search(user.user_id) {
        return Err(AppError::RateLimited(
            "Please wait before searching again".into(),
        ));
    }
    let key = state.config.google_places_api_key.as_deref().ok_or_else(||AppError::BadRequest("Address lookup is unavailable. Search plants by area or enter site coordinates instead.".into()))?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| AppError::InternalError("Map client unavailable".into()))?;
    let result: Value = client
        .get("https://maps.googleapis.com/maps/api/geocode/json")
        .query(&[
            ("address", input.address.trim()),
            ("key", key),
            ("region", "in"),
        ])
        .send()
        .await
        .map_err(|_| {
            AppError::BadRequest("Address lookup could not connect. Please retry.".into())
        })?
        .json()
        .await
        .map_err(|_| AppError::BadRequest("Invalid map provider response".into()))?;
    let found = result["results"]
        .as_array()
        .and_then(|values| values.first())
        .ok_or_else(|| {
            AppError::NotFound("No location found. Try a more specific address or PIN code.".into())
        })?;
    let point = &found["geometry"]["location"];
    if point["lat"].as_f64().is_none() || point["lng"].as_f64().is_none() {
        return Err(AppError::NotFound("No map coordinates found".into()));
    }
    Ok(Json(
        json!({"lat":point["lat"],"lng":point["lng"],"label":found["formatted_address"]}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_and_unbounded_searches() {
        for body in [
            json!({"lat":91,"lng":0}),
            json!({"lat":12}),
            json!({"radius_km":201}),
            json!({"page":0}),
            json!({"page_size":101}),
        ] {
            assert!(serde_json::from_value::<Search>(body)
                .unwrap()
                .validate()
                .is_err());
        }
        assert!(
            serde_json::from_value::<Search>(json!({"lat":12,"lng":77,"radius_km":50}))
                .unwrap()
                .validate()
                .is_ok()
        );
    }
}
