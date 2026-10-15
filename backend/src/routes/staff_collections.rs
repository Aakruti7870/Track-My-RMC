//! Read-only, plant-scoped collection contracts for the Expo StaffCollection screen.
//! Migrated from Tracking-project/backend/routers/staff.py. No implicit global admin access.

use crate::{auth::AuthUser, error::AppError, state::AppState};
use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::{json, Value};
use sqlx::Row;

const SCOPE: &str = r#"
WITH scope AS (
    SELECT p.id FROM rmc_plants p
    WHERE p.is_active = TRUE
      AND (
        p.owner_id = $1
        OR EXISTS (
          SELECT 1 FROM plant_staff ps
          WHERE ps.plant_id = p.id
            AND ps.user_id = $1
            AND ps.is_active = TRUE
        )
      )
)
"#;

/// No platform-wide directory or KYC profile is returned from a plant staff endpoint.
/// In particular, a legacy mobile 'admin' role does not grant Central Admin access.
fn collection_policy(kind: &str, role: &str) -> Option<(&'static str, &'static str)> {
    let owners = ["owner", "plant_owner", "admin"];
    let permits = match kind {
        "orders" => {
            owners.contains(&role)
                || [
                    "dispatcher",
                    "operator",
                    "supervisor",
                    "quality_engineer",
                    "fleet_manager",
                    "store_manager",
                    "accountant",
                ]
                .contains(&role)
        }
        "dispatch" => {
            owners.contains(&role) || ["dispatcher", "supervisor", "fleet_manager"].contains(&role)
        }
        "production" => {
            owners.contains(&role) || ["operator", "supervisor", "dispatcher"].contains(&role)
        }
        "quality" => owners.contains(&role) || ["quality_engineer", "supervisor"].contains(&role),
        "incidents" => {
            owners.contains(&role) || ["supervisor", "dispatcher", "fleet_manager"].contains(&role)
        }
        "fleet" => {
            owners.contains(&role)
                || ["dispatcher", "fleet_manager", "operator", "supervisor"].contains(&role)
        }
        "drivers" => {
            owners.contains(&role) || ["dispatcher", "fleet_manager", "supervisor"].contains(&role)
        }
        "invoices" | "ledger" => owners.contains(&role) || role == "accountant",
        "inventory" => {
            owners.contains(&role) || ["store_manager", "operator", "supervisor"].contains(&role)
        }
        "plants" => {
            owners.contains(&role)
                || [
                    "dispatcher",
                    "operator",
                    "supervisor",
                    "quality_engineer",
                    "fleet_manager",
                    "store_manager",
                    "accountant",
                ]
                .contains(&role)
        }
        // Restricted original features require dedicated web-only provenance and permission
        // checks; they are NOT exposed by this operational staff collection.
        "kyc" | "users" => false,
        _ => return None,
    };
    if !permits {
        return Some(("FORBIDDEN", "Not authorized to view this collection"));
    }
    Some(match kind {
        "orders" => ("Orders", "No orders yet"),
        "dispatch" => ("Dispatch Queue", "Nothing to dispatch"),
        "production" => ("Production Queue", "No orders in production"),
        "quality" => ("Quality Register", "No batches to inspect"),
        "incidents" => ("Incidents", "No incidents reported"),
        "fleet" => ("Fleet", "No vehicles"),
        "drivers" => ("Drivers", "No drivers linked"),
        "invoices" => ("Invoices", "No invoices raised"),
        "ledger" => ("Customer Ledger", "No ledger entries"),
        "inventory" => ("Stock Levels", "No materials tracked"),
        "plants" => ("Plants", "No plants registered"),
        _ => unreachable!(),
    })
}

