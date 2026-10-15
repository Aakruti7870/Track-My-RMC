use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

// Include pre-ledger completed measurements once, without inventing inventory movements.
pub const PRODUCED_SQL: &str = "SELECT (COALESCE((SELECT SUM(quantity) FROM production_batches WHERE order_id=$1),0)+COALESCE((SELECT SUM(l.quantity_m3) FROM order_loads l WHERE l.order_id=$1 AND EXISTS(SELECT 1 FROM batch_production_records b WHERE b.load_id=l.id AND b.status='COMPLETED') AND NOT EXISTS(SELECT 1 FROM production_batches b WHERE b.load_id=l.id)),0))::DOUBLE PRECISION";

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct QuantityBatch {
    pub quantity: f64,
    pub batch_reference: Option<String>,
    pub remarks: Option<String>,
    pub consume_materials: Option<bool>,
    pub request_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LoadBatch {
    pub load_id: Uuid,
    pub batch_number: Option<i32>,
    pub actual_weights: Value,
    pub target_weights: Option<Value>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub enum BatchInput {
    Quantity(QuantityBatch),
    Load(LoadBatch),
}

pub async fn record(
    pool: &PgPool,
    order: Uuid,
    actor: Uuid,
    input: BatchInput,
) -> Result<Value, AppError> {
    let payload =
        serde_json::to_value(&input).map_err(|_| AppError::BadRequest("Invalid batch".into()))?;
    let mut tx = pool.begin().await?;
    // The parent serializes batch totals, idempotency and dispatch allocation for this order.
    let row=sqlx::query("SELECT plant_id,concrete_grade,status,total_quantity_m3::DOUBLE PRECISION required FROM orders WHERE id=$1 FOR UPDATE")
 .bind(order).fetch_optional(&mut *tx).await?.ok_or_else(||AppError::NotFound("Order not found".into()))?;
    let plant: Uuid = row.get("plant_id");
    let grade: String = row.get("concrete_grade");
    let status: String = row.get("status");
    let required: f64 = row.get("required");
    let (quantity, load, request, reference, remarks) = match &input {
        BatchInput::Quantity(q) => {
            if q.consume_materials == Some(false) {
                return Err(AppError::BadRequest(
                    "Material consumption cannot be bypassed".into(),
                ));
            }
            if q.request_id
                .as_ref()
                .is_some_and(|s| s.len() < 8 || s.len() > 128)
                || q.batch_reference.as_ref().is_some_and(|s| s.len() > 160)
                || q.remarks.as_ref().is_some_and(|s| s.len() > 4000)
            {
                return Err(AppError::BadRequest(
                    "Invalid batch reference, request ID or remarks".into(),
                ));
            }
            (
                q.quantity,
                None,
                q.request_id.as_deref(),
                q.batch_reference.as_deref(),
                q.remarks.as_deref(),
            )
        }
        BatchInput::Load(b) => {
            let weights = b
                .actual_weights
                .as_object()
                .ok_or_else(|| AppError::BadRequest("Batch weights must be an object".into()))?;
            if weights.is_empty()
                || weights
                    .values()
                    .any(|v| v.as_f64().is_none_or(|n| !n.is_finite() || n < 0.0))
                || b.batch_number.is_some_and(|n| n <= 0)
            {
                return Err(AppError::BadRequest(
                    "Invalid batch weights or number".into(),
                ));
            }
            let qty:Option<f64>=sqlx::query_scalar("SELECT quantity_m3::DOUBLE PRECISION FROM order_loads WHERE id=$1 AND order_id=$2 FOR UPDATE")
    .bind(b.load_id).bind(order).fetch_optional(&mut *tx).await?;
            (
                qty.ok_or_else(|| AppError::NotFound("Load not found for this order".into()))?,
                Some(b.load_id),
                None,
                None,
                None,
            )
        }
    };
    if !quantity.is_finite() || quantity <= 0.0 {
        return Err(AppError::BadRequest(
            "A positive batch quantity is required".into(),
        ));
    }
    let previous:Option<(Uuid,Value,Value)>=sqlx::query_as("SELECT id,request_payload,material_consumption FROM production_batches WHERE order_id=$1 AND (($2::uuid IS NOT NULL AND load_id=$2) OR ($3::text IS NOT NULL AND request_id=$3))")
  .bind(order).bind(load).bind(request).fetch_optional(&mut *tx).await?;
    if let Some((id, original, consumption)) = previous {
        if original != payload {
            return Err(AppError::Conflict(
                "Batch retry changed its original payload".into(),
            ));
        }
        let produced: f64 = sqlx::query_scalar(PRODUCED_SQL)
            .bind(order)
            .fetch_one(&mut *tx)
            .await?;
        tx.commit().await?;
        return Ok(
            json!({"success":true,"batch_id":id,"produced":produced,"required":required,"material_consumption":consumption}),
        );
    }
    if status != "in_production" {
        return Err(AppError::Conflict(
            "Start production before recording a batch".into(),
        ));
    }
    if let Some(id) = load {
        let st: String = sqlx::query_scalar("SELECT status FROM order_loads WHERE id=$1")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
        if st != "batching" {
            return Err(AppError::Conflict("Load is not batching".into()));
        }
    }
    let produced: f64 = sqlx::query_scalar(PRODUCED_SQL)
        .bind(order)
        .fetch_one(&mut *tx)
        .await?;
    if produced + quantity > required * 1.02 + 0.001 {
        return Err(AppError::Conflict(
            "Batch exceeds order quantity tolerance".into(),
        ));
    }
    let design=sqlx::query("SELECT id,version,to_jsonb(d) recipe FROM plant_mix_designs d WHERE plant_id=$1 AND grade=$2 AND active=TRUE ORDER BY version DESC,created_at DESC,id LIMIT 1 FOR SHARE")
 .bind(plant).bind(&grade).fetch_optional(&mut *tx).await?.ok_or_else(||AppError::Conflict(format!("No active mix design for {grade}")))?;
    let design_id: Uuid = design.get("id");
    let version: i32 = design.get("version");
    let recipe: Value = design.get("recipe");
    let components = [
        ("cement_kg", "cement", "kg"),
        ("fly_ash_kg", "flyash", "kg"),
        ("c_sand_kg", "c_sand", "kg"),
        ("sand_kg", "sand", "kg"),
        ("aggregate_10mm_kg", "aggregate_10mm", "kg"),
        ("aggregate_20mm_kg", "aggregate_20mm", "kg"),
        ("admixture_kg", "admixture", "kg"),
        ("water_litre", "water", "litre"),
    ];
    let mut consumption = Vec::new();
    let batch = Uuid::new_v4();
    // Lock all materials in stable UUID order to avoid deadlocks between different orders.
    let materials=sqlx::query("SELECT id,name,material_type,unit,current_stock::DOUBLE PRECISION stock FROM plant_materials WHERE plant_id=$1 ORDER BY id FOR UPDATE").bind(plant).fetch_all(&mut *tx).await?;
    for (field, code, source_unit) in components {
        let per_m3 = recipe[field].as_f64().unwrap_or(0.0);
        if !per_m3.is_finite() || per_m3 < 0.0 {
            return Err(AppError::Conflict(
                "Mix design contains invalid quantities".into(),
            ));
        }
        if per_m3 == 0.0 {
            continue;
        }
        let matching: Vec<_> = materials
            .iter()
            .filter(|m| normalize(m.get::<String, _>("material_type").as_str()) == code)
            .collect();
        if matching.len() != 1 {
            return Err(AppError::Conflict(format!(
                "Configure exactly one {code} inventory material for this plant"
            )));
        }
        let m = matching[0];
        let id: Uuid = m.get("id");
        let unit: String = m.get("unit");
        let name: String = m.get("name");
        let amount = stock_amount(per_m3 * quantity, source_unit, &unit)?;
        let available: f64 = m.get("stock");
        if amount <= 0.0 || available + 1e-9 < amount {
            return Err(AppError::Conflict(format!("Insufficient {name} stock")));
        }
        let changed=sqlx::query("UPDATE plant_materials SET current_stock=current_stock-$2::numeric,updated_at=NOW() WHERE id=$1 AND current_stock>=$2::numeric")
   .bind(id).bind(amount).execute(&mut *tx).await?;
        if changed.rows_affected() != 1 {
            return Err(AppError::Conflict("Inventory changed concurrently".into()));
        }
        consumption.push(json!({"material_id":id,"code":code,"name":name,"stock_quantity":amount,"stock_unit":unit,"design_quantity":per_m3*quantity,"design_unit":source_unit}));
    }
    if consumption.is_empty() {
        return Err(AppError::Conflict(
            "Mix design must contain material quantities".into(),
        ));
    }
    let consumed = json!(consumption);
    sqlx::query("INSERT INTO production_batches (id,order_id,plant_id,batcher_id,quantity,load_id,request_id,request_payload,mix_design_id,mix_design_version,batch_reference,remarks,material_consumption) VALUES ($1,$2,$3,$4,$5::numeric,$6,$7,$8,$9,$10,$11,$12,$13)")
  .bind(batch).bind(order).bind(plant).bind(actor).bind(quantity).bind(load).bind(request).bind(payload).bind(design_id).bind(version).bind(reference).bind(remarks).bind(&consumed).execute(&mut *tx).await?;
    for c in &consumption {
        let material: Uuid = serde_json::from_value(c["material_id"].clone())
            .map_err(|_| AppError::InternalError("Material identifier".into()))?;
        let amount = c["stock_quantity"]
            .as_f64()
            .ok_or_else(|| AppError::InternalError("Material quantity".into()))?;
        sqlx::query("INSERT INTO production_stock_movements (batch_id,material_id,actor_id,quantity_change,stock_unit) VALUES ($1,$2,$3,$4::numeric,$5)")
   .bind(batch).bind(material).bind(actor).bind(-amount).bind(c["stock_unit"].as_str()).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO plant_material_adjustments (material_id,adjusted_by,quantity_change,reason) VALUES ($1,$2,$3::numeric,$4)")
   .bind(material).bind(actor).bind(-amount).bind(format!("PRODUCTION_BATCH:{batch}")).execute(&mut *tx).await?;
    }
    if let BatchInput::Load(b) = input {
        sqlx::query("INSERT INTO batch_production_records (load_id,operator_id,batch_number,actual_weights,target_weights,status,completed_at) VALUES ($1,$2,$3,$4,$5,'COMPLETED',NOW())")
   .bind(b.load_id).bind(actor).bind(b.batch_number.unwrap_or(1)).bind(b.actual_weights).bind(b.target_weights.unwrap_or(json!({}))).execute(&mut *tx).await?;
        sqlx::query("UPDATE order_loads SET status='batched',batch_completed_at=NOW() WHERE id=$1")
            .bind(b.load_id)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("INSERT INTO audit_logs (user_id,action,resource_type,resource_id,metadata) VALUES ($1,'production_batch','order',$2,$3)")
  .bind(actor).bind(order.to_string()).bind(json!({"batch_id":batch,"quantity":quantity,"mix_design_id":design_id})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(
        json!({"success":true,"batch_id":batch,"produced":produced+quantity,"required":required,"mix_design_version":version,"material_consumption":consumed}),
    )
}

fn normalize(value: &str) -> String {
    let s = value.trim().to_ascii_lowercase().replace([' ', '-'], "_");
    match s.as_str() {
        "fly_ash" => "flyash".into(),
        "crusher_sand" => "c_sand".into(),
        _ => s,
    }
}
fn stock_amount(raw: f64, source: &str, unit: &str) -> Result<f64, AppError> {
    let unit = unit.trim().to_ascii_lowercase().replace(' ', "");
    let scale = match (source, unit.as_str()) {
        ("kg", "kg" | "kgs" | "kilogram" | "kilograms")
        | ("litre", "l" | "ltr" | "litre" | "litres" | "liter" | "liters") => 1.0,
        ("kg", "t" | "ton" | "tons" | "tonne" | "tonnes" | "mt")
        | ("litre", "kl" | "kilolitre" | "kilolitres" | "kiloliter" | "kiloliters") => 1000.0,
        _ => {
            return Err(AppError::Conflict(format!(
                "Unsupported inventory unit {unit} for {source}"
            )))
        }
    };
    Ok((raw / scale * 1_000_000.0).round() / 1_000_000.0)
}
