use crate::{
    error::AppError,
    routes::{customer_routes::CustomerRfqPayload, finance_ops_routes::RespondRfqPayload},
    state::AppState,
};
use bigdecimal::BigDecimal;
use chrono::{NaiveDate, Utc};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

fn decimal(value: f64, label: &str) -> Result<BigDecimal, AppError> {
    if !value.is_finite()
        || value < 0.0
        || value > 1_000_000_000.0
        || (value * 100.0 - (value * 100.0).round()).abs() > 0.00001
    {
        return Err(AppError::BadRequest(format!(
            "{label} must be nonnegative and have at most two decimal places"
        )));
    }
    format!("{value:.2}")
        .parse()
        .map_err(|_| AppError::BadRequest(format!("Invalid {label}")))
}

pub async fn request(
    state: &AppState,
    customer: Uuid,
    payload: CustomerRfqPayload,
) -> Result<Uuid, AppError> {
    let quantity = payload
        .quantity_m3
        .or(payload.quantity)
        .ok_or_else(|| AppError::BadRequest("Quantity is required".into()))?;
    let quantity = decimal(quantity, "Quantity")?;
    if quantity <= BigDecimal::from(0) || quantity > BigDecimal::from(10000) {
        return Err(AppError::BadRequest(
            "Quantity must be greater than zero and at most 10000".into(),
        ));
    }
    let required = payload
        .required_date
        .as_deref()
        .map(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d"))
        .transpose()
        .map_err(|_| AppError::BadRequest("Invalid required date".into()))?
        .unwrap_or_else(|| Utc::now().date_naive() + chrono::Duration::days(1));
    if required < Utc::now().date_naive() {
        return Err(AppError::BadRequest(
            "Required date cannot be in the past".into(),
        ));
    }
    let grade = super::customer_order::canonical_grade(&payload.grade);
    if ![
        "M10", "M15", "M20", "M25", "M30", "M35", "M40", "M45", "M50", "M55", "M60",
    ]
    .contains(&grade.strip_suffix("PILE").unwrap_or(&grade))
    {
        return Err(AppError::BadRequest("Unsupported grade".into()));
    }
    if payload.notes.as_ref().is_some_and(|s| s.len() > 2000) {
        return Err(AppError::BadRequest("Notes are too long".into()));
    }
    let mut tx = state.db.begin().await?;
    let available:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM rmc_plants p WHERE id=$1 AND is_active AND EXISTS(SELECT 1 FROM plant_listing_requests r WHERE r.plant_id=p.id AND status='APPROVED'))").bind(payload.plant_id).fetch_one(&mut *tx).await?;
    if !available {
        return Err(AppError::Conflict(
            "Plant is not available for quotations".into(),
        ));
    }
    let site = if let Some(id) = payload.site_id {
        let own: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM customer_sites WHERE id=$1 AND customer_id=$2)",
        )
        .bind(id)
        .bind(customer)
        .fetch_one(&mut *tx)
        .await?;
        if !own {
            return Err(AppError::Forbidden(
                "Saved site does not belong to this customer".into(),
            ));
        }
        id
    } else {
        let name = payload
            .site_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.len() <= 160)
            .ok_or_else(|| AppError::BadRequest("Site name is required".into()))?;
        let address = payload
            .site_address
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.len() <= 500)
            .ok_or_else(|| AppError::BadRequest("Site address is required".into()))?;
        sqlx::query_scalar("INSERT INTO customer_sites(customer_id,name,address_line,city,state,pincode,contact_person,contact_phone) SELECT id,$2,$3,'','','',full_name,COALESCE(phone,'') FROM users WHERE id=$1 RETURNING id")
            .bind(customer).bind(name).bind(address).fetch_one(&mut *tx).await?
    };
    let id=sqlx::query_scalar("INSERT INTO customer_quotation_requests(customer_id,plant_id,site_id,grade,quantity_m3,required_date,notes,pump_required) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id")
        .bind(customer).bind(payload.plant_id).bind(site).bind(grade).bind(quantity).bind(required).bind(payload.notes).bind(payload.pump_required.unwrap_or(false)).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'quotation.request','rfq',$2,$3)").bind(customer).bind(format!("{id}")).bind(json!({"plant_id":payload.plant_id})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(id)
}

