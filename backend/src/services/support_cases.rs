use crate::{error::AppError, state::AppState};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

pub fn message(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 1000 {
        return Err(AppError::BadRequest(
            "Support messages require 1 to 1000 characters".into(),
        ));
    }
    let lower = value.to_lowercase();
    // Do not persist obvious credential submissions. Context-only reports such
    // as a blank password-reset screen remain valid. No rejected value is logged.
    let words: Vec<&str> = lower
        .split(|c: char| c.is_whitespace() || matches!(c, ':' | '=' | '-'))
        .filter(|s| !s.is_empty())
        .collect();
    let context = [
        "and",
        "reset",
        "screen",
        "page",
        "field",
        "issue",
        "problem",
        "help",
        "verification",
        "login",
        "prompt",
        "manager",
        "policy",
        "requirement",
        "required",
        "incorrect",
        "invalid",
        "forgot",
        "change",
        "expired",
        "missing",
    ];
    let labelled = words.iter().enumerate().any(|(i, word)| {
        let next = words.get(i + 1).copied().unwrap_or("");
        let next = if matches!(next, "is" | "equals") {
            words.get(i + 2).copied().unwrap_or("")
        } else {
            next
        };
        let digit_sequence = words[i + 1..]
            .iter()
            .take_while(|s| s.chars().all(|c| c.is_ascii_digit()))
            .map(|s| s.len())
            .sum::<usize>();
        let recovery = *word == "code"
            && i > 0
            && words[i - 1] == "recovery"
            && next.len() >= 4
            && !context.contains(&next);
        (matches!(
            *word,
            "password"
                | "passkey"
                | "token"
                | "api_key"
                | "access_token"
                | "refresh_token"
                | "secret_key"
                | "key"
        ) && next.len() >= 3
            && !context.contains(&next))
            || (matches!(*word, "otp" | "pin" | "cvv" | "code")
                && next.chars().filter(char::is_ascii_digit).count() >= 3)
            || (*word == "bearer"
                && !context.contains(&next)
                && words[i + 1..].iter().map(|s| s.len()).sum::<usize>() >= 12)
            || (matches!(*word, "otp" | "pin" | "cvv" | "code") && digit_sequence >= 3)
            || recovery
    });
    let card = words
        .iter()
        .any(|s| matches!(*s, "card" | "credit" | "debit"))
        && words.iter().enumerate().any(|(i, _)| {
            words[i..]
                .iter()
                .take_while(|s| s.chars().all(|c| c.is_ascii_digit()))
                .map(|s| s.len())
                .sum::<usize>()
                >= 13
        });
    if labelled || card || lower.contains("private key-----") {
        return Err(AppError::BadRequest(
            "Remove credentials, security codes, or secret tokens from the support message".into(),
        ));
    }
    Ok(value.to_string())
}

pub fn guidance(category: &str) -> Result<(&'static str, &'static str), AppError> {
    match category {
        "LOGIN" => Ok((
            "OPEN_SECURE_LOGIN_HELP",
            "Use secure sign-in recovery. Never share security codes or credentials.",
        )),
        "KYC" => Ok(("OPEN_KYC", "Review KYC in the secure in-app flow.")),
        "ORDER" => Ok((
            "OPEN_ORDERS",
            "Review your authorized order and plant status in My Orders.",
        )),
        "TRACKING" => Ok((
            "OPEN_TRACKING",
            "Live tracking is available for your authorized dispatched order.",
        )),
        "PAYMENT" => Ok((
            "OPEN_PAYMENTS",
            "Review payment status in the app. Never send payment credentials in chat.",
        )),
        "ACCOUNT_DELETION" => Ok((
            "OPEN_ACCOUNT_DELETION",
            "Start the authenticated account-deletion flow from Settings.",
        )),
        "PLANT_ONBOARDING" => Ok((
            "OPEN_PLANT_ONBOARDING",
            "Submit a plant inquiry through the onboarding flow.",
        )),
        "GENERAL" => Ok((
            "OPEN_HELP",
            "Describe the app issue without including credentials or payment secrets.",
        )),
        _ => Err(AppError::BadRequest("Unsupported support category".into())),
    }
}

pub async fn list(
    state: &AppState,
    owner: Option<Uuid>,
    case: Option<Uuid>,
) -> Result<Vec<Value>, AppError> {
    let rows = sqlx::query_scalar(r#"
        SELECT jsonb_build_object('id',c.id,'case_number',c.case_number,'order_id',c.order_id,
            'subject',c.subject,'category',upper(c.category),'priority',c.priority,'status',upper(c.status),
            'created_at',c.created_at,'updated_at',c.updated_at,'messages',m.messages,'latest_note',m.latest_note)
        FROM support_cases c CROSS JOIN LATERAL (
            SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'message',r.message,
                'author',CASE WHEN r.is_staff THEN 'SUPPORT' ELSE 'CUSTOMER' END,
                'internal',r.internal,'created_at',r.created_at) ORDER BY r.created_at,r.id),'[]'::jsonb) messages,
                (array_agg(r.message ORDER BY r.created_at DESC,r.id DESC))[1] latest_note
            FROM support_case_replies r WHERE r.case_id=c.id AND ($1::uuid IS NULL OR NOT r.internal)
        ) m
        WHERE ($1::uuid IS NULL OR c.user_id=$1) AND ($2::uuid IS NULL OR c.id=$2)
        ORDER BY c.updated_at DESC,c.id LIMIT 500
    "#).bind(owner).bind(case).fetch_all(&state.db).await?;
    Ok(rows)
}

pub async fn reply(
    state: &AppState,
    actor: Uuid,
    owner: Option<Uuid>,
    case: Uuid,
    text: &str,
    internal: bool,
) -> Result<(), AppError> {
    let text = message(text)?;
    if owner.is_some() && internal {
        return Err(AppError::Forbidden(
            "Customers cannot create internal notes".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    let row = sqlx::query("SELECT user_id,status FROM support_cases WHERE id=$1 AND ($2::uuid IS NULL OR user_id=$2) FOR UPDATE")
        .bind(case).bind(owner).fetch_optional(&mut *tx).await?.ok_or_else(||AppError::NotFound("Support case not found".into()))?;
    let status: String = row.get("status");
    if !["OPEN", "IN_PROGRESS"].contains(&status.to_uppercase().as_str()) {
        return Err(AppError::Conflict(
            "Support case is closed for replies".into(),
        ));
    }
    sqlx::query("INSERT INTO support_case_replies(case_id,sender_id,is_staff,message,internal) VALUES($1,$2,$3,$4,$5)").bind(case).bind(actor).bind(owner.is_none()).bind(text).bind(internal).execute(&mut *tx).await?;
    sqlx::query("UPDATE support_cases SET updated_at=NOW() WHERE id=$1")
        .bind(case)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'support.case.reply','support_case',$2,$3)").bind(actor).bind(case.to_string()).bind(json!({"internal":internal,"staff":owner.is_none()})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::message;
    #[test]
    fn refuses_obvious_secrets_without_blocking_context_only_reports() {
        for value in [
            "OTP is 123456",
            "password=synthetic-value",
            "access token: synthetic-value",
            "recovery code ABCD-EFGH-IJKL",
            "OTP 1 2 3 4 5 6",
            "api key is synthetic-value",
            "card number 4111 1111 1111 1111",
            "bearer synthetic-token-value",
            "-----BEGIN PRIVATE KEY-----",
        ] {
            assert!(message(value).is_err());
        }
        assert!(message("My password reset screen is blank").is_ok());
        assert!(message("The token expired screen is blank").is_ok());
        assert!(message("").is_err());
    }
}
