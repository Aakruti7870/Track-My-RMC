pub mod admin_routes;
pub mod auth_routes;
pub mod customer_routes;
pub mod dispatcher_routes;
pub mod driver_routes;
pub mod health;
pub mod owner_routes;
pub mod workforce_routes;

use crate::state::AppState;
use axum::{
    routing::{get, patch, post},
    Router,
};

pub fn build_app_router(state: AppState) -> Router {
    Router::new()
        // Health check (Render monitoring)
        .route("/health", get(health::health_check))

        // --- Authentication & Profile ---
        .route("/api/auth/register", post(auth_routes::register))
        .route("/api/auth/login", post(auth_routes::login))
        .route("/api/me", get(auth_routes::get_me))

        // --- User & Driver Authentication: Meta WhatsApp Cloud API ---
        .route("/api/auth/otp/whatsapp/send", post(auth_routes::send_whatsapp_otp))
        .route("/api/auth/otp/whatsapp/verify", post(auth_routes::verify_whatsapp_otp))

        // --- Other Roles (Staff, Owner, Super Admin): Email OTP ---
        .route("/api/auth/otp/email/send", post(auth_routes::send_email_otp))
        .route("/api/auth/otp/email/verify", post(auth_routes::verify_email_otp))
        // Backward-compatible aliases for existing client mobile & admin app code
        .route("/api/staff/auth/send-otp", post(auth_routes::send_email_otp))
        .route("/api/staff/auth/verify-otp", post(auth_routes::verify_email_otp))

        // --- Authenticator App (RFC 6238 TOTP) ---
        .route("/api/auth/totp/setup", post(auth_routes::setup_totp))
        .route("/api/auth/totp/verify-setup", post(auth_routes::verify_totp_setup))
        .route("/api/auth/totp/login", post(auth_routes::totp_login))

        // WebAuthn passkey endpoints are intentionally not exposed until full
        // challenge, origin, RP-ID, signature, and counter verification is implemented.

        // --- Customer Domain ---
        .route("/api/customer/plants", get(customer_routes::list_plants))
        .route("/api/customer/grades", get(customer_routes::get_grades))
        .route("/api/customer/sites", get(customer_routes::list_sites).post(customer_routes::create_site))
        .route("/api/customer/orders", get(customer_routes::list_orders).post(customer_routes::place_order))
        .route("/api/customer/orders/:id", get(customer_routes::get_order_details))

        // --- Driver Domain ---
        .route("/api/driver/trips", get(driver_routes::get_driver_trips))
        .route("/api/driver/location", post(driver_routes::update_location))
        .route("/api/driver/trips/:load_id/sign", post(driver_routes::sign_challan))
        .route("/api/driver/trips/:load_id/pod", post(driver_routes::submit_pod))

        // --- Dispatcher Domain ---
        .route("/api/dispatcher/fleet/:plant_id", get(dispatcher_routes::get_plant_fleet))
        .route("/api/dispatcher/loads/assign", post(dispatcher_routes::assign_load))
        .route("/api/dispatcher/orders/:id/status", patch(dispatcher_routes::update_order_status))

        // --- Owner Domain ---
        .route("/api/owner/plants", post(owner_routes::create_plant))
        .route("/api/owner/billing", get(owner_routes::get_billing_overview))

        // --- Workforce & Payroll ---
        .route("/api/workforce/roster", get(workforce_routes::get_roster))
        .route("/api/workforce/attendance/mark", post(workforce_routes::mark_attendance))

        // --- Admin Portal ---
        .route("/api/admin/auth/login", post(admin_routes::admin_login))
        .route("/api/admin/portal/overview", get(admin_routes::portal_overview))

        .with_state(state)
}