pub async fn respond(
    state: &AppState,
    actor: Uuid,
    plant: Uuid,
    request: Uuid,
    payload: RespondRfqPayload,
) -> Result<Value, AppError> {
    if !matches!(payload.action.as_str(), "SEND" | "DECLINE") {
        return Err(AppError::BadRequest(
            "Action must be SEND or DECLINE".into(),
        ));
    }
    if payload.notes.as_ref().is_some_and(|s| s.len() > 2000)
        || payload
            .decline_reason
            .as_ref()
            .is_some_and(|s| s.len() > 2000)
    {
        return Err(AppError::BadRequest("Response notes are too long".into()));
    }
    let intent = serde_json::to_value(&payload)
        .map_err(|_| AppError::BadRequest("Invalid response".into()))?;
    let mut tx = state.db.begin().await?;
    let row=sqlx::query("SELECT r.*,u.full_name,COALESCE(u.phone,'') AS phone,s.name AS site_name,s.address_line FROM customer_quotation_requests r JOIN users u ON u.id=r.customer_id LEFT JOIN customer_sites s ON s.id=r.site_id AND s.customer_id=r.customer_id WHERE r.id=$1 AND r.plant_id=$2 FOR UPDATE OF r")
        .bind(request).bind(plant).fetch_optional(&mut *tx).await?.ok_or_else(||AppError::NotFound("RFQ not found".into()))?;
    let status: String = row.get("status");
    if status != "PENDING" {
        if row.get::<Option<Value>, _>("response_payload") != Some(intent) {
            return Err(AppError::Conflict(
                "RFQ already has an immutable response".into(),
            ));
        }
        let quote:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'quotation_number',quotation_number,'total_amount',total_amount::DOUBLE PRECISION) FROM plant_quotations WHERE request_id=$1 ORDER BY created_at LIMIT 1").bind(request).fetch_optional(&mut *tx).await?;
        return Ok(
            json!({"success":true,"status":status,"quotation":quote,"idempotent_replay":true}),
        );
    }
    let quote = if payload.action == "SEND" {
        let existing: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plant_quotations WHERE request_id=$1)")
                .bind(request)
                .fetch_one(&mut *tx)
                .await?;
        if existing {
            return Err(AppError::Conflict(
                "Existing RFQ quotation requires reconciliation".into(),
            ));
        }
        let rate = decimal(
            payload
                .rate_per_m3
                .ok_or_else(|| AppError::BadRequest("Rate is required".into()))?,
            "Rate",
        )?;
        let gst = decimal(payload.gst_rate.unwrap_or(18.0), "GST rate")?;
        let transport = decimal(payload.transport_amount.unwrap_or(0.0), "Transport")?;
        let pump = decimal(payload.pumping_amount.unwrap_or(0.0), "Pumping")?;
        if rate <= BigDecimal::from(0) || gst > BigDecimal::from(100) {
            return Err(AppError::BadRequest(
                "Rate must be positive and GST at most 100 percent".into(),
            ));
        }
        let valid = payload
            .valid_until
            .as_deref()
            .map(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d"))
            .transpose()
            .map_err(|_| AppError::BadRequest("Invalid valid-until date".into()))?
            .unwrap_or_else(|| Utc::now().date_naive() + chrono::Duration::days(1));
        if valid < Utc::now().date_naive() {
            return Err(AppError::BadRequest(
                "Quotation cannot already be expired".into(),
            ));
        }
        let quantity: BigDecimal = row.get("quantity_m3");
        let subtotal = (&quantity * &rate + &transport + &pump).round(2);
        let tax = (&subtotal * &gst / BigDecimal::from(100)).round(2);
        let total = &subtotal + tax;
        if total
            > "9999999999.99"
                .parse::<BigDecimal>()
                .expect("numeric bound")
        {
            return Err(AppError::BadRequest(
                "Quotation total exceeds supported bounds".into(),
            ));
        }
        let name: Option<String> = row.get("site_name");
        let address: Option<String> = row.get("address_line");
        let (name, address) = name
            .zip(address)
            .ok_or_else(|| AppError::Conflict("RFQ site details require correction".into()))?;
        let number = format!("QT-{}", Uuid::new_v4().simple());
        let id:Uuid=sqlx::query_scalar("INSERT INTO plant_quotations(plant_id,quotation_number,request_id,customer_id,customer_name,customer_mobile,site_name,site_address,grade,quantity_m3,rate_per_m3,gst_rate,transport_amount,pumping_amount,total_amount,valid_until,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id")
            .bind(plant).bind(&number).bind(request).bind(row.get::<Uuid,_>("customer_id")).bind(row.get::<String,_>("full_name")).bind(row.get::<String,_>("phone")).bind(name).bind(address).bind(row.get::<String,_>("grade")).bind(quantity).bind(rate).bind(gst).bind(transport).bind(pump).bind(&total).bind(valid).bind(&payload.notes).fetch_one(&mut *tx).await?;
        Some(json!({"id":id,"quotation_number":number,"total_amount":total}))
    } else {
        if payload
            .decline_reason
            .as_ref()
            .is_none_or(|s| s.trim().is_empty())
        {
            return Err(AppError::BadRequest("Decline reason is required".into()));
        }
        None
    };
    let status = if payload.action == "SEND" {
        "QUOTED"
    } else {
        "DECLINED"
    };
    sqlx::query("UPDATE customer_quotation_requests SET status=$2,decline_reason=$3,response_payload=$4,updated_at=NOW() WHERE id=$1").bind(request).bind(status).bind(payload.decline_reason).bind(intent).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'quotation.respond','rfq',$2,$3)").bind(actor).bind(request.to_string()).bind(json!({"status":status,"quotation":quote})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(json!({"success":true,"status":status,"quotation":quote}))
}
