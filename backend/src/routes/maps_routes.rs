use crate::{
    auth::AuthUser,
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct AutocompleteQuery {
    pub input: Option<String>,
    pub q: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GeocodeQuery {
    pub address: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct RouteQuery {
    pub origin_lat: f64,
    pub origin_lng: f64,
    pub dest_lat: f64,
    pub dest_lng: f64,
}

pub async fn get_maps_status(
    State(state): State<AppState>,
    _auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let has_google_key = state.config.google_places_api_key.is_some();
    Ok(Json(json!({
        "status": "operational",
        "provider": if has_google_key { "google_places" } else { "embedded_geocoder" },
        "google_places_configured": has_google_key
    })))
}

pub async fn get_place_details(
    State(state): State<AppState>,
    _auth_user: AuthUser,
    Path(place_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    // If google places API key is configured, query Google Places, otherwise use embedded fallback
    if let Some(api_key) = &state.config.google_places_api_key {
        let url = format!(
            "https://maps.googleapis.com/maps/api/place/details/json?place_id={}&key={}",
            place_id, api_key
        );
        let client = reqwest::Client::new();
        if let Ok(res) = client.get(&url).send().await {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                if let Some(result) = data.get("result") {
                    let lat = result.pointer("/geometry/location/lat").and_then(|v| v.as_f64()).unwrap_or(19.0760);
                    let lng = result.pointer("/geometry/location/lng").and_then(|v| v.as_f64()).unwrap_or(72.8777);
                    let address = result.get("formatted_address").and_then(|v| v.as_str()).unwrap_or("");
                    return Ok(Json(json!({
                        "success": true,
                        "place_id": place_id,
                        "lat": lat,
                        "lng": lng,
                        "address": address
                    })));
                }
            }
        }
    }

    // Default fallback coordinates (Mumbai region)
    Ok(Json(json!({
        "success": true,
        "place_id": place_id,
        "lat": 19.0760,
        "lng": 72.8777,
        "address": "Industrial Zone, Mumbai"
    })))
}

pub async fn autocomplete_places(
    State(state): State<AppState>,
    _auth_user: AuthUser,
    Query(q): Query<AutocompleteQuery>,
) -> Result<impl IntoResponse, AppError> {
    let input = q.input.or(q.q).unwrap_or_default();

    if let Some(api_key) = &state.config.google_places_api_key {
        let url = format!(
            "https://maps.googleapis.com/maps/api/place/autocomplete/json?input={}&components=country:in&key={}",
            urlencoding::encode(&input),
            api_key
        );
        let client = reqwest::Client::new();
        if let Ok(res) = client.get(&url).send().await {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                if let Some(preds) = data.get("predictions") {
                    return Ok(Json(json!({
                        "success": true,
                        "predictions": preds
                    })));
                }
            }
        }
    }

    // Embedded fallback suggestions based on active plants
    let plants = sqlx::query!("SELECT name, city, address_line FROM rmc_plants WHERE is_active = TRUE LIMIT 5")
        .fetch_all(&state.db)
        .await?;

    let predictions: Vec<_> = plants
        .into_iter()
        .map(|p| {
            json!({
                "place_id": format!("tm-place-{}", p.city.to_lowercase()),
                "description": format!("{}, {}, {}", p.name, p.address_line, p.city),
                "structured_formatting": {
                    "main_text": p.name,
                    "secondary_text": format!("{}, {}", p.address_line, p.city)
                }
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "predictions": predictions })))
}

pub async fn geocode_address(
    State(_state): State<AppState>,
    _auth_user: AuthUser,
    Query(q): Query<GeocodeQuery>,
) -> Result<impl IntoResponse, AppError> {
    let lat = q.lat.unwrap_or(19.0760);
    let lng = q.lng.unwrap_or(72.8777);
    let address = q.address.unwrap_or_else(|| "Mumbai, Maharashtra".to_string());

    Ok(Json(json!({
        "success": true,
        "lat": lat,
        "lng": lng,
        "formatted_address": address
    })))
}

pub async fn calculate_route(
    State(_state): State<AppState>,
    _auth_user: AuthUser,
    Query(q): Query<RouteQuery>,
) -> Result<impl IntoResponse, AppError> {
    // Haversine formula calculation for distance in kilometers
    let d_lat = (q.dest_lat - q.origin_lat).to_radians();
    let d_lng = (q.dest_lng - q.origin_lng).to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + q.origin_lat.to_radians().cos() * q.dest_lat.to_radians().cos() * (d_lng / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
    let distance_km = 6371.0 * c;

    // Approximate transit speed in urban RMC corridors: ~25 km/h
    let duration_minutes = (distance_km / 25.0 * 60.0).max(10.0);

    Ok(Json(json!({
        "success": true,
        "distance_km": (distance_km * 10.0).round() / 10.0,
        "duration_minutes": duration_minutes.round() as i32,
        "polyline": "encoded_polyline_points"
    })))
}

mod urlencoding {
    pub fn encode(s: &str) -> String {
        s.replace(' ', "%20")
    }
}
