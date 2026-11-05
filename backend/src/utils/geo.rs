/// Calculates the great-circle distance between two geographic coordinates using the Haversine formula (in kilometers).
pub fn haversine_distance_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    crate::security::geo_distance::distance_km(lat1, lon1, lat2, lon2)
        .unwrap_or(f64::NAN)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_haversine_distance() {
        // Distance between Pune and Mumbai is roughly 120-150 km
        let dist = haversine_distance_km(18.5204, 73.8567, 19.0760, 72.8777);
        assert!(dist > 110.0 && dist < 160.0);
    }
}
