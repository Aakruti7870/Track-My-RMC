use crate::{
    error::AppError,
    routes::customer_routes::{CreateReceivingRecordPayload, CubeResultPayload},
    state::AppState,
};
use chrono::{Duration, NaiveDate, NaiveTime, Utc};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

fn bounded(value: &Option<String>, max: usize) -> bool {
    value.as_ref().is_none_or(|s| s.len() <= max)
}
pub fn clock(value: &str) -> Result<NaiveTime, AppError> {
    let time = NaiveTime::parse_from_str(value, "%H:%M")
        .map_err(|_| AppError::BadRequest("Time must use HH:MM".into()))?;
    if time.format("%H:%M").to_string() != value {
        return Err(AppError::BadRequest("Time must use HH:MM".into()));
    }
    Ok(time)
}
pub fn valid_grade(value: &str) -> bool {
    let grade = super::customer_order::canonical_grade(value);
    [
        "M10", "M15", "M20", "M25", "M30", "M35", "M40", "M45", "M50", "M55", "M60",
    ]
    .contains(&grade.strip_suffix("PILE").unwrap_or(&grade))
}

pub async fn list(
    state: &AppState,
    customer: Uuid,
    record: Option<Uuid>,
    site: Option<Uuid>,
) -> Result<Vec<Value>, AppError> {
    let mut rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(r)||jsonb_build_object('site_name',s.name,'site_address',s.address_line,'order_number',o.order_number,'received_quantity_m3',r.received_quantity_m3::DOUBLE PRECISION,'observed_slump_mm',r.observed_slump_mm::DOUBLE PRECISION,'record_type','CUSTOMER_OBSERVATION','cube_test_results',COALESCE(t.results,'[]'::jsonb)) FROM customer_receiving_records r JOIN customer_sites s ON s.id=r.site_id AND s.customer_id=r.customer_id LEFT JOIN orders o ON o.id=r.order_id AND o.customer_id=r.customer_id LEFT JOIN LATERAL(SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('result_mpa',c.result_mpa::DOUBLE PRECISION,'record_type','CUSTOMER_RECORDED_LAB_RESULT','acceptance_status',NULL) ORDER BY c.sample_id,c.age_days,c.created_at) results FROM cube_test_results c WHERE c.record_id=r.id) t ON TRUE WHERE r.customer_id=$1 AND($2::UUID IS NULL OR r.id=$2) AND($3::UUID IS NULL OR r.site_id=$3) ORDER BY r.created_at DESC LIMIT 500")
        .bind(customer).bind(record).bind(site).fetch_all(&state.db).await?;
    for row in &mut rows {
        let cast = row["sample_cast_date"]
            .as_str()
            .map(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d"))
            .transpose()
            .map_err(|_| AppError::Conflict("Stored casting date requires correction".into()))?;
        let mut follow = Vec::new();
        if let Some(cast) = cast {
            row["cube_7d_date"] = json!((cast + Duration::days(7)).to_string());
            row["cube_28d_date"] = json!((cast + Duration::days(28)).to_string());
            for sample in row["cube_sample_ids"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                for age in [7, 28] {
                    let due = cast + Duration::days(age);
                    let recorded = row["cube_test_results"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .any(|r| {
                            r["sample_id"]
                                .as_str()
                                .is_some_and(|s| s.eq_ignore_ascii_case(sample))
                                && r["age_days"].as_i64() == Some(age)
                        });
                    let status = if recorded {
                        "RECORDED"
                    } else if due < Utc::now().date_naive() {
                        "OVERDUE"
                    } else if due == Utc::now().date_naive() {
                        "DUE"
                    } else {
                        "UPCOMING"
                    };
                    follow.push(
                        json!({"sample_id":sample,"age_days":age,"due_date":due,"status":status}),
                    );
                }
            }
        }
        row["pending_cube_tests"] =
            json!(follow.iter().filter(|r| r["status"] != "RECORDED").count());
        row["overdue_cube_tests"] =
            json!(follow.iter().filter(|r| r["status"] == "OVERDUE").count());
        row["cube_follow_up"] = json!(follow);
    }
    Ok(rows)
}

pub async fn create(
    state: &AppState,
    customer: Uuid,
    p: CreateReceivingRecordPayload,
) -> Result<Value, AppError> {
    if !valid_grade(&p.grade)
        || !p.received_quantity_m3.is_finite()
        || p.received_quantity_m3 <= 0.0
        || p.received_quantity_m3 > 10000.0
        || p.observed_slump_mm
            .is_some_and(|n| !n.is_finite() || !(0.0..=500.0).contains(&n))
        || !bounded(&p.challan_number, 160)
        || !bounded(&p.tm_number, 64)
        || !bounded(&p.notes, 3000)
    {
        return Err(AppError::BadRequest(
            "Invalid receiving grade, quantity, slump or field length".into(),
        ));
    }
    let times = [
        p.arrival_time.as_deref(),
        p.unloading_start_time.as_deref(),
        p.unloading_end_time.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(clock)
    .collect::<Result<Vec<_>, _>>()?;
    if times.windows(2).any(|w| w[0] > w[1]) {
        return Err(AppError::BadRequest(
            "Receiving times must be chronological".into(),
        ));
    }
    if p.sample_cast_date
        .is_some_and(|d| d > Utc::now().date_naive())
    {
        return Err(AppError::BadRequest(
            "Casting date cannot be in the future".into(),
        ));
    }
    let samples: Vec<String> = p
        .cube_sample_ids
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let unique: std::collections::HashSet<String> =
        samples.iter().map(|s| s.to_lowercase()).collect();
    if samples.len() > 12 || unique.len() != samples.len() || samples.iter().any(|s| s.len() > 160)
    {
        return Err(AppError::BadRequest(
            "Cube sample IDs must be unique and within supported limits".into(),
        ));
    }
    let checks = p
        .checklist
        .into_iter()
        .filter(|(k, _)| {
            ["challan", "tm", "seal", "time", "visual", "access"].contains(&k.as_str())
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut tx = state.db.begin().await?;
    let own: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM customer_sites WHERE id=$1 AND customer_id=$2 FOR SHARE",
    )
    .bind(p.site_id)
    .bind(customer)
    .fetch_optional(&mut *tx)
    .await?;
    if own.is_none() {
        return Err(AppError::Forbidden(
            "Saved site does not belong to this customer".into(),
        ));
    }
    if let Some(order) = p.order_id {
        let row = sqlx::query(
            "SELECT site_id,concrete_grade FROM orders WHERE id=$1 AND customer_id=$2 FOR SHARE",
        )
        .bind(order)
        .bind(customer)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Customer order not found".into()))?;
        if row.get::<Uuid, _>("site_id") != p.site_id
            || super::customer_order::canonical_grade(&row.get::<String, _>("concrete_grade"))
                != super::customer_order::canonical_grade(&p.grade)
        {
            return Err(AppError::BadRequest(
                "Receiving site and grade must match the linked order".into(),
            ));
        }
    }
    let id:Uuid=sqlx::query_scalar("INSERT INTO customer_receiving_records(customer_id,site_id,order_id,grade,received_quantity_m3,challan_number,tm_number,arrival_time,unloading_start_time,unloading_end_time,observed_slump_mm,sample_cast_date,checklist,notes,cube_sample_ids) VALUES($1,$2,$3,$4,$5::DOUBLE PRECISION::NUMERIC,$6,$7,$8,$9,$10,$11::DOUBLE PRECISION::NUMERIC,$12,$13,$14,$15) RETURNING id")
        .bind(customer).bind(p.site_id).bind(p.order_id).bind(p.grade).bind(p.received_quantity_m3).bind(p.challan_number).bind(p.tm_number).bind(p.arrival_time).bind(p.unloading_start_time).bind(p.unloading_end_time).bind(p.observed_slump_mm).bind(p.sample_cast_date).bind(json!(checks)).bind(p.notes).bind(samples).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'receiving_record.create','receiving_record',$2,$3)").bind(customer).bind(id.to_string()).bind(json!({"site_id":p.site_id,"order_id":p.order_id})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(json!({"success":true,"id":id,"record":list(state,customer,Some(id),None).await?.pop()}))
}

pub async fn cube(
    state: &AppState,
    customer: Uuid,
    record: Uuid,
    p: CubeResultPayload,
) -> Result<Value, AppError> {
    if ![7, 28].contains(&p.age_days)
        || !p.result_mpa.is_finite()
        || p.result_mpa <= 0.0
        || p.result_mpa > 250.0
        || !bounded(&p.lab_name, 240)
        || !bounded(&p.report_reference, 500)
        || !bounded(&p.notes, 2000)
    {
        return Err(AppError::BadRequest(
            "Invalid cube age, result or field length".into(),
        ));
    }
    let tested = NaiveDate::parse_from_str(&p.tested_on, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid test date".into()))?;
    if tested > Utc::now().date_naive() {
        return Err(AppError::BadRequest(
            "Test date cannot be in the future".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    let row=sqlx::query("SELECT cube_sample_ids,sample_cast_date FROM customer_receiving_records WHERE id=$1 AND customer_id=$2 FOR UPDATE").bind(record).bind(customer).fetch_optional(&mut *tx).await?.ok_or_else(||AppError::NotFound("Receiving record not found".into()))?;
    let samples: Vec<String> = row.get("cube_sample_ids");
    let sample = samples
        .into_iter()
        .find(|s| s.eq_ignore_ascii_case(p.sample_id.trim()))
        .ok_or_else(|| {
            AppError::BadRequest("Sample ID is not part of this receiving record".into())
        })?;
    if row
        .get::<Option<NaiveDate>, _>("sample_cast_date")
        .is_some_and(|d| tested < d)
    {
        return Err(AppError::BadRequest(
            "Test date cannot be before casting".into(),
        ));
    }
    let old:Vec<Uuid>=sqlx::query_scalar("SELECT id FROM cube_test_results WHERE record_id=$1 AND LOWER(sample_id)=LOWER($2) AND age_days=$3").bind(record).bind(&sample).bind(p.age_days).fetch_all(&mut *tx).await?;
    if old.len() > 1 {
        return Err(AppError::Conflict(
            "Historical duplicate sample results require reconciliation".into(),
        ));
    }
    let id = old.first().copied().unwrap_or_else(Uuid::new_v4);
    sqlx::query("INSERT INTO cube_test_results(id,record_id,sample_id,age_days,tested_on,result_mpa,lab_name,report_reference,notes,recorded_by) VALUES($1,$2,$3,$4,$5,$6::DOUBLE PRECISION::NUMERIC,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET tested_on=EXCLUDED.tested_on,result_mpa=EXCLUDED.result_mpa,lab_name=EXCLUDED.lab_name,report_reference=EXCLUDED.report_reference,notes=EXCLUDED.notes,recorded_by=EXCLUDED.recorded_by,updated_at=NOW()")
        .bind(id).bind(record).bind(&sample).bind(p.age_days).bind(tested).bind(p.result_mpa).bind(p.lab_name).bind(p.report_reference).bind(p.notes).bind(customer).execute(&mut *tx).await?;
    sqlx::query("UPDATE customer_receiving_records SET updated_at=NOW() WHERE id=$1")
        .bind(record)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'receiving_record.cube_result','receiving_record',$2,$3)").bind(customer).bind(record.to_string()).bind(json!({"sample_id":sample,"age_days":p.age_days,"result_mpa":p.result_mpa})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(
        json!({"success":true,"id":id,"record":list(state,customer,Some(record),None).await?.pop(),"disclaimer":"Recorded result only. Acceptance remains with the authorized project engineer or laboratory."}),
    )
}
