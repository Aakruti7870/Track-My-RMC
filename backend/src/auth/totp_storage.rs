use crate::error::AppError;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use sqlx::PgPool;
use std::{collections::BTreeMap, fmt, sync::Arc};
use uuid::Uuid;

const ENVELOPE: &str = "tmrmc-totp-v1";
const AAD_DOMAIN: &[u8] = b"trackmyrmc:user_totp_credentials:secret_key:v1:";

#[derive(Clone)]
pub struct TotpKeyring {
    active_id: String,
    keys: Arc<BTreeMap<String, LessSafeKey>>,
    allow_legacy_reads: bool,
}

impl fmt::Debug for TotpKeyring {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TotpKeyring").finish_non_exhaustive()
    }
}

impl TotpKeyring {
    /// Entries use id=64-hex-digits, comma-separated. The active key seals all new writes.
    pub fn parse(active_id: &str, entries: &str) -> Result<Self, String> {
        let mut keys = BTreeMap::new();
        for entry in entries.split(',') {
            let (id, encoded_key) = entry
                .split_once('=')
                .ok_or("TOTP_ENCRYPTION_KEYS must contain id=hex entries")?;
            if id.is_empty()
                || id.len() > 32
                || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
            {
                return Err("Invalid TOTP key ID".into());
            }
            let mut bytes = [0; 32];
            hex::decode_to_slice(encoded_key, &mut bytes)
                .map_err(|_| "Each TOTP key must be 32 bytes encoded as hex")?;
            let key = UnboundKey::new(&AES_256_GCM, &bytes).map_err(|_| "Invalid TOTP key")?;
            if keys.insert(id.to_string(), LessSafeKey::new(key)).is_some() {
                return Err("Duplicate TOTP key ID".into());
            }
        }
        if !keys.contains_key(active_id) {
            return Err("TOTP_ENCRYPTION_ACTIVE_KEY_ID is absent from the keyring".into());
        }
        Ok(Self {
            active_id: active_id.into(),
            keys: Arc::new(keys),
            allow_legacy_reads: false,
        })
    }

    pub fn for_test_fixtures() -> Self {
        let mut bytes = [0; 32];
        OsRng.fill_bytes(&mut bytes);
        let mut ring = Self::parse("local", &format!("local={}", hex::encode(bytes)))
            .expect("valid local key");
        // Existing test fixtures deliberately exercise plaintext credentials.
        ring.allow_legacy_reads = true;
        ring
    }

    pub fn seal(&self, user_id: Uuid, secret: &str) -> Result<String, AppError> {
        let mut nonce = [0; NONCE_LEN];
        OsRng
            .try_fill_bytes(&mut nonce)
            .map_err(|_| unavailable())?;
        let mut ciphertext = secret.as_bytes().to_vec();
        self.keys[&self.active_id]
            .seal_in_place_append_tag(
                Nonce::assume_unique_for_key(nonce),
                Aad::from(associated_data(user_id, &self.active_id)),
                &mut ciphertext,
            )
            .map_err(|_| unavailable())?;
        let mut payload = nonce.to_vec();
        payload.extend_from_slice(&ciphertext);
        Ok(format!(
            "{ENVELOPE}:{}:{}",
            self.active_id,
            URL_SAFE_NO_PAD.encode(payload)
        ))
    }

    pub(crate) fn open(&self, user_id: Uuid, stored: &str) -> Result<String, AppError> {
        if self.allow_legacy_reads && !stored.contains(':') {
            return Ok(stored.into());
        }
        self.decrypt(user_id, stored).map(|(secret, _)| secret)
    }

    fn decrypt<'a>(&self, user_id: Uuid, stored: &'a str) -> Result<(String, &'a str), AppError> {
        let (id, encoded) = stored
            .strip_prefix(ENVELOPE)
            .and_then(|value| value.strip_prefix(':'))
            .and_then(|value| value.split_once(':'))
            .ok_or_else(unavailable)?;
        let key = self.keys.get(id).ok_or_else(unavailable)?;
        let payload = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| unavailable())?;
        let (nonce, ciphertext) = payload
            .split_at_checked(NONCE_LEN)
            .ok_or_else(unavailable)?;
        let nonce = Nonce::try_assume_unique_for_key(nonce).map_err(|_| unavailable())?;
        let mut ciphertext = ciphertext.to_vec();
        let plaintext = key
            .open_in_place(
                nonce,
                Aad::from(associated_data(user_id, id)),
                &mut ciphertext,
            )
            .map_err(|_| unavailable())?;
        let secret = std::str::from_utf8(plaintext).map_err(|_| unavailable())?;
        Ok((secret.to_string(), id))
    }

    /// Upgrade pre-encryption rows and rewrap retired keys without changing MFA state.
    /// A corrupt credential or missing historical key rolls back the entire sweep.
    pub async fn migrate_credentials(&self, db: &PgPool) -> Result<(), AppError> {
        let mut tx = db.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(92742,1)")
            .execute(&mut *tx)
            .await?;
        let constraint_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM pg_constraint
             WHERE conrelid = 'user_totp_credentials'::regclass
               AND conname = 'user_totp_secret_encrypted')",
        )
        .fetch_one(&mut *tx)
        .await?;
        if !constraint_exists {
            // Existing rows are upgraded below. New or changed rows must already
            // use the encrypted format, including writes from older binaries.
            sqlx::query(
                "ALTER TABLE user_totp_credentials ADD CONSTRAINT user_totp_secret_encrypted
                 CHECK (secret_key ~ '^tmrmc-totp-v1:[A-Za-z0-9_]{1,32}:[A-Za-z0-9_-]{39,}$')
                 NOT VALID",
            )
            .execute(&mut *tx)
            .await?;
        }
        let rows: Vec<(Uuid, String)> = sqlx::query_as(
            "SELECT user_id,secret_key FROM user_totp_credentials ORDER BY user_id FOR UPDATE",
        )
        .fetch_all(&mut *tx)
        .await?;
        for (user_id, stored) in rows {
            let plaintext = if stored.contains(':') {
                let (secret, key_id) = self.decrypt(user_id, &stored)?;
                if key_id == self.active_id {
                    continue;
                }
                secret
            } else {
                if !crate::auth::totp::TotpEngine::valid_legacy_secret(&stored) {
                    return Err(unavailable());
                }
                stored
            };
            let encrypted = self.seal(user_id, &plaintext)?;
            sqlx::query("UPDATE user_totp_credentials SET secret_key=$2 WHERE user_id=$1")
                .bind(user_id)
                .bind(encrypted)
                .execute(&mut *tx)
                .await?;
        }
        if !constraint_exists {
            sqlx::query(
                "ALTER TABLE user_totp_credentials VALIDATE CONSTRAINT user_totp_secret_encrypted",
            )
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }
}

