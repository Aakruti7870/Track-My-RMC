use crate::{
    error::AppError,
    models::order::{CreateOrderRequest, Order, OrderLoad},
    repositories::{order_repo, plant_repo},
    state::AppState,
};
use rand::Rng;
use uuid::Uuid;

pub async fn place_order(
    state: &AppState,
    customer_id: Uuid,
    req: CreateOrderRequest,
) -> Result<Order, AppError> {
    if req.quantity_m3 <= 0.0 {
        return Err(AppError::BadRequest("Order quantity must be greater than zero".to_string()));
    }

    let plant = plant_repo::find_plant_by_id(&state.db, req.plant_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Selected RMC plant does not exist".to_string()))?;

    if !plant.is_active {
        return Err(AppError::BadRequest("Plant is currently not accepting orders".to_string()));
    }

    let random_num: u32 = rand::thread_rng().gen_range(100000..999999);
    let order_number = format!("RMC-{}-{}-{}", plant.code, req.concrete_grade, random_num);

    let rate = req.estimated_rate_per_m3.unwrap_or(4200.0);
    let subtotal = rate * req.quantity_m3;
    let tax = subtotal * 0.18;
    let total = subtotal + tax;

    let order = order_repo::create_order(
        &state.db,
        &order_number,
        customer_id,
        req.plant_id,
        req.site_id,
        &req.concrete_grade,
        req.quantity_m3,
        req.delivery_date,
        &req.delivery_time_slot,
        req.pump_required.unwrap_or(false),
        req.special_instructions.as_deref(),
        total,
        tax,
    )
    .await?;

    Ok(order)
}

pub async fn get_order_with_loads(
    state: &AppState,
    order_id: Uuid,
) -> Result<(Order, Vec<OrderLoad>), AppError> {
    let order = order_repo::find_order_by_id(&state.db, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    let loads = crate::repositories::dispatch_repo::list_loads_for_order(&state.db, order_id).await?;
    Ok((order, loads))
}
