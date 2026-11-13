//! Standard invoice drafting, buyer reuse, reconciliation and issuance.
//! Deliberately separate from dispatch permissions: preparing a challan is not
//! permission to view financial data or issue a GST tax invoice.
use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    routes::staff_module_permissions::{self, Action},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    Json,
};
use bigdecimal::{BigDecimal, RoundingMode};
use chrono::{Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use std::str::FromStr;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceLine {
    pub grade: String,
    pub hsn: String,
    pub quantity_m3: String,
    pub rate_per_m3: String,
    pub gst_rate: String,
}
#[derive(Debug, Deserialize)]
pub struct BuyerInput {
    pub id: Option<Uuid>,
    pub customer_id: Option<Uuid>,
    pub company_name: String,
    pub gstin: Option<String>,
    pub billing_address: String,
    pub delivery_address: Option<String>,
    pub state_code: String,
    pub phone: Option<String>,
    pub email: Option<String>,
}
#[derive(Debug, Deserialize)]
pub struct DraftInput {
    pub version: i32,
    pub invoice_date: String,
    pub manual_invoice_number: Option<String>,
    pub seller_name: String,
    pub seller_gstin: Option<String>,
    pub seller_address: String,
    pub seller_state_code: String,
    pub buyer_id: Option<Uuid>,
    pub buyer_name: String,
    pub buyer_gstin: Option<String>,
    pub buyer_address: String,
    pub buyer_state_code: String,
    pub place_of_supply: String,
    pub challan_display_reference: Option<String>,
    pub note: Option<String>,
    pub lines: Vec<InvoiceLine>,
    pub change_reason: Option<String>,
    pub save_buyer: bool,
}
#[derive(Debug, Deserialize)]
pub struct IssueInput {
    pub version: i32,
    pub confirmed: bool,
}
#[derive(Debug, Deserialize)]
pub struct ComplianceInput {
    pub e_invoice_required: bool,
    pub acceptance: String,
}
pub async fn record_compliance(
    State(state): State<AppState>,
    user: AuthUser,
    Path(plant): Path<Uuid>,
    Json(input): Json<ComplianceInput>,
) -> Result<Json<Value>, AppError> {
    check_role(&user, &["owner", "plant_owner"])?;
    require_bill(&state, &user, plant, Action::Edit).await?;
    if input.acceptance != "I have reviewed e-invoicing applicability for this plant GSTIN" {
        return Err(invalid("explicit owner compliance acknowledgment"));
    }
    sqlx::query("INSERT INTO invoice_compliance_declarations(plant_id,e_invoice_required,confirmed_by) VALUES($1,$2,$3) \
       ON CONFLICT(plant_id) DO UPDATE SET e_invoice_required=EXCLUDED.e_invoice_required,confirmed_by=EXCLUDED.confirmed_by,confirmed_at=NOW()")
       .bind(plant).bind(input.e_invoice_required).bind(user.user_id).execute(&state.db).await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'invoice_compliance_declared','plant',$2,$3)")
       .bind(user.user_id).bind(plant.to_string()).bind(json!({"e_invoice_required":input.e_invoice_required}))
       .execute(&state.db).await?;
    Ok(Json(json!({"success":true})))
}

fn invalid(field: &str) -> AppError {
    AppError::BadRequest(format!("Invalid or missing {field}"))
}
fn limited(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max
}
fn decimal(value: &str, max: i64, zero_ok: bool) -> Result<BigDecimal, AppError> {
    if value.len() > 28
        || value.starts_with('-')
        || value.starts_with('+')
        || value.contains('e')
        || value.contains('E')
    {
        return Err(invalid("decimal amount"));
    }
    let d = BigDecimal::from_str(value).map_err(|_| invalid("decimal amount"))?;
    if d > max
        || (!zero_ok && d <= 0)
        || (zero_ok && d < 0)
    {
        return Err(invalid("decimal range"));
    }
    Ok(d)
}
fn two(n: &str) -> bool {
    n.len() == 2 && n.chars().all(|c| c.is_ascii_digit()) && n != "00"
}
fn valid_gstin(value: &str, state: &str) -> bool {
    value.len() == 15
        && value.starts_with(state)
        && value
            .bytes()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}