fn associated_data(user_id: Uuid, key_id: &str) -> Vec<u8> {
    [AAD_DOMAIN, user_id.as_bytes(), key_id.as_bytes()].concat()
}

fn unavailable() -> AppError {
    AppError::InternalError("Authenticator credential storage unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_is_bound_to_the_user_and_ciphertext_is_authenticated() {
        let ring = TotpKeyring::parse("first", &format!("first={}", "1f".repeat(32))).unwrap();
        let user = Uuid::new_v4();
        let seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
        let stored = ring.seal(user, seed).unwrap();
        assert_ne!(ring.seal(user, seed).unwrap(), stored);
        assert_eq!(ring.open(user, &stored).unwrap(), seed);
        assert!(ring.open(Uuid::new_v4(), &stored).is_err());
        assert!(ring.open(user, seed).is_err());
        let (header, payload) = stored.rsplit_once(':').unwrap();
        let mut bytes = URL_SAFE_NO_PAD.decode(payload).unwrap();
        bytes[NONCE_LEN] ^= 1;
        assert!(ring
            .open(user, &format!("{header}:{}", URL_SAFE_NO_PAD.encode(bytes)))
            .is_err());
    }

    #[sqlx::test]
    async fn migrate_and_rotate_without_changing_enrollment_or_recovery_state(db: PgPool) {
        use crate::auth::totp::{hash_backup_code, TotpEngine};

        let user: Uuid = sqlx::query_scalar(
            "INSERT INTO users(phone,hashed_password,full_name,role)
             VALUES('totp-migration','unused','Migration Test','owner') RETURNING id",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        let seed = TotpEngine::generate_secret();
        let recovery_hash = hash_backup_code("AB12-CD34", &seed);
        sqlx::query(
            "INSERT INTO user_totp_credentials(user_id,secret_key,is_enabled,backup_codes,last_login_totp_step)
             VALUES($1,$2,TRUE,ARRAY[$3],42)",
        )
        .bind(user)
        .bind(&seed)
        .bind(&recovery_hash)
        .execute(&db)
        .await
        .unwrap();

        let load = || async {
            sqlx::query_as::<_, (String, bool, Vec<String>, Option<i64>)>(
                "SELECT secret_key,is_enabled,backup_codes,last_login_totp_step
                 FROM user_totp_credentials WHERE user_id=$1",
            )
            .bind(user)
            .fetch_one(&db)
            .await
            .unwrap()
        };

        let first = format!("first={}", "13".repeat(32));
        let second = format!("second={}", "57".repeat(32));
        let old = TotpKeyring::parse("first", &first).unwrap();
        let old_ciphertext = {
            old.migrate_credentials(&db).await.unwrap();
            let row = load().await;
            assert!(row.0.starts_with("tmrmc-totp-v1:first:"));
            assert_eq!(old.open(user, &row.0).unwrap(), seed);
            row.0
        };

        let rejected =
            sqlx::query("UPDATE user_totp_credentials SET secret_key=$2 WHERE user_id=$1")
                .bind(user)
                .bind(&seed)
                .execute(&db)
                .await
                .unwrap_err();
        assert_eq!(
            rejected
                .as_database_error()
                .and_then(|e| e.code())
                .as_deref(),
            Some("23514")
        );
        assert_eq!(load().await.0, old_ciphertext);

        let new_only = TotpKeyring::parse("second", &second).unwrap();
        assert!(new_only.migrate_credentials(&db).await.is_err());
        assert_eq!(load().await.0, old_ciphertext);

        let rotating = TotpKeyring::parse("second", &format!("{first},{second}")).unwrap();
        rotating.migrate_credentials(&db).await.unwrap();
        let (new_ciphertext, enabled, recovery_codes, step) = load().await;
        assert!(enabled);
        assert_eq!(step, Some(42));
        assert_eq!(recovery_codes, vec![recovery_hash]);
        assert!(new_ciphertext.starts_with("tmrmc-totp-v1:second:"));
        assert_eq!(new_only.open(user, &new_ciphertext).unwrap(), seed);
        assert!(old.open(user, &new_ciphertext).is_err());
        new_only.migrate_credentials(&db).await.unwrap();
        assert_eq!(load().await.0, new_ciphertext);
    }
}
