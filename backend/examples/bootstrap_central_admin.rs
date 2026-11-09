//! Controlled, first-identity bootstrap. Run manually on a trusted host with a
//! verified DATABASE_URL. Never run from CI, application startup or deployment.
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use std::{
    env,
    error::Error,
    io::{self, IsTerminal},
};
use trackmyrmc_backend::{
    auth::{password, totp::TotpEngine},
    central_admin_bootstrap::{self, PRIMARY_EMAIL},
};

fn value_of(args: &[String], flag: &str) -> Result<String, Box<dyn Error>> {
    let index = args
        .iter()
        .position(|arg| arg == flag)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, format!("Missing {flag}")))?;
    Ok(args
        .get(index + 1)
        .filter(|arg| !arg.starts_with("--"))
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, flag))?
        .clone())
}

fn hash_recovery_code(code: &str, secret: &str) -> String {
    let normalized = code
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase();
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.update(normalized.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().skip(1).collect();
    if env::var_os("CI").is_some()
        || env::var_os("GITHUB_ACTIONS").is_some()
        || !args.iter().any(|a| a == "--apply")
        || !io::stdin().is_terminal()
        || !io::stdout().is_terminal()
    {
        return Err("Requires explicit --apply and a private interactive terminal; never pipe credentials or run in CI".into());
    }
    let expected_database = value_of(&args, "--expected-database")?;
    let email = value_of(&args, "--email")?.trim().to_ascii_lowercase();
    let name = value_of(&args, "--name")?.trim().to_string();
    if email != PRIMARY_EMAIL || !(2..=100).contains(&name.len()) || expected_database.is_empty() {
        return Err("Invalid identity or expected database".into());
    }

    let url = env::var("DATABASE_URL")?;
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&url)
        .await?;
    let actual_database =
        central_admin_bootstrap::verify_target_database(&pool, &expected_database).await?;
    let mut connection = pool.acquire().await?;
    if central_admin_bootstrap::pending_primary_id(&mut connection)
        .await?
        .is_none()
    {
        return Err("No pending primary Central Admin identity is available for enrollment".into());
    }
    drop(connection);
    println!("Enroll the pending Central Admin {email} in database {actual_database}.");
    let first = rpassword::prompt_password("New Central Admin password (16-128 bytes): ")?;
    let second = rpassword::prompt_password("Confirm Central Admin password: ")?;
    if first != second || !(16..=128).contains(&first.len()) {
        return Err("Password mismatch or invalid length".into());
    }
    let password_hash = password::hash_password(&first)?;
    drop(first);
    drop(second);

    let secret = TotpEngine::generate_secret();
    let recovery_codes = TotpEngine::generate_backup_codes();
    let hashed_recovery: Vec<String> = recovery_codes
        .iter()
        .map(|code| hash_recovery_code(code, &secret))
        .collect();
    println!(
        "\nConfigure this one-time secret in your authenticator on a separately protected device:"
    );
    println!("{}", TotpEngine::get_otpauth_uri(&secret, &email));
    let code = rpassword::prompt_password("Enter a current six-digit authenticator code: ")?;
    let Some(enrollment_step) = TotpEngine::verified_step(&secret, &code)? else {
        return Err("Authenticator verification failed. No account created".into());
    };

    let mut tx = pool.begin().await?;
    central_admin_bootstrap::lock_primary(&mut tx).await?;
    let user_id = central_admin_bootstrap::pending_primary_id(&mut tx)
        .await?
        .ok_or("The pending Central Admin changed before enrollment could finish")?;
    sqlx::query(
        "UPDATE users SET hashed_password=$2,full_name=$3,is_active=TRUE,
         is_verified=TRUE,updated_at=NOW() WHERE id=$1",
    )
    .bind(user_id)
    .bind(password_hash)
    .bind(&name)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO user_totp_credentials(user_id,secret_key,is_enabled,backup_codes,last_login_totp_step)
         VALUES($1,$2,TRUE,$3,$4)",
    )
    .bind(user_id)
    .bind(&secret)
    .bind(&hashed_recovery)
    .bind(enrollment_step)
    .execute(&mut *tx)
    .await?;
    // The bootstrap operator must review this fixed list before using --apply.
    let permissions = vec![
        "admin_access.manage",
        "system.view",
        "user.view",
        "plant.view",
        "order.view",
        "support.view",
        "support.reply",
        "support.manage",
        "kyc.view",
        "kyc.review",
        "audit.view",
        "session.view",
        "reviewer_access.manage",
        "plant_owners.manage",
        "owner.assign",
        "automation.manage",
        "payment.view",
        "ai.diagnose",
    ];
    sqlx::query(
        "INSERT INTO control_center_access(user_id,approved,permissions)
         VALUES($1,TRUE,$2)",
    )
    .bind(user_id)
    .bind(&permissions)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'control_center.bootstrap.first_admin','central_admin',$2,
           jsonb_build_object('database',$3,'email',$4,'method','operator_terminal_password_totp'))",
    )
    .bind(user_id)
    .bind(user_id.to_string())
    .bind(&actual_database)
    .bind(&email)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    println!("\nCentral Admin activated; secure the following single-use recovery codes OFFLINE:");
    for code in recovery_codes {
        println!("{code}");
    }
    println!("No web session was issued. Sign in at the approved web portal.");
    Ok(())
}
