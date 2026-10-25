use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::{order::CreateOrderRequest, plant::CreateSiteRequest},
    repositories::plant_repo,
    services::order_service,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

pub async fn list_plants(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    check_role(&auth_user, &["customer"])?;
    let review_customer: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM play_review_fixtures WHERE user_id = $1 AND role = 'customer' AND enabled = TRUE)",
    )
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;
    let review_plant_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT plant_id FROM play_review_fixtures WHERE role = 'customer' AND enabled = TRUE AND plant_id IS NOT NULL",
    )
    .fetch_all(&state.db)
    .await?;
    let mut plants = plant_repo::list_plants(&state.db).await?;
    plants.retain(|plant| {
        let is_review_plant = review_plant_ids.contains(&plant.id);
        if review_customer {
            is_review_plant
        } else {
            !is_review_plant
        }
    });
    let mut result = Vec::new();
    for plant in plants {
        let grades:Vec<String>=sqlx::query_scalar("SELECT DISTINCT grade FROM plant_rate_cards WHERE plant_id=$1 AND active AND effective_from<=CURRENT_DATE AND (effective_to IS NULL OR effective_to>=CURRENT_DATE) ORDER BY grade")
            .bind(plant.id).fetch_all(&state.db).await?;
        let verified:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plant_listing_requests WHERE plant_id=$1 AND status='APPROVED')").bind(plant.id).fetch_one(&state.db).await?;
        let mut value = serde_json::to_value(&plant)
            .map_err(|_| AppError::InternalError("Plant serialization failed".into()))?;
        value["grades"] = json!(grades);
        value["verified"] = json!(verified);
        value["order_enabled"] = json!(plant.is_active && verified);
        value["status"] = json!(if plant.is_active {
            "active"
        } else {
            "inactive"
        });
        value["address"] = json!(plant.address_line);
        value["lat"] = json!(plant.latitude);
        value["lng"] = json!(plant.longitude);
        crate::routes::discovery::redact_plant_contact(&mut value, verified);
        result.push(value);
    }
    Ok(Json(json!({ "success": true, "plants": result })))
}

#[derive(Debug, Deserialize)]
pub struct ComparePlantsQuery {
    pub grade: String,
    pub quantity: f64,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    #[serde(default)]
    pub pump_required: bool,
}

