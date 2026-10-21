use crate::{auth::AuthUser, error::AppError, state::AppState};
use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
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
        "status": if has_google_key { "configured" } else { "unavailable" },
        "provider": if has_google_key { Some("google_places") } else { None },
        "google_places_configured": has_google_key
    })))
}

pub async fn get_place_details(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(place_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    if place_id.is_empty()
        || place_id.len() > 256
        || !place_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(AppError::BadRequest("Invalid Google Place ID".into()));
    }
    let (client, key) = google_client(&state, &auth_user)?;
    let response = google_response(
        client
            .get(format!(
                "https://places.googleapis.com/v1/places/{place_id}"
            ))
            .header("X-Goog-Api-Key", key)
            .header("X-Goog-FieldMask", "id,formattedAddress,location"),
    )
    .await?;
    Ok(Json(place_result(&place_id, &response)?))
}

pub async fn autocomplete_places(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(q): Query<AutocompleteQuery>,
) -> Result<impl IntoResponse, AppError> {
    let input = q.input.or(q.q).unwrap_or_default();
    let input = input.trim();
    if !(2..=200).contains(&input.len()) || input.chars().any(char::is_control) {
        return Err(AppError::BadRequest(
            "Enter a place between 2 and 200 characters".into(),
        ));
    }
    let (client, key) = google_client(&state, &auth_user)?;
    let response = google_response(client
        .post("https://places.googleapis.com/v1/places:autocomplete")
        .header("X-Goog-Api-Key", key)
        .header("X-Goog-FieldMask", "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat")
        .json(&json!({"input":input,"includedRegionCodes":["in"]}))).await?;
    Ok(Json(autocomplete_result(&response)?))
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
    match result["status"].as_str() {
        Some("OK") => {}
        Some("ZERO_RESULTS") => {
            return Err(AppError::NotFound(
                "Location could not be resolved. Try a city or PIN code.".into(),
            ));
        }
        _ => {
            // Do not conflate provider quota or configuration failures with no results.
            // Never surface provider error_message, which can contain sensitive data.
            return Err(AppError::InternalError(
                "Location provider is temporarily unavailable. Please retry.".into(),
            ));
        }
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
        assert!(matches!(
            geocode_result(&json!({"status":"ZERO_RESULTS","results":[]})),
            Err(AppError::NotFound(_))
        ));
        for status in ["REQUEST_DENIED", "OVER_QUERY_LIMIT", "UNKNOWN_ERROR"] {
            assert!(matches!(
                geocode_result(&json!({"status":status,"error_message":"sensitive"})),
                Err(AppError::InternalError(_))
            ));
        }
        let result = json!({"status":"OK","results":[{
            "geometry":{"location":{"lat":18.99,"lng":73.11}},
            "formatted_address":"Street, Panvel",
            "address_components":[{"long_name":"Street","types":["route"]},{"long_name":"Panvel","types":["locality"]}]
        }]});
        assert_eq!(geocode_result(&result).unwrap()["locality"], "Panvel");
    }
}

pub async fn calculate_route(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(q): Query<RouteQuery>,
) -> Result<impl IntoResponse, AppError> {
    if !valid_coordinates(q.origin_lat, q.origin_lng) || !valid_coordinates(q.dest_lat, q.dest_lng)
    {
        return Err(AppError::BadRequest(
            "Provide valid route coordinates".into(),
        ));
    }
    let (client, key) = google_client(&state, &auth_user)?;
    let response = google_response(client
        .post("https://routes.googleapis.com/directions/v2:computeRoutes")
        .header("X-Goog-Api-Key", key)
        .header("X-Goog-FieldMask", "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline")
        .json(&json!({
            "origin":{"location":{"latLng":{"latitude":q.origin_lat,"longitude":q.origin_lng}}},
            "destination":{"location":{"latLng":{"latitude":q.dest_lat,"longitude":q.dest_lng}}},
            "travelMode":"DRIVE","routingPreference":"TRAFFIC_UNAWARE","computeAlternativeRoutes":false
        }))).await?;
    Ok(Json(route_result(&response)?))
}