fn opt_gstin(value: &Option<String>, state: &str) -> bool {
    value.as_deref().is_none_or(|v| valid_gstin(v, state))
}
fn valid_num(s: &str) -> bool {
    (1..=16).contains(&s.len())
        && s.bytes()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || matches!(c, b'-' | b'/'))
}
fn check_buyer(b: &BuyerInput) -> Result<(), AppError> {
    if !limited(&b.company_name, 200)
        || !limited(&b.billing_address, 2000)
        || !two(&b.state_code)
        || !opt_gstin(&b.gstin, &b.state_code)
        || b.email.as_ref().is_some_and(|v| v.len() > 254)
        || b.phone.as_ref().is_some_and(|v| v.len() > 30)
        || b.delivery_address.as_ref().is_some_and(|v| v.len() > 2000)
    {
        return Err(invalid("buyer legal name, address, state or GSTIN"));
    }
    Ok(())
}
fn calculate(lines: &[InvoiceLine], seller_state: &str, pos: &str) -> Result<Value, AppError> {
    if !(1..=50).contains(&lines.len()) || !two(seller_state) || !two(pos) {
        return Err(invalid("invoice items or place of supply"));
    }
    let mut subtotal = BigDecimal::from(0);
    let mut cgst = BigDecimal::from(0);
    let mut sgst = BigDecimal::from(0);
    let mut igst = BigDecimal::from(0);
    let mut items = Vec::new();
    for line in lines {
        if !limited(&line.grade, 30)
            || !line
                .grade
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
            || !((4..=8).contains(&line.hsn.len()) && line.hsn.bytes().all(|c| c.is_ascii_digit()))
        {
            return Err(invalid("grade or HSN"));
        }
        let qty = decimal(&line.quantity_m3, 100000, false)?;
        let rate = decimal(&line.rate_per_m3, 10000000, false)?;
        let gst = decimal(&line.gst_rate, 100, true)?;
        // Amounts and tax are calculated server-side with decimal math only.
        let taxable = (qty.clone() * rate).with_scale_round(2, RoundingMode::HalfUp);
        let tax = (taxable.clone() * gst.clone() / BigDecimal::from(100))
            .with_scale_round(2, RoundingMode::HalfUp);
        if seller_state == pos {
            let half =
                (tax.clone() / BigDecimal::from(2)).with_scale_round(2, RoundingMode::HalfUp);
            cgst += &half;
            sgst += &tax - &half;
        } else {
            igst += &tax;
        }
        subtotal += &taxable;
        items.push(
            json!({"grade":line.grade,"hsn":line.hsn,"quantity_m3":line.quantity_m3,
          "rate_per_m3":line.rate_per_m3,"gst_rate":line.gst_rate,
          "taxable":taxable.to_string(),"line_total":(taxable+tax).to_string()}),
        );
    }
    let total = &subtotal + &cgst + &sgst + &igst;
    Ok(
        json!({"items":items,"subtotal":subtotal.to_string(),"cgst":cgst.to_string(),
        "sgst":sgst.to_string(),"igst":igst.to_string(),"tax":(&cgst+&sgst+&igst).to_string(),
        "total":total.to_string()}),
    )
}
fn get_str(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").into()
}
fn get_opt(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_owned)
}
fn parse_lines(v: &Value) -> Result<Vec<InvoiceLine>, AppError> {
    serde_json::from_value(v["lines"].clone()).map_err(|_| invalid("invoice line items"))
}
fn snapshot(
    d: &Value,
    order_number: &str,
    challans: &[String],
    number: &str,
    delivery_address: &str,
) -> Result<Value, AppError> {
    let lines = parse_lines(d)?;
    let mut totals = calculate(
        &lines,
        &get_str(d, "seller_state_code"),
        &get_str(d, "place_of_supply"),
    )?;
    let out = totals
        .as_object_mut()
        .ok_or_else(|| invalid("tax totals"))?;
    out.insert("invoice_number".into(), json!(number));
    out.insert("delivery_address".into(), json!(delivery_address));
    out.insert("invoice_date".into(), d["invoice_date"].clone());
    out.insert("order_number".into(), json!(order_number));
    out.insert("challans".into(), json!(challans));
    out.insert(
        "challan_display_reference".into(),
        d["challan_display_reference"].clone(),
    );
    out.insert("place_of_supply".into(), d["place_of_supply"].clone());
    out.insert("note".into(), d["note"].clone());
    out.insert(
        "seller".into(),
        json!({"name":d["seller_name"],"gstin":d["seller_gstin"],
          "address":d["seller_address"],"state_code":d["seller_state_code"]}),
    );
    out.insert(
        "buyer".into(),
        json!({"name":d["buyer_name"],"gstin":d["buyer_gstin"],
          "address":d["buyer_address"],"state_code":d["buyer_state_code"]}),
    );
    Ok(totals)
}
async fn require_bill(
    state: &AppState,
    user: &AuthUser,
    plant: Uuid,
    action: Action,
) -> Result<(), AppError> {
    check_role(user, &["owner", "plant_owner", "admin", "accountant"])?;
    staff_module_permissions::require(state, user, plant, "billing_ledger", action).await
}
async fn require_order(
    state: &AppState,
    user: &AuthUser,
    order: Uuid,
    action: Action,
) -> Result<Uuid, AppError> {
    let plant: Uuid = sqlx::query_scalar("SELECT plant_id FROM orders WHERE id=$1")
        .bind(order)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Order not found".into()))?;
    require_bill(state, user, plant, action).await?;
    Ok(plant)
}
async fn draft_order(
    state: &AppState,
    user: &AuthUser,
    id: Uuid,
    action: Action,
) -> Result<(Uuid, Uuid), AppError> {
    let ids: Option<(Uuid, Uuid)> =
        sqlx::query_as("SELECT plant_id,order_id FROM invoice_drafts WHERE id=$1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
    let (plant, order) = ids.ok_or_else(|| AppError::NotFound("Draft not found".into()))?;
    require_bill(state, user, plant, action).await?;
    Ok((plant, order))
}
async fn collect_challans(
    tx: &mut Transaction<'_, Postgres>,
    order: Uuid,
) -> Result<(Vec<(Uuid, String)>, BigDecimal, i64), AppError> {
    let rows=sqlx::query(
      "SELECT c.id,c.challan_number,c.quantity_m3,l.status FROM challans c JOIN order_loads l ON l.id=c.load_id WHERE l.order_id=$1 AND l.status<>'cancelled' ORDER BY l.load_number"
    ).bind(order).fetch_all(&mut **tx).await?;
    let mut total = BigDecimal::from(0);
    let mut ret = Vec::new();
    for row in rows {
        total += row.get::<BigDecimal, _>("quantity_m3");
        ret.push((row.get("id"), row.get("challan_number")));
    }
    let active: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM order_loads WHERE order_id=$1 AND status<>'cancelled'",
    )
    .bind(order)
    .fetch_one(&mut **tx)
    .await?;
    Ok((ret, total, active))
}

