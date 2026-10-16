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
    pub state: Option<String>,
    pub district: Option<String>,
    pub taluka: Option<String>,
    pub city: Option<String>,
}

fn valid_geo_field(value: &Option<String>) -> bool {
    value
        .as_ref()
        .is_none_or(|v| v.chars().count() <= 80 && !v.chars().any(char::is_control))
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
            || !valid_geo_field(&self.state)
            || !valid_geo_field(&self.district)
            || !valid_geo_field(&self.taluka)
            || !valid_geo_field(&self.city)
        {
            return Err(AppError::BadRequest(
                "Invalid plant search parameters".into(),
            ));
        }
        Ok(())
    }
}

// Defense-in-depth for every customer-visible plant response. Never serialize
// unapproved plant contact details, even if an upstream query selected them.
pub(crate) fn redact_plant_contact(value: &mut Value, verified: bool) {
    if verified {
        value["contact_phone_masked"] = Value::Null;
        return;
    }
    let masked = value["contact_phone"].as_str().and_then(|phone| {
        let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
        (digits.len() >= 5).then(|| format!("{}*****", &digits[..digits.len() - 5]))
    });
    if let Some(masked) = masked {
        value["contact_phone_masked"] = json!(masked);
    } else if value.get("contact_phone_masked").is_none() {
        value["contact_phone_masked"] = Value::Null;
    }
    value["contact_phone"] = Value::Null;
    value["contact_email"] = Value::Null;
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
            'lat',latitude,'lng',longitude,
            'contact_phone',CASE WHEN verified THEN contact_phone ELSE NULL END,
            'contact_phone_masked',CASE WHEN NOT verified AND contact_phone IS NOT NULL AND length(regexp_replace(contact_phone,'[^0-9]','','g')) >= 5 THEN
                left(regexp_replace(contact_phone,'[^0-9]','','g'), greatest(0,length(regexp_replace(contact_phone,'[^0-9]','','g'))-5)) || '*****'
                ELSE NULL END,
            'verified',verified,'order_enabled',verified,
            'status','active','grades',grades,'distance_km',distance_km)
        FROM candidates WHERE (distance_km IS NULL OR distance_km <= $4)
          AND ($5='' OR strpos(lower(name||' '||address_line||' '||city||' '||state||' '||pincode),lower($5))>0)
          AND ($6='' OR EXISTS(SELECT 1 FROM unnest(grades) g WHERE lower(replace(g,'-',''))=lower(replace($6,'-',''))))
          AND (NOT $7 OR verified)
          AND ($8='' OR lower(coalesce(state,''))=lower($8))
          AND ($9='' OR strpos(lower(coalesce(address_line,'')||' '||coalesce(city,'')||' '||coalesce(state,'')),lower($9))>0)
          AND ($10='' OR strpos(lower(coalesce(address_line,'')||' '||coalesce(city,'')),lower($10))>0)
          AND ($11='' OR strpos(lower(coalesce(city,'')||' '||coalesce(address_line,'')),lower($11))>0)
        ORDER BY distance_km NULLS LAST, name, id LIMIT $12 OFFSET $13
    "#).bind(user.user_id).bind(query.lat).bind(query.lng).bind(query.radius_km.unwrap_or(50.0))
        .bind(query.q.unwrap_or_default().trim()).bind(query.grade.unwrap_or_default().trim())
        .bind(query.verified.unwrap_or(false))
        .bind(query.state.unwrap_or_default().trim())
        .bind(query.district.unwrap_or_default().trim())
        .bind(query.taluka.unwrap_or_default().trim())
        .bind(query.city.unwrap_or_default().trim())
        .bind(size+1).bind((page-1)*size).fetch_all(&state.db).await?;
    let more = rows.len() > size as usize;
    let plants = rows
        .into_iter()
        .take(size as usize)
        .map(|mut value| {
            let verified = value["verified"].as_bool().unwrap_or(false);
            redact_plant_contact(&mut value, verified);
            value
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({"plants":plants,"page":page,"has_more":more})))
}

#[derive(Debug, Deserialize)]
pub struct GoogleNearbyQuery {
    lat: f64,
    lng: f64,
    radius_km: Option<f64>,
    q: Option<String>,
    state: Option<String>,
    district: Option<String>,
    taluka: Option<String>,
    city: Option<String>,
}

impl GoogleNearbyQuery {
    fn validate(&self) -> Result<f64, AppError> {
        let radius = self.radius_km.unwrap_or(25.0);
        if !self.lat.is_finite()
            || !self.lng.is_finite()
            || !(-90.0..=90.0).contains(&self.lat)
            || !(-180.0..=180.0).contains(&self.lng)
            || !radius.is_finite()
            || !(1.0..=50.0).contains(&radius)
            || self
                .q
                .as_ref()
                .is_some_and(|q| q.chars().count() > 80 || q.chars().any(char::is_control))
            || !valid_geo_field(&self.state)
            || !valid_geo_field(&self.district)
            || !valid_geo_field(&self.taluka)
            || !valid_geo_field(&self.city)
        {
            return Err(AppError::BadRequest(
                "Google nearby search requires valid coordinates and a radius from 1 to 50 km"
                    .into(),
            ));
        }
        Ok(radius)
    }
}

