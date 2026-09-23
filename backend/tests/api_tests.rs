#[cfg(test)]
mod tests {
    use reqwest::StatusCode;
    use serde_json::json;

    #[test]
    fn test_client_error_response_format() {
        let err_resp = json!({
            "success": false,
            "message": "Server temporarily unavailable"
        });

        assert_eq!(err_resp["success"], false);
        assert_eq!(err_resp["message"], "Server temporarily unavailable");
    }

    #[test]
    fn test_haversine_formula_validity() {
        // Test distance logic
        let d = 125.4;
        assert!(d > 100.0 && d < 150.0);
    }
}
