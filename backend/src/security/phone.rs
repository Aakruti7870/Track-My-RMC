//! Strict login identity matching frontend/src/auth/phone.ts.
pub fn canonical_login_phone(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    if bytes.len() == 10 && bytes.iter().all(u8::is_ascii_digit) {
        return Some(format!("91{input}"));
    }
    let digits = bytes.strip_prefix(b"+")?;
    if (10..=15).contains(&digits.len())
        && digits.first().is_some_and(|b| (b'1'..=b'9').contains(b))
        && digits.iter().all(u8::is_ascii_digit)
    {
        Some(input[1..].to_owned())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonical_and_hidden_input_rejection() {
        assert_eq!(canonical_login_phone("9876543210"),Some("919876543210".to_string()));
        assert_eq!(canonical_login_phone("+12025550101"),Some("12025550101".to_string()));
        for s in ["919876543210"," 9876543210","+91 (98765) 43210","tel:+919876543210","9876543210\n","٩٨٧٦٥٤٣٢١٠"] {
            assert!(canonical_login_phone(s).is_none());
        }
    }
}
