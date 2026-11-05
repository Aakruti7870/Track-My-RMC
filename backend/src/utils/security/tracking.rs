//! Read-side privacy decisions: GPS can be stale but must not be represented as LIVE.
use chrono::{DateTime,Utc};
use uuid::Uuid;
use super::geo_fields::valid_coordinate;
pub const GPS_FRESHNESS_MS: i64=90_000;
pub fn can_read_order_tracking(viewer:Uuid,owner:Uuid,role:&str)->bool {
    viewer==owner || role=="admin"
}
pub fn gps_is_stale(lat:f64,lng:f64,at:DateTime<Utc>,now:DateTime<Utc>)->bool {
    let age=now.signed_duration_since(at).num_milliseconds();
    !valid_coordinate(lat,lng) || !(0..GPS_FRESHNESS_MS).contains(&age)
}
pub fn is_safe_live_location(status:&str,lat:f64,lng:f64,at:DateTime<Utc>,now:DateTime<Utc>)->bool {
    matches!(status,"dispatched"|"en_route"|"arrived"|"pouring")
        && !gps_is_stale(lat,lng,at,now)
}
#[cfg(test)]
mod tests {use super::*;use chrono::Duration;
    #[test] fn owners_and_freshness() {
        let a=Uuid::from_u128(1);let b=Uuid::from_u128(2);
        assert!(can_read_order_tracking(a,a,"customer"));
        assert!(!can_read_order_tracking(b,a,"customer"));
        assert!(can_read_order_tracking(b,a,"admin"));
        let now=Utc::now();
        assert!(!gps_is_stale(19.,73.,now-Duration::milliseconds(89_999),now));
        assert!(gps_is_stale(19.,73.,now-Duration::milliseconds(90_000),now));
        assert!(gps_is_stale(19.,73.,now+Duration::milliseconds(1),now));
        assert!(!is_safe_live_location("completed",19.,73.,now,now));
    }
}