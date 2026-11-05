//! Stable Haversine parity with src/maps/geo.ts.
use super::geo_fields::valid_coordinate;
pub const EARTH_RADIUS_KM: f64 = 6371.0088;

pub fn distance_km(a_lat: f64, a_lng: f64, b_lat: f64, b_lng: f64) -> Option<f64> {
    if !valid_coordinate(a_lat, a_lng) || !valid_coordinate(b_lat, b_lng) { return None; }
    let d_lat = (b_lat - a_lat).to_radians();
    let d_lng = (b_lng - a_lng).to_radians();
    let h = (d_lat / 2.0).sin().powi(2)
        + a_lat.to_radians().cos() * b_lat.to_radians().cos() * (d_lng / 2.0).sin().powi(2);
    let h = h.clamp(0.0, 1.0);
    Some(EARTH_RADIUS_KM * 2.0 * h.sqrt().atan2((1.0-h).sqrt()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finite_symmetric_and_invalid() {
        assert_eq!(distance_km(19.0,73.0,19.0,73.0),Some(0.0));
        assert!(distance_km(0.0,0.0,0.0,180.0).unwrap().is_finite());
        assert!(distance_km(91.0,73.0,19.0,73.0).is_none());
    }
}
