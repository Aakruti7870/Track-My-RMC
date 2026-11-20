use crate::{error::AppError, state::AppState};
use axum::{
    extract::{ConnectInfo, Request, State},
    http::Method,
    middleware::Next,
    response::Response,
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::net::{IpAddr, SocketAddr};

#[derive(Clone)]
pub(crate) struct AuthSource(pub(crate) String);

fn source(req: &Request) -> String {
    let peer = req.extensions().get::<ConnectInfo<SocketAddr>>();
    let peer_ip = peer.map(|peer| peer.0.ip());
    let ip = if peer_ip.is_some_and(|p| p.is_loopback()) {
        req.headers()
            .get("x-real-ip")
            .and_then(|h| h.to_str().ok()?.parse::<IpAddr>().ok())
            .or(peer_ip)
    } else {
        peer_ip
    };
    ip.map(|ip| ip.to_canonical().to_string())
        .unwrap_or_else(|| "unknown".to_owned())
}

pub(crate) async fn guard(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let path = req.uri().path();
    if req.method() != Method::POST
        || ![
            "/api/auth/",
            "/api/staff/auth/",
            "/api/admin/auth/",
            "/api/authority/auth/",
            "/api/account-deletion/",
        ]
        .iter()
        .any(|prefix| path.starts_with(prefix))
        || path.ends_with("/logout")
        || path.ends_with("/logout-all")
    {
        return Ok(next.run(req).await);
    }

    let proof = path.contains("verify")
        || path.ends_with("/login")
        || path.ends_with("/step-up")
        || path.ends_with("/recover")
        || path.ends_with("/play-review");
    let address = source(&req);
    let mut mac = Hmac::<Sha256>::new_from_slice(state.config.otp_pepper.as_bytes())
        .expect("HMAC accepts any key length");
    mac.update(b"auth-source:");
    mac.update(address.as_bytes());
    let key = mac.finalize().into_bytes().to_vec();
    sqlx::query(
        "DELETE FROM auth_source_windows WHERE source_key IN (
         SELECT source_key FROM auth_source_windows WHERE started_at < now()-interval '1 day'
         ORDER BY started_at LIMIT 8 FOR UPDATE SKIP LOCKED)",
    )
    .execute(&state.db)
    .await?;
    let admitted = sqlx::query(
        "INSERT INTO auth_source_windows VALUES ($1,now(),1) ON CONFLICT (source_key)
         DO UPDATE SET attempts=CASE WHEN auth_source_windows.started_at<=now()-interval '1 minute'
              THEN 1 ELSE auth_source_windows.attempts+1 END,
            started_at=CASE WHEN auth_source_windows.started_at<=now()-interval '1 minute'
              THEN now() ELSE auth_source_windows.started_at END
         WHERE auth_source_windows.attempts<60 OR auth_source_windows.started_at<=now()-interval '1 minute'",
    )
    .bind(key)
    .execute(&state.db)
    .await?;
    if admitted.rows_affected() == 0 {
        return Err(AppError::RateLimited("Try again in one minute.".into()));
    }
    req.extensions_mut().insert(AuthSource(address));
    let response = next.run(req).await;
    if proof && matches!(response.status().as_u16(), 401 | 403) {
        tracing::warn!(
            auth_event = "proof_rejected",
            "Authentication proof rejected"
        );
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_peer_establishes_source_trust() {
        let mut request = Request::new(axum::body::Body::empty());
        request
            .headers_mut()
            .insert("x-real-ip", "192.0.2.3".parse().unwrap());
        request
            .headers_mut()
            .insert("cf-connecting-ip", "192.0.2.4".parse().unwrap());
        for (peer, expected) in [
            ("192.0.2.9:443", "192.0.2.9"),
            ("127.0.0.1:443", "192.0.2.3"),
        ] {
            request
                .extensions_mut()
                .insert(ConnectInfo(peer.parse::<SocketAddr>().unwrap()));
            assert_eq!(source(&request), expected);
        }
    }
}
