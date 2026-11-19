//! Authenticated customer and plant supplier enquiries with a shared follow-up queue.
//! Customer and staff enquiry intake, follow-up status and operator assignment.
use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(
    tag = "service_type",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum NewServiceEnquiry {
    Cement {
        customer_name: String,
        contact_number: String,
        cement_brand: String,
        required_bags: i32,
        location: String,
        required_date: NaiveDate,
    },
    LabourContractor {
        work_name: String,
        location: String,
        duration_days: i32,
        work_start_date: NaiveDate,
        total_sq_ft: f64,
        expected_price_per_sq_ft: f64,
    },
    BuildingMaterial {
        material_type: String,
        location: String,
        contact_person_name: String,
        mobile_number: String,
        delivery_date: NaiveDate,
    },
    BulkConcrete {
        customer_name: String,
        contact_number: String,
        location: String,
        required_date: NaiveDate,
        grade: String,
        quantity_m3: f64,
    },
    PumpRental {
        customer_name: String,
        contact_number: String,
        location: String,
        required_date: NaiveDate,
        pump_type: String,
        estimated_hours: f64,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
enum SupplierMaterial {
    #[serde(rename = "OPC Cement")]
    OpcCement,
    #[serde(rename = "PPC Cement")]
    PpcCement,
    Aggregate,
    #[serde(rename = "Crushed Sand")]
    CrushedSand,
    #[serde(rename = "Water Tank")]
    WaterTank,
    Chemical,
    #[serde(rename = "Fly Ash")]
    FlyAsh,
    Other,
}

impl SupplierMaterial {
    fn label(self) -> &'static str {
        match self {
            Self::OpcCement => "OPC Cement",
            Self::PpcCement => "PPC Cement",
            Self::Aggregate => "Aggregate",
            Self::CrushedSand => "Crushed Sand",
            Self::WaterTank => "Water Tank",
            Self::Chemical => "Chemical",
            Self::FlyAsh => "Fly Ash",
            Self::Other => "Other",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SupplierEnquiry {
    plant_id: Uuid,
    request_key: String,
    contact_name: String,
    contact_phone: String,
    location: String,
    required_date: NaiveDate,
    materials: Vec<SupplierMaterial>,
    other_material: Option<String>,
}

struct EnquiryRecord {
    kind: &'static str,
    request_key: Option<String>,
    name: String,
    mobile: String,
    location: String,
    date: NaiveDate,
    details: Value,
}

fn supplier_materials(materials: &[SupplierMaterial]) -> Result<Vec<&'static str>, AppError> {
    if !(1..=3).contains(&materials.len())
        || materials
            .iter()
            .enumerate()
            .any(|(index, material)| materials[..index].contains(material))
    {
        return Err(AppError::BadRequest(
            "Choose one to three different materials".into(),
        ));
    }
    Ok(materials.iter().map(|material| material.label()).collect())
}

fn field(value: &str, label: &str, minimum: usize, maximum: usize) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.chars().count() < minimum
        || trimmed.chars().count() > maximum
        || trimmed.chars().any(char::is_control)
    {
        return Err(AppError::BadRequest(format!(
            "{label} must contain {minimum}–{maximum} valid characters"
        )));
    }
    Ok(trimmed.to_owned())
}

fn phone(value: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    let digits = trimmed.trim_start_matches('+');
    if digits.len() < 10
        || digits.len() > 15
        || !digits.bytes().all(|b| b.is_ascii_digit())
        || trimmed.matches('+').count() > 1
        || (trimmed.contains('+') && !trimmed.starts_with('+'))
    {
        return Err(AppError::BadRequest(
            "Enter a valid 10–15 digit contact number".into(),
        ));
    }
    Ok(trimmed.to_owned())
}

fn valid_date(date: NaiveDate) -> Result<NaiveDate, AppError> {
    if date < chrono::Utc::now().date_naive() {
        return Err(AppError::BadRequest(
            "Required date cannot be in the past".into(),
        ));
    }
    Ok(date)
}

fn positive_number(value: f64, label: &str, maximum: f64) -> Result<f64, AppError> {
    if !value.is_finite() || value <= 0.0 || value > maximum {
        return Err(AppError::BadRequest(format!(
            "{label} must be greater than zero and within supported limits"
        )));
    }
    Ok(value)
}

fn bulk_concrete_details(grade: &str, quantity_m3: f64) -> Result<Value, AppError> {
    let grade = field(grade, "Concrete grade", 2, 12)?;
    let grade = crate::services::customer_order::canonical_grade(&grade);
    if ![
        "M10", "M15", "M20", "M25", "M30", "M35", "M40", "M45", "M50", "M55", "M60",
    ]
    .contains(&grade.as_str())
    {
        return Err(AppError::BadRequest("Unsupported concrete grade".into()));
    }
    let quantity_m3 = positive_number(quantity_m3, "Quantity (m³)", 10_000.0)?;
    let hundredths = quantity_m3 * 100.0;
    if quantity_m3 < 0.01 || (hundredths.round() - hundredths).abs() > 0.00001 {
        return Err(AppError::BadRequest(
            "Quantity must be 0.01–10,000 m³ with up to two decimal places".into(),
        ));
    }
    Ok(json!({"grade": grade, "quantity_m3": quantity_m3}))
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<NewServiceEnquiry>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    check_role(&auth, &["customer"])?;

    // The labour form intentionally uses the verified session identity for contact,
    // because its requested fields do not include a customer phone/name.
    let (kind, name, mobile, location, date, details) = match req {
        NewServiceEnquiry::Cement {
            customer_name,
            contact_number,
            cement_brand,
            required_bags,
            location,
            required_date,
        } => {
            if !(1..=100_000).contains(&required_bags) {
                return Err(AppError::BadRequest(
                    "Required bags must be between 1 and 100000".into(),
                ));
            }
            (
                "CEMENT",
                field(&customer_name, "Customer name", 2, 150)?,
                phone(&contact_number)?,
                field(&location, "Location", 3, 500)?,
                valid_date(required_date)?,
                json!({"cement_brand": field(&cement_brand, "Cement brand", 2, 100)?, "required_bags": required_bags}),
            )
        }
        NewServiceEnquiry::LabourContractor {
            work_name,
            location,
            duration_days,
            work_start_date,
            total_sq_ft,
            expected_price_per_sq_ft,
        } => {
            if !(1..=3650).contains(&duration_days) {
                return Err(AppError::BadRequest(
                    "Duration must be between 1 and 3650 days".into(),
                ));
            }
            let name: String = sqlx::query_scalar("SELECT full_name FROM users WHERE id = $1")
                .bind(auth.user_id)
                .fetch_one(&state.db)
                .await?;
            (
                "LABOUR_CONTRACTOR",
                field(&name, "Customer name", 2, 150)?,
                phone(&auth.phone)?,
                field(&location, "Location", 3, 500)?,
                valid_date(work_start_date)?,
                json!({"work_name": field(&work_name, "Work name", 2, 150)?, "duration_days": duration_days,
                    "total_sq_ft": positive_number(total_sq_ft, "Total area", 1_000_000_000.0)?,
                    "expected_price_per_sq_ft": positive_number(expected_price_per_sq_ft, "Expected rate", 10_000_000.0)?}),
            )
        }
        NewServiceEnquiry::BulkConcrete {
            customer_name,
            contact_number,
            location,
            required_date,
            grade,
            quantity_m3,
        } => (
            "BULK_CONCRETE",
            field(&customer_name, "Customer name", 2, 150)?,
            phone(&contact_number)?,
            field(&location, "Delivery address", 3, 500)?,
            valid_date(required_date)?,
            bulk_concrete_details(&grade, quantity_m3)?,
        ),
        NewServiceEnquiry::PumpRental {
            customer_name,
            contact_number,
            location,
            required_date,
            pump_type,
            estimated_hours,
        } => (
            "PUMP_RENTAL",
            field(&customer_name, "Customer name", 2, 150)?,
            phone(&contact_number)?,
            field(&location, "Pump site address", 3, 500)?,
            valid_date(required_date)?,
            json!({
                "pump_type": field(&pump_type, "Pump type", 2, 60)?,
                "estimated_hours": positive_number(estimated_hours, "Estimated rental hours", 72.0)?
            }),
        ),
        NewServiceEnquiry::BuildingMaterial {
            material_type,
            location,
            contact_person_name,
            mobile_number,
            delivery_date,
        } => {
            const MATERIALS: [&str; 10] = [
                "10 MM",
                "20 MM",
                "40 MM",
                "Crushed Sand",
                "Gujrat Washed Sand",
                "Cement Bag",
                "Bricks",
                "Steel",
                "Office Cabin",
                "Shuttering Material",
            ];
            if !MATERIALS.contains(&material_type.as_str()) {
                return Err(AppError::BadRequest(
                    "Choose a supported building material".into(),
                ));
            }
            (
                "BUILDING_MATERIAL",
                field(&contact_person_name, "Contact person", 2, 150)?,
                phone(&mobile_number)?,
                field(&location, "Location", 3, 500)?,
                valid_date(delivery_date)?,
                json!({"material_type": material_type}),
            )
        }
    };
    save_enquiry(
        &state,
        auth.user_id,
        EnquiryRecord {
            kind,
            request_key: None,
            name,
            mobile,
            location,
            date,
            details,
        },
    )
    .await
}

pub async fn create_supplier(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<SupplierEnquiry>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let plants = super::owner_routes::assigned_plants(&state, &auth).await?;
    let (_, plant_name, _) = plants
        .iter()
        .find(|(id, _, _)| *id == req.plant_id)
        .ok_or_else(|| AppError::Forbidden("Choose a plant assigned to your account".into()))?;
    let materials = supplier_materials(&req.materials)?;
    let request_key = field(&req.request_key, "Request key", 1, 80)?;
    let mut details = json!({
        "plant_id": req.plant_id,
        "plant_name": plant_name,
        "submitted_by_role": auth.role,
        "materials": materials,
    });
    if req.materials.contains(&SupplierMaterial::Other) {
        details["other_material"] = json!(field(
            req.other_material.as_deref().unwrap_or_default(),
            "Other material",
            2,
            150,
        )?);
    }
    save_enquiry(
        &state,
        auth.user_id,
        EnquiryRecord {
            kind: "PLANT_SUPPLIER",
            request_key: Some(request_key),
            name: field(&req.contact_name, "Contact name", 2, 150)?,
            mobile: phone(&req.contact_phone)?,
            location: field(&req.location, "Delivery location", 3, 500)?,
            date: valid_date(req.required_date)?,
            details,
        },
    )
    .await
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
enum PlantAccessory {
    Silo,
    #[serde(rename = "Conveyor Belt")]
    ConveyorBelt,
    #[serde(rename = "Cement Filters")]
    CementFilters,
    #[serde(rename = "DG Set")]
    DgSet,
    #[serde(rename = "CCTV Setup")]
    CctvSetup,
    #[serde(rename = "Office Cabin")]
    OfficeCabin,
    Other,
}

impl PlantAccessory {
    fn label(self) -> &'static str {
        match self {
            Self::Silo => "Silo",
            Self::ConveyorBelt => "Conveyor Belt",
            Self::CementFilters => "Cement Filters",
            Self::DgSet => "DG Set",
            Self::CctvSetup => "CCTV Setup",
            Self::OfficeCabin => "Office Cabin",
            Self::Other => "Other",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum DealerRequest {
    WebsiteDesign {
        requirements: String,
    },
    BuyDomain {
        domain: String,
    },
    DigitalMarketing {
        requirements: String,
    },
    PlantAccessories {
        accessories: Vec<PlantAccessory>,
        location: String,
        requirements: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DealerEnquiry {
    plant_id: Uuid,
    request_key: String,
    contact_name: String,
    contact_phone: String,
    required_date: NaiveDate,
    request: DealerRequest,
}

const DEALER_TYPES: [&str; 4] = [
    "PLANT_WEBSITE_DESIGN",
    "PLANT_BUY_DOMAIN",
    "PLANT_DIGITAL_MARKETING",
    "PLANT_ACCESSORIES",
];

fn domain_name(value: &str) -> Result<String, AppError> {
    let name = value.trim().to_ascii_lowercase();
    let valid_label = |label: &str| {
        (1..=63).contains(&label.len())
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    };
    let valid = name.len() <= 253
        && name.rsplit_once('.').is_some_and(|(_, suffix)| {
            suffix.len() >= 2
                && (suffix.bytes().all(|byte| byte.is_ascii_alphabetic())
                    || suffix.starts_with("xn--"))
        })
        && name.split('.').all(valid_label);
    if !valid {
        return Err(AppError::BadRequest(
            "Enter a domain name such as yourplant.in".into(),
        ));
    }
    Ok(name)
}

pub async fn create_dealer(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<DealerEnquiry>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    check_role(&auth, &["owner", "plant_owner"])?;
    let plants = super::owner_routes::assigned_plants(&state, &auth).await?;
    let (_, plant_name, city) = plants
        .iter()
        .find(|(id, _, _)| *id == req.plant_id)
        .ok_or_else(|| AppError::Forbidden("Choose a plant assigned to your account".into()))?;
    let mut location = format!("{plant_name} · {city}");
    let mut details = json!({
        "plant_id": req.plant_id,
        "plant_name": plant_name,
        "submitted_by_role": auth.role,
    });
    let kind = match req.request {
        DealerRequest::WebsiteDesign { requirements } => {
            details["requirements"] = json!(field(&requirements, "Website requirements", 5, 1000)?);
            "PLANT_WEBSITE_DESIGN"
        }
        DealerRequest::BuyDomain { domain } => {
            details["domain"] = json!(domain_name(&domain)?);
            "PLANT_BUY_DOMAIN"
        }
        DealerRequest::DigitalMarketing { requirements } => {
            details["requirements"] =
                json!(field(&requirements, "Marketing requirements", 5, 1000)?);
            "PLANT_DIGITAL_MARKETING"
        }
        DealerRequest::PlantAccessories {
            accessories,
            location: delivery,
            requirements,
        } => {
            if accessories.is_empty()
                || accessories.len() > 7
                || accessories
                    .iter()
                    .enumerate()
                    .any(|(index, item)| accessories[..index].contains(item))
            {
                return Err(AppError::BadRequest(
                    "Choose at least one accessory without duplicates".into(),
                ));
            }
            if accessories.contains(&PlantAccessory::Other) && requirements.is_none() {
                return Err(AppError::BadRequest(
                    "Describe the other accessories you need".into(),
                ));
            }
            if let Some(requirements) = requirements {
                details["requirements"] =
                    json!(field(&requirements, "Accessory requirements", 3, 1000)?);
            }
            location = field(&delivery, "Delivery or installation location", 3, 500)?;
            details["accessories"] = json!(accessories
                .iter()
                .map(|item| item.label())
                .collect::<Vec<_>>());
            "PLANT_ACCESSORIES"
        }
    };
    save_enquiry(
        &state,
        auth.user_id,
        EnquiryRecord {
            kind,
            request_key: Some(field(&req.request_key, "Request key", 1, 80)?),
            name: field(&req.contact_name, "Contact name", 2, 150)?,
            mobile: phone(&req.contact_phone)?,
            location,
            date: valid_date(req.required_date)?,
            details,
        },
    )
    .await
}

pub async fn list_dealer(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Value>, AppError> {
    check_role(&auth, &["owner", "plant_owner"])?;
    let enquiries: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id',e.id,'service_type',e.service_type,'plant_name',p.name,
          'required_date',e.required_date,'status',e.status)
         FROM customer_service_enquiries e
         JOIN rmc_plants p ON p.id::text=e.details->>'plant_id' AND p.owner_id=$1 AND p.is_active
         WHERE e.customer_id=$1 AND e.service_type=ANY($2)
         ORDER BY e.created_at DESC,e.id DESC LIMIT 100",
    )
    .bind(auth.user_id)
    .bind(&DEALER_TYPES[..])
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"enquiries":enquiries})))
}

async fn save_enquiry(
    state: &AppState,
    requester: Uuid,
    record: EnquiryRecord,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let mut tx = state.db.begin().await?;
    let created: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO customer_service_enquiries
            (customer_id, service_type, contact_name, contact_phone, location, required_date, details, request_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (customer_id, request_key) WHERE request_key IS NOT NULL DO NOTHING RETURNING id",
    )
    .bind(requester).bind(record.kind).bind(&record.name).bind(&record.mobile)
    .bind(&record.location).bind(record.date).bind(&record.details).bind(&record.request_key)
    .fetch_optional(&mut *tx).await?;
    let Some(id) = created else {
        let (id, status, matches): (Uuid, String, bool) = sqlx::query_as(
            "SELECT id, status, (service_type=$3 AND contact_name=$4 AND contact_phone=$5
               AND location=$6 AND required_date=$7 AND details=$8)
             FROM customer_service_enquiries WHERE customer_id=$1 AND request_key=$2",
        )
        .bind(requester)
        .bind(record.request_key)
        .bind(record.kind)
        .bind(record.name)
        .bind(record.mobile)
        .bind(record.location)
        .bind(record.date)
        .bind(record.details)
        .fetch_one(&mut *tx)
        .await?;
        if !matches {
            return Err(AppError::Conflict(
                "This request key was already used for a different enquiry".into(),
            ));
        }
        return Ok((
            StatusCode::OK,
            Json(json!({"success": true, "id": id, "status": status})),
        ));
    };
    let (title, body) = match record.kind {
        "PLANT_SUPPLIER" => (
            "New plant supplier enquiry",
            "A plant material supplier enquiry is awaiting follow-up.",
        ),
        kind if DEALER_TYPES.contains(&kind) => (
            "New plant dealer enquiry",
            "A plant dealer or digital service enquiry is awaiting follow-up.",
        ),
        _ => (
            "New service enquiry",
            "A customer service enquiry is awaiting review and follow-up.",
        ),
    };
    sqlx::query(
        "INSERT INTO notifications(user_id,title,body,notification_type,reference_id)
         SELECT u.id,$2,$3,'service_enquiry',$1
         FROM users u WHERE u.is_active=TRUE AND u.role IN ('central_admin','authority')",
    )
    .bind(id.to_string())
    .bind(title)
    .bind(body)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(
            json!({"success": true, "id": id, "status": "NEW", "message": "Enquiry submitted. Our team will contact you."}),
        ),
    ))
}

