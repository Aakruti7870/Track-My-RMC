//! Native Rust FCM delivery for role-scoped operational notifications.
//! The database trigger enqueues push only after the in-app notification is inserted.
//! Configure FCM_SERVICE_ACCOUNT_JSON as an AWS secret; never put a private key in Git.
use chrono::Utc;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::time::{Duration, Instant};

pub const STANDARD_CHANNEL: &str = "trackmyrmc_operations_standard_v1";
pub const LOUD_CHANNEL: &str = "trackmyrmc_operations_loud_v1";

fn channel_for(event: &str) -> Option<(&'static str, &'static str)> {
    match event {
        "new_order_staff" => Some((STANDARD_CHANNEL, "trackmyrmc_standard")),
        "new_order" | "trip_assigned" => Some((LOUD_CHANNEL, "trackmyrmc_loud")),
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
struct ServiceAccount {
    project_id: String,
    client_email: String,
    private_key: String,
}

#[derive(Debug, Serialize)]
struct OAuthClaims<'a> {
    iss: &'a str,
    scope: &'static str,
    aud: &'static str,
    iat: i64,
    exp: i64,
}

#[derive(Debug, Deserialize)]
struct OAuthToken {
    access_token: String,
    expires_in: u64,
}

type WorkerResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub struct PushDeliveryWorker {
    http: Client,
    account: ServiceAccount,
    cached_oauth: Option<(String, Instant)>,
}

impl PushDeliveryWorker {
    pub fn from_env() -> Result<Self, String> {
        let credential = std::env::var("FCM_SERVICE_ACCOUNT_JSON").map_err(|_| {
            "FCM_SERVICE_ACCOUNT_JSON is required when PUSH_NOTIFICATIONS_ENABLED=true"
        })?;
        let account: ServiceAccount = serde_json::from_str(&credential).map_err(|_| {
            "FCM_SERVICE_ACCOUNT_JSON must contain a valid service account JSON object"
        })?;
        if account.project_id.is_empty()
            || !account
                .project_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
            || !account.client_email.ends_with(".gserviceaccount.com")
            || !account.private_key.contains("PRIVATE KEY")
        {
            return Err("FCM service account fields are invalid".into());
        }
        let http = Client::builder()
            .timeout(Duration::from_secs(12))
            .build()
            .map_err(|_| "Unable to initialize FCM client")?;
        Ok(Self {
            http,
            account,
            cached_oauth: None,
        })
    }

    async fn oauth(&mut self) -> WorkerResult<String> {
        if let Some((token, valid_until)) = &self.cached_oauth {
            if Instant::now() < *valid_until {
                return Ok(token.clone());
            }
        }
        let now = Utc::now().timestamp();
        let assertion = jsonwebtoken::encode(
            &Header::new(Algorithm::RS256),
            &OAuthClaims {
                iss: &self.account.client_email,
                scope: "https://www.googleapis.com/auth/firebase.messaging",
                aud: "https://oauth2.googleapis.com/token",
                iat: now,
                exp: now + 3600,
            },
            &EncodingKey::from_rsa_pem(self.account.private_key.as_bytes())?,
        )?;
        let response = self
            .http
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", assertion.as_str()),
            ])
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(format!("FCM OAuth refused request: {}", response.status()).into());
        }
        let token: OAuthToken = response.json().await?;
        if token.access_token.is_empty() {
            return Err("FCM OAuth returned no token".into());
        }
        let lifetime = token.expires_in.saturating_sub(120).max(30);
        self.cached_oauth = Some((
            token.access_token.clone(),
            Instant::now() + Duration::from_secs(lifetime),
        ));
        Ok(token.access_token)
    }

    fn fcm_payload(
        event: &str,
        token: &str,
        title: &str,
        body: &str,
        reference: &str,
    ) -> Option<Value> {
        let (channel_id, sound) = channel_for(event)?;
        Some(json!({
            "message": {
                "token": token,
                "notification": { "title": title, "body": body },
                "data": { "route": "/notifications", "event": event, "reference_id": reference },
                "android": {
                    "priority": "HIGH",
                    "notification": { "channel_id": channel_id, "sound": sound }
                }
            }
        }))
    }

    /// Durable queue, concurrent-worker-safe claims, finite retry and late authorization.
    /// Retries may redeliver after a process crash; consumers should not create a
    /// second in-app notification when an FCM message arrives.
    pub async fn tick(&mut self, db: &PgPool) -> WorkerResult<usize> {
        let due: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM notification_push_outbox
             WHERE status IN ('pending','processing') AND next_attempt_at <= NOW() AND attempts < 8"
        ).fetch_one(db).await?;
        if due == 0 {
            return Ok(0);
        }
        // Obtain a provider token before claiming any row so transient credential
        // failures do not consume attempts or strand otherwise deliverable alerts.
        let oauth = self.oauth().await?;
        let ids: Vec<(i64,)> = sqlx::query_as(
            "WITH claim AS (
               SELECT id FROM notification_push_outbox
               WHERE status IN ('pending','processing') AND next_attempt_at <= NOW() AND attempts < 8
               ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED
             )
             UPDATE notification_push_outbox q
                SET status='processing', attempts=attempts+1,
                    next_attempt_at=NOW()+INTERVAL '2 minutes'
               FROM claim WHERE q.id=claim.id RETURNING q.id"
        ).fetch_all(db).await?;
        let url = format!(
            "https://fcm.googleapis.com/v1/projects/{}/messages:send",
            self.account.project_id
        );
        for (id,) in &ids {
            let row = sqlx::query(
                "SELECT n.title, n.body, n.notification_type, COALESCE(n.reference_id,'') AS reference_id,
                        q.device_token,
                        (u.is_active AND EXISTS(
                            SELECT 1 FROM device_push_tokens t
                            WHERE t.user_id=n.user_id AND t.platform='android' AND t.token=q.device_token
                        ) AND (
                           (n.notification_type='new_order' AND EXISTS (
                              SELECT 1 FROM orders o JOIN rmc_plants p ON p.id=o.plant_id
                               WHERE o.id::text=n.reference_id AND p.is_active
                                 AND p.owner_id=n.user_id AND u.role IN ('owner','plant_owner')
                           ))
                           OR (n.notification_type='new_order_staff' AND EXISTS (
                              SELECT 1 FROM orders o JOIN rmc_plants p ON p.id=o.plant_id
                              JOIN plant_staff ps ON ps.plant_id=p.id
                              JOIN plant_staff_module_permissions perm
                                ON perm.plant_id=ps.plant_id AND perm.user_id=ps.user_id
                               AND perm.module_key='dispatch_queue' AND perm.can_view
                               WHERE o.id::text=n.reference_id AND p.is_active
                                AND ps.user_id=n.user_id AND ps.is_active
                                AND ps.role=u.role
                                AND ps.role IN ('admin','dispatcher','operator','supervisor','fleet_manager')
                           ))
                           OR (n.notification_type='trip_assigned' AND u.role='driver' AND EXISTS (
                              SELECT 1 FROM order_loads l JOIN orders o ON o.id=l.order_id
                              JOIN rmc_plants p ON p.id=o.plant_id
                              WHERE l.id::text=n.reference_id AND l.driver_id=n.user_id AND p.is_active
                           ))
                        )) AS eligible
                 FROM notification_push_outbox q JOIN notifications n ON n.id=q.notification_id
                 JOIN users u ON u.id=n.user_id WHERE q.id=$1"
            ).bind(id).fetch_optional(db).await?;
            let Some(row) = row else { continue };
            if !row.get::<bool, _>("eligible") {
                sqlx::query("UPDATE notification_push_outbox SET status='cancelled',last_error='authorization changed' WHERE id=$1")
                    .bind(id).execute(db).await?;
                continue;
            }
            let event: String = row.get("notification_type");
            let payload = Self::fcm_payload(
                &event,
                row.get::<&str, _>("device_token"),
                row.get::<&str, _>("title"),
                row.get::<&str, _>("body"),
                row.get::<&str, _>("reference_id"),
            );
            let Some(payload) = payload else {
                sqlx::query("UPDATE notification_push_outbox SET status='cancelled',last_error='unrecognized event' WHERE id=$1")
                    .bind(id).execute(db).await?;
                continue;
            };
            let response = self
                .http
                .post(&url)
                .bearer_auth(&oauth)
                .json(&payload)
                .send()
                .await;
            match response {
                Ok(result) if result.status().is_success() => {
                    sqlx::query("UPDATE notification_push_outbox SET status='sent', delivered_at=NOW(),last_error=NULL WHERE id=$1")
                        .bind(id).execute(db).await?;
                }
                result => {
                    let reason = match &result {
                        Ok(result) => format!("FCM HTTP {}", result.status().as_u16()),
                        Err(_) => "FCM network failure".to_string(),
                    };
                    let temporary = match &result {
                        Ok(result) => {
                            result.status() == StatusCode::TOO_MANY_REQUESTS
                                || result.status().is_server_error()
                        }
                        Err(_) => true,
                    };
                    let attempts: i32 = sqlx::query_scalar(
                        "SELECT attempts FROM notification_push_outbox WHERE id=$1",
                    )
                    .bind(id)
                    .fetch_one(db)
                    .await?;
                    let retry = temporary && attempts < 8;
                    // If a response is unequivocally permanent, leave the token
                    // registered until explicit provider invalid-token handling.
                    let secs =
                        (10_i32.saturating_mul(2_i32.pow((attempts as u32).min(6)))).min(900);
                    sqlx::query(
                        "UPDATE notification_push_outbox SET
                         status=CASE WHEN $2 THEN 'pending' ELSE 'failed' END,
                         next_attempt_at=NOW()+($3::int * INTERVAL '1 second'),
                         last_error=$4 WHERE id=$1",
                    )
                    .bind(id)
                    .bind(retry)
                    .bind(secs)
                    .bind(reason)
                    .execute(db)
                    .await?;
                }
            }
        }
        Ok(ids.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_known_events_have_audio_channels() {
        assert_eq!(
            channel_for("new_order"),
            Some((LOUD_CHANNEL, "trackmyrmc_loud"))
        );
        assert_eq!(
            channel_for("new_order_staff"),
            Some((STANDARD_CHANNEL, "trackmyrmc_standard"))
        );
        assert_eq!(
            channel_for("trip_assigned"),
            Some((LOUD_CHANNEL, "trackmyrmc_loud"))
        );
        assert_eq!(channel_for("support_followup"), None);
        assert_eq!(channel_for("delivered"), None);
    }
    #[test]
    fn payload_routes_to_authenticated_notification_feed() {
        let value =
            PushDeliveryWorker::fcm_payload("trip_assigned", "device", "Trip", "Assigned", "load")
                .unwrap();
        assert_eq!(
            value["message"]["android"]["notification"]["channel_id"],
            LOUD_CHANNEL
        );
        assert_eq!(value["message"]["data"]["route"], "/notifications");
        assert_eq!(value["message"]["data"]["reference_id"], "load");
    }
}
