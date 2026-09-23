use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::error;

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiErrorResponse {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Resource not found: {0}")]
    NotFound(String),

    #[error("Authentication failed: {0}")]
    Unauthorized(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Invalid input or validation failed: {0}")]
    BadRequest(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Database error occurred")]
    DatabaseError(#[from] sqlx::Error),

    #[error("Password hashing error")]
    HashingError(String),

    #[error("JWT error")]
    JwtError(String),

    #[error("Internal server error")]
    InternalError(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, client_message, error_code) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone(), Some("NOT_FOUND".to_string())),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg.clone(), Some("UNAUTHORIZED".to_string())),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg.clone(), Some("FORBIDDEN".to_string())),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone(), Some("BAD_REQUEST".to_string())),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, msg.clone(), Some("CONFLICT".to_string())),
            AppError::DatabaseError(err) => {
                error!(error = ?err, "PostgreSQL execution failure");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "A database error occurred. Please try again later.".to_string(),
                    Some("DATABASE_ERROR".to_string()),
                )
            }
            AppError::HashingError(err) => {
                error!(error = ?err, "Cryptographic hashing error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Authentication subsystem failure".to_string(),
                    Some("CRYPTO_ERROR".to_string()),
                )
            }
            AppError::JwtError(err) => {
                error!(error = ?err, "JWT signing or parsing error");
                (
                    StatusCode::UNAUTHORIZED,
                    "Invalid or expired token".to_string(),
                    Some("TOKEN_ERROR".to_string()),
                )
            }
            AppError::InternalError(msg) => {
                error!(internal_error = ?msg, "Internal application error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Server temporarily unavailable".to_string(),
                    Some("INTERNAL_SERVER_ERROR".to_string()),
                )
            }
        };

        let body = Json(ApiErrorResponse {
            success: false,
            message: client_message,
            error_code,
        });

        (status, body).into_response()
    }
}