fn valid_coordinates(lat: f64, lng: f64) -> bool {
    lat.is_finite()
        && lng.is_finite()
        && (-90.0..=90.0).contains(&lat)
        && (-180.0..=180.0).contains(&lng)
}

fn google_client(state: &AppState, user: &AuthUser) -> Result<(reqwest::Client, String), AppError> {
    let key = state
        .config
        .google_places_api_key
        .as_deref()
        .filter(|key| !key.trim().is_empty())
        .ok_or_else(|| AppError::InternalError("Map provider is not configured".into()))?;
    if !super::discovery::allow_search(user.user_id) {
        return Err(AppError::RateLimited(
            "Please wait before searching again".into(),
        ));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| AppError::InternalError("Map provider unavailable".into()))?;
    Ok((client, key.to_string()))
}

async fn google_response(request: reqwest::RequestBuilder) -> Result<serde_json::Value, AppError> {
    // Neither reqwest errors (which may contain URLs) nor provider response
    // bodies/error messages are logged or reflected to clients.
    let response = request
        .send()
        .await
        .map_err(|_| AppError::InternalError("Map provider could not connect".into()))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::NotFound("Place or route not found".into()));
    }
    let response = response
        .error_for_status()
        .map_err(|_| AppError::InternalError("Map provider is temporarily unavailable".into()))?;
    let result: serde_json::Value = response
        .json()
        .await
        .map_err(|_| AppError::InternalError("Invalid map provider response".into()))?;
    if !result.is_object() || result.get("error").is_some() {
        return Err(AppError::InternalError(
            "Invalid map provider response".into(),
        ));
    }
    Ok(result)
}

fn place_result(place_id: &str, result: &serde_json::Value) -> Result<serde_json::Value, AppError> {
    if result["id"].as_str() != Some(place_id) {
        return Err(AppError::InternalError(
            "Place provider identity mismatch".into(),
        ));
    }
    let lat = result["location"]["latitude"].as_f64();
    let lng = result["location"]["longitude"].as_f64();
    let address = result["formattedAddress"]
        .as_str()
        .filter(|s| !s.trim().is_empty());
    match (lat, lng, address) {
        (Some(lat), Some(lng), Some(address)) if valid_coordinates(lat, lng) => {
            Ok(json!({"success":true,"place_id":place_id,"lat":lat,"lng":lng,"address":address}))
        }
        _ => Err(AppError::NotFound(
            "Place has no usable address and coordinates".into(),
        )),
    }
}

fn autocomplete_result(result: &serde_json::Value) -> Result<serde_json::Value, AppError> {
    if result.get("error").is_some() || !result.is_object() {
        return Err(AppError::InternalError(
            "Invalid place prediction response".into(),
        ));
    }
    // Google returns an empty object when there are no suggestions.
    let Some(raw) = result.get("suggestions") else {
        return Ok(json!({"success":true,"predictions":[]}));
    };
    let raw = raw
        .as_array()
        .ok_or_else(|| AppError::InternalError("Invalid place prediction response".into()))?;
    let mut predictions = Vec::new();
    for suggestion in raw {
        let p = &suggestion["placePrediction"];
        let id = p["placeId"].as_str().filter(|s| !s.is_empty());
        let description = p["text"]["text"].as_str().filter(|s| !s.is_empty());
        let (Some(id), Some(description)) = (id, description) else {
            return Err(AppError::InternalError(
                "Invalid place prediction response".into(),
            ));
        };
        predictions.push(json!({"place_id":id,"description":description,"structured_formatting":{
            "main_text":p["structuredFormat"]["mainText"]["text"].as_str().unwrap_or(description),
            "secondary_text":p["structuredFormat"]["secondaryText"]["text"].as_str().unwrap_or("")
        }}));
    }
    Ok(json!({"success":true,"predictions":predictions}))
}

