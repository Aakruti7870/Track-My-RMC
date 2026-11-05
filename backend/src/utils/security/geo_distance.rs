//! Haversine reference matched to frontend/src/maps/geo.ts (mean Earth radius).
use super::geo_fields::valid_coordinate;
pub const EARTH_RADIUS_KM: f64 = 6371.0088;
pub fn distance_km(lat1:f64,lng1:f64,lat2:f64,lng2:f64) -> Option<f64> {
    if !valid_coordinate(lat1,lng1) || !valid_coordinate(lat2,lng2) { return None; }
    let dl=(lat2-lat1).to_radians(); let dn=(lng2-lng1).to_radians();
    let hav=(dl/2.).sin().powi(2)+lat1.to_radians().cos()*lat2.to_radians().cos()*(dn/2.).sin().powi(2);
    let angle=2.*hav.clamp(0.,1.).sqrt().atan2((1.-hav.clamp(0.,1.)).sqrt());
    let distance=EARTH_RADIUS_KM*angle;
    distance.is_finite().then_some(distance)
}
#[cfg(test)]
mod tests { use super::*;
    #[test] fn valid_and_invalid() {
        assert_eq!(distance_km(19.,73.,19.,73.),Some(0.));
        assert!(distance_km(18.5204,73.8567,19.0760,72.8777).unwrap() > 110.);
        assert_eq!(distance_km(f64::NAN,73.,19.,73.),None);
    }
}