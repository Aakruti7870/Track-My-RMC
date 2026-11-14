use crate::state::AppState;
use axum::{
    extract::State,
    http::StatusCode,
    response::{Html, IntoResponse},
    Json,
};
use serde_json::{json, Value};

/// Android verifies this JSON at the app's HTTPS origin. Never publish a
/// placeholder certificate: respond unavailable until Play App Signing is set.
pub async fn asset_links(State(state): State<AppState>) -> impl IntoResponse {
    let Some(fingerprint) = state.config.play_signing_sha256.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"detail": "App Link verification is not configured"})),
        )
            .into_response();
    };

    let body: Value = json!([{
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
            "namespace": "android_app",
            "package_name": "com.trackmyrmc.concreteking",
            "sha256_cert_fingerprints": [fingerprint]
        }
    }]);
    (StatusCode::OK, Json(body)).into_response()
}

/// Deep-link landing page used when DigiLocker/KYC returns to the app.
pub async fn kyc_return() -> Html<&'static str> {
    Html(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Return to TrackMyRMC</title>
</head>
<body style="font-family:system-ui;background:#101112;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="text-align:center;padding:24px">
<h1>DigiLocker return</h1>
<p>Returning to TrackMyRMC to confirm your DigiLocker consent securely. Verification completes only after the server checks the provider's identity evidence.</p>
<p><a href="trackmyrmc://kyc/return" style="color:#dfff62">Open TrackMyRMC App</a></p>
<p><a href="/kyc?returned=1" style="color:#dfff62">Continue in Browser</a></p>
<p style="font-size:14px;color:#b4b4b4">If the app does not open, tap the link above or continue in your browser.</p>
<script>
(function () {
  // Verified Android App Links normally open the app before this page loads.
  // A mobile browser that keeps the HTTPS callback still gets one best-effort
  // deep-link attempt; manual App and Web links remain usable if it is blocked.
  if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
    window.setTimeout(function () {
      if (document.visibilityState !== 'hidden') {
        window.location.href = 'trackmyrmc://kyc/return';
      }
    }, 300);
  }
})();
</script>
</main>
</body>
</html>"#,
    )
}

#[cfg(test)]
mod tests {
    use crate::config::normalize_sha256_fingerprint;

    #[tokio::test]
    async fn kyc_return_keeps_automatic_deep_link_and_manual_fallbacks() {
        let html = super::kyc_return().await.0;
        assert!(html.contains("window.setTimeout"));
        assert!(html.contains("document.visibilityState"));
        assert!(html.contains("trackmyrmc://kyc/return"));
        assert!(html.contains("/kyc?returned=1"));
        assert!(!html.contains("access_token"));
    }

    #[test]
    fn app_signing_fingerprint_normalizes_for_asset_links() {
        let fingerprint = "0123456789abcdef".repeat(4);
        assert_eq!(
            normalize_sha256_fingerprint(&fingerprint).as_deref(),
            Some(
                "01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF"
            )
        );
    }

    #[test]
    fn malformed_fingerprint_is_rejected() {
        assert!(normalize_sha256_fingerprint("invalid").is_none());
        assert!(normalize_sha256_fingerprint(&"z".repeat(64)).is_none());
    }
}
