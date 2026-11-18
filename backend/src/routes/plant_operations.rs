use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::staff_module_permissions::{require, Action};

async fn require_plant(state: &AppState, user: &AuthUser, plant: Uuid) -> Result<(), AppError> {
    check_role(user, &["owner", "plant_owner", "admin"])?;
    let plants = super::owner_routes::assigned_plants(state, user).await?;
    let is_admin = user.role == "admin";
    if (is_admin && plants.len() != 1) || !plants.iter().any(|(id, _, _)| *id == plant) {
        return Err(AppError::Forbidden(
            "Active plant assignment required".into(),
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct PipelineQuery {
    stage: Option<String>,
    offset: Option<i64>,
    summary: Option<bool>,
}

pub async fn pipeline(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(plant): Path<Uuid>,
    Query(query): Query<PipelineQuery>,
) -> Result<Json<Value>, AppError> {
    require_plant(&state, &auth, plant).await?;
    require(&state, &auth, plant, "dispatch_queue", Action::View).await?;
    let offset = query.offset.unwrap_or(0).clamp(0, 100_000);
    let stage = query.stage.as_deref();
    if stage.is_some_and(|stage| {
        ![
            "to_batch",
            "needs_mixer",
            "batching",
            "ready",
            "on_road",
            "pod_due",
        ]
        .contains(&stage)
    }) {
        return Err(AppError::BadRequest("Unknown load stage".into()));
    }

    // Operational work spans delivery dates. Exclude cancelled loads and classify
    // every active load once, keeping unfinished PODs visible across shifts.
    let result: Value = sqlx::query_scalar(
        r#"
        WITH pipeline AS (
            SELECT l.id, o.id AS order_id, o.order_number, l.load_number,
                   o.concrete_grade AS grade, l.quantity_m3::double precision AS quantity_m3,
                   s.name AS site_name, l.status, o.delivery_date,
                   CASE
                       WHEN lower(l.status) IN ('pouring', 'unloading', 'delivered', 'completed', 'returned')
                            AND NOT EXISTS (SELECT 1 FROM proof_of_deliveries pod WHERE pod.load_id = l.id)
                           THEN 'pod_due'
                       WHEN lower(l.status) IN ('dispatched', 'en_route', 'in_transit', 'arrived') THEN 'on_road'
                       WHEN lower(l.status) IN ('planned', 'assigned', 'batching', 'batched', 'ready_to_dispatch')
                            AND l.mixer_id IS NULL THEN 'needs_mixer'
                       WHEN lower(l.status) IN ('planned', 'assigned') THEN 'to_batch'
                       WHEN lower(l.status) = 'batching' THEN 'batching'
                       WHEN lower(l.status) IN ('batched', 'ready_to_dispatch') THEN 'ready'
                   END AS stage
            FROM orders o JOIN order_loads l ON l.order_id = o.id
            LEFT JOIN customer_sites s ON s.id = o.site_id
            WHERE o.plant_id = $1 AND lower(o.status) NOT IN ('draft', 'cancelled', 'rejected')
        ), page AS (
            SELECT * FROM pipeline WHERE stage IS NOT NULL AND ($2::text IS NULL OR stage = $2)
            ORDER BY delivery_date ASC NULLS LAST, order_number, load_number, id
            LIMIT (CASE WHEN $4 THEN 0 ELSE 30 END) OFFSET $3
        )
        SELECT jsonb_build_object(
            'counts', COALESCE((SELECT jsonb_object_agg(stage, count) FROM
                (SELECT stage, count(*) FROM pipeline WHERE stage IS NOT NULL GROUP BY stage) grouped), '{}'::jsonb),
            'total', (SELECT count(*) FROM pipeline WHERE stage IS NOT NULL AND ($2::text IS NULL OR stage = $2)),
            'loads', COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY delivery_date, order_number, load_number, id) FROM page), '[]'::jsonb)
        )
        "#,
    )
    .bind(plant)
    .bind(stage)
    .bind(offset)
    .bind(query.summary.unwrap_or(false))
    .fetch_one(&state.db)
    .await?;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct RegisterQuery {
    offset: Option<i64>,
}

pub async fn register(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((plant, kind)): Path<(Uuid, String)>,
    Query(query): Query<RegisterQuery>,
) -> Result<Json<Value>, AppError> {
    require_plant(&state, &auth, plant).await?;
    let (permission, source) = match kind.as_str() {
        "batch" => (
            "production_queue",
            r#"
            SELECT b.id, o.id AS order_id, NULL::uuid AS challan_id, b.created_at AS recorded_at,
                   COALESCE(b.batch_reference, o.order_number) AS title,
                   concat(o.order_number, ' · ', b.quantity, ' m³') AS detail
            FROM production_batches b JOIN orders o ON o.id=b.order_id WHERE b.plant_id=$1 AND o.plant_id=$1
            UNION ALL
            SELECT b.id, o.id, NULL::uuid, COALESCE(b.completed_at,b.started_at),
                   concat(o.order_number, ' · Batch ', b.batch_number),
                   concat('Load ', l.load_number, ' · ', b.status)
            FROM batch_production_records b JOIN order_loads l ON l.id=b.load_id JOIN orders o ON o.id=l.order_id
            WHERE o.plant_id=$1 AND NOT EXISTS (SELECT 1 FROM production_batches p WHERE p.load_id=l.id)
        "#,
        ),
        "quality" => (
            "quality_register",
            r#"
            SELECT t.id, o.id AS order_id, NULL::uuid AS challan_id, t.test_date::timestamp AT TIME ZONE 'Asia/Kolkata' AS recorded_at,
                   concat(o.order_number, ' · ', o.concrete_grade) AS title,
                   CASE WHEN t.passed THEN 'Passed' WHEN NOT t.passed THEN 'Failed' ELSE COALESCE(t.result, 'Pending') END AS detail
            FROM cube_tests t JOIN orders o ON o.id=t.order_id WHERE o.plant_id=$1
        "#,
        ),
        "challans" => (
            "challan_gate_pass",
            r#"
            SELECT c.id, o.id AS order_id, l.id AS challan_id, c.created_at AS recorded_at,
                   c.challan_number AS title,
                   concat(o.order_number, ' · Load ', l.load_number, ' · ',
                          CASE WHEN pod.id IS NOT NULL THEN 'POD recorded'
                               WHEN lower(l.status) IN ('pouring','unloading','delivered','completed','returned') THEN 'POD due'
                               ELSE replace(l.status, '_', ' ') END) AS detail
            FROM challans c JOIN order_loads l ON l.id=c.load_id JOIN orders o ON o.id=l.order_id
            LEFT JOIN proof_of_deliveries pod ON pod.load_id=l.id WHERE o.plant_id=$1
        "#,
        ),
        "consumption" => (
            "material_inventory",
            r#"
            SELECT mv.id, b.order_id, NULL::uuid AS challan_id, mv.created_at AS recorded_at,
                   m.name AS title, concat(-mv.quantity_change, ' ', mv.stock_unit, ' used · ', o.order_number) AS detail
            FROM production_stock_movements mv JOIN production_batches b ON b.id=mv.batch_id
            JOIN plant_materials m ON m.id=mv.material_id JOIN orders o ON o.id=b.order_id
            WHERE b.plant_id=$1 AND m.plant_id=$1 AND o.plant_id=$1
        "#,
        ),
        "incidents" => (
            "incidents",
            r#"
            SELECT a.id, o.id AS order_id, NULL::uuid AS challan_id, a.created_at AS recorded_at,
                   concat(a.alert_type, ' · ', u.full_name) AS title,
                   concat(a.status, CASE WHEN a.message IS NOT NULL THEN ' · ' || a.message ELSE '' END) AS detail
            FROM driver_sos_alerts a JOIN users u ON u.id=a.driver_id
            LEFT JOIN order_loads l ON l.id=a.load_id LEFT JOIN orders o ON o.id=l.order_id
            WHERE o.plant_id=$1 OR (a.load_id IS NULL AND EXISTS (
                SELECT 1 FROM plant_staff ps WHERE ps.plant_id=$1 AND ps.user_id=a.driver_id
                   AND ps.is_active AND ps.removed_at IS NULL AND ps.role='driver'))
        "#,
        ),
        "ledger" => (
            "billing_ledger",
            r#"
            SELECT pay.id, i.order_id, NULL::uuid AS challan_id,
                   pay.payment_date::timestamp AT TIME ZONE 'Asia/Kolkata' AS recorded_at,
                   concat('Credit · ₹', pay.amount) AS title,
                   concat_ws(' · ', i.invoice_number, pay.payment_method, pay.transaction_ref) AS detail
            FROM plant_payments pay LEFT JOIN plant_invoices i ON i.id=pay.invoice_id AND i.plant_id=pay.plant_id
            WHERE pay.plant_id=$1
            UNION ALL
            SELECT e.id, NULL::uuid, NULL::uuid, e.expense_date::timestamp AT TIME ZONE 'Asia/Kolkata',
                   concat('Debit · ₹', e.amount), concat_ws(' · ', e.category, e.vendor, e.payment_method)
            FROM plant_expenses e WHERE e.plant_id=$1
        "#,
        ),
        "fleet" => (
            "fleet_availability",
            r#"
            SELECT m.id, NULL::uuid AS order_id, NULL::uuid AS challan_id, m.last_ping_at AS recorded_at,
                   m.registration_number AS title,
                   concat(replace(m.status, '_', ' '), ' · ', m.capacity_m3, ' m³') AS detail,
                   m.last_latitude AS latitude, m.last_longitude AS longitude
            FROM transit_mixers m WHERE m.plant_id=$1 AND m.status <> 'inactive'
        "#,
        ),
        "maintenance" => (
            "fleet_availability",
            r#"
            SELECT v.id, NULL::uuid AS order_id, NULL::uuid AS challan_id, v.recorded_at,
                   m.registration_number AS title,
                   concat(v.maintenance_type, CASE WHEN v.notes IS NOT NULL THEN ' · ' || v.notes ELSE '' END) AS detail
            FROM driver_vehicle_logs v JOIN transit_mixers m ON m.id=v.mixer_id
            WHERE v.plant_id=$1 AND v.entry_kind='maintenance'
        "#,
        ),
        _ => return Err(AppError::NotFound("Unknown plant register".into())),
    };
    require(&state, &auth, plant, permission, Action::View).await?;
    let sql = format!(
        "SELECT to_jsonb(r) FROM ({source}) r ORDER BY r.recorded_at DESC NULLS LAST, r.id DESC LIMIT 31 OFFSET $2"
    );
    let mut rows: Vec<Value> = sqlx::query_scalar(&sql)
        .bind(plant)
        .bind(query.offset.unwrap_or(0).clamp(0, 100_000))
        .fetch_all(&state.db)
        .await?;
    let has_more = rows.len() > 30;
    rows.truncate(30);
    Ok(Json(json!({ "rows": rows, "has_more": has_more })))
}