/// Called from the existing challan PREPARE transaction. Idempotent for multi-load
/// orders and does not grant the preparing dispatcher any financial permissions.
pub async fn auto_prepare_tx(
    tx: &mut Transaction<'_, Postgres>,
    order: Uuid,
    actor: Uuid,
) -> Result<(), AppError> {
    let issued: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plant_invoices WHERE order_id=$1)")
            .bind(order)
            .fetch_one(&mut **tx)
            .await?;
    if issued {
        return Ok(());
    }
    let row=sqlx::query(
      "SELECT o.plant_id,o.customer_id,o.concrete_grade,o.total_quantity_m3,o.total_amount,o.tax_amount,        COALESCE(pp.legal_name,p.name) seller_name,pp.gstin seller_gstin,        COALESCE(pp.billing_address,p.address_line,'') seller_address,pp.state_code seller_state_code,        COALESCE(b.company_name,u.full_name) buyer_name,b.gstin buyer_gstin,        COALESCE(b.billing_address,s.address_line) buyer_address,b.state_code buyer_state_code,b.id buyer_id        FROM orders o JOIN rmc_plants p ON p.id=o.plant_id JOIN users u ON u.id=o.customer_id        JOIN customer_sites s ON s.id=o.site_id LEFT JOIN plant_profiles pp ON pp.plant_id=p.id        LEFT JOIN LATERAL (SELECT id,company_name,gstin,billing_address,state_code FROM invoice_buyers             WHERE plant_id=o.plant_id AND customer_id=o.customer_id ORDER BY updated_at DESC LIMIT 1) b ON TRUE        WHERE o.id=$1"
    ).bind(order).fetch_one(&mut **tx).await?;
    let total: BigDecimal = row.get("total_amount");
    let tax: BigDecimal = row.get("tax_amount");
    let qty: BigDecimal = row.get("total_quantity_m3");
    let taxable = &total - &tax;
    let rate = if qty > 0 {
        (&taxable / &qty).with_scale_round(2, RoundingMode::HalfUp)
    } else {
        BigDecimal::from(0)
    };
    let gst = if taxable > 0 {
        (&tax * BigDecimal::from(100) / &taxable).with_scale_round(2, RoundingMode::HalfUp)
    } else {
        BigDecimal::from(0)
    };
    let line = json!([{"grade":row.get::<String,_>("concrete_grade"),"hsn":"38245010",
                     "quantity_m3":qty.to_string(),"rate_per_m3":rate.to_string(),"gst_rate":gst.to_string()}]);
    sqlx::query(
       "INSERT INTO invoice_drafts(plant_id,order_id,customer_id,buyer_id,seller_name,seller_gstin,seller_address,seller_state_code,        buyer_name,buyer_gstin,buyer_address,buyer_state_code,place_of_supply,lines,updated_by)         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(order_id) DO NOTHING"
    ).bind(row.get::<Uuid,_>("plant_id")).bind(order).bind(row.get::<Uuid,_>("customer_id"))
    .bind(row.get::<Option<Uuid>,_>("buyer_id"))
    .bind(row.get::<String,_>("seller_name")).bind(row.get::<Option<String>,_>("seller_gstin"))
    .bind(row.get::<String,_>("seller_address")).bind(row.get::<Option<String>,_>("seller_state_code"))
    .bind(row.get::<String,_>("buyer_name")).bind(row.get::<Option<String>,_>("buyer_gstin"))
    .bind(row.get::<String,_>("buyer_address")).bind(row.get::<Option<String>,_>("buyer_state_code"))
    .bind(row.get::<Option<String>,_>("buyer_state_code")).bind(line).bind(actor)
    .execute(&mut **tx).await?;
    Ok(())
}