fn route_result(result: &serde_json::Value) -> Result<serde_json::Value, AppError> {
    if result.get("error").is_some() {
        return Err(AppError::InternalError(
            "Route provider is temporarily unavailable".into(),
        ));
    }
    let routes = result["routes"]
        .as_array()
        .ok_or_else(|| AppError::NotFound("No driving route found".into()))?;
    let route = routes
        .first()
        .ok_or_else(|| AppError::NotFound("No driving route found".into()))?;
    let meters = route["distanceMeters"]
        .as_f64()
        .filter(|d| d.is_finite() && *d >= 0.0);
    let seconds = route["duration"]
        .as_str()
        .and_then(|s| s.strip_suffix('s'))
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|s| s.is_finite() && *s >= 0.0 && *s <= 1_000_000_000.0);
    let polyline = route["polyline"]["encodedPolyline"].as_str().filter(|s| {
        !s.is_empty() && s.len() <= 250_000 && s.bytes().all(|b| (63..=126).contains(&b))
    });
    match (meters, seconds, polyline) {
        (Some(meters), Some(seconds), Some(polyline)) => Ok(json!({
            "success":true,"distance_km":(meters / 100.0).round()/10.0,
            "duration_minutes":(seconds/60.0).ceil() as i64,"polyline":polyline,
            "provider":"google_routes","traffic_aware":false
        })),
        _ => Err(AppError::InternalError(
            "Route provider returned incomplete route data".into(),
        )),
    }
}

#[cfg(test)]
mod provider_tests {
    use super::*;

    #[test]
    fn real_place_coordinates_are_required_without_a_city_fallback() {
        let valid = json!({"id":"ChIJ_test","formattedAddress":"Panvel, India","location":{"latitude":18.99,"longitude":73.11}});
        assert_eq!(place_result("ChIJ_test", &valid).unwrap()["lat"], 18.99);
        for invalid in [
            json!({}),
            json!({"id":"wrong"}),
            json!({"id":"ChIJ_test","formattedAddress":"Panvel","location":{"latitude":91,"longitude":73}}),
        ] {
            assert!(place_result("ChIJ_test", &invalid).is_err());
        }
    }

    #[test]
    fn predictions_preserve_google_identity_and_never_invent_plant_ids() {
        let response = json!({"suggestions":[{"placePrediction":{"placeId":"ChIJ_test","text":{"text":"Panvel, India"},"structuredFormat":{"mainText":{"text":"Panvel"},"secondaryText":{"text":"India"}}}}]});
        let result = autocomplete_result(&response).unwrap();
        assert_eq!(result["predictions"][0]["place_id"], "ChIJ_test");
        assert_eq!(
            result["predictions"][0]["structured_formatting"]["main_text"],
            "Panvel"
        );
        assert_eq!(
            autocomplete_result(&json!({})).unwrap()["predictions"],
            json!([])
        );
        assert!(autocomplete_result(&json!({"suggestions":[{}]})).is_err());
        assert!(
            autocomplete_result(&json!({"error":{"message":"private provider details"}})).is_err()
        );
    }

    #[test]
    fn routes_require_provider_distance_duration_and_polyline() {
        let response = json!({"routes":[{"distanceMeters":12345,"duration":"123.5s","polyline":{"encodedPolyline":"??"}}]});
        let parsed = route_result(&response).unwrap();
        assert_eq!(parsed["distance_km"], 12.3);
        assert_eq!(parsed["duration_minutes"], 3);
        assert_eq!(parsed["polyline"], "??");
        assert_eq!(parsed["traffic_aware"], false);
        for invalid in [
            json!({}),
            json!({"routes":[]}),
            json!({"routes":[{"distanceMeters":-1,"duration":"60s","polyline":{"encodedPolyline":"??"}}]}),
            json!({"routes":[{"distanceMeters":1,"duration":"NaNs","polyline":{"encodedPolyline":"??"}}]}),
            json!({"routes":[{"distanceMeters":1,"duration":"60s"}]}),
        ] {
            assert!(route_result(&invalid).is_err());
        }
    }

    #[test]
    fn route_coordinates_reject_non_finite_and_out_of_range_values() {
        assert!(valid_coordinates(0.0, 0.0));
        assert!(valid_coordinates(18.99, 73.11));
        assert!(!valid_coordinates(f64::NAN, 73.11));
        assert!(!valid_coordinates(18.99, f64::INFINITY));
        assert!(!valid_coordinates(-91.0, 73.11));
        assert!(!valid_coordinates(18.99, 181.0));
    }
}