fn collection_sql(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "orders" => {
            r#"
SELECT o.id::text id, 'cube-outline' icon,
       o.order_number || ' · ' || o.concrete_grade primary_text,
       COALESCE(u.full_name, 'Customer') || ' — ' || o.total_quantity_m3::text || ' m³' secondary_text,
       s.name meta_text, o.status badge, o.status badge_status
FROM orders o JOIN scope sc ON sc.id = o.plant_id
LEFT JOIN users u ON u.id = o.customer_id
LEFT JOIN customer_sites s ON s.id = o.site_id
ORDER BY o.created_at DESC LIMIT 500
"#
        }
        "dispatch" => {
            r#"
SELECT o.id::text id, 'cube-outline' icon,
       o.order_number || ' · ' || o.concrete_grade primary_text,
       COALESCE(u.full_name, 'Customer') || ' — ' || o.total_quantity_m3::text || ' m³' secondary_text,
       s.name meta_text, o.status badge, o.status badge_status
FROM orders o JOIN scope sc ON sc.id = o.plant_id
LEFT JOIN users u ON u.id = o.customer_id LEFT JOIN customer_sites s ON s.id = o.site_id
WHERE lower(o.status) IN ('confirmed','ready_to_dispatch','scheduled','in_production',
   'produced','production_complete','dispatched','in_transit','at_site','pouring')
ORDER BY o.updated_at DESC LIMIT 500
"#
        }
        "production" => {
            r#"
SELECT o.id::text id, 'cube-outline' icon,
       o.order_number || ' · ' || o.concrete_grade primary_text,
       COALESCE(u.full_name, 'Customer') || ' — ' || o.total_quantity_m3::text || ' m³' secondary_text,
       s.name meta_text, o.status badge, o.status badge_status
FROM orders o JOIN scope sc ON sc.id = o.plant_id
LEFT JOIN users u ON u.id = o.customer_id LEFT JOIN customer_sites s ON s.id = o.site_id
WHERE lower(o.status) IN ('confirmed','scheduled','in_production','produced','production_complete')
ORDER BY o.updated_at DESC LIMIT 500
"#
        }
        "quality" => {
            r#"
SELECT o.id::text id, 'flask-outline' icon,
       o.concrete_grade || ' · ' || o.order_number primary_text,
       o.total_quantity_m3::text || ' m³ — ' || COALESCE(s.name, '') secondary_text,
       o.status meta_text,
       CASE WHEN EXISTS (SELECT 1 FROM cube_tests c WHERE c.order_id = o.id)
            THEN 'QC Recorded' ELSE 'Pending QC' END badge,
       CASE WHEN EXISTS (SELECT 1 FROM cube_tests c WHERE c.order_id = o.id)
            THEN 'DELIVERED' ELSE 'PENDING' END badge_status
FROM orders o JOIN scope sc ON sc.id = o.plant_id
LEFT JOIN customer_sites s ON s.id = o.site_id
WHERE lower(o.status) IN ('in_production','produced','production_complete',
   'dispatched','in_transit','delivered')
ORDER BY o.updated_at DESC LIMIT 500
"#
        }
        "incidents" => {
            r#"
SELECT a.id::text id, 'warning-outline' icon,
       a.alert_type || ' · ' || COALESCE(u.full_name, 'Driver') primary_text,
       COALESCE(a.message, 'No details') secondary_text,
       o.order_number meta_text, a.status badge,
       CASE WHEN upper(a.status) = 'RESOLVED' THEN 'DELIVERED' ELSE 'REJECTED' END badge_status
FROM driver_sos_alerts a
JOIN users u ON u.id = a.driver_id
LEFT JOIN order_loads l ON l.id = a.load_id
LEFT JOIN orders o ON o.id = l.order_id
WHERE (o.plant_id IN (SELECT id FROM scope)
       OR (a.load_id IS NULL AND EXISTS (
           SELECT 1 FROM plant_staff ps JOIN scope sc ON sc.id = ps.plant_id
           WHERE ps.user_id = a.driver_id AND ps.is_active = TRUE
       )))
ORDER BY a.created_at DESC LIMIT 300
"#
        }
        "fleet" => {
            r#"
SELECT m.id::text id, 'bus-outline' icon,
       m.registration_number primary_text,
       'Capacity ' || m.capacity_m3::text || ' m³' secondary_text,
       u.full_name meta_text, m.status badge,
       CASE WHEN lower(m.status) IN ('idle','available') THEN 'DELIVERED'
            ELSE 'DISPATCHED' END badge_status
FROM transit_mixers m JOIN scope sc ON sc.id = m.plant_id
LEFT JOIN users u ON u.id = m.driver_id
ORDER BY m.registration_number LIMIT 500
"#
        }
        "drivers" => {
            r#"
SELECT DISTINCT ON (u.id) u.id::text id, 'person-outline' icon,
       u.full_name primary_text, u.phone secondary_text,
       m.registration_number meta_text,
       CASE WHEN u.is_active THEN 'Active' ELSE 'Inactive' END badge,
       CASE WHEN u.is_active THEN 'DELIVERED' ELSE 'REJECTED' END badge_status
FROM users u
JOIN plant_staff ps ON ps.user_id = u.id AND ps.is_active = TRUE
JOIN scope sc ON sc.id = ps.plant_id
LEFT JOIN transit_mixers m ON m.driver_id = u.id AND m.plant_id = ps.plant_id
WHERE u.role = 'driver' OR ps.role = 'driver'
ORDER BY u.id, m.registration_number LIMIT 500
"#
        }
        "invoices" => {
            r#"
SELECT i.id::text id, 'receipt-outline' icon,
       i.invoice_number || ' · ' || COALESCE(u.full_name, 'Customer') primary_text,
       'Total ₹' || i.total_amount::text secondary_text,
       'Paid ₹' || COALESCE(p.paid, 0)::text || ' · Balance ₹' ||
         (i.total_amount - COALESCE(p.paid, 0))::text meta_text,
       i.status badge, i.status badge_status
FROM plant_invoices i JOIN scope sc ON sc.id = i.plant_id
LEFT JOIN users u ON u.id = i.customer_id
LEFT JOIN LATERAL (
    SELECT SUM(amount) paid FROM plant_payments WHERE invoice_id = i.id
) p ON TRUE
ORDER BY i.created_at DESC LIMIT 500
"#
        }
        "ledger" => {
            r#"
SELECT MIN(i.id::text) id, 'person-circle-outline' icon,
       COALESCE(u.full_name, 'Customer') primary_text,
       'Billed ₹' || SUM(i.total_amount)::text || ' · Paid ₹' ||
         SUM(COALESCE(p.paid, 0))::text secondary_text,
       'Balance ₹' || (SUM(i.total_amount) - SUM(COALESCE(p.paid, 0)))::text meta_text,
       CASE WHEN SUM(i.total_amount) - SUM(COALESCE(p.paid, 0)) <= 0
            THEN 'Cleared' ELSE 'Due' END badge,
       CASE WHEN SUM(i.total_amount) - SUM(COALESCE(p.paid, 0)) <= 0
            THEN 'DELIVERED' ELSE 'REJECTED' END badge_status
FROM plant_invoices i JOIN scope sc ON sc.id = i.plant_id
LEFT JOIN users u ON u.id = i.customer_id
LEFT JOIN LATERAL (
    SELECT SUM(amount) paid FROM plant_payments WHERE invoice_id = i.id
) p ON TRUE
GROUP BY i.customer_id, u.full_name ORDER BY primary_text LIMIT 500
"#
        }
        "inventory" => {
            r#"
SELECT m.id::text id, 'cube-outline' icon, m.name primary_text,
       m.current_stock::text || ' ' || m.unit || ' in stock' secondary_text,
       'Reorder ≤ ' || m.minimum_stock::text || ' ' || m.unit meta_text,
       CASE WHEN m.current_stock <= m.minimum_stock THEN 'LOW' ELSE 'OK' END badge,
       CASE WHEN m.current_stock <= m.minimum_stock THEN 'REJECTED' ELSE 'DELIVERED' END badge_status
FROM plant_materials m JOIN scope sc ON sc.id = m.plant_id
ORDER BY m.name LIMIT 500
"#
        }
        "plants" => {
            r#"
SELECT p.id::text id, 'business-outline' icon, p.name primary_text,
       p.city || ' · ' || p.state secondary_text, p.contact_phone meta_text,
       CASE WHEN p.is_active THEN 'Active' ELSE 'Inactive' END badge,
       CASE WHEN p.is_active THEN 'DELIVERED' ELSE 'PENDING' END badge_status
FROM rmc_plants p JOIN scope sc ON sc.id = p.id
ORDER BY p.name LIMIT 500
"#
        }
        _ => return None,
    })
}

