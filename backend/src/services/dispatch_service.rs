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

pub async fn complete_delivery_pod(
    state: &AppState,
    load_id: Uuid,
    req: SubmitPodRequest,
) -> Result<ProofOfDelivery, AppError> {
    let pod = dispatch_repo::record_pod(
        &state.db,
        load_id,
        &req.receiver_name,
        &req.receiver_phone,
        req.signature_url.as_deref(),
        req.photo_url.as_deref(),
        req.notes.as_deref(),
    )
    .await?;

    Ok(pod)
}

pub async fn sign_digital_challan(
    state: &AppState,
    load_id: Uuid,
    req: SignChallanRequest,
) -> Result<(), AppError> {
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