pub async fn workspace(
    State(state): State<AppState>,
    user: AuthUser,
    Path(order): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let plant = require_order(&state, &user, order, Action::View).await?;
    let mut tx = state.db.begin().await?;
    // Lazily upgrade challans generated before this feature was deployed.
    let has_challan:bool=sqlx::query_scalar(
      "SELECT EXISTS(SELECT 1 FROM challans c JOIN order_loads l ON l.id=c.load_id WHERE l.order_id=$1)"
    ).bind(order).fetch_one(&mut *tx).await?;
    if has_challan {
        auto_prepare_tx(&mut tx, order, user.user_id).await?;
    }
    tx.commit().await?;
    let base:Value=sqlx::query_scalar(
      "SELECT jsonb_build_object('order_id',o.id,'order_number',o.order_number,'plant_id',o.plant_id,       'customer_id',o.customer_id,'customer_name',u.full_name,'site_address',s.address_line,       'grade',o.concrete_grade,'quantity_m3',o.total_quantity_m3::TEXT,'order_total',o.total_amount::TEXT,       'status',o.status) FROM orders o JOIN users u ON u.id=o.customer_id JOIN customer_sites s ON s.id=o.site_id WHERE o.id=$1 AND o.plant_id=$2"
    ).bind(order).bind(plant).fetch_one(&state.db).await?;
    let customer: Uuid =
        serde_json::from_value(base["customer_id"].clone()).map_err(|_| invalid("customer id"))?;
    let draft: Option<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(d) FROM invoice_drafts d WHERE d.order_id=$1 AND d.plant_id=$2",
    )
    .bind(order)
    .bind(plant)
    .fetch_optional(&state.db)
    .await?;
    let buyers:Vec<Value>=sqlx::query_scalar(
      "SELECT to_jsonb(b) FROM invoice_buyers b WHERE b.plant_id=$1 ORDER BY b.updated_at DESC LIMIT 100"
    ).bind(plant).fetch_all(&state.db).await?;
    let prices:Vec<Value>=sqlx::query_scalar(
      "SELECT jsonb_build_object('grade',grade,'rate_per_m3',rate_per_m3::text,'gst_rate',gst_rate::text,       'effective_from',effective_from) FROM plant_rate_cards WHERE plant_id=$1 AND active AND effective_from<=CURRENT_DATE        AND (effective_to IS NULL OR effective_to>=CURRENT_DATE) ORDER BY grade,effective_from DESC LIMIT 100"
    ).bind(plant).fetch_all(&state.db).await?;
    let history:Vec<Value>=sqlx::query_scalar(
      "SELECT jsonb_build_object('order_id',o.id,'order_number',o.order_number,'grade',o.concrete_grade,       'quantity_m3',o.total_quantity_m3::TEXT,'amount',o.total_amount::TEXT,'status',o.status,'created_at',o.created_at)        FROM orders o WHERE o.plant_id=$1 AND o.customer_id=$2 ORDER BY o.created_at DESC LIMIT 40"
    ).bind(plant).bind(customer).fetch_all(&state.db).await?;
    let ledger:Vec<Value>=sqlx::query_scalar(
      "SELECT jsonb_build_object('invoice_id',i.id,'invoice_number',i.invoice_number,'total',i.total_amount::TEXT,       'paid',COALESCE(pay.paid,0)::TEXT,'balance',(i.total_amount-COALESCE(pay.paid,0))::TEXT,'status',i.status)        FROM plant_invoices i LEFT JOIN LATERAL(SELECT SUM(amount) paid FROM plant_payments WHERE invoice_id=i.id) pay ON TRUE        WHERE i.plant_id=$1 AND i.customer_id=$2 ORDER BY i.created_at DESC LIMIT 40"
    ).bind(plant).bind(customer).fetch_all(&state.db).await?;
    let challans:Vec<Value>=sqlx::query_scalar(
      "SELECT jsonb_build_object('id',c.id,'challan_number',c.challan_number,'quantity_m3',c.quantity_m3::TEXT,'status',l.status)        FROM challans c JOIN order_loads l ON l.id=c.load_id JOIN orders o ON o.id=l.order_id        WHERE o.id=$1 AND o.plant_id=$2 ORDER BY l.load_number"
    ).bind(order).bind(plant).fetch_all(&state.db).await?;
    let compliance: Option<bool> = sqlx::query_scalar(
        "SELECT e_invoice_required FROM invoice_compliance_declarations WHERE plant_id=$1",
    )
    .bind(plant)
    .fetch_optional(&state.db)
    .await?;
    Ok(Json(
        json!({"success":true,"order":base,"draft":draft,"buyers":buyers,
      "prices":prices,"grades":prices,"order_history":history,"ledger":ledger,"challans":challans,
      "e_invoice_required":compliance}),
    ))
}

