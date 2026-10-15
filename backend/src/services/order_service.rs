use crate::{
    error::AppError,
    models::order::{CreateOrderRequest, Order, OrderLoad},
    repositories::order_repo,
    state::AppState,
};
use uuid::Uuid;

pub async fn place_order(
    state: &AppState,
    customer_id: Uuid,
    req: CreateOrderRequest,
) -> Result<Order, AppError> {
    super::customer_order::place(state, customer_id, req).await
}

pub async fn get_order_with_loads(
    state: &AppState,
    order_id: Uuid,
) -> Result<(Order, Vec<OrderLoad>), AppError> {
    let order = order_repo::find_order_by_id(&state.db, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    let loads =
        crate::repositories::dispatch_repo::list_loads_for_order(&state.db, order_id).await?;
    Ok((order, loads))
}

// Preserve storage state names while exposing the established mobile contract.
pub const MOBILE_ORDER_SELECT:&str="SELECT to_jsonb(o)||jsonb_build_object('grade',o.concrete_grade,'quantity',o.total_quantity_m3::DOUBLE PRECISION,'quantity_m3',o.total_quantity_m3::DOUBLE PRECISION,'plant_name',p.name,'site_name',s.name,'site_address',s.address_line,'customer_name',u.full_name,'customer_mobile',u.phone,'delivery_time',o.delivery_time_slot,'invoice_number',(SELECT invoice_number FROM plant_invoices WHERE order_id=o.id ORDER BY created_at LIMIT 1),'status',CASE o.status WHEN 'confirmed' THEN 'ACCEPTED' WHEN 'produced' THEN 'PRODUCTION_COMPLETE' WHEN 'in_transit' THEN 'EN_ROUTE' WHEN 'pouring' THEN 'UNLOADING' WHEN 'completed' THEN 'DELIVERED' ELSE UPPER(o.status) END) FROM orders o JOIN rmc_plants p ON p.id=o.plant_id JOIN customer_sites s ON s.id=o.site_id JOIN users u ON u.id=o.customer_id";

pub async fn mobile_detail(
    state: &AppState,
    user: &crate::auth::AuthUser,
    id: Uuid,
) -> Result<serde_json::Value, AppError> {
    crate::routes::loads_routes::ensure_order_access(state, user, id, true).await?;
    let query = format!("{MOBILE_ORDER_SELECT} WHERE o.id=$1");
    let order: serde_json::Value = sqlx::query_scalar(&query)
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    let history:Vec<serde_json::Value>=sqlx::query_scalar("SELECT jsonb_build_object('status',UPPER(metadata->>'to'),'at',created_at,'note',action) FROM audit_logs WHERE resource_type='order' AND resource_id=$1 AND metadata ? 'to' ORDER BY created_at").bind(id.to_string()).fetch_all(&state.db).await?;
    let loads:Vec<serde_json::Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',l.id,'load_id',l.id,'load_number',l.load_number,'quantity_m3',l.quantity_m3::DOUBLE PRECISION,'status',CASE l.status WHEN 'completed' THEN 'DELIVERED' WHEN 'pouring' THEN 'UNLOADING' ELSE UPPER(l.status) END,'tm_number',m.registration_number,'driver_name',u.full_name,'challan_number',c.challan_number,'gate_pass_number',g.pass_number) FROM order_loads l LEFT JOIN transit_mixers m ON m.id=l.mixer_id LEFT JOIN users u ON u.id=l.driver_id LEFT JOIN challans c ON c.load_id=l.id LEFT JOIN gate_passes g ON g.load_id=l.id WHERE l.order_id=$1 ORDER BY l.load_number").bind(id).fetch_all(&state.db).await?;
    let pods:Vec<serde_json::Value>=sqlx::query_scalar("SELECT to_jsonb(p) FROM proof_of_deliveries p JOIN order_loads l ON l.id=p.load_id WHERE l.order_id=$1 ORDER BY p.delivered_at").bind(id).fetch_all(&state.db).await?;
    Ok(
        serde_json::json!({"success":true,"order":order,"loads":loads,"history":history,"pod":pods.last(),"pods":pods}),
    )
}