pub async fn compare_plants(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(query): Query<ComparePlantsQuery>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer", "admin", "owner", "plant_owner"])?;

    if query.quantity <= 0.0 {
        return Err(AppError::BadRequest(
            "Quantity must be greater than zero".to_string(),
        ));
    }

    let rows = sqlx::query(
        r#"
        SELECT 
            p.id as plant_id,
            p.name as plant_name,
            p.city,
            p.state as district,
            p.latitude,
            p.longitude,
            rc.grade,
            CAST(rc.rate_per_m3 AS DOUBLE PRECISION) as rate_per_m3,
            CAST(rc.gst_rate AS DOUBLE PRECISION) as gst_rate,
            CAST(rc.transport_rate_per_km AS DOUBLE PRECISION) as transport_rate_per_km,
            CAST(rc.pumping_rate_per_m3 AS DOUBLE PRECISION) as pumping_rate_per_m3
        FROM plant_rate_cards rc
        JOIN rmc_plants p ON p.id = rc.plant_id
        WHERE rc.active = TRUE
          AND p.is_active = TRUE
          AND LOWER(rc.grade) = LOWER($1)
        "#,
    )
    .bind(&query.grade)
    .fetch_all(&state.db)
    .await?;

    let mut estimates = Vec::new();

    for row in rows {
        let plant_id: Uuid = row.get("plant_id");
        let plant_name: String = row.get("plant_name");
        let city: Option<String> = row.get("city");
        let district: Option<String> = row.get("district");
        let plat: f64 = row.get("latitude");
        let plng: f64 = row.get("longitude");
        let grade: String = row.get("grade");
        let rate_per_m3: f64 = row.get("rate_per_m3");
        let gst_rate: f64 = row.get("gst_rate");
        let transport_rate_per_km: f64 = row.get("transport_rate_per_km");
        let pumping_rate_per_m3: f64 = row.get("pumping_rate_per_m3");

        let distance_km = match (query.lat, query.lng) {
            (Some(ulat), Some(ulng)) => Some(crate::utils::geo::haversine_distance_km(
                ulat, ulng, plat, plng,
            )),
            _ => None,
        };

        let base_amount = (rate_per_m3 * query.quantity * 100.0).round() / 100.0;
        let transport_amount =
            distance_km.map(|d| ((transport_rate_per_km * d) * 100.0).round() / 100.0);
        let pumping_amount = if query.pump_required {
            Some(((pumping_rate_per_m3 * query.quantity) * 100.0).round() / 100.0)
        } else {
            None
        };

        let subtotal =
            base_amount + transport_amount.unwrap_or(0.0) + pumping_amount.unwrap_or(0.0);
        let gst_amount = ((subtotal * gst_rate / 100.0) * 100.0).round() / 100.0;
        let estimated_total = ((subtotal + gst_amount) * 100.0).round() / 100.0;
        let service_area_km = 50.0;
        let within_service_area = distance_km.map(|d| d <= service_area_km);

        estimates.push(json!({
            "plant_id": plant_id.to_string(),
            "plant_name": plant_name,
            "city": city,
            "district": district,
            "verified": true,
            "grade": grade,
            "rate_per_m3": rate_per_m3,
            "gst_rate": gst_rate,
            "distance_km": distance_km.map(|d| (d * 100.0).round() / 100.0),
            "service_area_km": service_area_km,
            "within_service_area": within_service_area,
            "base_amount": base_amount,
            "transport_amount": transport_amount,
            "pumping_amount": pumping_amount,
            "gst_amount": gst_amount,
            "estimated_total": estimated_total,
            "transport_included": transport_amount.is_some()
        }));
    }

    estimates.sort_by(|a, b| {
        let total_a = a["estimated_total"].as_f64().unwrap_or(f64::MAX);
        let total_b = b["estimated_total"].as_f64().unwrap_or(f64::MAX);
        total_a
            .partial_cmp(&total_b)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let count = estimates.len();
    Ok(Json(json!({
        "estimates": estimates,
        "count": count,
        "disclaimer": "Estimate only. Final price, delivery eligibility and tax invoice require plant confirmation."
    })))
}

pub async fn get_grades() -> impl IntoResponse {
    Json(json!({
        "success": true,
        "grades": ["M-10", "M-15", "M-20", "M-25", "M-30", "M-35", "M-40", "M-45"]
    }))
}

pub async fn list_sites(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    let sites = plant_repo::list_customer_sites(&state.db, auth_user.user_id).await?;
    let rows = sites
        .into_iter()
        .map(|site| {
            let mut value = json!(site);
            value["address"] = value["address_line"].clone();
            value["lat"] = value["latitude"].clone();
            value["lng"] = value["longitude"].clone();
            value["contact_mobile"] = value["contact_phone"].clone();
            value
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({"success":true,"sites":rows})))
}

/// One statement gives a consistent persisted summary without joining child
/// collections together (which would multiply quantities and counts).
pub async fn project_sites(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    let sites: Vec<serde_json::Value> = sqlx::query_scalar(
        r#"
        WITH own_sites AS (
            SELECT s.*, lower(regexp_replace(trim(s.name || ' ' || s.address_line), '\s+', ' ', 'g')) AS site_key,
                count(*) OVER (PARTITION BY lower(regexp_replace(trim(s.name || ' ' || s.address_line), '\s+', ' ', 'g'))) AS key_count
            FROM customer_sites s WHERE s.customer_id=$1
        )
        SELECT jsonb_build_object(
            'id',s.id,'name',s.name,'address',s.address_line,'lat',s.latitude,'lng',s.longitude,
            'contact_person',s.contact_person,'contact_mobile',s.contact_phone,'is_default',s.is_default,
            'orders_count',o.total,'active_orders',o.active,'delivered_orders',o.delivered,
            'ordered_m3',o.quantity,'delivered_m3',p.quantity,'delivery_quantity_source','RECORDED_POD',
            'pour_plans',(SELECT count(*) FROM customer_pour_plans pp WHERE pp.customer_id=$1 AND pp.site_id=s.id),
            'receiving_records',(SELECT count(*) FROM customer_receiving_records rr WHERE rr.customer_id=$1 AND rr.site_id=s.id),
            'pending_cube_tests',c.pending,'overdue_cube_tests',c.overdue,
            'quotation_requests',(SELECT count(*) FROM customer_quotation_requests r WHERE r.customer_id=$1 AND r.site_id=s.id),
            'official_quotations',q.total,'open_quotations',q.open,
            'upcoming_delivery',(SELECT jsonb_build_object('order_id',n.id,'order_number',n.order_number,
                'delivery_date',n.delivery_date,'delivery_time',n.delivery_time_slot,'grade',n.concrete_grade,
                'quantity',n.total_quantity_m3::double precision,'status',upper(n.status))
                FROM orders n WHERE n.customer_id=$1 AND n.site_id=s.id
                AND lower(n.status) NOT IN ('draft','delivered','rejected','cancelled')
                ORDER BY n.delivery_date,n.delivery_time_slot,n.created_at,n.id LIMIT 1),
            'latest_order',(SELECT jsonb_build_object('id',n.id,'order_number',n.order_number,'status',upper(n.status))
                FROM orders n WHERE n.customer_id=$1 AND n.site_id=s.id ORDER BY n.created_at DESC,n.id DESC LIMIT 1)
        )
        FROM own_sites s
        CROSS JOIN LATERAL (
            SELECT count(*) total,
                count(*) FILTER (WHERE lower(status) NOT IN ('draft','delivered','rejected','cancelled')) active,
                count(*) FILTER (WHERE lower(status)='delivered') delivered,
                coalesce(sum(total_quantity_m3),0)::double precision quantity
            FROM orders WHERE customer_id=$1 AND site_id=s.id
        ) o
        CROSS JOIN LATERAL (
            SELECT coalesce(sum(d.delivered_quantity),0)::double precision quantity
            FROM orders n JOIN order_loads l ON l.order_id=n.id JOIN proof_of_deliveries d ON d.load_id=l.id
            WHERE n.customer_id=$1 AND n.site_id=s.id
        ) p
        CROSS JOIN LATERAL (
            SELECT count(*) pending, count(*) FILTER (WHERE r.sample_cast_date + a.days < $2::date) overdue
            FROM customer_receiving_records r CROSS JOIN LATERAL unnest(r.cube_sample_ids) sample(id)
            CROSS JOIN (VALUES(7),(28)) a(days)
            WHERE r.customer_id=$1 AND r.site_id=s.id AND r.sample_cast_date IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM cube_test_results t WHERE t.record_id=r.id
                AND lower(t.sample_id)=lower(sample.id) AND t.age_days=a.days)
        ) c
        CROSS JOIN LATERAL (
            SELECT count(*) total, count(*) FILTER (WHERE upper(q.status) IN ('SENT','OPEN','ACCEPTED') AND q.valid_until >= $2::date) open
            FROM plant_quotations q LEFT JOIN customer_quotation_requests r ON r.id=q.request_id AND r.customer_id=$1
            WHERE q.customer_id=$1 AND (
                r.site_id=s.id OR (r.site_id IS NULL AND EXISTS(SELECT 1 FROM orders n WHERE n.quotation_id=q.id AND n.customer_id=$1 AND n.site_id=s.id))
                OR (r.site_id IS NULL AND NOT EXISTS(SELECT 1 FROM orders n WHERE n.quotation_id=q.id AND n.customer_id=$1)
                    AND s.key_count=1 AND lower(regexp_replace(trim(q.site_name || ' ' || q.site_address), '\s+', ' ', 'g'))=s.site_key)
            )
        ) q
        ORDER BY s.is_default DESC,s.created_at DESC,s.id LIMIT 500
        "#,
    )
    .bind(auth_user.user_id)
    .bind(chrono::Utc::now().date_naive())
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"sites":sites,"count":sites.len()})))
}

