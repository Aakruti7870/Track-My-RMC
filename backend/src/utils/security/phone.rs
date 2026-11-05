//! Strict OTP destination input parsing; never use punctuation-stripping as authentication validation.
pub fn canonical_login_phone(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    if bytes.len() == 10 && bytes.iter().all(u8::is_ascii_digit) {
        return Some(format!("91{value}"));
    }
    let digits = bytes.strip_prefix(b"+")?;
    if (10..=15).contains(&digits.len())
        && digits.first().is_some_and(|b| (b'1'..=b'9').contains(b))
        && digits.iter().all(u8::is_ascii_digit)
    {
        Some(value[1..].to_owned())
    } else { None }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn matching_frontend_input_contract() {
        for (given, wanted) in [
            ("9876543210",Some("919876543210")),
            ("+919876543210",Some("919876543210")),
            ("+1123456789",Some("1123456789")),
            ("+123456789012345",Some("123456789012345")),
            ("",None),(" 9876543210",None),("9876543210\n",None),
            ("919876543210",None),("+91 (98765) 43210",None),
            ("tel:+919876543210",None),("+01987654321",None),
            ("+123456789",None),("+1234567890123456",None),
            ("9876543210\u{200b}",None),("٩٨٧٦٥٤٣٢١٠",None)
        ] {
            assert_eq!(canonical_login_phone(given).as_deref(), wanted, "input: {given:?}");
        }
    }
}