pub async fn list_supplier(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Value>, AppError> {
    let plants: Vec<Uuid> = super::owner_routes::assigned_plants(&state, &auth)
        .await?
        .into_iter()
        .map(|(id, _, _)| id)
        .collect();
    let enquiries: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id',id,'plant_name',details->>'plant_name',
          'materials',details->'materials','required_date',required_date,'status',status)
         FROM customer_service_enquiries WHERE customer_id=$1 AND service_type='PLANT_SUPPLIER'
           AND details->>'plant_id'=ANY($2)
         ORDER BY created_at DESC,id DESC LIMIT 100",
    )
    .bind(auth.user_id)
    .bind(plants.iter().map(Uuid::to_string).collect::<Vec<_>>())
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"enquiries":enquiries})))
}

pub async fn list_assignees(
    State(state): State<AppState>,
    admin: crate::auth::control_center::WebAdmin,
) -> Result<Json<Value>, AppError> {
    admin.require("support.manage")?;
    let items: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id',u.id,'name',u.full_name)
         FROM users u JOIN control_center_access a ON a.user_id=u.id
         WHERE u.is_active AND u.role='central_admin' AND a.approved
           AND 'support.manage'=ANY(a.permissions) ORDER BY u.full_name,u.id",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"items":items})))
}

#[derive(Deserialize)]
pub struct AssignEnquiry {
    assignee: Option<Uuid>,
    reason: String,
}

