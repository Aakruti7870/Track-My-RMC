//! Server-owned GPS status; order permission is enforced in customer_routes.
use chrono::{DateTime, Utc};
use uuid::Uuid;
use super::geo_fields::valid_coordinate;
pub const GPS_FRESHNESS_MS: i64 = 90_000;

pub fn can_read_order_tracking(viewer: Uuid, owner: Uuid, role: &str) -> bool {
    viewer == owner || role == "admin"
}

pub fn gps_is_stale(lat: f64, lng: f64, at: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    let age = now.signed_duration_since(at).num_milliseconds();
    !valid_coordinate(lat, lng) || !(0..GPS_FRESHNESS_MS).contains(&age)
}

pub fn is_safe_live_location(status: &str, lat: f64, lng: f64, at: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    matches!(status, "dispatched" | "en_route" | "arrived" | "pouring")
        && !gps_is_stale(lat,lng,at,now)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    #[test]
    fn strict_freshness_and_order_ownership() {
        let now = Utc::now();
        assert!(!gps_is_stale(19.0,73.0,now-Duration::milliseconds(89_999),now));
        assert!(gps_is_stale(19.0,73.0,now-Duration::milliseconds(90_000),now));
        assert!(gps_is_stale(19.0,73.0,now+Duration::milliseconds(1),now));
        assert!(!can_read_order_tracking(Uuid::from_u128(2),Uuid::from_u128(1),"customer"));
        assert!(!is_safe_live_location("delivered",19.0,73.0,now,now));
    }
}
