use crate::{auth::AuthUser, error::AppError, state::AppState};
use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;

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
                    let lat = result
                        .pointer("/geometry/location/lat")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(19.0760);
                    let lng = result
                        .pointer("/geometry/location/lng")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(72.8777);
                    let address = result
                        .get("formatted_address")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
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
    let plants = sqlx::query(
        "SELECT name, city, address_line FROM rmc_plants WHERE is_active = TRUE LIMIT 5",
    )
    .fetch_all(&state.db)
    .await?;

    let predictions: Vec<_> = plants
        .into_iter()
        .map(|p| {
            let name: String = p.get("name");
            let city: String = p.get("city");
            let address_line: Option<String> = p.get("address_line");
            let addr = address_line.unwrap_or_default();
            json!({
                "place_id": format!("tm-place-{}", city.to_lowercase()),
                "description": format!("{}, {}, {}", name, addr, city),
                "structured_formatting": {
                    "main_text": name,
                    "secondary_text": format!("{}, {}", addr, city)
                }
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "predictions": predictions })))
}

pub async fn geocode_address(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(q): Query<GeocodeQuery>,
) -> Result<impl IntoResponse, AppError> {
    let lookup = geocode_lookup(&q)?;
    if !super::discovery::allow_search(auth_user.user_id) {
        return Err(AppError::RateLimited(
            "Please wait before searching again".into(),
        ));
    }
    let key = state
        .config
        .google_places_api_key
        .as_deref()
        .ok_or_else(|| {
            AppError::BadRequest("Location lookup is unavailable. Please retry later.".into())
        })?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| AppError::InternalError("Location lookup unavailable".into()))?;
    let response = client
        .get("https://maps.googleapis.com/maps/api/geocode/json")
        .query(&[
            (lookup.0, lookup.1.as_str()),
            ("key", key),
            ("region", "in"),
        ])
        .send()
        .await
        .map_err(|_| {
            AppError::BadRequest("Location lookup could not connect. Please retry.".into())
        })?
        .error_for_status()
        .map_err(|_| AppError::BadRequest("Location provider unavailable. Please retry.".into()))?;
    let result: serde_json::Value = response
        .json()
        .await
        .map_err(|_| AppError::BadRequest("Invalid location provider response".into()))?;
    // Never return a fabricated city or provider error text (which can include key details).
    Ok(Json(geocode_result(&result)?))
}

fn geocode_lookup(q: &GeocodeQuery) -> Result<(&'static str, String), AppError> {
    match (q.lat, q.lng, q.address.as_deref().map(str::trim)) {
        (Some(lat), Some(lng), None)
            if lat.is_finite()
                && lng.is_finite()
                && (-90.0..=90.0).contains(&lat)
                && (-180.0..=180.0).contains(&lng) =>
        {
            Ok(("latlng", format!("{lat},{lng}")))
        }
        (None, None, Some(address)) if (3..=200).contains(&address.len()) => {
            Ok(("address", address.to_string()))
        }
        _ => Err(AppError::BadRequest(
            "Provide a city or valid latitude and longitude".into(),
        )),
    }
}

fn geocode_result(result: &serde_json::Value) -> Result<serde_json::Value, AppError> {
    if result["status"] != "OK" {
        return Err(AppError::NotFound(
            "Location could not be resolved. Try a city or PIN code.".into(),
        ));
    }
    let results = result["results"]
        .as_array()
        .ok_or_else(|| AppError::NotFound("No location found".into()))?;
    // Prefer a city, then a locality, instead of displaying an exact street address in the header.
    for kind in [
        "locality",
        "postal_town",
        "sublocality",
        "administrative_area_level_3",
        "administrative_area_level_2",
    ] {
        for found in results {
            let component = found["address_components"].as_array().and_then(|items| {
                items.iter().find(|item| {
                    item["types"]
                        .as_array()
                        .is_some_and(|types| types.iter().any(|value| value == kind))
                })
            });
            if let Some(locality) = component
                .and_then(|item| item["long_name"].as_str())
                .filter(|value| !value.trim().is_empty())
            {
                if let (Some(lat), Some(lng)) = (
                    found["geometry"]["location"]["lat"].as_f64(),
                    found["geometry"]["location"]["lng"].as_f64(),
                ) {
                    return Ok(
                        json!({"success":true,"lat":lat,"lng":lng,"locality":locality,"formatted_address":found["formatted_address"]}),
                    );
                }
            }
        }
    }
    Err(AppError::NotFound(
        "No city or locality found. Try a more specific location.".into(),
    ))
}

#[cfg(test)]
mod geocode_tests {
    use super::*;

    #[test]
    fn validates_coordinates_and_rejects_ambiguous_lookups() {
        let query = |lat, lng, address| GeocodeQuery { lat, lng, address };
        assert_eq!(
            geocode_lookup(&query(Some(0.0), Some(0.0), None))
                .unwrap()
                .1,
            "0,0"
        );
        assert!(geocode_lookup(&query(Some(91.0), Some(1.0), None)).is_err());
        assert!(geocode_lookup(&query(Some(f64::NAN), Some(1.0), None)).is_err());
        assert!(geocode_lookup(&query(Some(1.0), None, None)).is_err());
        assert!(geocode_lookup(&query(None, None, None)).is_err());
        assert!(geocode_lookup(&query(Some(1.0), Some(1.0), Some("City".into()))).is_err());
        assert_eq!(
            geocode_lookup(&query(None, None, Some(" Panvel ".into())))
                .unwrap()
                .1,
            "Panvel"
        );
    }

    #[test]
    fn prefers_city_and_never_fabricates_a_location() {
        assert!(geocode_result(&json!({"status":"ZERO_RESULTS","results":[]})).is_err());
        assert!(
            geocode_result(&json!({"status":"REQUEST_DENIED","error_message":"sensitive"}))
                .is_err()
        );
        let result = json!({"status":"OK","results":[{
            "geometry":{"location":{"lat":18.99,"lng":73.11}},
            "formatted_address":"Street, Panvel",
            "address_components":[{"long_name":"Street","types":["route"]},{"long_name":"Panvel","types":["locality"]}]
        }]});
        assert_eq!(geocode_result(&result).unwrap()["locality"], "Panvel");
    }
}

pub async fn calculate_route(
    State(_state): State<AppState>,
    _auth_user: AuthUser,
    Query(q): Query<RouteQuery>,
) -> Result<impl IntoResponse, AppError> {
    let d_lat = (q.dest_lat - q.origin_lat).to_radians();
    let d_lng = (q.dest_lng - q.origin_lng).to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + q.origin_lat.to_radians().cos()
            * q.dest_lat.to_radians().cos()
            * (d_lng / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
    let distance_km = 6371.0 * c;

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