pub async fn assign(
    State(state): State<AppState>,
    admin: crate::auth::control_center::WebAdmin,
    headers: axum::http::HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<AssignEnquiry>,
) -> Result<Json<Value>, AppError> {
    admin.require("support.manage")?;
    let reason = input.reason.trim();
    if !(10..=500).contains(&reason.chars().count()) {
        return Err(AppError::BadRequest(
            "Enter an assignment reason (10–500 characters)".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    let previous: (Option<Uuid>,) =
        sqlx::query_as("SELECT assigned_to FROM customer_service_enquiries WHERE id=$1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound("Enquiry not found".into()))?;
    super::control_center_routes::require_recent_step_up_using(&mut *tx, &admin, &headers).await?;
    if let Some(assignee) = input.assignee {
        let allowed: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM users u JOIN control_center_access a ON a.user_id=u.id
             WHERE u.id=$1 AND u.is_active AND u.role='central_admin' AND a.approved
             AND 'support.manage'=ANY(a.permissions))",
        )
        .bind(assignee)
        .fetch_one(&mut *tx)
        .await?;
        if !allowed {
            return Err(AppError::BadRequest(
                "Select an active Super Admin with support management access".into(),
            ));
        }
    }
    if previous.0 != input.assignee {
        sqlx::query(
            "UPDATE customer_service_enquiries SET assigned_to=$2,updated_at=NOW() WHERE id=$1",
        )
        .bind(id)
        .bind(input.assignee)
        .execute(&mut *tx)
        .await?;
        sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'control_center.service_enquiry.assign','service_enquiry',$2,$3)")
            .bind(admin.user_id).bind(id.to_string()).bind(json!({"previous":previous.0,"assignee":input.assignee,"reason":reason}))
            .execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"success":true})))
}

