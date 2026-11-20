pub mod geo_distance;
pub mod geo_fields;
pub mod phone;
pub mod tracking;

use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

pub(crate) fn shared_secret_matches(provided: &str, expected: &str) -> bool {
    let provided = Sha256::digest(provided.as_bytes());
    let expected = Sha256::digest(expected.as_bytes());
    bool::from(provided[..].ct_eq(&expected[..]))
}

#[cfg(test)]
mod tests {
    use super::shared_secret_matches;

    #[test]
    fn shared_secret_requires_exact_match() {
        assert!(shared_secret_matches("test-token", "test-token"));
        assert!(!shared_secret_matches("test-tokeN", "test-token"));
        assert!(!shared_secret_matches("test", "test-token"));
    }
}
