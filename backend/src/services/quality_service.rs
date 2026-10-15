use crate::{
    auth::AuthUser, error::AppError, routes::staff_routes::QualityTestPayload, state::AppState,
};
use bigdecimal::BigDecimal;
use chrono::Utc;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

fn measurement(value: Option<f64>, max: f64) -> Result<Option<BigDecimal>, AppError> {
    value
        .map(|n| {
            if !n.is_finite()
                || n < 0.0
                || n > max
                || (n * 100.0 - (n * 100.0).round()).abs() > 0.000001
            {
                return Err(AppError::BadRequest(
                    "Measurements must be within range and use at most two decimal places".into(),
                ));
            }
            n.to_string()
                .parse()
                .map_err(|_| AppError::BadRequest("Invalid measurement".into()))
        })
        .transpose()
}

pub async fn record(
    state: &AppState,
    user: &AuthUser,
    mut p: QualityTestPayload,
) -> Result<Value, AppError> {
    // The reference grants recording to the Quality Engineer, with oversight kept read-only.
    if user.role != "quality_engineer" {
        return Err(AppError::Forbidden(
            "Only a Quality Engineer can record tests".into(),
        ));
    }
    if p.slump_mm
        .zip(p.slump_tested_mm)
        .is_some_and(|(a, b)| a != b)
    {
        return Err(AppError::BadRequest(
            "Conflicting slump measurements".into(),
        ));
    }
    let slump = p.slump_mm.or(p.slump_tested_mm);
    if slump.is_some_and(|n| !(0..=1000).contains(&n)) {
        return Err(AppError::BadRequest(
            "Slump must be between 0 and 1000 mm".into(),
        ));
    }
    let s7 = measurement(p.cube_7d, 1000.0)?;
    let s28 = measurement(p.cube_28d, 1000.0)?;
    let cement = measurement(p.actual_cement, 2000.0)?;
    let water = measurement(p.actual_water, 2000.0)?;
    let temperature = measurement(p.temperature_celsius, 100.0)?;
    for text in [&mut p.remarks, &mut p.visual_inspection] {
        *text = text
            .take()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty());
        if text.as_ref().is_some_and(|s| s.len() > 2000) {
            return Err(AppError::BadRequest(
                "Inspection text must be at most 2000 bytes".into(),
            ));
        }
    }
    if slump.is_none()
        && s7.is_none()
        && s28.is_none()
        && cement.is_none()
        && water.is_none()
        && temperature.is_none()
        && p.visual_inspection.is_none()
    {
        return Err(AppError::BadRequest(
            "Record at least one inspection measurement or visual observation".into(),
        ));
    }
    let result = p
        .result
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("An explicit engineer assessment is required".into()))?
        .to_uppercase();
    if !["PASS", "FAIL"].contains(&result.as_str()) {
        return Err(AppError::BadRequest(
            "Engineer assessment must be PASS or FAIL".into(),
        ));
    }
    if p.request_id
        .as_ref()
        .is_some_and(|s| s.is_empty() || s.len() > 160 || s.chars().any(char::is_control))
    {
        return Err(AppError::BadRequest("Invalid request ID".into()));
    }
    let today = Utc::now().date_naive();
    let sampled = p.sample_date.unwrap_or(today);
    let tested = p.tested_on.unwrap_or(today);
    if sampled > tested || tested > today {
        return Err(AppError::BadRequest(
            "Sample and test dates must be chronological and cannot be in the future".into(),
        ));
    }
    p.slump_mm = slump;
    p.slump_tested_mm = None;
    p.result = Some(result.clone());
    // Keep absent dates absent in the fingerprint so an exact retry is stable across midnight.
    let fingerprint =
        serde_json::to_value(&p).map_err(|_| AppError::BadRequest("Invalid inspection".into()))?;
    let mut tx = state.db.begin().await?;
    let order: Uuid =
        match p.order_id {
            Some(id) => id,
            None => sqlx::query_scalar("SELECT order_id FROM order_loads WHERE id=$1")
                .bind(p.load_id.ok_or_else(|| {
                    AppError::BadRequest("order_id or load_id is required".into())
                })?)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| AppError::NotFound("Load not found".into()))?,
        };
    let plant: Uuid = sqlx::query_scalar("SELECT plant_id FROM orders WHERE id=$1 FOR UPDATE")
        .bind(order)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Order not found".into()))?;
    let membership: Option<Uuid> = sqlx::query_scalar("SELECT s.user_id FROM plant_staff s JOIN users u ON u.id=s.user_id JOIN rmc_plants p ON p.id=s.plant_id WHERE s.plant_id=$1 AND s.user_id=$2 AND s.is_active=TRUE AND s.role='quality_engineer' AND u.is_active=TRUE AND u.role='quality_engineer' AND p.is_active=TRUE FOR SHARE OF s,u,p")
        .bind(plant).bind(user.user_id).fetch_optional(&mut *tx).await?;
    if membership.is_none() {
        return Err(AppError::Forbidden(
            "Active Quality Engineer assignment to this plant is required".into(),
        ));
    }
    if let Some(load) = p.load_id {
        let linked: Option<Uuid> =
            sqlx::query_scalar("SELECT id FROM order_loads WHERE id=$1 AND order_id=$2 FOR SHARE")
                .bind(load)
                .bind(order)
                .fetch_optional(&mut *tx)
                .await?;
        if linked.is_none() {
            return Err(AppError::BadRequest(
                "Load does not belong to this order".into(),
            ));
        }
    }
    if let Some(key) = &p.request_id {
        if let Some(old) = sqlx::query("SELECT id,result,request_payload FROM cube_tests WHERE order_id=$1 AND tested_by=$2 AND request_id=$3")
            .bind(order).bind(user.user_id).bind(key).fetch_optional(&mut *tx).await? {
            if old.get::<Option<Value>,_>("request_payload").as_ref() != Some(&fingerprint) {
                return Err(AppError::Conflict("Request ID was already used for a different inspection".into()));
            }
            return Ok(json!({"success":true,"test_id":old.get::<Uuid,_>("id"),"result":old.get::<Option<String>,_>("result"),"record_source":"ENGINEER_INSPECTION"}));
        }
    }
    let interval: Option<i32> = if s28.is_some() {
        Some(28)
    } else if s7.is_some() {
        Some(7)
    } else {
        None
    };
    let id:Uuid = sqlx::query_scalar("INSERT INTO cube_tests(order_id,load_id,slump_mm,compressive_strength_7d_mpa,compressive_strength_28d_mpa,actual_cement,actual_water,result,remarks,sample_date,test_interval_days,test_date,testing_date,expected_strength_mpa,actual_strength_mpa,passed,tested_by,record_source,temperature_celsius,visual_inspection,request_id,request_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,NULL,$5,$13,$14,'ENGINEER_INSPECTION',$15,$16,$17,$18) RETURNING id")
        .bind(order).bind(p.load_id).bind(slump).bind(s7).bind(s28).bind(cement).bind(water).bind(&result).bind(p.remarks)
        .bind(sampled).bind(interval).bind(tested).bind(result == "PASS").bind(user.user_id).bind(temperature).bind(p.visual_inspection).bind(p.request_id).bind(fingerprint)
        .fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'quality.record','order',$2,$3)")
        .bind(user.user_id).bind(order.to_string()).bind(json!({"test_id":id,"load_id":p.load_id,"result":result,"record_source":"ENGINEER_INSPECTION"}))
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(
        json!({"success":true,"test_id":id,"result":result,"record_source":"ENGINEER_INSPECTION","message":"Engineer inspection recorded"}),
    )
}
