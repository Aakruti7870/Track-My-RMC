//! Server-enforced, UTF-16-aware limits for user-entered geographic filters.
pub const MAX_GEO_FIELD_UTF16: usize = 80;
fn is_bidi_control(ch: char) -> bool {
    matches!(ch, '\u{061c}'|'\u{200e}'|'\u{200f}'|'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}')
}
pub fn valid_geo_field(value: &str) -> bool {
    value.encode_utf16().count() <= MAX_GEO_FIELD_UTF16
        && !value.chars().any(|ch| ch.is_control() || is_bidi_control(ch))
}
pub fn valid_coordinate(lat: f64, lng: f64) -> bool {
    lat.is_finite() && lng.is_finite()
        && (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lng)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn length_and_unicode() {
        assert!(valid_geo_field(&"🧱".repeat(40)));
        assert!(!valid_geo_field(&"🧱".repeat(41)));
        assert!(valid_geo_field("मराठी"));
        assert!(valid_geo_field("क्षे\u{200d}त्र"));
    }
    #[test] fn rejects_control_and_spoofing() {
        for bad in ["Pune\nMumbai","A\0B","A\u{7f}B","A\u{202e}B","A\u{2066}B"] {
            assert!(!valid_geo_field(bad));
        }
    }
    #[test] fn rejects_invalid_coords() {
        assert!(valid_coordinate(19.0,73.0));
        for (a,b) in [(91.,73.),(19.,181.),(f64::NAN,0.),(0.,f64::INFINITY)] {
            assert!(!valid_coordinate(a,b));
        }
    }
}