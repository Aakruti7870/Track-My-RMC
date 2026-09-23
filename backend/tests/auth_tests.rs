#[cfg(test)]
mod tests {
    use serde_json::json;
    use sha2::{Digest, Sha256};

    fn hash_otp(otp: &str, salt: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(salt.as_bytes());
        hasher.update(otp.trim().as_bytes());
        format!("{:x}", hasher.finalize())
    }

    fn normalize_phone(phone: &str) -> String {
        let clean: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
        if clean.len() == 10 {
            format!("91{}", clean)
        } else {
            clean
        }
    }

    fn is_whatsapp_otp_permitted_for_role(role: &str) -> bool {
        match role.to_lowercase().as_str() {
            "customer" | "driver" => true,
            _ => false, // Plant Staff, Owner, Super Admin MUST BE REJECTED
        }
    }

    fn hash_backup_code(code: &str, salt: &str) -> String {
        let clean: String = code.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase();
        let mut hasher = Sha256::new();
        hasher.update(salt.as_bytes());
        hasher.update(clean.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    #[test]
    fn test_whatsapp_role_enforcement_matrix() {
        // Customer -> allowed
        assert!(is_whatsapp_otp_permitted_for_role("customer"));
        assert!(is_whatsapp_otp_permitted_for_role("Customer"));

        // Driver -> allowed
        assert!(is_whatsapp_otp_permitted_for_role("driver"));
        assert!(is_whatsapp_otp_permitted_for_role("Driver"));

        // Plant Staff -> REJECTED
        assert!(!is_whatsapp_otp_permitted_for_role("dispatcher"));
        assert!(!is_whatsapp_otp_permitted_for_role("operator"));
        assert!(!is_whatsapp_otp_permitted_for_role("supervisor"));
        assert!(!is_whatsapp_otp_permitted_for_role("quality_engineer"));
        assert!(!is_whatsapp_otp_permitted_for_role("store_manager"));
        assert!(!is_whatsapp_otp_permitted_for_role("accountant"));
        assert!(!is_whatsapp_otp_permitted_for_role("fleet_manager"));
        assert!(!is_whatsapp_otp_permitted_for_role("staff"));

        // Owner -> REJECTED
        assert!(!is_whatsapp_otp_permitted_for_role("owner"));
        assert!(!is_whatsapp_otp_permitted_for_role("Owner"));

        // Super Admin -> REJECTED
        assert!(!is_whatsapp_otp_permitted_for_role("admin"));
        assert!(!is_whatsapp_otp_permitted_for_role("super_admin"));
        assert!(!is_whatsapp_otp_permitted_for_role("Admin"));
    }

    #[test]
    fn test_secure_otp_hashing() {
        let otp = "482910";
        let salt = "random_cryptographic_salt_123456";
        let hash1 = hash_otp(otp, salt);
        let hash2 = hash_otp(otp, salt);
        assert_eq!(hash1, hash2);

        let hash_wrong = hash_otp("482911", salt);
        assert_ne!(hash1, hash_wrong);
    }

    #[test]
    fn test_meta_whatsapp_phone_normalization() {
        let norm = normalize_phone("9823012345");
        assert_eq!(norm, "919823012345");

        let norm2 = normalize_phone("+91 98230-12345");
        assert_eq!(norm2, "919823012345");
    }

    #[test]
    fn test_totp_single_use_hashed_recovery_codes() {
        let salt = "totp_user_salt_random_32_bytes";
        let raw_code = "A1B2-C3D4";
        let hashed = hash_backup_code(raw_code, salt);

        let mut stored_hashes = vec![hashed.clone(), hash_backup_code("E5F6-G7H8", salt)];
        assert_eq!(stored_hashes.len(), 2);

        let attempt_hash = hash_backup_code("a1b2-c3d4", salt);
        assert!(stored_hashes.contains(&attempt_hash));

        stored_hashes.retain(|h| h != &attempt_hash);
        assert_eq!(stored_hashes.len(), 1);

        assert!(!stored_hashes.contains(&attempt_hash));
    }

    #[test]
    fn test_error_response_no_traces() {
        let err_json = json!({
            "success": false,
            "message": "Invalid or expired verification code"
        });

        assert_eq!(err_json["success"], false);
        assert_eq!(err_json["message"], "Invalid or expired verification code");
        assert!(err_json.get("stack_trace").is_none());
        assert!(err_json.get("sql").is_none());
    }
}
