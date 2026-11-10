//! Explicitly approved central CRM campaign sending with per-recipient consent.
 //! No automatic consent, broadcast or retry; provider IO is behind release gates.
use crate::{auth::control_center::WebAdmin,error::AppError,state::AppState};
use axum::{extract::{Path,Query,State},http::HeaderMap,Json};
use serde::Deserialize;
use serde_json::{json,Value};
use uuid::Uuid;

fn activation_enabled() -> bool {
    std::env::var("ADMIN_MARKETING_SEND_ENABLED").ok().as_deref()==Some("true")
}
fn reason(value:&str)->Result<&str,AppError>{
    let reason=value.trim();
    if !(10..=500).contains(&reason.chars().count()) ||
       reason.chars().any(char::is_control) {
        return Err(AppError::BadRequest("Provide a printable audit reason (10–500 characters)".into()));
    }
    Ok(reason)
}
fn normalized(value:&str)->Result<String,AppError>{
    let digits=value.trim().strip_prefix('+').unwrap_or(value.trim());
    if !(8..=15).contains(&digits.len())||digits.starts_with('0')||
       !digits.bytes().all(|b|b.is_ascii_digit()){
        return Err(AppError::BadRequest("Enter full +country phone in E.164 format".into()));
    }
    Ok(format!("+{digits}"))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContactFilter {pub segment_id:Uuid}
pub async fn contacts(
    State(state):State<AppState>,admin:WebAdmin,Query(query):Query<ContactFilter>,
)->Result<Json<Value>,AppError>{
    admin.require("support.manage")?;
    let rows:Vec<Value>=sqlx::query_scalar(
        "SELECT jsonb_build_object('id',c.id,'phone',c.phone_e164,'name',c.display_name,
         'consent_status',c.consent_status,'source',c.source_label,
         'consent_recorded_at',c.consent_recorded_at)
         FROM admin_marketing_memberships m
         JOIN admin_marketing_contacts c ON c.id=m.contact_id
         WHERE m.segment_id=$1 ORDER BY c.phone_e164 LIMIT 1000"
    ).bind(query.segment_id).fetch_all(&state.db).await?;
    Ok(Json(json!({"contacts":rows})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConsentInput {
    pub phone:String,
    pub status:String,
    pub evidence:String,
    pub source:String,
    pub reason:String,
}
pub async fn consent(
    State(state):State<AppState>,admin:WebAdmin,headers:HeaderMap,Json(body):Json<ConsentInput>,
)->Result<Json<Value>,AppError>{
    admin.require("support.manage")?;
    let why=reason(&body.reason)?;
    let phone=normalized(&body.phone)?;
    if !matches!(body.status.as_str(),"OPTED_IN"|"OPTED_OUT"){
        return Err(AppError::BadRequest("Consent status must be OPTED_IN or OPTED_OUT".into()));
    }
    if !matches!(body.source.as_str(),
        "customer_checkbox"|"signed_form"|"recorded_customer_request"|"whatsapp_explicit_opt_in"|"customer_opt_out"){
        return Err(AppError::BadRequest("Unrecognized consent evidence source".into()));
    }
    if !(12..=500).contains(&body.evidence.trim().chars().count()) ||
        body.evidence.chars().any(char::is_control){
        return Err(AppError::BadRequest("Document consent/opt-out evidence (12–500 characters)".into()));
    }
    if body.status=="OPTED_IN" && body.source=="customer_opt_out" {
        return Err(AppError::BadRequest("An opt-out cannot establish marketing consent".into()));
    }
    crate::routes::control_center_routes::require_recent_step_up(&state,&admin,&headers).await?;
    let mut tx=state.db.begin().await?;
    let updated=sqlx::query(
        "UPDATE admin_marketing_contacts SET consent_status=$2,
           consent_evidence=$3,source_label=$4,
           consent_recorded_at=CASE WHEN $2='OPTED_IN' THEN NOW() ELSE NULL END,
           last_changed_by=$5,updated_at=NOW() WHERE phone_e164=$1"
    ).bind(&phone).bind(&body.status).bind(body.evidence.trim()).bind(&body.source)
     .bind(admin.user_id).execute(&mut *tx).await?;
    if updated.rows_affected()!=1 {
        return Err(AppError::NotFound("Import this contact into a channel before recording consent".into()));
    }
    if body.status=="OPTED_OUT"{
        sqlx::query(
            "UPDATE admin_marketing_deliveries SET status='cancelled',updated_at=NOW()
             WHERE contact_id=(SELECT id FROM admin_marketing_contacts WHERE phone_e164=$1)
               AND status='pending'"
        ).bind(&phone).execute(&mut *tx).await?;
    }
    sqlx::query(
       "INSERT INTO audit_logs(user_id,action,resource_type,metadata)
        VALUES($1,'marketing.consent.record','marketing_contact',$2)"
    ).bind(admin.user_id).bind(json!({
      "phone_redacted":true,"status":body.status,"source":body.source,
      "evidence_stored_privately":true,"reason":why
    })).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"status":body.status})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CampaignDecision {pub reason:String}

async fn approved_meta_template(state:&AppState,name:&str)->Result<(),AppError>{
    let token=state.config.meta_whatsapp_token.as_deref()
        .filter(|v|!v.is_empty()).ok_or_else(||AppError::Forbidden("Meta token unavailable".into()))?;
    let waba=state.config.meta_whatsapp_waba_id.as_deref()
        .filter(|v|!v.is_empty() && v.bytes().all(|b|b.is_ascii_digit()))
        .ok_or_else(||AppError::Forbidden("Meta WhatsApp Business Account not configured".into()))?;
    let language=std::env::var("META_ADMIN_MARKETING_LOCALE").unwrap_or_else(|_|"en_US".into());
    let url=format!("https://graph.facebook.com/{}/{waba}/message_templates",
       state.config.meta_graph_api_version);
    let client=reqwest::Client::builder().timeout(std::time::Duration::from_secs(12))
       .build().map_err(|_|AppError::InternalError("HTTP client unavailable".into()))?;
    let response=client.get(url).bearer_auth(token)
       .query(&[("name",name),("fields","name,status,category,language"),("limit","30")])
       .send().await.map_err(|_|AppError::Forbidden("Meta template approval could not be verified".into()))?;
    if !response.status().is_success(){
       return Err(AppError::Forbidden("Cannot verify Meta marketing template approval".into()));
    }
    let data:Value=response.json().await
       .map_err(|_|AppError::Forbidden("Invalid Meta template approval response".into()))?;
    let approved=data["data"].as_array().is_some_and(|items|items.iter().any(|item|{
        item["name"].as_str()==Some(name)
            && item["status"]=="APPROVED"
            && item["category"]=="MARKETING"
            && item["language"].as_str()==Some(language.as_str())
    }));
    if !approved{
       return Err(AppError::Forbidden("Meta template must be APPROVED as MARKETING for the configured locale".into()));
    }
    Ok(())
}
pub async fn approve(
    State(state):State<AppState>,admin:WebAdmin,headers:HeaderMap,
    Path(id):Path<Uuid>,Json(body):Json<CampaignDecision>,
)->Result<Json<Value>,AppError>{
    admin.require("support.manage")?;
    let why=reason(&body.reason)?;
    let template:Option<String>=sqlx::query_scalar(
       "SELECT whatsapp_template FROM admin_marketing_campaign_drafts
        WHERE id=$1 AND status='DRAFT'"
    ).bind(id).fetch_optional(&state.db).await?;
    let template=template.ok_or_else(||AppError::Conflict("Campaign must be in DRAFT state".into()))?;
    approved_meta_template(&state,&template).await?;
    crate::routes::control_center_routes::require_recent_step_up(&state,&admin,&headers).await?;
    let mut tx=state.db.begin().await?;
    let updated=sqlx::query(
        "UPDATE admin_marketing_campaign_drafts SET status='APPROVED',
         approved_by=$2,approved_at=NOW(),approval_reason=$3
         WHERE id=$1 AND status='DRAFT'"
    ).bind(id).bind(admin.user_id).bind(why).execute(&mut *tx).await?;
    if updated.rows_affected()!=1{return Err(AppError::Conflict("Campaign state changed; refresh".into()));}
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'marketing.campaign.approved','marketing_campaign',$2,$3)"
    ).bind(admin.user_id).bind(id.to_string())
     .bind(json!({"reason":why,"meta_marketing_template_approved":true,"sent":false}))
      .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"status":"APPROVED","sent":false})))
}
pub async fn launch(
    State(state):State<AppState>,admin:WebAdmin,headers:HeaderMap,
    Path(id):Path<Uuid>,Json(body):Json<CampaignDecision>,
)->Result<Json<Value>,AppError>{
    admin.require("support.manage")?;
    if !activation_enabled(){return Err(AppError::Forbidden("Admin marketing broadcasts are not activated for this release".into()));}
    let why=reason(&body.reason)?;
    let template:Option<String>=sqlx::query_scalar(
      "SELECT whatsapp_template FROM admin_marketing_campaign_drafts
       WHERE id=$1 AND status='APPROVED'"
    ).bind(id).fetch_optional(&state.db).await?;
    let template=template.ok_or_else(||AppError::Conflict("Campaign must be approved first".into()))?;
    approved_meta_template(&state,&template).await?;
    crate::routes::control_center_routes::require_recent_step_up(&state,&admin,&headers).await?;
    let mut tx=state.db.begin().await?;
    let updated=sqlx::query(
      "UPDATE admin_marketing_campaign_drafts SET status='SENDING',launched_at=NOW()
       WHERE id=$1 AND status='APPROVED'"
    ).bind(id).execute(&mut *tx).await?;
    if updated.rows_affected()!=1{return Err(AppError::Conflict("Campaign state changed; refresh".into()));}
    let inserted=sqlx::query(
      "INSERT INTO admin_marketing_deliveries(campaign_id,contact_id,operator_id)
       SELECT $1,c.id,$2 FROM admin_marketing_campaign_drafts d
       JOIN admin_marketing_memberships m ON m.segment_id=d.segment_id
       JOIN admin_marketing_contacts c ON c.id=m.contact_id
       WHERE d.id=$1 AND c.consent_status='OPTED_IN'
         AND c.consent_evidence IS NOT NULL AND length(btrim(c.consent_evidence))>=12
         AND c.consent_recorded_at IS NOT NULL
       ON CONFLICT(campaign_id,contact_id) DO NOTHING"
    ).bind(id).bind(admin.user_id).execute(&mut *tx).await?.rows_affected();
    if inserted==0{
        return Err(AppError::BadRequest("No independently consented recipients; no send queued".into()));
    }
    sqlx::query(
       "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
        VALUES($1,'marketing.campaign.launched','marketing_campaign',$2,$3)"
    ).bind(admin.user_id).bind(id.to_string())
     .bind(json!({"queued":inserted,"reason":why,"provider_acceptance_not_assumed":true}))
      .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"queued":inserted,"status":"SENDING"})))
}
pub async fn cancel(
    State(state):State<AppState>,admin:WebAdmin,headers:HeaderMap,
    Path(id):Path<Uuid>,Json(body):Json<CampaignDecision>,
)->Result<Json<Value>,AppError>{
    admin.require("support.manage")?;
    let why=reason(&body.reason)?;
    crate::routes::control_center_routes::require_recent_step_up(&state,&admin,&headers).await?;
    let mut tx=state.db.begin().await?;
    let updated=sqlx::query(
      "UPDATE admin_marketing_campaign_drafts SET status='CANCELLED',cancelled_at=NOW()
       WHERE id=$1 AND status IN ('DRAFT','APPROVED','SENDING')"
    ).bind(id).execute(&mut *tx).await?;
    if updated.rows_affected()!=1{return Err(AppError::Conflict("Campaign is already finished/cancelled".into()));}
    sqlx::query(
      "UPDATE admin_marketing_deliveries SET status='cancelled',updated_at=NOW()
       WHERE campaign_id=$1 AND status='pending'"
    ).bind(id).execute(&mut *tx).await?;
    sqlx::query(
      "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
       VALUES($1,'marketing.campaign.cancelled','marketing_campaign',$2,$3)"
    ).bind(admin.user_id).bind(id.to_string())
     .bind(json!({"reason":why,"in_flight_delivery_may_complete":true}))
     .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"status":"CANCELLED","in_flight_may_complete":true})))
}
pub async fn mark_provider_status(
    state:&AppState,provider_id:&str,status:&str,
)->Result<(),AppError>{
    if !provider_id.starts_with("wamid.")||provider_id.len()>200
        ||!matches!(status,"sent"|"delivered"|"read"|"failed"){return Ok(());}
    sqlx::query(
        "UPDATE admin_marketing_deliveries SET status=$2,updated_at=NOW()
         WHERE provider_message_id=$1
           AND (CASE status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3
                 WHEN 'sent' THEN 2 WHEN 'accepted' THEN 1 ELSE 0 END)
            < (CASE $2 WHEN 'read' THEN 4 WHEN 'delivered' THEN 3
                 WHEN 'sent' THEN 2 WHEN 'accepted' THEN 1 ELSE 0 END)
           AND (status NOT IN ('delivered','read') OR $2 <> 'failed')"
    ).bind(provider_id).bind(status).execute(&state.db).await?;
    Ok(())
}
pub async fn tick(state:&AppState)->Result<usize,AppError>{
    if !activation_enabled(){return Ok(0);}
    let Some(token)=state.config.meta_whatsapp_token.as_deref().filter(|v|!v.is_empty())
      else {return Ok(0);};
    let Some(phone_id)=state.config.meta_whatsapp_phone_number_id.as_deref()
      .filter(|s|!s.is_empty()&&s.bytes().all(|c|c.is_ascii_digit()))
      else{return Ok(0);};
    let client=reqwest::Client::builder().timeout(std::time::Duration::from_secs(15))
      .build().map_err(|_|AppError::InternalError("HTTP client unavailable".into()))?;
    let locale=std::env::var("META_ADMIN_MARKETING_LOCALE").unwrap_or_else(|_|"en_US".into());
    let mut processed=0;
    // At most three sends per minute per backend instance. Unknown outcomes
    // remain uncertain indefinitely pending signed provider status.
    for _ in 0..3 {
      let mut tx=state.db.begin().await?;
      let row:Option<(Uuid,Uuid,String,String)>=sqlx::query_as(
        "SELECT d.id,d.campaign_id,c.phone_e164,k.whatsapp_template
         FROM admin_marketing_deliveries d
         JOIN admin_marketing_contacts c ON c.id=d.contact_id
         JOIN admin_marketing_campaign_drafts k ON k.id=d.campaign_id
         WHERE d.status='pending' AND k.status='SENDING'
          AND c.consent_status='OPTED_IN' AND c.consent_recorded_at IS NOT NULL
         ORDER BY d.created_at,d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED"
      ).fetch_optional(&mut *tx).await?;
      let Some((id,campaign_id,phone,template))=row else {tx.commit().await?;break;};
      sqlx::query(
         "UPDATE admin_marketing_deliveries SET status='uncertain',
             reserved_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='pending'"
      ).bind(id).execute(&mut *tx).await?;
      tx.commit().await?;
      // Recheck consent and cancellation after reservation before provider IO.
      let allowed:bool=sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM admin_marketing_deliveries d
         JOIN admin_marketing_contacts c ON c.id=d.contact_id
         JOIN admin_marketing_campaign_drafts k ON k.id=d.campaign_id
         WHERE d.id=$1 AND k.status='SENDING' AND c.consent_status='OPTED_IN'
           AND c.consent_evidence IS NOT NULL AND length(btrim(c.consent_evidence))>=12
           AND c.consent_recorded_at IS NOT NULL)"
      ).bind(id).fetch_one(&state.db).await?;
      if !allowed||!activation_enabled(){
        sqlx::query("UPDATE admin_marketing_deliveries SET status='cancelled',updated_at=NOW()
            WHERE id=$1 AND status='uncertain'").bind(id).execute(&state.db).await?;
        continue;
      }
      let url=format!("https://graph.facebook.com/{}/{phone_id}/messages",
         state.config.meta_graph_api_version);
      let result=client.post(url).bearer_auth(token).json(&json!({
         "messaging_product":"whatsapp","recipient_type":"individual",
         "to":phone.trim_start_matches('+'),"type":"template",
         "template":{"name":template,"language":{"code":locale}}
      })).send().await;
      let (status,message_id)=match result{
        Ok(r) if r.status().is_success()=>{
          let data:Value=r.json().await.unwrap_or(Value::Null);
          match data["messages"][0]["id"].as_str().filter(|v|v.starts_with("wamid.")&&v.len()<200){
             Some(id)=>("accepted",Some(id.to_string())),None=>("uncertain",None)
          }
        }
        Ok(r) if r.status().is_client_error()=>("failed",None),
        _=>("uncertain",None),
      };
      sqlx::query(
         "UPDATE admin_marketing_deliveries SET status=$2,provider_message_id=$3,
          updated_at=NOW() WHERE id=$1 AND status='uncertain'"
      ).bind(id).bind(status).bind(message_id).execute(&state.db).await?;
      processed+=1;
      // If all queued rows were reserved, campaign moves to finished; unknown
      // provider outcomes remain explicitly visible per delivery.
      sqlx::query(
        "UPDATE admin_marketing_campaign_drafts SET status='FINISHED'
         WHERE id=$1 AND status='SENDING' AND NOT EXISTS(
           SELECT 1 FROM admin_marketing_deliveries
           WHERE campaign_id=$1 AND status='pending')"
      ).bind(campaign_id).execute(&state.db).await?;
    }
    Ok(processed)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn phone_requires_explicit_e164_country(){
        assert_eq!(normalized("+919876543210").unwrap(),"+919876543210");
        assert!(normalized("9876543210;DROP").is_err());
        assert!(normalized("00000000000").is_err());
    }
    #[test] fn marketing_broadcast_is_opt_in_by_default(){
        // This is a gating test; no provider messages are sent by unit tests.
        assert!(!std::env::var("ADMIN_MARKETING_SEND_ENABLED").ok().as_deref().unwrap_or("").is_empty() ||
                !activation_enabled());
    }
}