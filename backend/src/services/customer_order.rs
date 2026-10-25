use crate::{
    error::AppError,
    models::order::{CreateOrderRequest, Order},
    state::AppState,
};
use bigdecimal::BigDecimal;
use chrono::Utc;
use serde_json::{json, Value};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

struct Validated {
    owner: Uuid,
    name: String,
    phone: String,
    site_id: Option<Uuid>,
    total: BigDecimal,
    tax: BigDecimal,
    pricing: Value,
}

pub fn canonical_grade(value: &str) -> String {
    value
        .chars()
        .filter(|c| !matches!(c, '-' | '_' | ' '))
        .flat_map(char::to_uppercase)
        .collect()
}

fn text(value: &Option<String>, max: usize, required: bool) -> Result<(), AppError> {
    if value.as_ref().is_some_and(|s| s.len() > max)
        || (required && value.as_ref().is_none_or(|s| s.trim().is_empty()))
    {
        return Err(AppError::BadRequest(
            "Missing or oversized order/site details".into(),
        ));
    }
    Ok(())
}

async fn validate(
    conn: &mut PgConnection,
    customer: Uuid,
    req: &CreateOrderRequest,
) -> Result<Validated, AppError> {
    if !req.quantity_m3.is_finite()
        || req.quantity_m3 <= 0.0
        || req.quantity_m3 > 10000.0
        || (req.quantity_m3 * 100.0 - (req.quantity_m3 * 100.0).round()).abs() > 0.00001
    {
        return Err(AppError::BadRequest(
            "Quantity must be positive, at most 10000 and have at most two decimal places".into(),
        ));
    }
    let grade = canonical_grade(&req.concrete_grade);
    let base = grade.strip_suffix("PILE").unwrap_or(&grade);
    if ![
        "M10", "M15", "M20", "M25", "M30", "M35", "M40", "M45", "M50", "M55", "M60",
    ]
    .contains(&base)
    {
        return Err(AppError::BadRequest("Unsupported concrete grade".into()));
    }
    if req.delivery_date < Utc::now().date_naive() {
        return Err(AppError::BadRequest(
            "Delivery date cannot be in the past".into(),
        ));
    }
    if !matches!(
        req.delivery_mode.as_deref().unwrap_or("DELIVERY"),
        "DELIVERY" | "ONLY_LOADING"
    ) {
        return Err(AppError::BadRequest("Unsupported delivery mode".into()));
    }
    text(&req.delivery_time_slot, 50, false)?;
    text(&req.special_instructions, 2000, false)?;
    text(&req.site_name, 160, req.site_id.is_none())?;
    text(&req.site_address, 500, req.site_id.is_none())?;
    text(&req.contact_person, 150, false)?;
    text(&req.contact_mobile, 20, false)?;
    if req.lat.is_some() != req.lng.is_some()
        || req
            .lat
            .is_some_and(|v| !v.is_finite() || !(-90.0..=90.0).contains(&v))
        || req
            .lng
            .is_some_and(|v| !v.is_finite() || !(-180.0..=180.0).contains(&v))
    {
        return Err(AppError::BadRequest(
            "Provide both valid site coordinates or neither".into(),
        ));
    }
    let user = sqlx::query("SELECT u.full_name,COALESCE(u.phone,'') AS phone,u.role,u.is_active,p.kyc_status,p.verified_name FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1")
        .bind(customer).fetch_one(&mut *conn).await?;
    if !user.get::<bool, _>("is_active") || user.get::<String, _>("role") != "customer" {
        return Err(AppError::Forbidden(
            "Only active customers may create customer orders".into(),
        ));
    }
    let name: String = user.get("full_name");
    let phone: String = user.get("phone");
    if !req.save_draft {
        let kyc: Option<String> = user.get("kyc_status");
        if !kyc.is_some_and(|s| s.eq_ignore_ascii_case("verified")) {
            return Err(AppError::Forbidden("KYC_REQUIRED".into()));
        }
        let verified: Option<String> = user.get("verified_name");
        let normalized = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
        if verified.as_deref().is_none_or(|s| {
            normalized(s).is_empty()
                || normalized(s).to_lowercase() != normalized(&name).to_lowercase()
        }) {
            return Err(AppError::Conflict("KYC_REVERIFICATION_REQUIRED".into()));
        }
        if phone.trim().is_empty() {
            return Err(AppError::Conflict("VERIFIED_MOBILE_REQUIRED".into()));
        }
    }
    let plant = sqlx::query(
        "SELECT owner_id,is_active,latitude,longitude,EXISTS(SELECT 1 FROM plant_listing_requests r WHERE r.plant_id=rmc_plants.id AND r.status='APPROVED') AS verified FROM rmc_plants WHERE id=$1 FOR SHARE",
    )
    .bind(req.plant_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| AppError::NotFound("Plant not available".into()))?;
    if !plant.get::<bool, _>("is_active") || !plant.get::<bool, _>("verified") {
        return Err(AppError::Conflict("Plant not available".into()));
    }
    let mut coordinates = req.lat.zip(req.lng);
    if let Some(id) = req.site_id {
        let site: Option<(Option<f64>,Option<f64>)> = sqlx::query_as("SELECT latitude,longitude FROM customer_sites WHERE id=$1 AND customer_id=$2 FOR SHARE")
            .bind(id).bind(customer).fetch_optional(&mut *conn).await?;
        let (lat, lng) = site.ok_or_else(|| {
            AppError::Forbidden("Saved site does not belong to this customer".into())
        })?;
        coordinates = lat.zip(lng);
    }
    let zero = BigDecimal::from(0);
    let (total, tax, pricing) = if let Some(quote) = req.quotation_id {
        let row=sqlx::query("SELECT * FROM plant_quotations WHERE id=$1 AND customer_id=$2 AND plant_id=$3 FOR UPDATE")
            .bind(quote).bind(customer).bind(req.plant_id).fetch_optional(&mut *conn).await?
            .ok_or_else(|| AppError::Conflict("Accepted quotation is not available".into()))?;
        let quantity: BigDecimal = row.get("quantity_m3");
        let requested: BigDecimal = req
            .quantity_m3
            .to_string()
            .parse()
            .map_err(|_| AppError::BadRequest("Invalid quantity".into()))?;
        if row.get::<String, _>("status") != "ACCEPTED"
            || row.get::<chrono::NaiveDate, _>("valid_until") < Utc::now().date_naive()
            || canonical_grade(&row.get::<String, _>("grade")) != grade
            || quantity != requested
        {
            return Err(AppError::Conflict(
                "Quotation must be accepted, unexpired and match order grade and quantity".into(),
            ));
        }
        let used: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM orders WHERE quotation_id=$1)")
                .bind(quote)
                .fetch_one(&mut *conn)
                .await?;
        if used {
            return Err(AppError::Conflict(
                "An order already exists for this quotation".into(),
            ));
        }
        let rate: BigDecimal = row.get("rate_per_m3");
        let gst: BigDecimal = row.get("gst_rate");
        let transport: BigDecimal = row.get("transport_amount");
        let pump: BigDecimal = row.get("pumping_amount");
        let total: BigDecimal = row.get("total_amount");
        let subtotal = &quantity * &rate + &transport + &pump;
        let tax = (&subtotal * &gst / BigDecimal::from(100)).round(2);
        if rate <= zero
            || gst < zero
            || gst > 100
            || transport < zero
            || pump < zero
            || total != (&subtotal + &tax).round(2)
        {
            return Err(AppError::Conflict(
                "Quotation financial totals require reconciliation".into(),
            ));
        }
        (
            total,
            tax,
            json!({"source":"quotation","quotation_id":quote,"quotation_number":row.get::<String,_>("quotation_number"),"rate_per_m3":rate,"gst_rate":gst,"transport_amount":transport,"pumping_amount":pump}),
        )
    } else {
        let card=sqlx::query("SELECT * FROM plant_rate_cards WHERE plant_id=$1 AND active AND UPPER(REPLACE(REPLACE(REPLACE(grade,'-',''),'_',''),' ',''))=$2 AND effective_from<=CURRENT_DATE AND (effective_to IS NULL OR effective_to>=CURRENT_DATE) ORDER BY effective_from DESC,created_at DESC,id LIMIT 1 FOR SHARE")
            .bind(req.plant_id).bind(&grade).fetch_optional(&mut *conn).await?;
        if let Some(row) = card {
            let quantity: BigDecimal = req
                .quantity_m3
                .to_string()
                .parse()
                .map_err(|_| AppError::BadRequest("Invalid quantity".into()))?;
            let rate: BigDecimal = row.get("rate_per_m3");
            let gst: BigDecimal = row.get("gst_rate");
            let transport_rate: BigDecimal = row.get("transport_rate_per_km");
            let pump_rate: BigDecimal = row.get("pumping_rate_per_m3");
            if rate <= zero || gst < zero || gst > 100 || transport_rate < zero || pump_rate < zero
            {
                return Err(AppError::Conflict(
                    "Plant rate card requires reconciliation".into(),
                ));
            }
            let loading = req.delivery_mode.as_deref() == Some("ONLY_LOADING");
            let distance = coordinates.map(|(lat, lng)| {
                crate::utils::geo::haversine_distance_km(
                    lat,
                    lng,
                    plant.get("latitude"),
                    plant.get("longitude"),
                )
            });
            if !loading && transport_rate > zero && distance.is_none() {
                return Err(AppError::Conflict(
                    "Site coordinates or an accepted transport quotation are required".into(),
                ));
            }
            let km: BigDecimal = format!("{:.6}", distance.unwrap_or(0.0))
                .parse()
                .map_err(|_| AppError::BadRequest("Invalid distance".into()))?;
            let transport = if loading {
                zero.clone()
            } else {
                (&transport_rate * &km).round(2)
            };
            let pump = if req.pump_required.unwrap_or(false) {
                (&pump_rate * &quantity).round(2)
            } else {
                zero.clone()
            };
            let subtotal = (&rate * &quantity + &transport + &pump).round(2);
            let tax = (&subtotal * &gst / BigDecimal::from(100)).round(2);
            let total = &subtotal + &tax;
            (
                total,
                tax,
                json!({"source":"rate_card","rate_card_id":row.get::<Uuid,_>("id"),"rate_per_m3":rate,"gst_rate":gst,"transport_amount":transport,"pumping_amount":pump,"distance_km":distance}),
            )
        } else if req.save_draft {
            (zero.clone(), zero, json!({"source":"unpriced_draft"}))
        } else {
            return Err(AppError::Conflict(
                "A current plant rate card or accepted quotation is required".into(),
            ));
        }
    };
    if total < 0
        || total
            > "9999999999.99"
                .parse::<BigDecimal>()
                .expect("numeric bound")
    {
        return Err(AppError::BadRequest(
            "Order total exceeds supported financial bounds".into(),
        ));
    }
    Ok(Validated {
        owner: plant.get("owner_id"),
        name,
        phone,
        site_id: req.site_id,
        total,
        tax,
        pricing,
    })
}

