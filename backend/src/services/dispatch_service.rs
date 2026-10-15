use crate::{
    error::AppError,
    models::{
        challan::{Challan, ProofOfDelivery, SignChallanRequest, SubmitPodRequest},
        order::OrderLoad,
    },
    repositories::dispatch_repo,
    state::AppState,
};
use uuid::Uuid;

async fn ensure_driver_owns_load(
    state: &AppState,
    load_id: Uuid,
    driver_id: Uuid,
) -> Result<(), AppError> {
    let owns: (bool,) =
        sqlx::query_as("SELECT EXISTS(SELECT 1 FROM order_loads WHERE id = $1 AND driver_id = $2)")
            .bind(load_id)
            .bind(driver_id)
            .fetch_one(&state.db)
            .await?;
    if !owns.0 {
        return Err(AppError::Forbidden(
            "This load is not assigned to the authenticated driver".to_string(),
        ));
    }
    Ok(())
}

pub async fn complete_delivery_pod(
    state: &AppState,
    load_id: Uuid,
    driver_id: Uuid,
    req: SubmitPodRequest,
) -> Result<ProofOfDelivery, AppError> {
    if req.receiver_name.trim().is_empty()
        || req.receiver_name.len() > 150
        || !req.delivered_quantity.is_finite()
        || req.delivered_quantity <= 0.0
        || req
            .signature_url
            .as_deref()
            .map_or(true, |s| s.trim().is_empty())
        || req
            .photo_url
            .as_deref()
            .map_or(true, |s| s.trim().is_empty())
    {
        return Err(AppError::BadRequest(
            "Receiver, positive delivered quantity, photo and signature are required".to_string(),
        ));
    }
    let pod = dispatch_repo::record_pod(
        &state.db,
        load_id,
        driver_id,
        &req.receiver_name,
        &req.receiver_phone,
        req.signature_url.as_deref(),
        req.photo_url.as_deref(),
        req.notes.as_deref(),
        req.delivered_quantity,
    )
    .await?;
    Ok(pod)
}

pub async fn sign_digital_challan(
    state: &AppState,
    load_id: Uuid,
    driver_id: Uuid,
    req: SignChallanRequest,
) -> Result<(), AppError> {
    ensure_driver_owns_load(state, load_id, driver_id).await?;
    let load_status: Option<String> =
        sqlx::query_scalar("SELECT status FROM order_loads WHERE id = $1")
            .bind(load_id)
            .fetch_optional(&state.db)
            .await?;
    if !matches!(
        load_status.as_deref(),
        Some("dispatched") | Some("en_route") | Some("arrived") | Some("pouring")
    ) {
        return Err(AppError::BadRequest(
            "Challan can only be signed for an active delivery".to_string(),
        ));
    }
    let challan = dispatch_repo::get_challan_by_load(&state.db, load_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Challan not found for this load".to_string()))?;

    sqlx::query(
        r#"
        UPDATE challans
        SET digital_signature = $1,
            receiver_name = $2,
            receiver_phone = $3,
            status = 'signed'
        WHERE id = $4
        "#,
    )
    .bind(&req.digital_signature)
    .bind(&req.receiver_name)
    .bind(&req.receiver_phone)
    .bind(challan.id)
    .execute(&state.db)
    .await?;

    Ok(())
}
