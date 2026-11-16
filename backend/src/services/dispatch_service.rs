use crate::{
    error::AppError,
    models::challan::{ProofOfDelivery, SignChallanRequest, SubmitPodRequest},
    repositories::dispatch_repo,
    state::AppState,
};
use uuid::Uuid;

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
            .is_none_or(|s| s.trim().is_empty())
        || req.photo_url.as_deref().is_none_or(|s| s.trim().is_empty())
    {
        return Err(AppError::BadRequest(
            "Receiver, positive delivered quantity, photo and signature are required".to_string(),
        ));
    }
    let pod = dispatch_repo::record_pod(
        &state.db,
        crate::repositories::dispatch_repo::PodEvidence {
            load_id,
            driver_id,
            receiver_name: &req.receiver_name,
            receiver_phone: &req.receiver_phone,
            signature_url: req.signature_url.as_deref(),
            photo_url: req.photo_url.as_deref(),
            notes: req.notes.as_deref(),
            delivered_quantity: req.delivered_quantity,
        },
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
    let signature = req.digital_signature.trim();
    let receiver = req.receiver_name.trim();
    let phone = req.receiver_phone.trim();
    if signature.is_empty()
        || signature.len() > 65_536
        || receiver.is_empty()
        || receiver.chars().count() > 150
        || phone.chars().count() > 20
        || [signature, receiver, phone]
            .iter()
            .any(|value| value.contains('\0'))
    {
        return Err(AppError::BadRequest(
            "Invalid challan signature or receiver details".into(),
        ));
    }

    let mut tx = state.db.begin().await?;
    let load_status: String = sqlx::query_scalar(
        "SELECT status FROM order_loads WHERE id=$1 AND driver_id=$2 FOR UPDATE",
    )
    .bind(load_id)
    .bind(driver_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        AppError::Forbidden("This load is not assigned to the authenticated driver".into())
    })?;

    let (id, status, previous_signature, previous_receiver, previous_phone): (
        Uuid,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT id,status,digital_signature,receiver_name,receiver_phone
         FROM challans WHERE load_id=$1 FOR UPDATE",
    )
    .bind(load_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Challan not found for this load".into()))?;

    if status == "signed"
        || previous_signature
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        if previous_signature.as_deref().map(str::trim) == Some(signature)
            && previous_receiver.as_deref().map(str::trim) == Some(receiver)
            && previous_phone.as_deref().unwrap_or_default().trim() == phone
        {
            return Ok(());
        }
        return Err(AppError::Conflict(
            "The signed challan already has receiver details".into(),
        ));
    }
    if !matches!(
        load_status.as_str(),
        "dispatched" | "en_route" | "arrived" | "pouring"
    ) {
        return Err(AppError::BadRequest(
            "Challan can only be signed for an active delivery".into(),
        ));
    }

    sqlx::query(
        "UPDATE challans SET digital_signature=$1,receiver_name=$2,receiver_phone=$3,status='signed'
         WHERE id=$4",
    )
    .bind(signature)
    .bind(receiver)
    .bind(phone)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs (user_id,action,resource_type,resource_id,metadata)
         VALUES ($1,'challan.signed','challan',$2,$3)",
    )
    .bind(driver_id)
    .bind(id.to_string())
    .bind(serde_json::json!({"load_id":load_id}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}
