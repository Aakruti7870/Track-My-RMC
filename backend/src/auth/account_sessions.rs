//! Per-account, database-owned current session. Login success, not OTP request,
//! replaces an older JWT. Login issuance is serialized by users row lock.
use crate::{
    auth::jwt::{generate_token, verify_token},
    error::AppError,
    state::AppState,
};
use axum::http::{header::AUTHORIZATION, HeaderMap};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

pub async fn issue(
    state: &AppState,
    user: Uuid,
    role: &str,
    phone: &str,
    email: Option<&str>,
    lifetime_hours: i64,
) -> Result<String, AppError> {
    let mut tx = state.db.begin().await?;
    let jwt = issue_in_tx(
        &mut tx,
        user,
        role,
        phone,
        email,
        &state.config.jwt_secret,
        lifetime_hours,
    )
    .await?;
    tx.commit().await?;
    Ok(jwt)
}

pub async fn issue_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user: Uuid,
    role: &str,
    phone: &str,
    email: Option<&str>,
    secret: &str,
    lifetime_hours: i64,
) -> Result<String, AppError> {
    let row: Option<(String, bool)> =
        sqlx::query_as("SELECT role,is_active FROM users WHERE id=$1 FOR UPDATE")
            .bind(user)
            .fetch_optional(&mut **tx)
            .await?;
    let (current_role, active) =
        row.ok_or_else(|| AppError::Unauthorized("Account not found".into()))?;
    fn canonical(value: &str) -> &str {
        if value == "plant_owner" {
            "owner"
        } else {
            value
        }
    }
    if !active || canonical(&current_role) != canonical(role) {
        return Err(AppError::Unauthorized("Account permissions changed".into()));
    }
    if current_role == "driver" {
        let blocked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM driver_employment_profiles WHERE driver_id=$1 AND released_at IS NULL AND employment_status<>'ACTIVE')")
            .bind(user).fetch_one(&mut **tx).await?;
        if blocked {
            return Err(AppError::Forbidden(
                "An active verified Driver employment is required".into(),
            ));
        }
    }
    if matches!(
        current_role.as_str(),
        "dispatcher"
            | "operator"
            | "supervisor"
            | "accountant"
            | "quality_engineer"
            | "fleet_manager"
            | "store_manager"
    ) {
        // Called only after complete authentication. OTP verification alone
        // records email ownership but cannot activate an assignment or session.
        let activated:Vec<Uuid>=sqlx::query_scalar("UPDATE plant_staff ps SET employment_status='ACTIVE',is_active=TRUE
            FROM users u WHERE u.id=ps.user_id AND ps.user_id=$1 AND ps.role=$2
            AND ps.employment_status='PENDING' AND ps.removed_at IS NULL AND ps.invitation_expires_at>clock_timestamp()
            AND u.work_email_verified_at IS NOT NULL
            AND EXISTS(SELECT 1 FROM user_totp_credentials t WHERE t.user_id=u.id AND t.is_enabled=TRUE)
            RETURNING ps.plant_id")
            .bind(user).bind(&current_role).fetch_all(&mut **tx).await?;
        for plant in activated {
            sqlx::query("INSERT INTO plant_staff_lifecycle_audit(assignment_id,plant_id,staff_user_id,actor_user_id,actor_role,role,action,old_status,new_status,reason)
                SELECT assignment_id,plant_id,user_id,user_id,role,role,'CLAIMED','PENDING','ACTIVE','Verified registered email and completed MFA' FROM plant_staff WHERE plant_id=$1 AND user_id=$2")
                .bind(plant).bind(user).execute(&mut **tx).await?;
        }
        let assigned: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM plant_staff ps
             JOIN rmc_plants p ON p.id=ps.plant_id
             WHERE ps.user_id=$1 AND ps.role=$2 AND ps.is_active=TRUE
             AND ps.removed_at IS NULL AND ps.employment_status='ACTIVE' AND p.is_active=TRUE)",
        )
        .bind(user)
        .bind(&current_role)
        .fetch_one(&mut **tx)
        .await?;
        if !assigned {
            return Err(AppError::Forbidden(
                "An active approved plant assignment is required".into(),
            ));
        }
    }
    let jwt = generate_token(user, role, phone, email, secret, lifetime_hours)?;
    let claims = verify_token(&jwt, secret)?;
    let jti = claims
        .jti
        .ok_or_else(|| AppError::InternalError("JWT missing session ID".into()))?;
    sqlx::query("UPDATE users SET active_session_jti=$2 WHERE id=$1")
        .bind(user)
        .bind(jti)
        .execute(&mut **tx)
        .await?;
    Ok(jwt)
}

/// Extract only a signed JTI for a validated user. Never trust a client-provided
/// session ID or JSON body to revoke an account.
pub fn header_session_jti(headers: &HeaderMap, secret: &str, user: Uuid) -> Result<Uuid, AppError> {
    let bearer = headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::Unauthorized("Bearer session required".into()))?;
    let claims = verify_token(bearer, secret)?;
    if claims.sub != user {
        return Err(AppError::Unauthorized("Session identity mismatch".into()));
    }
    claims
        .jti
        .ok_or_else(|| AppError::Unauthorized("Session identifier missing".into()))
}

/// Conditional revocation prevents stale Session-1 logout racing with Session-2.
pub async fn revoke_current(state: &AppState, user: Uuid, jti: Uuid) -> Result<(), AppError> {
    let mut tx = state.db.begin().await?;
    let rows = sqlx::query(
        "UPDATE users SET active_session_jti=NULL,
         auth_revoked_at=clock_timestamp(),updated_at=NOW()
         WHERE id=$1 AND (active_session_jti=$2 OR active_session_jti IS NULL)",
    )
    .bind(user)
    .bind(jti)
    .execute(&mut *tx)
    .await?;
    if rows.rows_affected() != 1 {
        return Err(AppError::SessionReplaced);
    }
    sqlx::query("DELETE FROM account_refresh_tokens WHERE user_id=$1")
        .bind(user)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn jwt_session_identifiers_are_distinct() {
        let secret = "secure-test-jwt-key-with-at-least-32-characters";
        let user = Uuid::new_v4();
        let first = generate_token(user, "customer", "919876543210", None, secret, 1).unwrap();
        let second = generate_token(user, "customer", "919876543210", None, secret, 1).unwrap();
        assert_ne!(
            verify_token(&first, secret).unwrap().jti,
            verify_token(&second, secret).unwrap().jti
        );
    }
}