pub async fn get_staff_collection(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(kind): Path<String>,
) -> Result<Json<Value>, AppError> {
    let (title, empty) = collection_policy(&kind, &auth_user.role)
        .ok_or_else(|| AppError::NotFound("Unknown staff collection".to_owned()))?;
    if title == "FORBIDDEN" {
        return Err(AppError::Forbidden(empty.to_owned()));
    }

    let scoped: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM rmc_plants p WHERE p.is_active = TRUE AND (p.owner_id = $1 OR EXISTS (SELECT 1 FROM plant_staff ps WHERE ps.plant_id = p.id AND ps.user_id = $1 AND ps.is_active = TRUE)))",
    )
    .bind(auth_user.user_id)
    .fetch_one(&state.db).await?;
    if !scoped {
        return Err(AppError::Forbidden("No assigned active plant".to_owned()));
    }

    let sql = format!(
        "{} {}",
        SCOPE,
        collection_sql(&kind).expect("allowed collection has SQL")
    );
    let rows = sqlx::query(&sql)
        .bind(auth_user.user_id)
        .fetch_all(&state.db)
        .await?;
    let can_nav_dispatch =
        ["dispatcher", "supervisor", "owner", "plant_owner"].contains(&auth_user.role.as_str());
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            let id: String = row.get("id");
            let status: String = row.get("badge_status");
            let nav = if kind == "dispatch"
                && can_nav_dispatch
                && !status.eq_ignore_ascii_case("delivered")
            {
                Some(format!("/dispatch-order/{}", id))
            } else {
                None
            };
            json!({
                "id": id,
                "icon": row.get::<String, _>("icon"),
                "primary": row.get::<String, _>("primary_text"),
                "secondary": row.get::<Option<String>, _>("secondary_text"),
                "meta": row.get::<Option<String>, _>("meta_text"),
                "badge": row.get::<String, _>("badge"),
                "badge_status": status,
                "nav": nav,
                "actions": []
            })
        })
        .collect();

    Ok(Json(
        json!({ "title": title, "empty": empty, "items": items, "success": true }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operational_collection_policy_is_role_scoped() {
        for kind in [
            "orders",
            "dispatch",
            "production",
            "quality",
            "incidents",
            "fleet",
            "drivers",
            "invoices",
            "ledger",
            "inventory",
            "plants",
        ] {
            assert!(collection_policy(kind, "plant_owner").is_some());
            assert!(collection_sql(kind).is_some());
            assert_eq!(collection_policy(kind, "driver").unwrap().0, "FORBIDDEN");
            assert_eq!(collection_policy(kind, "customer").unwrap().0, "FORBIDDEN");
            assert_eq!(
                collection_policy(kind, "central_admin").unwrap().0,
                "FORBIDDEN"
            );
        }
        assert_eq!(
            collection_policy("invoices", "operator").unwrap().0,
            "FORBIDDEN"
        );
        assert_eq!(
            collection_policy("inventory", "accountant").unwrap().0,
            "FORBIDDEN"
        );
        assert_eq!(collection_policy("users", "admin").unwrap().0, "FORBIDDEN");
        assert_eq!(collection_policy("kyc", "admin").unwrap().0, "FORBIDDEN");
        assert!(collection_policy("does_not_exist", "owner").is_none());
    }

    #[test]
    fn all_live_queries_filter_through_plant_scope() {
        for kind in [
            "orders",
            "dispatch",
            "production",
            "quality",
            "incidents",
            "fleet",
            "drivers",
            "invoices",
            "ledger",
            "inventory",
            "plants",
        ] {
            assert!(collection_sql(kind).unwrap().contains("scope"));
        }
        assert!(SCOPE.contains("p.owner_id = $1"));
        assert!(SCOPE.contains("ps.user_id = $1"));
        assert!(SCOPE.contains("ps.is_active = TRUE"));
    }
}
