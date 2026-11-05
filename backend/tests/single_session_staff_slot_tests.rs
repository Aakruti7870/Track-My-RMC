//! PostgreSQL regression tests for one-login enforcement and reserved staff slots.
//! All identities and plants are synthetic. Never use production credentials.
use sqlx::PgPool;
use trackmyrmc_backend::auth::{account_sessions::issue_in_tx, jwt::verify_token};
use uuid::Uuid;

async fn make_user(db: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role)
         VALUES($1,'test-only','Session CI',$2) RETURNING id",
    )
    .bind(Uuid::new_v4().simple().to_string()[..16].to_string())
    .bind(role)
    .fetch_one(db)
    .await
    .unwrap()
}

async fn make_plant(db: &PgPool, owner: Uuid) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,
         city,state,pincode,contact_phone)
         VALUES($1,'Session CI Plant',$2,19.0,73.0,'CI','Panvel','MH','410206','000')
         RETURNING id",
    )
    .bind(owner)
    .bind(Uuid::new_v4().simple().to_string())
    .fetch_one(db)
    .await
    .unwrap()
}

#[sqlx::test]
async fn a_second_verified_session_replaces_the_first_and_stale_logout_cannot_revoke_it(
    db: PgPool,
) {
    let user = make_user(&db, "customer").await;
    let secret = "test-only-session-key-with-at-least-32-characters";

    let mut first_tx = db.begin().await.unwrap();
    let token_one = issue_in_tx(
        &mut first_tx,
        user,
        "customer",
        "919876543210",
        None,
        secret,
        1,
    )
    .await
    .unwrap();
    first_tx.commit().await.unwrap();

    let mut second_tx = db.begin().await.unwrap();
    let token_two = issue_in_tx(
        &mut second_tx,
        user,
        "customer",
        "919876543210",
        None,
        secret,
        1,
    )
    .await
    .unwrap();
    second_tx.commit().await.unwrap();

    let jti_one = verify_token(&token_one, secret).unwrap().jti.unwrap();
    let jti_two = verify_token(&token_two, secret).unwrap().jti.unwrap();
    assert_ne!(jti_one, jti_two);

    let stored: Option<Uuid> =
        sqlx::query_scalar("SELECT active_session_jti FROM users WHERE id=$1")
            .bind(user)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(stored, Some(jti_two));

    // Session one can no longer match the authoritative session identifier.
    let obsolete_logout = sqlx::query(
        "UPDATE users SET active_session_jti=NULL WHERE id=$1 AND active_session_jti=$2",
    )
    .bind(user)
    .bind(jti_one)
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(obsolete_logout.rows_affected(), 0);
    let remaining: Option<Uuid> =
        sqlx::query_scalar("SELECT active_session_jti FROM users WHERE id=$1")
            .bind(user)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(remaining, Some(jti_two));
}

#[sqlx::test]
async fn a_suspended_staff_member_keeps_the_only_role_slot_until_removal(db: PgPool) {
    let owner = make_user(&db, "owner").await;
    let first = make_user(&db, "supervisor").await;
    let second = make_user(&db, "supervisor").await;
    let plant = make_plant(&db, owner).await;

    sqlx::query(
        "INSERT INTO plant_staff(plant_id,user_id,role,is_active)
         VALUES($1,$2,'supervisor',TRUE)",
    )
    .bind(plant)
    .bind(first)
    .execute(&db)
    .await
    .unwrap();

    let competing = sqlx::query(
        "INSERT INTO plant_staff(plant_id,user_id,role,is_active)
         VALUES($1,$2,'supervisor',TRUE)",
    )
    .bind(plant)
    .bind(second)
    .execute(&db)
    .await
    .unwrap_err();
    assert_eq!(
        competing.as_database_error().and_then(|e| e.constraint()),
        Some("ux_plant_staff_reserved_role")
    );

    sqlx::query("UPDATE plant_staff SET is_active=FALSE WHERE plant_id=$1 AND user_id=$2")
        .bind(plant)
        .bind(first)
        .execute(&db)
        .await
        .unwrap();

    // A suspension is not deletion and cannot free the occupied role.
    let suspended_conflict = sqlx::query(
        "INSERT INTO plant_staff(plant_id,user_id,role,is_active)
         VALUES($1,$2,'supervisor',TRUE)",
    )
    .bind(plant)
    .bind(second)
    .execute(&db)
    .await
    .unwrap_err();
    assert_eq!(
        suspended_conflict
            .as_database_error()
            .and_then(|e| e.constraint()),
        Some("ux_plant_staff_reserved_role")
    );

    sqlx::query(
        "UPDATE plant_staff
         SET removed_at=clock_timestamp(), removed_by=$3
         WHERE plant_id=$1 AND user_id=$2 AND is_active=FALSE",
    )
    .bind(plant)
    .bind(first)
    .bind(owner)
    .execute(&db)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO plant_staff(plant_id,user_id,role,is_active)
         VALUES($1,$2,'supervisor',TRUE)",
    )
    .bind(plant)
    .bind(second)
    .execute(&db)
    .await
    .unwrap();

    let occupied: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plant_staff
         WHERE plant_id=$1 AND role='supervisor' AND removed_at IS NULL",
    )
    .bind(plant)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(occupied, 1);
}