pub async fn buyer_upsert(
    State(state): State<AppState>,
    user: AuthUser,
    Path(plant): Path<Uuid>,
    Json(input): Json<BuyerInput>,
) -> Result<Json<Value>, AppError> {
    require_bill(&state, &user, plant, Action::Edit).await?;
    check_buyer(&input)?;
    if let Some(customer) = input.customer_id {
        let linked: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM orders WHERE plant_id=$1 AND customer_id=$2)",
        )
        .bind(plant)
        .bind(customer)
        .fetch_one(&state.db)
        .await?;
        if !linked {
            return Err(AppError::Forbidden(
                "Customer is not linked to this plant".into(),
            ));
        }
    }
    let id: Uuid = if let Some(id) = input.id {
        sqlx::query_scalar("UPDATE invoice_buyers SET company_name=$3,gstin=$4,billing_address=$5,delivery_address=$6,            state_code=$7,phone=$8,email=$9,customer_id=$10,updated_by=$11,updated_at=NOW() WHERE id=$1 AND plant_id=$2 RETURNING id")
          .bind(id).bind(plant).bind(input.company_name.trim()).bind(&input.gstin)
          .bind(input.billing_address.trim()).bind(&input.delivery_address).bind(&input.state_code)
          .bind(&input.phone).bind(&input.email).bind(input.customer_id).bind(user.user_id)
          .fetch_optional(&state.db).await?.ok_or_else(||AppError::NotFound("Buyer not found".into()))?
    } else {
        sqlx::query_scalar("INSERT INTO invoice_buyers(plant_id,customer_id,company_name,gstin,billing_address,delivery_address,            state_code,phone,email,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id")
          .bind(plant).bind(input.customer_id).bind(input.company_name.trim()).bind(&input.gstin)
          .bind(input.billing_address.trim()).bind(&input.delivery_address).bind(&input.state_code)
          .bind(&input.phone).bind(&input.email).bind(user.user_id)
          .fetch_one(&state.db).await?
    };
    Ok(Json(json!({"success":true,"buyer_id":id})))
}