pub async fn preview(
    state: &AppState,
    customer: Uuid,
    req: &CreateOrderRequest,
) -> Result<Value, AppError> {
    let mut tx = state.db.begin().await?;
    let validated = validate(&mut tx, customer, req).await?;
    Ok(
        json!({"grade":req.concrete_grade,"quantity":req.quantity_m3,"delivery_date":req.delivery_date,"site_name":req.site_name,"site_id":req.site_id,"total_amount":validated.total,"tax_amount":validated.tax,"pricing":validated.pricing}),
    )
}

pub async fn place(
    state: &AppState,
    customer: Uuid,
    req: CreateOrderRequest,
) -> Result<Order, AppError> {
    place_with_preview(state, customer, req, None).await
}

pub async fn place_with_preview(
    state: &AppState,
    customer: Uuid,
    req: CreateOrderRequest,
    expected: Option<Value>,
) -> Result<Order, AppError> {
    if req
        .idempotency_key
        .as_ref()
        .is_some_and(|s| !(8..=128).contains(&s.len()) || s.trim().is_empty())
    {
        return Err(AppError::BadRequest(
            "Idempotency key must contain 8 to 128 characters".into(),
        ));
    }
    let payload =
        serde_json::to_value(&req).map_err(|_| AppError::BadRequest("Invalid order".into()))?;
    let mut tx = state.db.begin().await?;
    // One customer row serializes duplicate keys before any site/order writes.
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
        .bind(customer)
        .fetch_one(&mut *tx)
        .await?;
    if let Some(key) = &req.idempotency_key {
        if let Some(row) = sqlx::query(
            "SELECT id,request_payload FROM orders WHERE customer_id=$1 AND idempotency_key=$2",
        )
        .bind(customer)
        .bind(key)
        .fetch_optional(&mut *tx)
        .await?
        {
            if row.get::<Option<Value>, _>("request_payload") != Some(payload.clone()) {
                return Err(AppError::Conflict(
                    "Idempotency key was already used for a different order".into(),
                ));
            }
            let order = sqlx::query_as::<_, Order>("SELECT * FROM orders WHERE id=$1")
                .bind(row.get::<Uuid, _>("id"))
                .fetch_one(&mut *tx)
                .await?;
            tx.commit().await?;
            return Ok(order);
        }
    }
    let validated = validate(&mut tx, customer, &req).await?;
    if expected.as_ref().is_some_and(|p| {
        p["total_amount"] != json!(validated.total)
            || p["tax_amount"] != json!(validated.tax)
            || p["pricing"] != validated.pricing
    }) {
        return Err(AppError::Conflict(
            "Pricing changed; prepare and review the order again".into(),
        ));
    }
    let site = if let Some(id) = validated.site_id {
        id
    } else {
        sqlx::query_scalar("INSERT INTO customer_sites(customer_id,name,address_line,city,state,pincode,latitude,longitude,contact_person,contact_phone) VALUES($1,$2,$3,'','','',$4,$5,$6,$7) RETURNING id")
            .bind(customer).bind(req.site_name.as_deref().unwrap_or_default().trim()).bind(req.site_address.as_deref().unwrap_or_default().trim())
            .bind(req.lat).bind(req.lng).bind(req.contact_person.as_deref().unwrap_or(&validated.name)).bind(req.contact_mobile.as_deref().unwrap_or(&validated.phone))
            .fetch_one(&mut *tx).await?
    };
    let order=sqlx::query_as::<_,Order>("INSERT INTO orders(order_number,customer_id,plant_id,site_id,concrete_grade,total_quantity_m3,delivery_date,delivery_time_slot,pump_required,special_instructions,total_amount,tax_amount,status,idempotency_key,request_payload,quotation_id,pricing_snapshot,delivery_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *")
        .bind(format!("RMC-{}",Uuid::new_v4().simple())).bind(customer).bind(req.plant_id).bind(site).bind(&req.concrete_grade)
        .bind(req.quantity_m3.to_string().parse::<BigDecimal>().map_err(|_|AppError::BadRequest("Invalid quantity".into()))?)
        .bind(req.delivery_date).bind(req.delivery_time_slot.as_deref().unwrap_or("")).bind(req.pump_required.unwrap_or(false)).bind(&req.special_instructions)
        .bind(validated.total).bind(validated.tax).bind(if req.save_draft {"draft"} else {"pending"}).bind(&req.idempotency_key).bind(&payload).bind(req.quotation_id).bind(&validated.pricing)
        .bind(req.delivery_mode.as_deref().unwrap_or("DELIVERY")).fetch_one(&mut *tx).await?;
    if let Some(quote) = req.quotation_id {
        sqlx::query(
            "UPDATE plant_quotations SET status='ORDER_CREATED',updated_at=NOW() WHERE id=$1",
        )
        .bind(quote)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'order.create','order',$2,$3)")
        .bind(customer).bind(order.id.to_string()).bind(json!({"status":order.status,"pricing":validated.pricing})).execute(&mut *tx).await?;
    if !req.save_draft {
        sqlx::query("INSERT INTO notifications(user_id,title,body,notification_type,reference_id) VALUES($1,$2,$3,'new_order',$4)")
            .bind(validated.owner).bind(format!("New order {}",order.order_number)).bind(format!("{} ordered {} m³ of {}",validated.name,req.quantity_m3,req.concrete_grade)).bind(order.id.to_string()).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(order)
}
