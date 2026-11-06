//! Explicit Owner approval for synthetic legacy fixtures. Production missing
//! permissions fail closed; these fixtures intentionally authorize their roles.
pub async fn approve_fixture_assignments(db: &sqlx::PgPool) {
    use trackmyrmc_backend::routes::staff_module_permissions::role_ceiling;
    let rows:Vec<(uuid::Uuid,uuid::Uuid,String,uuid::Uuid)>=sqlx::query_as("SELECT ps.plant_id,ps.user_id,ps.role,p.owner_id FROM plant_staff ps JOIN rmc_plants p ON p.id=ps.plant_id WHERE ps.is_active AND ps.removed_at IS NULL")
        .fetch_all(db).await.unwrap();
    for (plant, staff, role, owner) in rows {
        for key in [
            "dispatch_queue",
            "fleet_availability",
            "challan_gate_pass",
            "material_inventory",
            "billing_ledger",
            "payroll",
            "production_queue",
            "quality_register",
            "mix_designs",
            "diesel_ledger",
            "suppliers",
            "purchases",
            "quotations",
            "expenses",
            "rate_cards",
            "workforce",
            "incidents",
            "plant_reports",
            "driver_roster",
            "employee_master",
        ] {
            if let Some(grant) = role_ceiling(&role, key) {
                sqlx::query("INSERT INTO plant_staff_module_permissions(plant_id,user_id,module_key,can_view,can_edit,can_approve,can_create,can_export,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING")
                    .bind(plant).bind(staff).bind(key).bind(grant.view).bind(grant.edit).bind(grant.approve).bind(grant.create).bind(grant.export).bind(owner)
                    .execute(db).await.unwrap();
            }
        }
    }
}
