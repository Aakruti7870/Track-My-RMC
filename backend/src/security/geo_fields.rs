//! Server-side geographic validation; never trust client filtering.
pub const MAX_GEO_FIELD_UTF16: usize = 80;

fn bidi_control(ch: char) -> bool {
    matches!(ch, '\u{061c}' | '\u{200e}' | '\u{200f}'
        | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
}

pub fn valid_geo_field(value: &str) -> bool {
    value.encode_utf16().count() <= MAX_GEO_FIELD_UTF16
        && !value.chars().any(|ch| ch.is_control() || bidi_control(ch))
}

pub fn valid_coordinate(lat: f64, lng: f64) -> bool {
    lat.is_finite()
        && lng.is_finite()
        && (-90.0..=90.0).contains(&lat)
        && (-180.0..=180.0).contains(&lng)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn utf16_and_international_place_names() {
        assert!(valid_geo_field(&"🧱".repeat(40)));
        assert!(!valid_geo_field(&"🧱".repeat(41)));
        assert!(valid_geo_field("मराठी"));
        for s in ["A\nB", "A\u{85}B", "A\u{202e}B"] {
            assert!(!valid_geo_field(s));
        }
    }
}
