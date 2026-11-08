//! Shared platform support access, never a replacement for WebAdmin governance.
use crate::{
    auth::{
        control_center::{token_hash, WebAdmin},
        AuthUser,
    },
    error::AppError,
    state::AppState,
};
use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};
use sqlx::{Postgres, Transaction};
use std::ops::Deref;

#[derive(Clone, Copy)]
pub enum SupportAction {
    View,
    Reply,
    Manage,
}

pub struct WebSupport {
    user: AuthUser,
    token_hash: String,
}

impl Deref for WebSupport {
    type Target = AuthUser;
    fn deref(&self) -> &AuthUser {
        &self.user
    }
}

impl WebSupport {
    pub fn from_admin(admin: &WebAdmin) -> Self {
        Self {
            user: admin.user.clone(),
            token_hash: admin.token_hash.clone(),
        }
    }

    /// Case mutations lock the case BEFORE calling this method, matching the
    /// worker's case -> identity order. Policy/login/credential changes lock the
    /// identity row exclusively. Hold this SHARE lock until the action commits,
    /// and read access/session in a NEW statement after any identity lock wait.
    pub async fn authorize_in_tx(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        action: SupportAction,
    ) -> Result<(), AppError> {
        let active: Option<bool> =
            sqlx::query_scalar("SELECT is_active FROM users WHERE id=$1 AND role=$2 FOR SHARE")
                .bind(self.user_id)
                .bind(&self.role)
                .fetch_optional(&mut **tx)
                .await?;
        if active != Some(true) || !matches!(self.role.as_str(), "central_admin" | "authority") {
            return Err(AppError::SessionRevoked);
        }
        let permissions: Option<Vec<String>> = sqlx::query_scalar(
            "SELECT a.permissions FROM control_center_access a
             JOIN control_center_sessions s ON s.user_id=a.user_id
             JOIN user_totp_credentials t ON t.user_id=a.user_id AND t.is_enabled
             WHERE a.user_id=$1 AND a.approved AND s.token_hash=$2
               AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()",
        )
        .bind(self.user_id)
        .bind(&self.token_hash)
        .fetch_optional(&mut **tx)
        .await?;
        let permissions = permissions
            .ok_or_else(|| AppError::Forbidden("Approved support web session required".into()))?;
        let has = |p: &str| permissions.iter().any(|v| v == p);
        let allowed = match action {
            SupportAction::View => has("support.view"),
            SupportAction::Reply => has("support.view") && has("support.reply"),
            SupportAction::Manage => self.role == "central_admin" && has("support.manage"),
        };
        if !allowed {
            return Err(AppError::Forbidden("Support permission denied".into()));
        }
        Ok(())
    }
}

#[async_trait]
impl<S> FromRequestParts<S> for WebSupport
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, AppError> {
        let user = AuthUser::from_request_parts(parts, state).await?;
        if !matches!(user.role.as_str(), "central_admin" | "authority") {
            return Err(AppError::Forbidden(
                "Dedicated support web session required".into(),
            ));
        }
        let support = Self {
            user,
            token_hash: token_hash(&parts.headers)?,
        };
        let app = AppState::from_ref(state);
        let mut tx = app.db.begin().await?;
        support
            .authorize_in_tx(&mut tx, SupportAction::View)
            .await?;
        tx.commit().await?;
        Ok(support)
    }
}
