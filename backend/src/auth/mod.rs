pub mod account_sessions;
pub mod jwt;
pub mod middleware;
pub mod otp;
pub mod passkey;
pub mod password;
pub mod refresh;
pub mod totp;
pub mod totp_storage;

pub use middleware::AuthUser;

pub(crate) const NO_STORE: [(axum::http::HeaderName, &str); 1] =
    [(axum::http::header::CACHE_CONTROL, "no-store")];

pub mod authority;
pub mod control_center;
pub mod staff_support;