pub async fn create_site(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateSiteRequest>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    if req.name.trim().is_empty()
        || req.name.len() > 180
        || !(5..=1000).contains(&req.address_line.trim().len())
        || req.city.len() > 100
        || req.state.len() > 100
        || req.pincode.len() > 20
        || req.contact_person.as_ref().is_some_and(|s| s.len() > 160)
        || req.contact_phone.as_ref().is_some_and(|s| s.len() > 20)
        || req.notes.as_ref().is_some_and(|s| s.len() > 2000)
    {
        return Err(AppError::BadRequest(
            "Invalid site details or field length".into(),
        ));
    }
    if req.latitude.is_some() != req.longitude.is_some()
        || req
            .latitude
            .is_some_and(|v| !v.is_finite() || !(-90.0..=90.0).contains(&v))
        || req
            .longitude
            .is_some_and(|v| !v.is_finite() || !(-180.0..=180.0).contains(&v))
    {
        return Err(AppError::BadRequest(
            "Provide both valid coordinates or neither".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
        .bind(auth_user.user_id)
        .fetch_one(&mut *tx)
        .await?;
    if req.is_default {
        sqlx::query(
            "UPDATE customer_sites SET is_default=FALSE WHERE customer_id=$1 AND is_default",
        )
        .bind(auth_user.user_id)
        .execute(&mut *tx)
        .await?;
    }
    let site=sqlx::query_as::<_,crate::models::plant::CustomerSite>("INSERT INTO customer_sites(customer_id,name,address_line,city,state,pincode,latitude,longitude,contact_person,contact_phone,notes,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *")
        .bind(auth_user.user_id).bind(req.name.trim()).bind(req.address_line.trim()).bind(req.city).bind(req.state).bind(req.pincode).bind(req.latitude).bind(req.longitude).bind(req.contact_person.unwrap_or_default()).bind(req.contact_phone.unwrap_or_default()).bind(req.notes).bind(req.is_default).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id) VALUES($1,'site.create','site',$2)").bind(auth_user.user_id).bind(site.id.to_string()).execute(&mut *tx).await?;
    tx.commit().await?;
    let mut value = json!(site);
    value["address"] = value["address_line"].clone();
    value["contact_mobile"] = value["contact_phone"].clone();
    value["lat"] = value["latitude"].clone();
    value["lng"] = value["longitude"].clone();
    Ok(Json(json!({"success":true,"id":site.id,"site":value})))
}

pub async fn place_order(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateOrderRequest>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    let order = order_service::place_order(&state, auth_user.user_id, req).await?;
    Ok(Json(json!({
        "success": true,
        "id": order.id,
        "order_id": order.id,
        "order_number": order.order_number,
        "order": order,
    })))
}

pub async fn list_orders(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let query = format!(
        "{} WHERE o.customer_id=$1 ORDER BY o.created_at DESC LIMIT 500",
        order_service::MOBILE_ORDER_SELECT
    );
    let orders: Vec<serde_json::Value> = sqlx::query_scalar(&query)
        .bind(auth_user.user_id)
        .fetch_all(&state.db)
        .await?;
    Ok(Json(json!({"success":true,"orders":orders})))
}

pub async fn get_order_details(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(
        order_service::mobile_detail(&state, &auth_user, id).await?,
    ))
}

pub async fn get_customer_home(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    let profile:(String,String)=sqlx::query_as("SELECT u.full_name,coalesce(p.kyc_status,'unverified') FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1").bind(auth_user.user_id).fetch_one(&state.db).await?;
    let query = format!(
        "{} WHERE o.customer_id=$1 ORDER BY o.created_at DESC,o.id LIMIT 5",
        order_service::MOBILE_ORDER_SELECT
    );
    let recent: Vec<serde_json::Value> = sqlx::query_scalar(&query)
        .bind(auth_user.user_id)
        .fetch_all(&state.db)
        .await?;
    let query=format!("{} WHERE o.customer_id=$1 AND lower(o.status) NOT IN('delivered','cancelled','rejected') ORDER BY CASE WHEN EXISTS(SELECT 1 FROM order_loads l WHERE l.order_id=o.id AND lower(l.status) IN('dispatched','en_route','arrived','pouring')) THEN 0 ELSE 1 END,o.delivery_date,o.created_at,o.id LIMIT 1",order_service::MOBILE_ORDER_SELECT);
    let active: Option<serde_json::Value> = sqlx::query_scalar(&query)
        .bind(auth_user.user_id)
        .fetch_optional(&state.db)
        .await?;
    let unread: i64 =
        sqlx::query_scalar("SELECT count(*) FROM notifications WHERE user_id=$1 AND NOT is_read")
            .bind(auth_user.user_id)
            .fetch_one(&state.db)
            .await?;
    let Json(discovery) = list_plants(State(state.clone()), auth_user).await?;
    let plants: Vec<serde_json::Value> = discovery["plants"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| p["order_enabled"] == true)
        .take(6)
        .cloned()
        .collect();
    let kyc = if profile.1.eq_ignore_ascii_case("unverified") {
        "NOT_STARTED".to_string()
    } else {
        profile.1.to_uppercase()
    };
    Ok(Json(
        json!({"name":profile.0,"kyc_status":kyc,"active_order":active,"recent_orders":recent,"nearby_plants":plants,"unread_notifications":unread}),
    ))
}

pub async fn cancel_order(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    let mut tx = state.db.begin().await?;
    let order = sqlx::query("SELECT customer_id, status FROM orders WHERE id = $1 FOR UPDATE")
        .bind(order_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    let cid: Uuid = order.get("customer_id");
    let status: String = order.get("status");

    if cid != auth_user.user_id {
        return Err(AppError::Forbidden("Unauthorized".to_string()));
    }

    if !matches!(
        status.as_str(),
        "draft" | "pending" | "confirmed" | "cancelled"
    ) {
        return Err(AppError::BadRequest(
            "Cannot cancel order once production or dispatch has begun".to_string(),
        ));
    }

    if status != "cancelled" {
        sqlx::query("UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1")
            .bind(order_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query("UPDATE order_loads SET status = 'cancelled' WHERE order_id = $1")
            .bind(order_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'order.cancel','order',$2,$3)").bind(auth_user.user_id).bind(order_id.to_string()).bind(json!({"from":status,"to":"cancelled"})).execute(&mut *tx).await?;
    }
    tx.commit().await?;

    Ok(Json(
        json!({ "success": true, "message": "Order cancelled successfully" }),
    ))
}

pub async fn get_order_tracking(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let order =
        sqlx::query("SELECT o.customer_id, o.plant_id, o.site_id, o.status, s.name AS site_name, s.address_line AS site_address, s.latitude AS site_lat, s.longitude AS site_lng, p.contact_phone AS plant_phone, EXISTS(SELECT 1 FROM challans c JOIN order_loads cl ON cl.id=c.load_id WHERE cl.order_id=o.id) AS challan_available, p.name AS plant_name, p.latitude AS plant_lat, p.longitude AS plant_lng FROM orders o LEFT JOIN customer_sites s ON s.id=o.site_id LEFT JOIN rmc_plants p ON p.id=o.plant_id WHERE o.id = $1")
            .bind(order_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    let cid: Uuid = order.get("customer_id");
    let status: String = order.get("status");

    if cid != auth_user.user_id && auth_user.role != "admin" {
        return Err(AppError::Forbidden("Unauthorized".to_string()));
    }

    let active_loads = sqlx::query(
        r#"
        SELECT l.id as load_id, l.load_number, l.status, l.quantity_m3::double precision AS quantity_m3,
               l.dispatched_at, l.arrived_at, l.pour_started_at, l.pour_completed_at,
               m.registration_number, t.latitude AS last_latitude, t.longitude AS last_longitude, t.recorded_at AS last_ping_at,
               u.full_name as driver_name, u.phone as driver_phone
        FROM order_loads l
        LEFT JOIN transit_mixers m ON m.id = l.mixer_id
        LEFT JOIN users u ON u.id = l.driver_id
        LEFT JOIN LATERAL (
            SELECT latitude, longitude, recorded_at FROM gps_telemetry
            WHERE load_id=l.id AND mixer_id=l.mixer_id AND driver_id=l.driver_id
            ORDER BY recorded_at DESC LIMIT 1
        ) t ON TRUE
        WHERE l.order_id = $1
        ORDER BY l.load_number
        "#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await?;

    let tracking: Vec<_> = active_loads
        .into_iter()
        .map(|l| {
            let load_id: Uuid = l.get("load_id");
            let load_number: i32 = l.get("load_number");
            let load_status: String = l.get("status");
            let mixer_number: Option<String> = l.get("registration_number");
            let driver_name: Option<String> = l.get("driver_name");
            let driver_phone: Option<String> = l.get("driver_phone");
            let latitude: Option<f64> = l.get("last_latitude");
            let longitude: Option<f64> = l.get("last_longitude");
            let last_ping: Option<chrono::DateTime<chrono::Utc>> = l.get("last_ping_at");
            let location = match (latitude, longitude, last_ping) {
                (Some(lat),Some(lng),Some(at)) => json!({"lat":lat,"lng":lng,"at":at,"stale":(chrono::Utc::now()-at).num_seconds()>90}),
                _ => serde_json::Value::Null,
            };

            json!({
                "load_id": load_id,
                "id": load_id,
                "quantity_m3": l.get::<f64,_>("quantity_m3"),
                "load_number": load_number,
                "status": load_status,
                "mixer_number": mixer_number,
                "tm_number": mixer_number,
                "driver_name": driver_name,
                "driver_phone": driver_phone,
                "driver_mobile": driver_phone,
                "location": location,
                "milestones": {
                    "dispatched_at":l.get::<Option<chrono::DateTime<chrono::Utc>>,_>("dispatched_at"),
                    "arrived_at":l.get::<Option<chrono::DateTime<chrono::Utc>>,_>("arrived_at"),
                    "pour_started_at":l.get::<Option<chrono::DateTime<chrono::Utc>>,_>("pour_started_at"),
                    "pour_completed_at":l.get::<Option<chrono::DateTime<chrono::Utc>>,_>("pour_completed_at")
                },
                "latitude": latitude,
                "longitude": longitude,
                "last_ping_at": last_ping
            })
        })
        .collect();

    let active_loads: Vec<_> = tracking
        .iter()
        .filter(|l| {
            matches!(
                l["status"].as_str(),
                Some("dispatched" | "en_route" | "arrived" | "pouring")
            )
        })
        .cloned()
        .collect();
    Ok(Json(json!({
        "success":true,"order_status":status,"status":status.to_uppercase(),"order_id":order_id,
        "active":!active_loads.is_empty(),"loads":tracking,"active_loads":active_loads,
        "location":null,"route":null,
        "plant_phone":order.get::<Option<String>,_>("plant_phone"),
        "challan_available":order.get::<bool,_>("challan_available"),
        "destination":{"site_name":order.get::<Option<String>,_>("site_name").unwrap_or_else(||"Delivery site".into()),"address":order.get::<Option<String>,_>("site_address"),"lat":order.get::<Option<f64>,_>("site_lat"),"lng":order.get::<Option<f64>,_>("site_lng")},
        "origin":{"name":order.get::<Option<String>,_>("plant_name"),"lat":order.get::<Option<f64>,_>("plant_lat"),"lng":order.get::<Option<f64>,_>("plant_lng")}
    })))
}

pub async fn get_order_challan(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let order_customer: Uuid = sqlx::query_scalar("SELECT customer_id FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    if order_customer != auth_user.user_id && auth_user.role != "admin" {
        return Err(AppError::Forbidden("Unauthorized".to_string()));
    }

    let challan = sqlx::query(
        r#"
        SELECT c.id, c.challan_number, c.plant_code, c.customer_name, c.site_address,
               c.concrete_grade, c.quantity_m3, c.slump_mm, c.water_cement_ratio,
               c.batch_time, c.mixer_number, c.driver_name, c.digital_signature,
               c.status, c.created_at
        FROM challans c
        INNER JOIN order_loads l ON l.id = c.load_id
        WHERE l.order_id = $1
        ORDER BY c.created_at DESC
        LIMIT 1
        "#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Challan not yet generated for this order".to_string()))?;

    let cid: Uuid = challan.get("id");
    let cnum: String = challan.get("challan_number");
    let pcode: String = challan.get("plant_code");
    let cname: String = challan.get("customer_name");
    let saddr: String = challan.get("site_address");
    let grade: String = challan.get("concrete_grade");
    let qty: bigdecimal::BigDecimal = challan.get("quantity_m3");
    let slump: Option<i32> = challan.get("slump_mm");
    let btime: Option<chrono::DateTime<chrono::Utc>> = challan.get("batch_time");
    let mnum: Option<String> = challan.get("mixer_number");
    let dname: Option<String> = challan.get("driver_name");
    let sig: Option<String> = challan.get("digital_signature");
    let cstatus: String = challan.get("status");

    Ok(Json(json!({
        "success": true,
        "challan": {
            "id": cid,
            "challan_number": cnum,
            "plant_code": pcode,
            "customer_name": cname,
            "site_address": saddr,
            "grade": grade,
            "quantity_m3": qty,
            "slump_mm": slump,
            "batch_time": btime,
            "mixer_number": mnum,
            "driver_name": dname,
            "signature": sig,
            "status": cstatus
        }
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CustomerRfqPayload {
    pub plant_id: Uuid,
    pub site_id: Option<Uuid>,
    pub site_name: Option<String>,
    pub site_address: Option<String>,
    pub grade: String,
    pub quantity_m3: Option<f64>,
    pub quantity: Option<f64>,
    pub required_date: Option<String>,
    pub pump_required: Option<bool>,
    pub notes: Option<String>,
}

pub async fn create_quotation_request(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<CustomerRfqPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    let id =
        crate::services::commercial_service::request(&state, auth_user.user_id, payload).await?;
    Ok(Json(json!({"success":true,"id":id,"status":"REQUESTED"})))
}

pub async fn list_customer_rfqs(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    let rows:Vec<serde_json::Value>=sqlx::query_scalar("SELECT to_jsonb(r)-'response_payload'||jsonb_build_object('plant_name',p.name,'site_name',s.name,'site_address',s.address_line,'quantity',r.quantity_m3::DOUBLE PRECISION,'quantity_m3',r.quantity_m3::DOUBLE PRECISION,'status',CASE r.status WHEN 'PENDING' THEN 'REQUESTED' ELSE r.status END,'quotation_number',q.quotation_number,'quoted_total',q.total_amount::DOUBLE PRECISION) FROM customer_quotation_requests r JOIN rmc_plants p ON p.id=r.plant_id LEFT JOIN customer_sites s ON s.id=r.site_id AND s.customer_id=r.customer_id LEFT JOIN LATERAL(SELECT quotation_number,total_amount FROM plant_quotations WHERE request_id=r.id ORDER BY created_at LIMIT 1) q ON TRUE WHERE r.customer_id=$1 ORDER BY r.created_at DESC LIMIT 500")
        .bind(auth_user.user_id).fetch_all(&state.db).await?;
    Ok(Json(json!({"success":true,"requests":rows})))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreatePourPlanPayload {
    pub site_id: Uuid,
    pub grade: String,
    pub total_quantity_m3: f64,
    pub mixer_capacity_m3: Option<f64>,
    pub pour_date: String,
    pub start_time: String,
    pub unload_minutes: Option<i32>,
    pub discharge_mode: Option<String>,
    pub notes: Option<String>,
}

fn pour_plan_dto(mut plan: serde_json::Value) -> Result<serde_json::Value, AppError> {
    let quantity = (plan["total_quantity_m3"].as_f64().unwrap_or(0.0) * 100.0).round() as i64;
    let capacity = (plan["mixer_capacity_m3"].as_f64().unwrap_or(0.0) * 100.0).round() as i64;
    let interval = plan["unload_minutes"].as_i64().unwrap_or(0);
    if quantity <= 0
        || quantity > 1_000_000
        || capacity <= 0
        || capacity > 2000
        || !(5..=180).contains(&interval)
        || (quantity + capacity - 1) / capacity > 500
    {
        return Err(AppError::Conflict(
            "Stored pour plan requires reconciliation".into(),
        ));
    }
    let date = NaiveDate::parse_from_str(plan["pour_date"].as_str().unwrap_or(""), "%Y-%m-%d")
        .map_err(|_| AppError::Conflict("Stored pour date requires correction".into()))?;
    let time =
        crate::services::customer_observations::clock(plan["start_time"].as_str().unwrap_or(""))?;
    let start = date.and_time(time);
    let count = (quantity + capacity - 1) / capacity;
    let mut loads = Vec::new();
    for i in 0..count {
        let arrival = start
            .checked_add_signed(chrono::Duration::minutes(i * interval))
            .ok_or_else(|| {
                AppError::BadRequest("Pour schedule exceeds the supported date range".into())
            })?;
        loads.push(json!({"load_number":i+1,"quantity_m3":(quantity-i*capacity).min(capacity) as f64/100.0,"suggested_arrival":arrival.format("%H:%M").to_string(),"suggested_arrival_date":arrival.date().to_string()}));
    }
    let end = start
        .checked_add_signed(chrono::Duration::minutes(count * interval))
        .ok_or_else(|| {
            AppError::BadRequest("Pour schedule exceeds the supported date range".into())
        })?;
    plan["loads_count"] = json!(count);
    plan["loads"] = json!(loads);
    plan["estimated_end_time"] = json!(end.format("%H:%M").to_string());
    plan["estimated_end_date"] = json!(end.date());
    plan["status"] = json!("PLANNED");
    Ok(plan)
}

pub async fn create_pour_plan(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<CreatePourPlanPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    let date = NaiveDate::parse_from_str(&payload.pour_date, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid pour date".into()))?;
    crate::services::customer_observations::clock(&payload.start_time)?;
    let capacity = payload.mixer_capacity_m3.unwrap_or(6.0);
    let interval = payload.unload_minutes.unwrap_or(30);
    let mode = payload.discharge_mode.as_deref().unwrap_or("PUMP");
    if !crate::services::customer_observations::valid_grade(&payload.grade)
        || !payload.total_quantity_m3.is_finite()
        || payload.total_quantity_m3 <= 0.0
        || payload.total_quantity_m3 > 10000.0
        || !capacity.is_finite()
        || capacity <= 0.0
        || capacity > 20.0
        || !(5..=180).contains(&interval)
        || !matches!(mode, "PUMP" | "DIRECT")
        || date < chrono::Utc::now().date_naive()
        || payload.notes.as_ref().is_some_and(|s| s.len() > 2000)
    {
        return Err(AppError::BadRequest(
            "Invalid pour quantity, capacity, schedule or mode".into(),
        ));
    }
    if (payload.total_quantity_m3 * 100.0 - (payload.total_quantity_m3 * 100.0).round()).abs()
        > 0.00001
        || (capacity * 100.0 - (capacity * 100.0).round()).abs() > 0.00001
    {
        return Err(AppError::BadRequest(
            "Planning quantities support at most two decimal places".into(),
        ));
    }
    let quantity_cents = (payload.total_quantity_m3 * 100.0).round() as i64;
    let capacity_cents = (capacity * 100.0).round() as i64;
    if quantity_cents <= 0
        || capacity_cents <= 0
        || (quantity_cents + capacity_cents - 1) / capacity_cents > 500
    {
        return Err(AppError::BadRequest(
            "Pour plan exceeds supported load count".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    let site = sqlx::query(
        "SELECT name,address_line FROM customer_sites WHERE id=$1 AND customer_id=$2 FOR SHARE",
    )
    .bind(payload.site_id)
    .bind(auth_user.user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Forbidden("Saved site does not belong to this customer".into()))?;
    let id:Uuid=sqlx::query_scalar("INSERT INTO customer_pour_plans(customer_id,site_id,grade,total_quantity_m3,mixer_capacity_m3,pour_date,start_time,unload_minutes,discharge_mode,notes) VALUES($1,$2,$3,$4::DOUBLE PRECISION::NUMERIC,$5::DOUBLE PRECISION::NUMERIC,$6,$7,$8,$9,$10) RETURNING id")
        .bind(auth_user.user_id).bind(payload.site_id).bind(&payload.grade).bind(payload.total_quantity_m3).bind(capacity).bind(date).bind(&payload.start_time).bind(interval).bind(mode).bind(&payload.notes).fetch_one(&mut *tx).await?;
    let plan = pour_plan_dto(
        json!({"id":id,"site_id":payload.site_id,"site_name":site.get::<String,_>("name"),"site_address":site.get::<String,_>("address_line"),"grade":payload.grade,"total_quantity_m3":payload.total_quantity_m3,"mixer_capacity_m3":capacity,"pour_date":date,"start_time":payload.start_time,"unload_minutes":interval,"discharge_mode":mode,"notes":payload.notes}),
    )?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'pour_plan.create','pour_plan',$2,$3)").bind(auth_user.user_id).bind(id.to_string()).bind(json!({"site_id":payload.site_id,"loads":plan["loads_count"]})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"id":id,"plan":plan})))
}

pub async fn list_pour_plans(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(filter): Query<CustomerSiteFilter>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    let rows:Vec<serde_json::Value>=sqlx::query_scalar("SELECT to_jsonb(p)||jsonb_build_object('site_name',s.name,'site_address',s.address_line,'total_quantity_m3',p.total_quantity_m3::DOUBLE PRECISION,'mixer_capacity_m3',p.mixer_capacity_m3::DOUBLE PRECISION) FROM customer_pour_plans p JOIN customer_sites s ON s.id=p.site_id AND s.customer_id=p.customer_id WHERE p.customer_id=$1 AND($2::UUID IS NULL OR p.site_id=$2) ORDER BY p.pour_date DESC,p.created_at DESC LIMIT 500")
        .bind(auth_user.user_id).bind(filter.site_id).fetch_all(&state.db).await?;
    let plans = rows
        .into_iter()
        .map(pour_plan_dto)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(
        json!({"success":true,"plans":plans,"pour_plans":plans}),
    ))
}

pub async fn delete_pour_plan(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    let mut tx = state.db.begin().await?;
    let deleted = sqlx::query("DELETE FROM customer_pour_plans WHERE id=$1 AND customer_id=$2")
        .bind(id)
        .bind(auth_user.user_id)
        .execute(&mut *tx)
        .await?;
    if deleted.rows_affected() != 1 {
        return Err(AppError::NotFound("Pour plan not found".into()));
    }
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id) VALUES($1,'pour_plan.delete','pour_plan',$2)").bind(auth_user.user_id).bind(id.to_string()).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"status":"deleted"})))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateReceivingRecordPayload {
    pub site_id: Uuid,
    pub order_id: Option<Uuid>,
    pub grade: String,
    pub received_quantity_m3: f64,
    pub challan_number: Option<String>,
    pub tm_number: Option<String>,
    pub observed_slump_mm: Option<f64>,
    pub arrival_time: Option<String>,
    pub unloading_start_time: Option<String>,
    pub unloading_end_time: Option<String>,
    #[serde(default)]
    pub cube_sample_ids: Vec<String>,
    pub sample_cast_date: Option<NaiveDate>,
    #[serde(default)]
    pub checklist: std::collections::BTreeMap<String, bool>,
    pub notes: Option<String>,
}

pub async fn create_receiving_record(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<CreateReceivingRecordPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    Ok(Json(
        crate::services::customer_observations::create(&state, auth_user.user_id, payload).await?,
    ))
}

#[derive(Deserialize, Default)]
pub struct CustomerSiteFilter {
    pub site_id: Option<Uuid>,
}

pub async fn list_receiving_records(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(filter): Query<CustomerSiteFilter>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    Ok(Json(
        json!({"success":true,"records":crate::services::customer_observations::list(&state,auth_user.user_id,None,filter.site_id).await?}),
    ))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CubeResultPayload {
    pub sample_id: String,
    pub age_days: i32,
    pub tested_on: String,
    pub result_mpa: f64,
    pub lab_name: Option<String>,
    pub report_reference: Option<String>,
    pub notes: Option<String>,
}

pub async fn add_cube_test_result(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(record): Path<Uuid>,
    Json(payload): Json<CubeResultPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    Ok(Json(
        crate::services::customer_observations::cube(&state, auth_user.user_id, record, payload)
            .await?,
    ))
}

pub async fn delete_receiving_record(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(record): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    let mut tx = state.db.begin().await?;
    let deleted =
        sqlx::query("DELETE FROM customer_receiving_records WHERE id=$1 AND customer_id=$2")
            .bind(record)
            .bind(auth_user.user_id)
            .execute(&mut *tx)
            .await?;
    if deleted.rows_affected() != 1 {
        return Err(AppError::NotFound("Receiving record not found".into()));
    }
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id) VALUES($1,'receiving_record.delete','receiving_record',$2)").bind(auth_user.user_id).bind(record.to_string()).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"status":"deleted"})))
}

// Backward-compatible test/module entry point. Public route uses digilocker_kyc::start.
pub async fn start_customer_kyc(
    state: State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::routes::digilocker_kyc::start(state, auth_user).await
}