pub async fn save_draft(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<DraftInput>,
) -> Result<Json<Value>, AppError> {
    let (plant, order) = draft_order(&state, &user, id, Action::Edit).await?;
    let date = NaiveDate::parse_from_str(&input.invoice_date, "%Y-%m-%d")
        .map_err(|_| invalid("invoice date"))?;
    if date > Utc::now().date_naive() {
        return Err(invalid("future invoice date"));
    }
    if !limited(&input.seller_name, 200)
        || !limited(&input.seller_address, 2000)
        || !limited(&input.buyer_name, 200)
        || !limited(&input.buyer_address, 2000)
        || !two(&input.seller_state_code)
        || !two(&input.buyer_state_code)
        || !two(&input.place_of_supply)
        || !opt_gstin(&input.buyer_gstin, &input.buyer_state_code)
        || !opt_gstin(&input.seller_gstin, &input.seller_state_code)
        || input.note.as_ref().is_some_and(|n| n.len() > 2000)
        || input
            .challan_display_reference
            .as_ref()
            .is_some_and(|n| n.len() > 400)
    {
        return Err(invalid("invoice identity, address or GST details"));
    }
    if let Some(n) = &input.manual_invoice_number {
        if !valid_num(n) {
            return Err(invalid("invoice number"));
        }
    }
    let _ = calculate(
        &input.lines,
        &input.seller_state_code,
        &input.place_of_supply,
    )?;
    let master: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT legal_name,gstin FROM plant_profiles WHERE plant_id=$1")
            .bind(plant)
            .fetch_optional(&state.db)
            .await?;
    let (master_name, master_gstin) = master.ok_or_else(|| {
        AppError::Conflict("Complete the plant billing profile before invoicing".into())
    })?;
    if input.seller_gstin != master_gstin || input.seller_gstin.is_none() {
        return Err(AppError::Conflict(
            "Seller GSTIN must match the verified plant billing profile".into(),
        ));
    }
    // Display aliases/price corrections are allowed in draft, but tracked.
    let nonstandard_seller = input.seller_name != master_name;
    if nonstandard_seller && !matches!(user.role.as_str(), "owner" | "plant_owner") {
        return Err(AppError::Forbidden(
            "Seller identity correction requires the plant owner".into(),
        ));
    }
    if nonstandard_seller
        && !input
            .change_reason
            .as_deref()
            .is_some_and(|v| limited(v, 500))
    {
        return Err(invalid("seller change reason"));
    }
    let mut tx = state.db.begin().await?;
    let original:Value=sqlx::query_scalar("SELECT to_jsonb(d) FROM invoice_drafts d WHERE id=$1 AND plant_id=$2 AND order_id=$3 FOR UPDATE")
       .bind(id).bind(plant).bind(order).fetch_one(&mut *tx).await?;
    if get_str(&original, "status") != "DRAFT" {
        return Err(AppError::Conflict("Issued invoice is immutable".into()));
    }
    if original["version"].as_i64() != Some(i64::from(input.version)) {
        return Err(AppError::Conflict(
            "Invoice draft changed elsewhere; reload it".into(),
        ));
    }
    if input.manual_invoice_number != get_opt(&original, "manual_invoice_number")
        && !matches!(user.role.as_str(), "owner" | "plant_owner")
    {
        return Err(AppError::Forbidden(
            "Manual invoice numbers require the plant owner".into(),
        ));
    }
    if input.buyer_id.is_some() {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM invoice_buyers WHERE id=$1 AND plant_id=$2)",
        )
        .bind(input.buyer_id)
        .bind(plant)
        .fetch_one(&mut *tx)
        .await?;
        if !exists {
            return Err(AppError::Forbidden(
                "Buyer does not belong to the logged-in plant".into(),
            ));
        }
    }
    let changed = serde_json::to_value(&input.lines).map_err(|_| invalid("invoice line items"))?;
    let ref_override = input.challan_display_reference.as_deref().unwrap_or("");
    let before = get_str(&original, "seller_name") != input.seller_name
        || original["lines"] != changed
        || get_str(&original, "buyer_name") != input.buyer_name
        || get_str(&original, "challan_display_reference") != ref_override;
    if before
        && !input
            .change_reason
            .as_deref()
            .is_some_and(|v| limited(v, 500))
    {
        return Err(invalid(
            "reason for invoice changes (maximum 500 characters)",
        ));
    }
    let buyer_id = if input.save_buyer {
        let c: Uuid = serde_json::from_value(original["customer_id"].clone())
            .map_err(|_| invalid("linked customer"))?;
        let up: Uuid = if let Some(b) = input.buyer_id {
            sqlx::query_scalar("UPDATE invoice_buyers SET company_name=$3,gstin=$4,billing_address=$5,state_code=$6,updated_by=$7,updated_at=NOW() WHERE id=$1 AND plant_id=$2 RETURNING id")
                .bind(b).bind(plant).bind(&input.buyer_name).bind(&input.buyer_gstin).bind(&input.buyer_address)
                .bind(&input.buyer_state_code).bind(user.user_id).fetch_one(&mut *tx).await?
        } else {
            sqlx::query_scalar("INSERT INTO invoice_buyers(plant_id,customer_id,company_name,gstin,billing_address,state_code,created_by,updated_by)                 VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id")
                .bind(plant).bind(c).bind(&input.buyer_name).bind(&input.buyer_gstin)
                .bind(&input.buyer_address).bind(&input.buyer_state_code).bind(user.user_id)
                .fetch_one(&mut *tx).await?
        };
        Some(up)
    } else {
        input.buyer_id
    };
    sqlx::query(
      "UPDATE invoice_drafts SET invoice_date=$2,manual_invoice_number=$3,seller_name=$4,seller_gstin=$5,       seller_address=$6,seller_state_code=$7,buyer_id=$8,buyer_name=$9,buyer_gstin=$10,buyer_address=$11,       buyer_state_code=$12,place_of_supply=$13,challan_display_reference=$14,note=$15,lines=$16,       version=version+1,updated_by=$17,updated_at=NOW() WHERE id=$1 AND status='DRAFT'"
    ).bind(id).bind(date).bind(input.manual_invoice_number).bind(input.seller_name)
     .bind(input.seller_gstin).bind(input.seller_address).bind(input.seller_state_code)
     .bind(buyer_id).bind(input.buyer_name).bind(input.buyer_gstin)
     .bind(input.buyer_address).bind(input.buyer_state_code).bind(input.place_of_supply)
     .bind(input.challan_display_reference).bind(input.note.unwrap_or_default()).bind(changed).bind(user.user_id)
     .execute(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'invoice_draft_edited','invoice_draft',$2,$3)")
        .bind(user.user_id).bind(id.to_string())
        .bind(json!({"order_id":order,"version":input.version+1,"reason":input.change_reason,"data_changed":before,"buyer_saved":input.save_buyer}))
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"success":true,"draft_id":id,"version":input.version+1,"buyer_id":buyer_id}),
    ))
}

pub async fn preview(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let (plant, order) = draft_order(&state, &user, id, Action::View).await?;
    let draft: Value = sqlx::query_scalar(
        "SELECT to_jsonb(d) FROM invoice_drafts d WHERE d.id=$1 AND d.plant_id=$2",
    )
    .bind(id)
    .bind(plant)
    .fetch_one(&state.db)
    .await?;
    let row: (String,String) =
        sqlx::query_as("SELECT o.order_number,s.address_line FROM orders o JOIN customer_sites s ON s.id=o.site_id WHERE o.id=$1 AND o.plant_id=$2")
            .bind(order)
            .bind(plant)
            .fetch_one(&state.db)
            .await?;
    let challans:Vec<String>=sqlx::query_scalar(
       "SELECT c.challan_number FROM challans c JOIN order_loads l ON l.id=c.load_id         JOIN orders o ON o.id=l.order_id WHERE o.id=$1 AND o.plant_id=$2 ORDER BY l.load_number"
    ).bind(order).bind(plant).fetch_all(&state.db).await?;
    let snap = snapshot(&draft, &row.0, &challans, "DRAFT", &row.1)?;
    Ok(Json(
        json!({"success":true,"html":super::invoice_print::render(&snap,true),"snapshot":snap}),
    ))
}