pub async fn list_customer(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Value>, AppError> {
    check_role(&auth, &["customer"])?;
    let enquiries: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id', id, 'service_type', service_type, 'contact_name', contact_name, 'contact_phone', contact_phone, 'location', location, 'required_date', required_date, 'details', details, 'status', status, 'created_at', created_at) FROM customer_service_enquiries WHERE customer_id=$1 AND service_type IN ('CEMENT','LABOUR_CONTRACTOR','BUILDING_MATERIAL','BULK_CONCRETE','PUMP_RENTAL') ORDER BY created_at DESC LIMIT 100",
    ).bind(auth.user_id).fetch_all(&state.db).await?;
    Ok(Json(json!({"enquiries": enquiries})))
}

pub async fn list_admin(
    State(state): State<AppState>,
    admin: crate::auth::control_center::WebAdmin,
) -> Result<Json<Value>, AppError> {
    admin.require("support.view")?;
    let enquiries: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id', id, 'customer_id', customer_id, 'service_type', service_type, 'contact_name', contact_name, 'contact_phone', contact_phone, 'location', location, 'required_date', required_date, 'details', details, 'status', status, 'created_at', created_at) FROM customer_service_enquiries ORDER BY created_at DESC LIMIT 200",
    ).fetch_all(&state.db).await?;
    Ok(Json(json!({"enquiries": enquiries})))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusUpdate {
    pub status: String,
    pub reason: String,
}