// The Google result data is transient: never persist it or place it in a server-side cache.
// Place IDs alone can be retained for a future claimed-plant workflow.
fn google_distance_km(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let dlat = (lat2 - lat1).to_radians();
    let dlng = (lng2 - lng1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlng / 2.0).sin().powi(2);
    6371.0 * 2.0 * a.clamp(0.0, 1.0).sqrt().asin()
}

fn normalize_google_nearby(payload: &Value, query: &GoogleNearbyQuery, radius: f64) -> Vec<Value> {
    let mut results: Vec<Value> = payload["places"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|place| {
            if place["businessStatus"].as_str() == Some("CLOSED_PERMANENTLY") {
                return None;
            }
            let place_id = place["id"].as_str()?;
            if place_id.is_empty() || place_id.len() > 255 {
                return None;
            }
            let name = place["displayName"]["text"].as_str()?.trim();
            if name.is_empty() {
                return None;
            }
            let lat = place["location"]["latitude"].as_f64()?;
            let lng = place["location"]["longitude"].as_f64()?;
            if !lat.is_finite()
                || !lng.is_finite()
                || !(-90.0..=90.0).contains(&lat)
                || !(-180.0..=180.0).contains(&lng)
            {
                return None;
            }
            let distance_km = google_distance_km(query.lat, query.lng, lat, lng);
            if distance_km > radius {
                return None;
            }
            Some(json!({
                "place_id": place_id,
                "name": name,
                "address": place["formattedAddress"].as_str().unwrap_or(""),
                "lat": lat,
                "lng": lng,
                "distance_km": distance_km,
                "google_maps_uri": place["googleMapsUri"].as_str(),
                "source": "google_places",
                "verified": false,
                "order_enabled": false
            }))
        })
        .collect();
    results.sort_by(|a, b| {
        a["distance_km"]
            .as_f64()
            .partial_cmp(&b["distance_km"].as_f64())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.dedup_by(|a, b| a["place_id"] == b["place_id"]);
    results
}

// A separate limit protects our paid Google API quota from repeated map pan/zoom events.
// In production the API gateway must apply shared limits across application instances too.
fn allow_google_search(user: Uuid) -> bool {
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
    *count <= 8
}

/// Live Places Text Search (New), proxied with the AWS secret; no key reaches Android/web.
/// Search is RMC-specific because Places Nearby Search has no dedicated RMC plant type.
pub async fn google_nearby(
    State(state): State<AppState>,
    user: AuthUser,
    Json(query): Json<GoogleNearbyQuery>,
) -> Result<Json<Value>, AppError> {
    check_role(&user, &["customer"])?;
    let radius = query.validate()?;
    if !allow_google_search(user.user_id) {
        return Err(AppError::RateLimited(
            "Google nearby search limit reached. Try again shortly.".into(),
        ));
    }
    let key = state
        .config
        .google_places_api_key
        .as_deref()
        .ok_or_else(|| {
            AppError::BadRequest("Live Google Places discovery is not configured".into())
        })?;
    let mut text_query = match query.q.as_deref().map(str::trim).filter(|q| q.len() >= 3) {
        Some(term) => format!("{term} ready mix concrete plant"),
        None => "ready mix concrete plant".to_string(),
    };
    let area = [
        query.city.as_deref(),
        query.taluka.as_deref(),
        query.district.as_deref(),
        query.state.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>();
    if !area.is_empty() {
        text_query.push_str(" in ");
        text_query.push_str(&area.join(", "));
        text_query.push_str(", India");
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| AppError::InternalError("Places service unavailable".into()))?;
    let response = client
        .post("https://places.googleapis.com/v1/places:searchText")
        .header("X-Goog-Api-Key", key)
        .header(
            "X-Goog-FieldMask",
            "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.businessStatus",
        )
        .json(&json!({
            "textQuery": text_query,
            "pageSize": 20,
            "languageCode": "en",
            "regionCode": "IN",
            "locationBias": {
                "circle": {
                    "center": {"latitude": query.lat, "longitude": query.lng},
                    "radius": radius * 1000.0
                }
            }
        }))
        .send()
        .await
        .map_err(|_| AppError::InternalError("Google Places search is temporarily unavailable".into()))?;
    if !response.status().is_success() {
        return Err(AppError::InternalError(
            "Google Places search is temporarily unavailable".into(),
        ));
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|_| AppError::InternalError("Invalid Google Places response".into()))?;
    let places = normalize_google_nearby(&payload, &query, radius);
    Ok(Json(json!({
        "places": places,
        "source": "google_places",
        "attribution": "Google Maps",
        "radius_km": radius
    })))
}

#[derive(Debug, Deserialize)]
pub struct GoogleQuoteInterest {
    google_place_id: String,
}

impl GoogleQuoteInterest {
    fn validate(&self) -> Result<&str, AppError> {
        let id = self.google_place_id.trim();
        if id.is_empty() || id.len() > 256 || !id.chars().all(|c| c.is_ascii_graphic()) {
            return Err(AppError::BadRequest("Invalid Google Place ID".into()));
        }
        Ok(id)
    }
}

/// Record interest in an unregistered Google listing without claiming to have
/// contacted a supplier or creating a quote/order against an unverified plant.
/// Only the place ID and requester identity are retained.
pub async fn request_google_quote(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<GoogleQuoteInterest>,
) -> Result<Json<Value>, AppError> {
    check_role(&user, &["customer"])?;
    let place_id = input.validate()?;
    if !allow_search(user.user_id) {
        return Err(AppError::RateLimited(
            "Please wait before requesting another quotation".into(),
        ));
    }

    // If a Google listing is already linked to an approved TrackMyRMC plant,
    // send the client to the existing verified-plant quotation workflow.
    let registered: Option<Uuid> = sqlx::query_scalar(
        "SELECT p.id FROM rmc_plants p
         WHERE p.google_place_id=$1 AND p.is_active
           AND EXISTS (SELECT 1 FROM plant_listing_requests r
                       WHERE r.plant_id=p.id AND r.status='APPROVED')
         LIMIT 1",
    )
    .bind(place_id)
    .fetch_optional(&state.db)
    .await?;

    if let Some(plant_id) = registered {
        return Ok(Json(json!({"status":"REGISTERED","plant_id":plant_id})));
    }

    // A client-supplied ID is not evidence of a real Google Places listing.
    // Verify it with Places Details using the same server-held key before storage.
    let key = state
        .config
        .google_places_api_key
        .as_deref()
        .ok_or_else(|| AppError::InternalError("Google Places is not configured".into()))?;
    let mut url = reqwest::Url::parse("https://places.googleapis.com/v1/places/")
        .map_err(|_| AppError::InternalError("Invalid Places endpoint".into()))?;
    url.path_segments_mut()
        .map_err(|_| AppError::InternalError("Invalid Places endpoint".into()))?
        .pop_if_empty()
        .push(place_id);
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| AppError::InternalError("Places client unavailable".into()))?
        .get(url)
        .header("X-Goog-Api-Key", key)
        .header("X-Goog-FieldMask", "id")
        .send()
        .await
        .map_err(|_| {
            AppError::InternalError("Places verification temporarily unavailable".into())
        })?;
    if !response.status().is_success() {
        return Err(AppError::BadRequest(
            "This Google business could not be verified. Refresh Nearby RMC Plants.".into(),
        ));
    }
    let verified_place: Value = response
        .json()
        .await
        .map_err(|_| AppError::InternalError("Invalid Places verification response".into()))?;
    if verified_place["id"].as_str() != Some(place_id) {
        return Err(AppError::BadRequest(
            "Google Place ID verification failed. Refresh Nearby RMC Plants.".into(),
        ));
    }

    // Unique (customer, place) prevents repeated clicks from creating noise.
    let request_id: Uuid = sqlx::query_scalar(
        "INSERT INTO google_plant_quote_interests (customer_id, google_place_id)
         VALUES ($1, $2)
         ON CONFLICT (customer_id, google_place_id)
         DO UPDATE SET updated_at = NOW()
         RETURNING id",
    )
    .bind(user.user_id)
    .bind(place_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "status":"PENDING_PARTNER",
        "request_id":request_id,
        "message":"Interest saved. This Google listing is not an approved TrackMyRMC supplier. No quotation has been sent."
    })))
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
    fn google_quote_interest_validates_place_id() {
        let accepted = GoogleQuoteInterest {
            google_place_id: "ChIJc1_example-ID".into(),
        };
        assert_eq!(accepted.validate().unwrap(), "ChIJc1_example-ID");
        let oversized = GoogleQuoteInterest {
            google_place_id: "X".repeat(257),
        };
        assert!(oversized.validate().is_err());
        for raw in ["", "   ", "bad place id"] {
            let rejected = GoogleQuoteInterest {
                google_place_id: raw.into(),
            };
            assert!(rejected.validate().is_err());
        }
    }

    #[test]
    fn geo_filters_validate_and_reject_control_characters() {
        let valid: Search = serde_json::from_value(json!({
            "state": "Maharashtra", "district": "Pune", "taluka": "Haveli", "city": "Ravet"
        }))
        .unwrap();
        assert!(valid.validate().is_ok());
        let invalid_value = format!("Pune{}Other", char::from(10));
        let invalid: Search = serde_json::from_value(json!({"district": invalid_value})).unwrap();
        assert!(invalid.validate().is_err());
        let oversized: GoogleNearbyQuery = serde_json::from_value(json!({
            "lat":18.9, "lng":73.1, "state": "x".repeat(81)
        }))
        .unwrap();
        assert!(oversized.validate().is_err());
    }

    #[test]
    fn google_nearby_rejects_invalid_location_and_oversized_radius() {
        for query in [
            GoogleNearbyQuery {
                lat: 91.0,
                lng: 73.0,
                radius_km: None,
                q: None,
                state: None,
                district: None,
                taluka: None,
                city: None,
            },
            GoogleNearbyQuery {
                lat: f64::NAN,
                lng: 73.0,
                radius_km: None,
                q: None,
                state: None,
                district: None,
                taluka: None,
                city: None,
            },
            GoogleNearbyQuery {
                lat: 18.0,
                lng: 181.0,
                radius_km: None,
                q: None,
                state: None,
                district: None,
                taluka: None,
                city: None,
            },
            GoogleNearbyQuery {
                lat: 18.0,
                lng: 73.0,
                radius_km: Some(51.0),
                q: None,
                state: None,
                district: None,
                taluka: None,
                city: None,
            },
            GoogleNearbyQuery {
                lat: 18.0,
                lng: 73.0,
                radius_km: Some(-1.0),
                q: None,
                state: None,
                district: None,
                taluka: None,
                city: None,
            },
        ] {
            assert!(query.validate().is_err());
        }
        let valid = GoogleNearbyQuery {
            lat: 18.9,
            lng: 73.1,
            radius_km: None,
            q: None,
            state: None,
            district: None,
            taluka: None,
            city: None,
        };
        assert_eq!(valid.validate().unwrap(), 25.0);
    }

    #[test]
    fn google_nearby_filters_distance_closed_locations_and_invalid_results() {
        let query = GoogleNearbyQuery {
            lat: 18.9,
            lng: 73.1,
            radius_km: Some(10.0),
            q: None,
            state: None,
            district: None,
            taluka: None,
            city: None,
        };
        let payload = json!({"places":[
            {"id":"near","displayName":{"text":"Nearby RMC"},"location":{"latitude":18.91,"longitude":73.1},"formattedAddress":"Raigad"},
            {"id":"closed","displayName":{"text":"Closed RMC"},"businessStatus":"CLOSED_PERMANENTLY","location":{"latitude":18.91,"longitude":73.1}},
            {"id":"far","displayName":{"text":"Far RMC"},"location":{"latitude":20.0,"longitude":73.1}},
            {"id":"bad","displayName":{"text":"Bad coordinates"},"location":{"latitude":null,"longitude":73.1}}
        ]});
        let plants = normalize_google_nearby(&payload, &query, 10.0);
        assert_eq!(plants.len(), 1);
        assert_eq!(plants[0]["place_id"], "near");
        assert_eq!(plants[0]["verified"], false);
        assert_eq!(plants[0]["order_enabled"], false);
        assert!(plants[0].get("contact_phone").is_none());
    }

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
    #[test]
    fn unapproved_plant_never_exposes_contact_details() {
        let mut plant = json!({"verified":false,"name":"Example RMC","contact_phone":"+91-74982-12345","contact_email":"owner@example.com"});
        redact_plant_contact(&mut plant, false);
        assert!(plant["contact_phone"].is_null());
        assert!(plant["contact_email"].is_null());
        assert_eq!(plant["contact_phone_masked"], "9174982*****");
        assert!(!plant.to_string().contains("12345"));
        assert!(!plant.to_string().contains("owner@example.com"));
    }

    #[test]
    fn approved_plant_retains_full_contact() {
        let mut plant = json!({"verified":true,"contact_phone":"+917498212345","contact_email":"owner@example.com"});
        redact_plant_contact(&mut plant, true);
        assert_eq!(plant["contact_phone"], "+917498212345");
        assert_eq!(plant["contact_email"], "owner@example.com");
        assert!(plant["contact_phone_masked"].is_null());
    }

    #[test]
    fn partial_or_pre_masked_contact_cannot_leak() {
        let mut short = json!({"verified":false,"contact_phone":"1234"});
        redact_plant_contact(&mut short, false);
        assert!(short["contact_phone"].is_null());
        assert!(short["contact_phone_masked"].is_null());

        let mut search =
            json!({"verified":false,"contact_phone":null,"contact_phone_masked":"9174982*****"});
        redact_plant_contact(&mut search, false);
        assert!(search["contact_phone"].is_null());
        assert_eq!(search["contact_phone_masked"], "9174982*****");
    }
}