pub async fn issue(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<IssueInput>,
) -> Result<Json<Value>, AppError> {
    let (plant, order) = draft_order(&state, &user, id, Action::Edit).await?;
    if !input.confirmed {
        return Err(invalid("explicit invoice confirmation"));
    }
    let mut tx = state.db.begin().await?;
    let row=sqlx::query("SELECT o.order_number,o.total_amount,o.total_quantity_m3,o.concrete_grade,o.status,o.customer_id,s.address_line AS delivery_address FROM orders o JOIN customer_sites s ON s.id=o.site_id WHERE o.id=$1 AND o.plant_id=$2 FOR UPDATE OF o")
        .bind(order).bind(plant).fetch_one(&mut *tx).await?;
    let draft: Value = sqlx::query_scalar(
        "SELECT to_jsonb(d) FROM invoice_drafts d WHERE d.id=$1 AND d.plant_id=$2 FOR UPDATE",
    )
    .bind(id)
    .bind(plant)
    .fetch_one(&mut *tx)
    .await?;
    if get_str(&draft, "status") == "ISSUED" {
        return Err(AppError::Conflict(
            "Invoice was already issued; use the existing invoice record".into(),
        ));
    }
    if draft["version"].as_i64() != Some(i64::from(input.version)) {
        return Err(AppError::Conflict(
            "Invoice changed; reload before issuing".into(),
        ));
    }
    let order_status: String = row.get("status");
    if matches!(order_status.as_str(), "cancelled" | "rejected" | "draft") {
        return Err(AppError::Conflict(
            "Cancelled, rejected or unapproved orders cannot be invoiced".into(),
        ));
    }
    let compliance: Option<bool> = sqlx::query_scalar(
        "SELECT e_invoice_required FROM invoice_compliance_declarations WHERE plant_id=$1",
    )
    .bind(plant)
    .fetch_optional(&mut *tx)
    .await?;
    match compliance {
        None => return Err(AppError::Conflict("Plant owner must confirm GST e-invoicing applicability before issue".into())),
        Some(true) => return Err(AppError::Conflict("IRN/QR registration is required; this invoice module must not issue without a validated IRP integration".into())),
        Some(false) => {}
    }
    let already: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plant_invoices WHERE order_id=$1)")
            .bind(order)
            .fetch_one(&mut *tx)
            .await?;
    if already {
        return Err(AppError::Conflict("Order is already invoiced".into()));
    }
    let (ch, prepared_qty, active) = collect_challans(&mut tx, order).await?;
    if active == 0
        || ch.len() as i64 != active
        || prepared_qty != row.get::<BigDecimal, _>("total_quantity_m3")
    {
        return Err(AppError::Conflict("All active loads must have matching prepared challans before issuing this order-level invoice".into()));
    }
    let issuer_gstin: Option<String> =
        sqlx::query_scalar("SELECT gstin FROM plant_profiles WHERE plant_id=$1")
            .bind(plant)
            .fetch_optional(&mut *tx)
            .await?
            .flatten();
    if issuer_gstin.is_none()
        || get_opt(&draft, "seller_gstin") != issuer_gstin
        || !valid_gstin(
            &get_str(&draft, "seller_gstin"),
            &get_str(&draft, "seller_state_code"),
        )
    {
        return Err(AppError::Conflict(
            "Seller GST identity is not verified against the plant profile".into(),
        ));
    }
    if !two(&get_str(&draft, "buyer_state_code"))
        || !opt_gstin(
            &get_opt(&draft, "buyer_gstin"),
            &get_str(&draft, "buyer_state_code"),
        )
        || get_str(&draft, "buyer_name").trim().is_empty()
        || get_str(&draft, "buyer_address").trim().is_empty()
    {
        return Err(invalid("buyer identity"));
    }
    let date = NaiveDate::parse_from_str(&get_str(&draft, "invoice_date"), "%Y-%m-%d")
        .map_err(|_| invalid("date"))?;
    if date > Utc::now().date_naive() {
        return Err(invalid("future invoice date"));
    }
    // Invoice grade must remain consistent with the fulfilled order.
    // To change a grade, first correct the approved order and production evidence.
    let recorded_grade: String = row.get("concrete_grade");
    if parse_lines(&draft)?
        .iter()
        .any(|line| line.grade != recorded_grade)
    {
        return Err(AppError::Conflict(
            "Invoice grade differs from the production order; approve and reconcile the source order first".into()
        ));
    }
    let ch_names: Vec<String> = ch.iter().map(|(_, n)| n.clone()).collect();
    let order_number: String = row.get("order_number");
    let delivery_address: String = row.get("delivery_address");
    let mut snap = snapshot(&draft, &order_number, &ch_names, "", &delivery_address)?;
    let due = decimal(&get_str(&snap, "total"), 100000000, false)?;
    let order_total: BigDecimal = row.get("total_amount");
    // Accepted order, Cashfree payment offer and invoice ledger must agree.
    // Commercial changes remain editable as drafts until the order is amended
    // with customer consent by the approved commercial workflow.
    if due != order_total {
        return Err(AppError::Conflict("Edited invoice total differs from the accepted order amount; reconcile pricing and customer approval before issue".into()));
    }
    let fy = if date.month() >= 4 {
        date.year()
    } else {
        date.year() - 1
    };
    let number = if let Some(manual) = get_opt(&draft, "manual_invoice_number") {
        if !valid_num(&manual) {
            return Err(invalid("invoice number"));
        }
        manual
    } else {
        let seq:i32=sqlx::query_scalar(
          "INSERT INTO invoice_sequences(plant_id,fiscal_year_start,last_number) VALUES($1,$2,1)            ON CONFLICT(plant_id,fiscal_year_start) DO UPDATE SET last_number=invoice_sequences.last_number+1            WHERE invoice_sequences.last_number<999999 RETURNING last_number")
          .bind(plant).bind(fy as i16).fetch_optional(&mut *tx).await?
          .ok_or_else(||AppError::Conflict("Invoice number series exhausted".into()))?;
        let slug = plant.simple().to_string();
        format!(
            "I{}{:02}{:06}",
            slug[..6].to_ascii_uppercase(),
            fy % 100,
            seq
        )
    };
    if !valid_num(&number) {
        return Err(invalid("generated invoice number"));
    }
    snap["invoice_number"] = json!(number);
    let sub = decimal(&get_str(&snap, "subtotal"), 100000000, true)?;
    let tax = decimal(&get_str(&snap, "tax"), 100000000, true)?;
    let customer: Uuid = row.get("customer_id");
    let invoice_id:Uuid=sqlx::query_scalar(
      "INSERT INTO plant_invoices(plant_id,order_id,customer_id,invoice_number,invoice_date,subtotal_amount,tax_amount,total_amount)        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id"
    ).bind(plant).bind(order).bind(customer).bind(&number).bind(date).bind(sub).bind(tax).bind(&due)
      .fetch_one(&mut *tx).await?;
    for (challan, _) in &ch {
        sqlx::query("INSERT INTO invoice_challan_links(invoice_id,challan_id) VALUES($1,$2)")
            .bind(invoice_id)
            .bind(challan)
            .execute(&mut *tx)
            .await?;
    }
    let html = super::invoice_print::render(&snap, false);
    sqlx::query("INSERT INTO invoice_documents(invoice_id,plant_id,draft_id,payload,document_html) VALUES($1,$2,$3,$4,$5)")
       .bind(invoice_id).bind(plant).bind(id).bind(&snap).bind(html).execute(&mut *tx).await?;
    sqlx::query("UPDATE invoice_drafts SET issued_invoice_id=$2,status='ISSUED',version=version+1,updated_by=$3,updated_at=NOW() WHERE id=$1")
        .bind(id).bind(invoice_id).bind(user.user_id).execute(&mut *tx).await?;
    // Existing verified prepayment reconciler remains the sole crediting path.
    crate::services::billing_service::apply_verified_rmc_prepayments(
        &mut tx, order, invoice_id, &due,
    )
    .await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'invoice_issued','invoice',$2,$3)")
        .bind(user.user_id).bind(invoice_id.to_string())
        .bind(json!({"order_id":order,"draft_id":id,"challans":ch_names,"source":"standard_invoice_workflow"}))
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"success":true,"invoice_id":invoice_id,"invoice_number":number}),
    ))
}