pub async fn update_status(
    State(state): State<AppState>,
    admin: crate::auth::control_center::WebAdmin,
    headers: axum::http::HeaderMap,
    Path(id): Path<Uuid>,
    Json(update): Json<StatusUpdate>,
) -> Result<Json<Value>, AppError> {
    admin.require("support.manage")?;
    super::control_center_routes::require_recent_step_up(&state, &admin, &headers).await?;
    if update.reason.trim().len() < 10 || update.reason.trim().len() > 500 {
        return Err(AppError::BadRequest(
            "Service enquiry changes require an audit reason (10-500 characters)".into(),
        ));
    }
    if !["NEW", "CONTACTED", "QUOTED", "CLOSED"].contains(&update.status.as_str()) {
        return Err(AppError::BadRequest("Invalid enquiry status".into()));
    }
    let mut tx = state.db.begin().await?;
    let previous: Option<(String, Uuid)> = sqlx::query_as(
        "SELECT status,customer_id FROM customer_service_enquiries WHERE id=$1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let previous = previous.ok_or_else(|| AppError::NotFound("Enquiry not found".into()))?;
    if previous.0 != update.status {
        sqlx::query(
            "UPDATE customer_service_enquiries SET status=$1, updated_at=NOW() WHERE id=$2",
        )
        .bind(&update.status)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
             VALUES($1,'control_center.service_enquiry.status','service_enquiry',$2,$3)",
        )
        .bind(admin.user_id)
        .bind(id.to_string())
        .bind(json!({"old_status": previous.0, "new_status": update.status, "reason": update.reason.trim()}))
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO notifications(user_id,title,body,notification_type,reference_id)
             VALUES($1,'Service enquiry update',$2,'service_enquiry_update',$3)",
        )
        .bind(previous.1)
        .bind(format!("Your service enquiry is now {}.", update.status))
        .bind(id.to_string())
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(
        json!({"success": true, "id": id, "status": update.status}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn supplier_enquiry_accepts_up_to_three_distinct_supported_materials() {
        use SupplierMaterial::*;
        assert_eq!(
            supplier_materials(&[OpcCement, Aggregate, FlyAsh]).unwrap(),
            ["OPC Cement", "Aggregate", "Fly Ash"]
        );
        assert!(supplier_materials(&[]).is_err());
        assert!(supplier_materials(&[Chemical, Chemical]).is_err());
        assert!(supplier_materials(&[PpcCement, CrushedSand, WaterTank, FlyAsh]).is_err());
        assert!(serde_json::from_value::<SupplierMaterial>(json!("Bricks")).is_err());
    }

    #[test]
    fn validates_bulk_concrete_grade_and_quantity() {
        assert_eq!(
            bulk_concrete_details("M-30", 125.25).unwrap(),
            json!({"grade": "M30", "quantity_m3": 125.25})
        );
        assert!(bulk_concrete_details("M99", 125.25).is_err());
        for quantity in [0.0, 0.001, 1.001, 10_000.01, f64::NAN] {
            assert!(bulk_concrete_details("M30", quantity).is_err());
        }
    }

    #[test]
    fn validate_phones_and_fields() {
        assert!(phone("+919876543210").is_ok());
        assert!(phone("98765").is_err());
        assert!(phone("abc1234567890").is_err());
        assert!(field("  Pune  ", "Location", 3, 500).is_ok());
        assert!(field("\n", "Location", 3, 500).is_err());
        assert!(positive_number(f64::NAN, "area", 1_000.0).is_err());
    }
}
