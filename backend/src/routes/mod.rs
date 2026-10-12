pub mod account_deletion;
pub mod admin_routes;
pub mod auth_routes;
pub mod customer_routes;
pub mod dispatcher_routes;
pub mod driver_routes;
pub mod health;
pub mod notifications;
pub mod owner_routes;
pub mod plant_onboarding;
pub mod play_review;
pub mod well_known;
pub mod workforce_reports;
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
        // Android Digital Asset Links and KYC return page.
        .route("/.well-known/assetlinks.json", get(well_known::asset_links))
        .route("/kyc/return", get(well_known::kyc_return))
        // --- Account deletion requests (verified public request + authenticated status/cancel) ---
        .route(
            "/api/account-deletion/otp/send",
            post(account_deletion::send_public_otp),
        )
        .route(
            "/api/account-deletion/public-request",
            post(account_deletion::submit_public_request),
        )
        .route(
            "/api/account-deletion/status",
            get(account_deletion::status),
        )
        .route(
            "/api/account-deletion/request",
            post(account_deletion::submit_signed_in_request),
        )
        .route(
            "/api/account-deletion/cancel",
            post(account_deletion::cancel),
        )
        // --- User-scoped notifications and push-token registration ---
        .route("/api/notifications", get(notifications::list_notifications))
        .route(
            "/api/notifications/read-all",
            post(notifications::mark_all_read),
        )
        .route(
            "/api/notifications/:id/read",
            post(notifications::mark_one_read),
        )
        .route(
            "/api/notifications/device/register",
            post(notifications::register_device_token),
        )
        .route(
            "/api/notifications/device/unregister",
            post(notifications::unregister_device_token),
        )
        // --- Authentication & Profile ---
        .route("/api/auth/play-review", post(play_review::login))
        .route("/api/auth/register", post(auth_routes::register))
        .route("/api/auth/login", post(auth_routes::login))
        .route("/api/me", get(auth_routes::get_me))
        .route("/api/auth/logout", post(auth_routes::logout))
        // --- User & Driver Authentication: Meta WhatsApp Cloud API ---
        .route(
            "/api/auth/otp/whatsapp/send",
            post(auth_routes::send_whatsapp_otp),
        )
        .route(
            "/api/auth/otp/whatsapp/verify",
            post(auth_routes::verify_whatsapp_otp),
        )
        // --- Other Roles (Staff, Owner, Super Admin): Email OTP ---
        .route(
            "/api/auth/otp/email/send",
            post(auth_routes::send_email_otp),
        )
        .route(
            "/api/auth/otp/email/verify",
            post(auth_routes::verify_email_otp),
        )
        // Backward-compatible aliases for existing client mobile & admin app code
        .route(
            "/api/staff/auth/send-otp",
            post(auth_routes::send_email_otp),
        )
        .route(
            "/api/staff/auth/verify-otp",
            post(auth_routes::verify_email_otp),
        )
        .route(
            "/api/auth/staff/mfa/enroll/start",
            post(auth_routes::start_staff_mfa_enrollment),
        )
        .route(
            "/api/auth/staff/mfa/enroll/confirm",
            post(auth_routes::confirm_staff_mfa_enrollment),
        )
        // Staff login second factor. These endpoints require the opaque challenge
        // returned after successful email OTP; no identifier-only MFA is accepted.
        .route(
            "/api/auth/staff/mfa/verify-totp",
            post(auth_routes::verify_staff_mfa),
        )
        .route(
            "/api/auth/staff/mfa/verify-recovery",
            post(auth_routes::verify_staff_mfa),
        )
        // --- Authenticator App (RFC 6238 TOTP) ---
        .route("/api/auth/totp/setup", post(auth_routes::setup_totp))
        .route(
            "/api/auth/totp/verify-setup",
            post(auth_routes::verify_totp_setup),
        )
        .route("/api/auth/totp/login", post(auth_routes::totp_login))
        // WebAuthn passkey endpoints are intentionally not exposed until full
        // challenge, origin, RP-ID, signature, and counter verification is implemented.
        // --- Customer Domain ---
        .route("/api/customer/plants", get(customer_routes::list_plants))
        .route("/api/customer/grades", get(customer_routes::get_grades))
        .route(
            "/api/customer/sites",
            get(customer_routes::list_sites).post(customer_routes::create_site),
        )
        .route(
            "/api/customer/orders",
            get(customer_routes::list_orders).post(customer_routes::place_order),
        )
        .route(
            "/api/customer/orders/:id",
            get(customer_routes::get_order_details),
        )
        // --- Driver Domain ---
        .route("/api/driver/home", get(driver_routes::get_driver_home))
        .route(
            "/api/driver/attendance",
            get(driver_routes::get_driver_attendance),
        )
        .route(
            "/api/driver/attendance/checkin",
            post(driver_routes::check_in_driver),
        )
        .route(
            "/api/driver/attendance/checkout",
            post(driver_routes::check_out_driver),
        )
        .route("/api/driver/trips", get(driver_routes::get_driver_trips))
        .route("/api/driver/location", post(driver_routes::update_location))
        .route(
            "/api/driver/trips/:load_id/sign",
            post(driver_routes::sign_challan),
        )
        .route(
            "/api/driver/trips/:load_id/pod",
            post(driver_routes::submit_pod),
        )
        // --- Dispatcher Domain ---
        .route(
            "/api/dispatcher/fleet/:plant_id",
            get(dispatcher_routes::get_plant_fleet),
        )
        .route(
            "/api/dispatcher/loads/assign",
            post(dispatcher_routes::assign_load),
        )
        .route(
            "/api/dispatcher/orders/:id/status",
            patch(dispatcher_routes::update_order_status),
        )
        // --- Plant discovery and public partner onboarding ---
        .route(
            "/api/plant-onboarding/places",
            get(plant_onboarding::search_places),
        )
        .route(
            "/api/plant-onboarding/requests",
            post(plant_onboarding::submit_onboarding),
        )
        .route(
            "/api/plant-discovery/requests",
            get(plant_onboarding::list_requests),
        )
        .route(
            "/api/plant-discovery/requests/:request_id/approve",
            post(plant_onboarding::approve_listing),
        )
        .route(
            "/api/plant-discovery/requests/:request_id/reject",
            post(plant_onboarding::reject_listing),
        )
        // --- Owner Domain ---
        .route("/api/master/my-plants", get(owner_routes::my_plants))
        .route(
            "/api/owner/plants",
            get(owner_routes::list_owner_plants).post(owner_routes::create_plant),
        )
        .route(
            "/api/owner/billing",
            get(owner_routes::get_billing_overview),
        )
        // --- Workforce & Payroll ---
        .route("/api/workforce/roster", get(workforce_routes::get_roster))
        .route(
            "/api/workforce/attendance/mark",
            post(workforce_routes::mark_attendance),
        )
        // Read-only monthly attendance and persisted payroll summary.
        .route(
            "/api/workforce-reports/monthly",
            get(workforce_reports::monthly_summary),
        )
        // --- Admin Portal ---
        .route("/api/admin/auth/login", post(admin_routes::admin_login))
        .route(
            "/api/admin/portal/overview",
            get(admin_routes::portal_overview),
        )
        .with_state(state)
}