pub async fn issued_document(
    State(state): State<AppState>,
    user: AuthUser,
    Path(invoice): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let row: Option<(Uuid, String)> =
        sqlx::query_as("SELECT plant_id,document_html FROM invoice_documents WHERE invoice_id=$1")
            .bind(invoice)
            .fetch_optional(&state.db)
            .await?;
    let (plant, html) =
        row.ok_or_else(|| AppError::NotFound("Issued invoice document not found".into()))?;
    require_bill(&state, &user, plant, Action::View).await?;
    Ok(Json(json!({"success":true,"html":html})))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gst_math_is_decimal_and_split_without_loss() {
        let items = vec![InvoiceLine {
            grade: "M25".into(),
            hsn: "38245010".into(),
            quantity_m3: "2.50".into(),
            rate_per_m3: "4000".into(),
            gst_rate: "18".into(),
        }];
        let intra = calculate(&items, "27", "27").unwrap();
        assert_eq!(intra["total"], "11800.00");
        assert_eq!(intra["cgst"], "900.00");
        assert_eq!(intra["sgst"], "900.00");
        let inter = calculate(&items, "27", "29").unwrap();
        assert_eq!(inter["igst"], "1800.00");
    }
    #[test]
    fn manual_invoice_numbers_are_bounded() {
        assert!(valid_num("INV/26/000001"));
        assert!(!valid_num("INV 2026/2027/1000001"));
    }
}
