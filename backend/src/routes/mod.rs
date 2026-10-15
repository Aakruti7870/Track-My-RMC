pub mod account_deletion;
pub mod admin_routes;
pub mod assistant_routes;
pub mod auth_routes;
pub mod automation_routes;
pub mod business_routes;
pub mod control_center_routes;
pub mod customer_routes;
pub mod dispatcher_routes;
pub mod driver_routes;
pub mod finance_ops_routes;
pub mod health;
pub mod hr_routes;
pub mod loads_routes;
pub mod maps_routes;
pub mod master_data_routes;
pub mod notifications;
pub mod owner_routes;
pub mod payroll_routes;
pub mod plant_onboarding;
pub mod plant_plans_routes;
pub mod play_review;
pub mod staff_collections;
pub mod staff_routes;
pub mod storage_routes;
pub mod well_known;
pub mod workforce_reports;
pub mod workforce_routes;

use crate::state::AppState;
use axum::{
    routing::{delete, get, patch, post, put},
    Router,
};

pub fn build_app_router(state: AppState) -> Router {
    Router::new()
        .route(
            "/api/admin/auth/logout",
            post(crate::auth::control_center::logout),
        )
        .route(
            "/api/control-center/collections/:kind",
            get(control_center_routes::collection),
        )
        .route(
            "/api/admin/auth/method",
            post(crate::auth::control_center::method),
        )
        .route(
            "/api/admin/auth/verify-totp",
            post(crate::auth::control_center::login),
        )
        .route("/api/admin/auth/me", get(crate::auth::control_center::me))
        .route(
            "/api/admin/auth/step-up",
            post(control_center_routes::admin_step_up),
        )
        .route(
            "/api/admin/auth/logout-all",
            post(control_center_routes::admin_logout_all),
        )
        // Health check (monitoring & probes)
        .route("/health", get(health::health_check))
        // Android Digital Asset Links and KYC return page
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
            "/api/auth/staff/mfa/method",
            post(auth_routes::staff_mfa_method),
        )
        .route(
            "/api/auth/staff/mfa/enroll/start",
            post(auth_routes::start_staff_mfa_enrollment),
        )
        .route(
            "/api/auth/staff/mfa/enroll/confirm",
            post(auth_routes::confirm_staff_mfa_enrollment),
        )
        // Staff login second factor. Requires verified opaque challenge.
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
        // --- Master Data & Plant Configuration ---
        .route(
            "/api/master/plants/:plant_id/profile",
            get(master_data_routes::get_plant_profile)
                .post(master_data_routes::update_plant_profile),
        )
        .route(
            "/api/master/plants/:plant_id/rate-cards",
            get(master_data_routes::list_rate_cards).post(master_data_routes::create_rate_card),
        )
        .route(
            "/api/master/plants/:plant_id/mix-designs",
            get(master_data_routes::list_mix_designs).post(master_data_routes::create_mix_design),
        )
        .route(
            "/api/master/plants/:plant_id/resources",
            get(master_data_routes::get_plant_resources),
        )
        .route(
            "/api/master/plants/:plant_id/people",
            get(master_data_routes::list_plant_people),
        )
        .route(
            "/api/master/plants/:plant_id/suppliers",
            get(master_data_routes::list_plant_suppliers)
                .post(master_data_routes::create_plant_supplier),
        )
        .route(
            "/api/master/plants/:plant_id/materials",
            get(business_routes::list_materials).post(business_routes::create_material),
        )
        .route(
            "/api/master/plants/:plant_id/materials/:material_id/adjust",
            post(business_routes::adjust_material_stock),
        )
        .route(
            "/api/master/plants/:plant_id/vehicles",
            get(business_routes::list_vehicles).post(business_routes::create_vehicle),
        )
        .route(
            "/api/master/plants/:plant_id/vehicles/:vehicle_id/status",
            patch(business_routes::update_vehicle_status)
                .post(business_routes::update_vehicle_status),
        )
        .route(
            "/api/master/plants/:plant_id/staff",
            post(business_routes::add_plant_staff),
        )
        .route(
            "/api/master/plants/:plant_id/staff/:user_id/suspend",
            post(business_routes::suspend_plant_staff),
        )
        .route(
            "/api/master/plants/:plant_id/staff/:user_id/activate",
            post(business_routes::activate_plant_staff),
        )
        .route(
            "/api/master/plants/:plant_id/customers",
            get(business_routes::list_plant_customers),
        )
        // --- Business Module Operations ---
        .route(
            "/api/business/plants/:plant_id/materials",
            get(business_routes::list_materials).post(business_routes::create_material),
        )
        .route(
            "/api/business/plants/:plant_id/materials/:material_id/adjust",
            post(business_routes::adjust_material_stock),
        )
        .route(
            "/api/business/plants/:plant_id/vehicles",
            get(business_routes::list_vehicles).post(business_routes::create_vehicle),
        )
        .route(
            "/api/business/plants/:plant_id/vehicles/:vehicle_id/status",
            patch(business_routes::update_vehicle_status)
                .post(business_routes::update_vehicle_status),
        )
        .route(
            "/api/business/plants/:plant_id/people",
            get(master_data_routes::list_plant_people).post(business_routes::add_plant_staff),
        )
        .route(
            "/api/business/plants/:plant_id/people/:user_id/suspend",
            post(business_routes::suspend_plant_staff),
        )
        .route(
            "/api/business/plants/:plant_id/people/:user_id/activate",
            post(business_routes::activate_plant_staff),
        )
        .route(
            "/api/business/plants/:plant_id/staff",
            post(business_routes::add_plant_staff),
        )
        .route(
            "/api/business/plants/:plant_id/staff/:user_id/suspend",
            post(business_routes::suspend_plant_staff),
        )
        .route(
            "/api/business/plants/:plant_id/staff/:user_id/activate",
            post(business_routes::activate_plant_staff),
        )
        .route(
            "/api/business/plants/:plant_id/customers",
            get(business_routes::list_plant_customers),
        )
        .route(
            "/api/master/sites/:site_id",
            delete(master_data_routes::delete_customer_site),
        )
        .route(
            "/api/master/customer/sites",
            get(customer_routes::list_sites).post(customer_routes::create_site),
        )
        .route(
            "/api/master/customer/sites/:site_id",
            delete(master_data_routes::delete_customer_site),
        )
        // --- Customer Domain ---
        .route("/api/customer/plants", get(customer_routes::list_plants))
        .route(
            "/api/customer/compare-plants",
            get(customer_routes::compare_plants),
        )
        .route("/api/customer/grades", get(customer_routes::get_grades))
        .route(
            "/api/customer/sites",
            get(customer_routes::list_sites).post(customer_routes::create_site),
        )
        .route(
            "/api/customer/sites/:site_id",
            delete(master_data_routes::delete_customer_site),
        )
        .route(
            "/api/customer/home",
            get(customer_routes::get_customer_home),
        )
        .route(
            "/api/customer/orders",
            get(customer_routes::list_orders).post(customer_routes::place_order),
        )
        .route(
            "/api/customer/orders/:id",
            get(customer_routes::get_order_details),
        )
        .route(
            "/api/customer/orders/:id/cancel",
            post(customer_routes::cancel_order),
        )
        .route(
            "/api/customer/orders/:id/tracking",
            get(customer_routes::get_order_tracking),
        )
        .route(
            "/api/customer/orders/:id/challan",
            get(customer_routes::get_order_challan),
        )
        .route(
            "/api/customer/rfqs",
            get(customer_routes::list_customer_rfqs)
                .post(customer_routes::create_quotation_request),
        )
        .route(
            "/api/customer/quotation-requests",
            get(customer_routes::list_customer_rfqs)
                .post(customer_routes::create_quotation_request),
        )
        .route(
            "/api/customer/quotations",
            get(finance_ops_routes::list_customer_quotations),
        )
        .route(
            "/api/customer/quotations/:quotation_id/decide",
            post(finance_ops_routes::decide_customer_quotation),
        )
        .route(
            "/api/ops/customer/quotations/:quotation_id/decision",
            post(finance_ops_routes::decide_customer_quotation),
        )
        .route(
            "/api/customer/pour-plans",
            get(customer_routes::list_pour_plans).post(customer_routes::create_pour_plan),
        )
        .route(
            "/api/customer/pour-plans/:id",
            delete(customer_routes::delete_pour_plan),
        )
        .route(
            "/api/customer/receiving-records",
            get(customer_routes::list_receiving_records)
                .post(customer_routes::create_receiving_record),
        )
        .route(
            "/api/customer/receiving-records/:id",
            delete(customer_routes::delete_receiving_record),
        )
        .route(
            "/api/customer/receiving-records/:record_id/cube-tests",
            post(customer_routes::add_cube_test_result),
        )
        .route(
            "/api/customer/receiving-records/:record_id/cube-results",
            patch(customer_routes::add_cube_test_result)
                .post(customer_routes::add_cube_test_result),
        )
        .route("/api/customer/kyc", get(customer_routes::get_customer_kyc))
        .route(
            "/api/customer/kyc/start",
            post(customer_routes::start_customer_kyc),
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
            "/api/driver/trips/:trip_id/location",
            post(driver_routes::update_trip_location),
        )
        .route(
            "/api/driver/trips/:load_id/sign",
            post(driver_routes::sign_challan),
        )
        .route(
            "/api/driver/trips/:load_id/pod",
            post(driver_routes::submit_pod),
        )
        .route(
            "/api/driver/trips/:trip_id",
            get(driver_routes::get_trip_details),
        )
        .route(
            "/api/driver/trips/:trip_id/start",
            post(driver_routes::start_trip),
        )
        .route(
            "/api/driver/trips/:trip_id/arrive",
            post(driver_routes::arrive_trip),
        )
        .route(
            "/api/driver/trips/:trip_id/unload",
            post(driver_routes::unload_trip),
        )
        .route("/api/driver/sos", post(driver_routes::trigger_driver_sos))
        .route(
            "/api/driver/sos/status",
            get(driver_routes::get_driver_sos_status),
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
        // --- Plant Loads & Production Dispatch Operations ---
        .route(
            "/api/loads/order/:order_id",
            get(loads_routes::list_order_loads).post(loads_routes::create_order_load),
        )
        .route(
            "/api/loads/orders/:order_id",
            get(loads_routes::list_order_loads).post(loads_routes::create_order_load),
        )
        .route(
            "/api/loads/:load_id/assign",
            post(loads_routes::assign_load_mixer_driver)
                .put(loads_routes::assign_load_mixer_driver),
        )
        .route(
            "/api/loads/:load_id/assignment",
            put(loads_routes::assign_load_mixer_driver)
                .post(loads_routes::assign_load_mixer_driver),
        )
        .route(
            "/api/loads/:load_id/prepare",
            post(loads_routes::prepare_load),
        )
        .route(
            "/api/loads/:load_id/dispatch",
            post(loads_routes::dispatch_load),
        )
        .route(
            "/api/loads/:load_id/cancel",
            post(loads_routes::cancel_load),
        )
        .route("/api/loads/gate-pass", post(loads_routes::issue_gate_pass))
        // --- Staff Operations Domain ---
        .route("/api/staff/home", get(staff_routes::get_staff_home))
        .route(
            "/api/staff/collection/:kind",
            get(staff_collections::get_staff_collection),
        )
        .route("/api/staff/fleet", get(staff_routes::list_staff_fleet))
        .route("/api/staff/drivers", get(staff_routes::list_staff_drivers))
        .route(
            "/api/staff/orders/:order_id",
            get(staff_routes::get_staff_order),
        )
        .route(
            "/api/staff/orders/:order_id/assign-tm",
            post(staff_routes::assign_tm_to_order),
        )
        .route(
            "/api/staff/orders/:order_id/assign-driver",
            post(staff_routes::assign_driver_to_order),
        )
        .route(
            "/api/staff/orders/:order_id/generate-challan",
            post(staff_routes::generate_order_challan),
        )
        .route(
            "/api/staff/orders/:order_id/dispatch",
            post(staff_routes::dispatch_order),
        )
        .route(
            "/api/staff/orders/:order_id/production",
            get(staff_routes::get_production_status),
        )
        .route(
            "/api/staff/orders/:order_id/production/start",
            post(staff_routes::start_production),
        )
        .route(
            "/api/staff/orders/:order_id/production/batch",
            post(staff_routes::record_batch),
        )
        .route(
            "/api/staff/orders/:order_id/production/complete",
            post(staff_routes::complete_production),
        )
        .route(
            "/api/staff/quality",
            post(staff_routes::record_quality_test),
        )
        .route(
            "/api/staff/quality/:order_id",
            get(staff_routes::get_quality_details),
        )
        .route(
            "/api/staff/orders/:order_id/quality",
            get(staff_routes::get_quality_details).post(staff_routes::record_order_quality_test),
        )
        .route(
            "/api/staff/invoices/:invoice_id/payment",
            post(staff_routes::record_invoice_payment),
        )
        .route(
            "/api/staff/customers/:customer_id/kyc/approve",
            post(staff_routes::approve_customer_kyc),
        )
        .route(
            "/api/staff/customers/:customer_id/kyc/reject",
            post(staff_routes::reject_customer_kyc),
        )
        .route(
            "/api/staff/customers/:customer_id/kyc/reset",
            post(staff_routes::reset_customer_kyc),
        )
        // --- Commercial Operations & Plant Finances ---
        .route(
            "/api/ops/plants/:plant_id/quotations",
            get(finance_ops_routes::list_plant_quotations)
                .post(finance_ops_routes::create_plant_quotation),
        )
        .route(
            "/api/ops/plants/:plant_id/quotation-requests",
            get(finance_ops_routes::list_plant_quotation_requests),
        )
        .route(
            "/api/ops/plants/:plant_id/quotation-requests/:request_id/respond",
            post(finance_ops_routes::respond_quotation_request),
        )
        .route(
            "/api/ops/plants/:plant_id/expenses",
            get(finance_ops_routes::list_plant_expenses)
                .post(finance_ops_routes::record_plant_expense),
        )
        .route(
            "/api/ops/plants/:plant_id/diesel",
            get(finance_ops_routes::list_diesel_transactions)
                .post(finance_ops_routes::record_diesel_transaction),
        )
        .route(
            "/api/ops/plants/:plant_id/purchases",
            get(finance_ops_routes::list_purchase_receipts)
                .post(finance_ops_routes::record_purchase_receipt),
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
        .route("/api/owner/home", get(owner_routes::get_owner_home))
        .route(
            "/api/owner/orders/:order_id/production",
            get(staff_routes::get_production_status),
        )
        .route(
            "/api/owner/orders/:order_id/production/start",
            post(staff_routes::start_production),
        )
        .route(
            "/api/owner/orders/:order_id/production/batch",
            post(staff_routes::record_batch),
        )
        .route(
            "/api/owner/orders/:order_id/production/complete",
            post(staff_routes::complete_production),
        )
        .route("/api/owner/orders", get(owner_routes::list_owner_orders))
        .route(
            "/api/owner/orders/:order_id/approve",
            post(owner_routes::approve_order),
        )
        .route(
            "/api/owner/orders/:order_id/reject",
            post(owner_routes::reject_order),
        )
        .route("/api/owner/fleet", get(owner_routes::list_owner_fleet))
        .route("/api/owner/drivers", get(owner_routes::list_owner_drivers))
        .route(
            "/api/owner/incidents",
            get(owner_routes::list_owner_incidents),
        )
        .route(
            "/api/owner/incidents/:alert_id/resolve",
            post(owner_routes::resolve_incident),
        )
        .route(
            "/api/owner/invoices",
            get(owner_routes::list_owner_invoices),
        )
        .route(
            "/api/owner/invoices/:invoice_id/payment",
            post(owner_routes::record_owner_invoice_payment),
        )
        .route(
            "/api/owner/payments",
            post(owner_routes::record_owner_payment),
        )
        .route("/api/owner/ledger", get(owner_routes::get_owner_ledger))
        .route("/api/owner/insights", get(owner_routes::get_owner_insights))
        // --- Plant Subscriptions & Commercial Plans ---
        .route(
            "/api/plant-plans/context",
            get(plant_plans_routes::get_plan_context),
        )
        .route(
            "/api/plant-plans/quote",
            post(plant_plans_routes::quote_plan),
        )
        .route(
            "/api/plant-plans/validate-promo",
            post(plant_plans_routes::validate_promo_code),
        )
        .route(
            "/api/plant-plans/activate",
            post(plant_plans_routes::activate_plan),
        )
        .route(
            "/api/plant-plans/payments",
            get(plant_plans_routes::list_payment_history),
        )
        .route(
            "/api/plant-plans/payment-history",
            get(plant_plans_routes::list_payment_history),
        )
        .route(
            "/api/plant-plans/payments/:order_number",
            get(plant_plans_routes::get_payment_order_status),
        )
        .route(
            "/api/plant-plans/orders/:order_number",
            get(plant_plans_routes::get_payment_order_status),
        )
        // --- Maps & Location Intelligence ---
        .route("/api/maps/status", get(maps_routes::get_maps_status))
        .route(
            "/api/maps/place/:place_id",
            get(maps_routes::get_place_details),
        )
        .route(
            "/api/maps/place-details/:place_id",
            get(maps_routes::get_place_details),
        )
        .route(
            "/api/maps/autocomplete",
            get(maps_routes::autocomplete_places),
        )
        .route("/api/maps/geocode", get(maps_routes::geocode_address))
        .route("/api/maps/route", get(maps_routes::calculate_route))
        // --- Conversational Assistant & Support Cases ---
        .route(
            "/api/assistant/orders/intent",
            post(assistant_routes::prepare_order_intent),
        )
        .route(
            "/api/assistant/orders/confirm",
            post(assistant_routes::confirm_order_intent),
        )
        .route(
            "/api/assistant/support",
            post(assistant_routes::create_support_case),
        )
        .route(
            "/api/assistant/support/cases",
            get(assistant_routes::list_support_cases).post(assistant_routes::create_support_case),
        )
        .route(
            "/api/assistant/support/cases/:case_id",
            get(assistant_routes::get_support_case_details),
        )
        .route(
            "/api/assistant/support/cases/:case_id/reply",
            post(assistant_routes::add_case_reply),
        )
        .route(
            "/api/assistant/support/cases/:case_id/replies",
            post(assistant_routes::add_case_reply),
        )
        .route(
            "/api/assistant/support/cases/:case_id/status",
            patch(assistant_routes::update_case_status).post(assistant_routes::update_case_status),
        )
        .route(
            "/api/assistant/support/staff/cases",
            get(assistant_routes::list_staff_support_cases),
        )
        .route(
            "/api/assistant/support/staff/cases/:case_id/replies",
            post(assistant_routes::add_case_reply),
        )
        .route(
            "/api/assistant/support/staff/cases/:case_id/status",
            patch(assistant_routes::update_case_status).post(assistant_routes::update_case_status),
        )
        // --- Files & Storage ---
        .route("/api/upload", post(storage_routes::upload_file))
        .route("/api/files/*path", get(storage_routes::get_file))
        // --- Workforce, Attendance, Shifts & Field Visits ---
        .route("/api/workforce/me", get(workforce_routes::get_workforce_me))
        .route("/api/workforce/punch-in", post(workforce_routes::punch_in))
        .route(
            "/api/workforce/punch-out",
            post(workforce_routes::punch_out),
        )
        .route(
            "/api/workforce/attendance/punch-in",
            post(workforce_routes::punch_in),
        )
        .route(
            "/api/workforce/attendance/punch-out",
            post(workforce_routes::punch_out),
        )
        .route("/api/workforce/leave", post(workforce_routes::apply_leave))
        .route("/api/workforce/leaves", post(workforce_routes::apply_leave))
        .route(
            "/api/workforce/visits",
            post(workforce_routes::create_client_visit),
        )
        .route(
            "/api/workforce/visits/:visit_id/start",
            post(workforce_routes::start_client_visit),
        )
        .route(
            "/api/workforce/visits/:visit_id/complete",
            post(workforce_routes::complete_client_visit),
        )
        .route(
            "/api/workforce/expenses",
            post(workforce_routes::submit_expense_claim),
        )
        .route(
            "/api/workforce/expenses/accountant",
            get(workforce_routes::list_accountant_expenses),
        )
        .route(
            "/api/workforce/accountant/expenses",
            get(workforce_routes::list_accountant_expenses),
        )
        .route(
            "/api/workforce/expenses/:claim_id/accountant-decision",
            post(workforce_routes::accountant_expense_decision),
        )
        .route(
            "/api/workforce/accountant/expenses/:claim_id/decision",
            post(workforce_routes::accountant_expense_decision),
        )
        .route(
            "/api/workforce/owner-control",
            get(workforce_routes::get_owner_control),
        )
        .route(
            "/api/workforce/owner/control",
            get(workforce_routes::get_owner_control),
        )
        .route(
            "/api/workforce/leaves/:leave_id/decision",
            post(workforce_routes::owner_leave_decision),
        )
        .route(
            "/api/workforce/expenses/:claim_id/owner-decision",
            post(workforce_routes::owner_expense_decision),
        )
        .route(
            "/api/workforce/owner/:kind/:id/decision",
            post(workforce_routes::owner_unified_decision),
        )
        .route("/api/workforce/roster", get(workforce_routes::get_roster))
        .route(
            "/api/workforce/attendance/mark",
            post(workforce_routes::mark_attendance),
        )
        // --- Workforce Roster Screen Endpoints ---
        .route(
            "/api/workforce-roster/me",
            get(workforce_routes::get_my_roster_me),
        )
        .route(
            "/api/workforce-roster/overview/:date_key",
            get(workforce_routes::get_roster_overview),
        )
        .route(
            "/api/workforce-roster/plants/:plant_id/attendance-config",
            put(workforce_routes::update_attendance_config),
        )
        .route(
            "/api/workforce-roster/plants/:plant_id/shifts",
            post(workforce_routes::create_shift),
        )
        .route(
            "/api/workforce-roster/plants/:plant_id/roster/:date_key/:user_id",
            put(workforce_routes::assign_roster_schedule)
                .post(workforce_routes::assign_roster_schedule),
        )
        .route(
            "/api/workforce/plants/:plant_id/shifts",
            post(workforce_routes::create_shift),
        )
        .route(
            "/api/workforce/plants/:plant_id/roster/:date_key/:user_id",
            put(workforce_routes::assign_roster_schedule)
                .post(workforce_routes::assign_roster_schedule),
        )
        // --- Workforce Reports & Payroll Operations ---
        .route(
            "/api/workforce-reports/monthly",
            get(workforce_reports::monthly_summary),
        )
        .route(
            "/api/workforce-reports/monthly/:month",
            get(workforce_reports::monthly_workforce_report),
        )
        .route(
            "/api/workforce-reports/plants/:plant_id/payroll/:month/:user_id/draft",
            put(workforce_reports::save_payroll_draft).post(workforce_reports::save_payroll_draft),
        )
        .route(
            "/api/workforce-reports/plants/:plant_id/payroll/:month/:user_id/owner-decision",
            post(workforce_reports::owner_payroll_decision),
        )
        .route(
            "/api/workforce-reports/plants/:plant_id/payroll/:month/:user_id/mark-paid",
            post(workforce_reports::mark_payroll_paid),
        )
        // --- Payroll & HR ---
        .route("/api/hr/employees", get(hr_routes::list_employees))
        .route(
            "/api/hr/plants/:plant_id/employees/:user_id",
            get(hr_routes::get_employee_hr_profile),
        )
        .route(
            "/api/hr/plants/:plant_id/employees/:user_id/profile",
            put(hr_routes::update_employee_profile).post(hr_routes::update_employee_profile),
        )
        .route(
            "/api/hr/plants/:plant_id/employees/:user_id/salary",
            put(hr_routes::update_employee_salary).post(hr_routes::update_employee_salary),
        )
        .route(
            "/api/hr/plants/:plant_id/employees/:user_id/salary-suggestion/:month",
            get(hr_routes::get_salary_suggestion),
        )
        .route(
            "/api/payroll-periods/:month",
            get(payroll_routes::get_payroll_period_summary),
        )
        .route(
            "/api/payroll-periods/:plant_id/:month/close",
            post(payroll_routes::close_payroll_period),
        )
        .route(
            "/api/payroll-periods/plants/:plant_id/:month/close",
            post(payroll_routes::close_payroll_period),
        )
        .route(
            "/api/payroll-periods/:plant_id/:month/reopen",
            post(payroll_routes::reopen_payroll_period),
        )
        .route(
            "/api/payroll-periods/plants/:plant_id/:month/reopen",
            post(payroll_routes::reopen_payroll_period),
        )
        .route(
            "/api/payroll-periods/:plant_id/:month/payslips",
            get(payroll_routes::list_period_payslips),
        )
        .route(
            "/api/payroll-periods/plants/:plant_id/:month/payslips",
            get(payroll_routes::list_period_payslips),
        )
        .route(
            "/api/payroll-periods/:plant_id/:month/export",
            get(payroll_routes::export_payroll_csv),
        )
        .route(
            "/api/payroll-periods/plants/:plant_id/:month/export",
            get(payroll_routes::export_payroll_csv),
        )
        .route(
            "/api/payroll-periods/:month/my-payslip",
            get(payroll_routes::get_my_payslip),
        )
        .route(
            "/api/payroll-periods/me/:month",
            get(payroll_routes::get_my_payslip),
        )
        // --- Control Center & Admin ---
        .route("/api/admin/auth/login", post(admin_routes::admin_login))
        .route(
            "/api/admin/portal/overview",
            get(admin_routes::portal_overview),
        )
        .route(
            "/api/admin/portal/summary",
            get(control_center_routes::get_portal_summary),
        )
        .route(
            "/api/control-center/ai-command",
            post(control_center_routes::run_ai_command),
        )
        .route(
            "/api/control-center/capabilities",
            get(control_center_routes::get_capabilities),
        )
        .route(
            "/api/control-center/reviewer-access",
            get(control_center_routes::get_reviewer_access)
                .post(control_center_routes::set_reviewer_access),
        )
        .route(
            "/api/control-center/admin-access",
            get(control_center_routes::list_admin_access)
                .post(control_center_routes::update_admin_access),
        )
        .route(
            "/api/control-center/unowned-plants",
            get(control_center_routes::list_unowned_plants),
        )
        .route(
            "/api/control-center/assign-plant-owner",
            post(control_center_routes::assign_plant_owner),
        )
        .route(
            "/api/control-center/step-up",
            post(control_center_routes::admin_step_up),
        )
        .route(
            "/api/control-center/logout-all",
            post(control_center_routes::admin_logout_all),
        )
        .route(
            "/api/control-center/summary",
            get(control_center_routes::get_portal_summary),
        )
        // --- Order Status Automation Queue & Worker Endpoints ---
        .route(
            "/api/automation/events/claim",
            post(automation_routes::claim_events),
        )
        .route(
            "/api/automation/worker-health",
            get(automation_routes::get_worker_health),
        )
        .route(
            "/api/automation/events/:event_id/ack",
            post(automation_routes::ack_event),
        )
        .route(
            "/api/automation/events/:event_id/fail",
            post(automation_routes::fail_event),
        )
        .route(
            "/api/automation/events/:event_id/deliver",
            post(automation_routes::deliver_event),
        )
        .route(
            "/api/automation/provider-callback",
            post(automation_routes::provider_callback),
        )
        .with_state(state)
}
