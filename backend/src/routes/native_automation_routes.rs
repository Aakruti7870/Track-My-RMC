//! Native automation governance. Central Admin controls publication;
//! Plant Owners can only opt in within their own active plant.
//! Authority is intentionally not aliased to Central Admin.
use crate::{
    auth::{control_center::WebAdmin, AuthUser},
    error::AppError,
    services::native_rule_conditions::OrderConditions,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TemplatePolicy {
    pub published: bool,
    pub globally_paused: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlantRule {
    pub enabled: bool,
    pub reminder_after_minutes: Option<i32>,
    pub sla_minutes: Option<i32>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConditionPolicy {
    pub conditions: OrderConditions,
}

pub async fn admin_templates(
    State(state): State<AppState>,
    admin: WebAdmin,
) -> Result<Json<Value>, AppError> {
    admin.require("system.view")?;
    let items: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('key',t.template_key,'label',t.label,
             'event_type',t.event_type,'action_type',t.action_type,
             'version',t.version,'published',t.published,'globally_paused',t.globally_paused,
             'conditions',t.conditions,
             'enabled_plants',(SELECT COUNT(*) FROM native_automation_plant_rules r
                                WHERE r.template_key=t.template_key AND r.enabled))
         FROM native_automation_templates t ORDER BY t.template_key",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"templates":items})))
}

/// Publishing or unpausing affects every enabled plant; require a dedicated
/// approved Central Admin session, explicit automation.manage, and recent MFA.
pub async fn set_template_policy(
    State(state): State<AppState>,
    admin: WebAdmin,
    headers: HeaderMap,
    Path(key): Path<String>,
    Json(body): Json<TemplatePolicy>,
) -> Result<Json<Value>, AppError> {
    admin.require("automation.manage")?;
    super::control_center_routes::require_recent_step_up(&state, &admin.user, &headers).await?;
    if !body.published && !body.globally_paused {
        return Err(AppError::BadRequest(
            "Unpublished automation must remain paused".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    let current: Option<(bool, bool)> = sqlx::query_as(
        "SELECT published,globally_paused FROM native_automation_templates
         WHERE template_key=$1 FOR UPDATE",
    )
    .bind(&key)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((published, paused)) = current else {
        return Err(AppError::NotFound("Unknown automation template".into()));
    };
    if published != body.published || paused != body.globally_paused {
        sqlx::query(
            "UPDATE native_automation_templates
             SET published=$2,globally_paused=$3,version=version+1,
                 updated_by=$4,updated_at=NOW() WHERE template_key=$1",
        )
        .bind(&key)
        .bind(body.published)
        .bind(body.globally_paused)
        .bind(admin.user_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO native_automation_template_revisions
             (template_key,version,published,globally_paused,conditions,changed_by)
             SELECT template_key,version,published,globally_paused,conditions,$2
             FROM native_automation_templates WHERE template_key=$1
             ON CONFLICT (template_key,version) DO NOTHING",
        )
        .bind(&key)
        .bind(admin.user_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
             VALUES($1,'automation.template.policy','automation_template',$2,$3)",
        )
        .bind(admin.user_id)
        .bind(&key)
        .bind(json!({"old_published":published,"old_paused":paused,
                     "published":body.published,"globally_paused":body.globally_paused}))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"success":true,"template_key":key,
                   "published":body.published,"globally_paused":body.globally_paused})))
}

pub async fn admin_jobs(
    State(state): State<AppState>,
    admin: WebAdmin,
) -> Result<Json<Value>, AppError> {
    admin.require("audit.view")?;
    let items: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object(
            'id',id,'template_key',template_key,'status',status,
            'attempts',attempts,'available_at',available_at,'created_at',created_at,
            'updated_at',updated_at)
         FROM native_automation_jobs ORDER BY created_at DESC LIMIT 100",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"jobs":items})))
}

pub async fn admin_health(
    State(state): State<AppState>,
    admin: WebAdmin,
) -> Result<Json<Value>, AppError> {
    admin.require("system.view")?;
    let counts: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('status',status,'count',COUNT(*))
         FROM native_automation_jobs GROUP BY status",
    )
    .fetch_all(&state.db)
    .await?;
    let heartbeat: Option<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('last_seen_at',last_seen_at,
                    'last_success_at',last_success_at,'recent',last_seen_at>NOW()-INTERVAL '1 minute')
         FROM native_automation_worker_heartbeat WHERE worker_name='native-internal-worker'",
    )
    .fetch_optional(&state.db)
    .await?;
    // Aggregates only; no cross-plant task content leaks to Admin health.
    let task_counts: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('status',status,'count',COUNT(*))
         FROM native_automation_domain_tasks GROUP BY status",
    )
    .fetch_all(&state.db)
    .await?;
    let escalated_unresolved: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM native_automation_domain_tasks
         WHERE status IN ('OPEN','ACKNOWLEDGED') AND escalation_count>0",
    )
    .fetch_one(&state.db)
    .await?;
    let configured = std::env::var("NATIVE_AUTOMATION_WORKER_ENABLED")
        .ok()
        .as_deref()
        == Some("true");
    Ok(Json(
        json!({"worker_enabled":configured,"heartbeat":heartbeat,
                   "job_counts":counts,"task_counts":task_counts,
                   "escalated_unresolved":escalated_unresolved}),
    ))
}

pub async fn owner_rules(
    State(state): State<AppState>,
    owner: AuthUser,
    Path(plant): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    super::plant_staff_manager::require_owner(&state, &owner, plant).await?;
    let items: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('key',t.template_key,'label',t.label,
                'published',t.published,'globally_paused',t.globally_paused,
                'conditions',t.conditions,'enabled',COALESCE(r.enabled,FALSE),
                'reminder_after_minutes',COALESCE(r.reminder_after_minutes,60),
                'sla_minutes',COALESCE(r.sla_minutes,60))
         FROM native_automation_templates t
         LEFT JOIN native_automation_plant_rules r
           ON r.plant_id=$1 AND r.template_key=t.template_key
         ORDER BY t.template_key",
    )
    .bind(plant)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"plant_id":plant,"rules":items})))
}

pub async fn set_owner_rule(
    State(state): State<AppState>,
    owner: AuthUser,
    Path((plant, key)): Path<(Uuid, String)>,
    Json(body): Json<PlantRule>,
) -> Result<Json<Value>, AppError> {
    // Managers and staff can never activate rules, even if they hold delegation.
    super::plant_staff_manager::require_owner(&state, &owner, plant).await?;
    if body
        .reminder_after_minutes
        .is_some_and(|n| !(15..=1440).contains(&n))
    {
        return Err(AppError::BadRequest(
            "Reminder interval must be between 15 and 1440 minutes".into(),
        ));
    }
    if body.reminder_after_minutes.is_some()
        && key != crate::services::native_automation::PENDING_REMINDER
    {
        return Err(AppError::BadRequest(
            "Only the pending-order reminder accepts an interval".into(),
        ));
    }
    if body.sla_minutes.is_some_and(|n| !(15..=1440).contains(&n)) {
        return Err(AppError::BadRequest(
            "SLA must be between 15 and 1440 minutes".into(),
        ));
    }
    if body.sla_minutes.is_some() && key.starts_with("ORDER_") {
        return Err(AppError::BadRequest(
            "Domain review SLA cannot be set on an order template".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    // Hold live active-Owner authorization until the configuration commits.
    super::plant_staff_manager::lock_authorization(&mut tx, &owner, plant, "staff").await?;
    let policy: Option<(bool, bool)> = sqlx::query_as(
        "SELECT published,globally_paused FROM native_automation_templates WHERE template_key=$1 FOR SHARE",
    )
    .bind(&key)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((published, globally_paused)) = policy else {
        return Err(AppError::NotFound("Unknown automation template".into()));
    };
    if body.enabled && (!published || globally_paused) {
        return Err(AppError::Conflict(
            "Only centrally published, unpaused automation templates can be enabled".into(),
        ));
    }

    sqlx::query(
        "INSERT INTO native_automation_plant_rules
         (plant_id,template_key,enabled,updated_by,reminder_after_minutes,sla_minutes)
         VALUES($1,$2,$3,$4,COALESCE($5,60),COALESCE($6,60))
         ON CONFLICT (plant_id,template_key)
         DO UPDATE SET enabled=EXCLUDED.enabled,
            reminder_after_minutes=COALESCE($5,native_automation_plant_rules.reminder_after_minutes),
            sla_minutes=COALESCE($6,native_automation_plant_rules.sla_minutes),
            updated_by=EXCLUDED.updated_by,updated_at=NOW()",
    )
    .bind(plant)
    .bind(&key)
    .bind(body.enabled)
    .bind(owner.user_id)
    .bind(body.reminder_after_minutes)
    .bind(body.sla_minutes)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'automation.plant.rule','plant',$2,$3)",
    )
    .bind(owner.user_id)
    .bind(plant.to_string())
    .bind(json!({"template_key":key,"enabled":body.enabled,
                     "reminder_after_minutes":body.reminder_after_minutes,
                     "sla_minutes":body.sla_minutes}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"plant_id":plant,
                   "template_key":key,"enabled":body.enabled})))
}

/// Owner-only task inbox. The order remains actionable only through the
/// existing order approval/rejection endpoints and existing role checks.
pub async fn owner_tasks(
    State(state): State<AppState>,
    owner: AuthUser,
    Path(plant): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    super::plant_staff_manager::require_owner(&state, &owner, plant).await?;
    let items: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id',tasks.id,'order_id',tasks.order_id,
              'order_number',tasks.order_number,'task_kind',tasks.task_kind,
              'source_label',tasks.source_label,
              'status',tasks.status,'created_at',tasks.created_at,
              'acknowledged_at',tasks.acknowledged_at,
              'escalation_count',tasks.escalation_count,
              'resolution_reason',tasks.resolution_reason,
              'resolved_at',tasks.resolved_at)
         FROM (
           SELECT t.id,t.order_id,o.order_number,t.task_kind,t.status,
                  t.created_at,t.resolved_at,
                  ('Order '||o.order_number)::text AS source_label,
                  NULL::timestamptz AS acknowledged_at,
                  0::integer AS escalation_count,
                  NULL::text AS resolution_reason
           FROM native_automation_tasks t
           JOIN orders o ON o.id=t.order_id AND o.plant_id=t.plant_id
           WHERE t.plant_id=$1
           UNION ALL
           SELECT d.id,NULL::uuid,''::text,d.template_key,d.status,
                  d.created_at,d.resolved_at,
                  COALESCE(CASE d.template_key
                    WHEN 'DISPATCH_UNASSIGNED_LOAD' THEN (
                      SELECT 'Load #'||l.load_number::text||' / Order '||o.order_number
                      FROM order_loads l JOIN orders o ON o.id=l.order_id
                      WHERE l.id=d.domain_entity_id AND o.plant_id=d.plant_id)
                    WHEN 'RFQ_PENDING_PLANT' THEN (
                      SELECT 'RFQ '||LEFT(q.id::text,8)||' / '||q.grade
                      FROM customer_quotation_requests q
                      WHERE q.id=d.domain_entity_id AND q.plant_id=d.plant_id)
                    WHEN 'QUALITY_INSPECTION_FAILED' THEN (
                      SELECT 'Inspection '||LEFT(q.id::text,8)||' / Order '||o.order_number
                      FROM cube_tests q JOIN orders o ON o.id=q.order_id
                      WHERE q.id=d.domain_entity_id AND o.plant_id=d.plant_id)
                    WHEN 'INVENTORY_BELOW_MIN' THEN (
                      SELECT 'Material: '||m.name
                      FROM plant_materials m
                      WHERE m.id=d.domain_entity_id AND m.plant_id=d.plant_id)
                    WHEN 'WORKFORCE_LEAVE_PENDING' THEN (
                      SELECT 'Leave '||LEFT(l.id::text,8)||' / '||l.start_date::text
                      FROM workforce_leave_requests l
                      WHERE l.id=d.domain_entity_id AND l.plant_id=d.plant_id)
                    END,LEFT(d.domain_entity_id::text,8)) AS source_label,
                  d.acknowledged_at,d.escalation_count,d.resolution_reason
           FROM native_automation_domain_tasks d WHERE d.plant_id=$1
         ) tasks ORDER BY (tasks.status IN ('OPEN','ACKNOWLEDGED')) DESC,tasks.created_at DESC LIMIT 100",
    )
    .bind(plant)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"plant_id":plant,"tasks":items})))
}

/// Owner-only, immutable technical timeline for one tenant-scoped domain case.
/// Actor identifiers are hidden from the response; no customer PII is included.
pub async fn owner_task_events(
    State(state): State<AppState>,
    owner: AuthUser,
    Path((plant, task)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, AppError> {
    super::plant_staff_manager::require_owner(&state, &owner, plant).await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM native_automation_domain_tasks
         WHERE id=$1 AND plant_id=$2)",
    )
    .bind(task)
    .bind(plant)
    .fetch_one(&state.db)
    .await?;
    if !exists {
        return Err(AppError::NotFound("Automation task not found".into()));
    }
    let events: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object(
            'event_type',event_type,'details',details,'created_at',created_at)
         FROM native_automation_domain_task_events
         WHERE task_id=$1 AND plant_id=$2
         ORDER BY created_at DESC,id DESC LIMIT 100",
    )
    .bind(task)
    .bind(plant)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        json!({"task_id":task,"plant_id":plant,"events":events}),
    ))
}

/// Owner's read-only execution history, excluding other plants and customer PII.
pub async fn owner_history(
    State(state): State<AppState>,
    owner: AuthUser,
    Path(plant): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    super::plant_staff_manager::require_owner(&state, &owner, plant).await?;
    let items: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object(
             'id',id,'order_id',order_id,'domain_entity_id',domain_entity_id,'template_key',template_key,
             'status',status,'attempts',attempts,'created_at',created_at,
             'updated_at',updated_at)
         FROM native_automation_jobs
         WHERE plant_id=$1 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(plant)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"plant_id":plant,"jobs":items})))
}

/// Administrator-supervised retry is available only after a verified MFA
/// step-up. Requeueing does not bypass the worker's live rule/plant checks.
pub async fn admin_requeue_dead_letter(
    State(state): State<AppState>,
    admin: WebAdmin,
    headers: HeaderMap,
    Path(job): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    admin.require("automation.manage")?;
    super::control_center_routes::require_recent_step_up(&state, &admin.user, &headers).await?;
    let mut tx = state.db.begin().await?;
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM native_automation_jobs WHERE id=$1 FOR UPDATE")
            .bind(job)
            .fetch_optional(&mut *tx)
            .await?;
    if status.as_deref() != Some("DEAD_LETTER") {
        return Err(AppError::Conflict(
            "Only dead-letter automation jobs can be requeued".into(),
        ));
    }
    sqlx::query(
        "UPDATE native_automation_jobs
         SET status='RETRY',attempts=0,available_at=NOW(),last_error=NULL,updated_at=NOW()
         WHERE id=$1",
    )
    .bind(job)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'automation.job.requeue','native_automation_job',$2,$3)",
    )
    .bind(admin.user_id)
    .bind(job.to_string())
    .bind(json!({"previous_status":"DEAD_LETTER"}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"job_id":job,"status":"RETRY"})))
}

/// Only the dedicated Central Admin can change bounded rule conditions.
/// Active templates must be paused first; publication is a separate MFA action.
pub async fn admin_set_conditions(
    State(state): State<AppState>,
    admin: WebAdmin,
    headers: HeaderMap,
    Path(key): Path<String>,
    Json(body): Json<ConditionPolicy>,
) -> Result<Json<Value>, AppError> {
    admin.require("automation.manage")?;
    super::control_center_routes::require_recent_step_up(&state, &admin.user, &headers).await?;
    body.conditions
        .validate()
        .map_err(|message| AppError::BadRequest(message.into()))?;
    let serialized = serde_json::to_value(&body.conditions)
        .map_err(|_| AppError::BadRequest("Invalid automation conditions".into()))?;
    let mut tx = state.db.begin().await?;
    let existing: Option<(bool, Value)> = sqlx::query_as(
        "SELECT globally_paused,conditions
         FROM native_automation_templates WHERE template_key=$1 FOR UPDATE",
    )
    .bind(&key)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((paused, old_conditions)) = existing else {
        return Err(AppError::NotFound("Unknown automation template".into()));
    };
    // Quantity/grade filters apply only to original order workflows.
    // Cross-domain workflows use fixed Rust predicates and empty conditions.
    if !key.starts_with("ORDER_") {
        return Err(AppError::BadRequest(
            "Domain workflows have fixed, reviewed eligibility checks".into(),
        ));
    }
    if !paused {
        return Err(AppError::Conflict(
            "Pause the template before modifying its conditions".into(),
        ));
    }
    if serialized != old_conditions {
        sqlx::query(
            "UPDATE native_automation_templates
             SET conditions=$2,version=version+1,updated_by=$3,updated_at=NOW()
             WHERE template_key=$1",
        )
        .bind(&key)
        .bind(&serialized)
        .bind(admin.user_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO native_automation_template_revisions
             (template_key,version,published,globally_paused,conditions,changed_by)
             SELECT template_key,version,published,globally_paused,conditions,$2
             FROM native_automation_templates WHERE template_key=$1
             ON CONFLICT (template_key,version) DO NOTHING",
        )
        .bind(&key)
        .bind(admin.user_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
             VALUES($1,'automation.template.conditions','automation_template',$2,$3)",
        )
        .bind(admin.user_id)
        .bind(&key)
        .bind(json!({"previous":old_conditions,"new":serialized}))
        .execute(&mut *tx)
        .await?;
    }
    let version: i32 =
        sqlx::query_scalar("SELECT version FROM native_automation_templates WHERE template_key=$1")
            .bind(&key)
            .fetch_one(&mut *tx)
            .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"success":true,"template_key":key,"version":version,
                   "conditions":body.conditions}),
    ))
}

/// Immutable historical revisions (not executable scripts) for governance.
pub async fn admin_revisions(
    State(state): State<AppState>,
    admin: WebAdmin,
    Path(key): Path<String>,
) -> Result<Json<Value>, AppError> {
    admin.require("audit.view")?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM native_automation_templates WHERE template_key=$1)",
    )
    .bind(&key)
    .fetch_one(&state.db)
    .await?;
    if !exists {
        return Err(AppError::NotFound("Unknown automation template".into()));
    }
    let revisions: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('version',version,'published',published,
            'globally_paused',globally_paused,'conditions',conditions,
            'changed_by',changed_by,'created_at',created_at)
         FROM native_automation_template_revisions
         WHERE template_key=$1 ORDER BY version DESC LIMIT 100",
    )
    .bind(&key)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"template_key":key,"revisions":revisions})))
}

/// Acknowledging a task means an Owner has seen the alert, NOT that the
/// underlying operational issue is approved, fixed or closed. This endpoint
/// cannot change orders, inspections, RFQs, material stock or staff requests.
pub async fn owner_acknowledge_domain_task(
    State(state): State<AppState>,
    owner: AuthUser,
    Path((plant, task_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, AppError> {
    super::plant_staff_manager::require_owner(&state, &owner, plant).await?;
    let mut tx = state.db.begin().await?;
    super::plant_staff_manager::lock_authorization(&mut tx, &owner, plant, "staff").await?;
    // The current owner may acknowledge alerts created before ownership
    // transfer; the original assignee remains in the immutable job record.
    let existing: Option<(String, String)> = sqlx::query_as(
        "SELECT template_key,status FROM native_automation_domain_tasks
         WHERE id=$1 AND plant_id=$2 FOR UPDATE",
    )
    .bind(task_id)
    .bind(plant)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((template, status)) = existing else {
        return Err(AppError::NotFound(
            "Review task not found in this plant".into(),
        ));
    };
    if status == "ACKNOWLEDGED" {
        tx.commit().await?;
        return Ok(Json(
            json!({"success":true,"status":"ACKNOWLEDGED","idempotent_replay":true}),
        ));
    }
    if status != "OPEN" {
        return Err(AppError::Conflict(
            "Review task cannot be acknowledged in this state".into(),
        ));
    }
    sqlx::query(
        "UPDATE native_automation_domain_tasks
         SET status='ACKNOWLEDGED',acknowledged_at=NOW(),acknowledged_by=$3,
             resolved_at=NULL,updated_at=NOW()
         WHERE id=$1 AND plant_id=$2",
    )
    .bind(task_id)
    .bind(plant)
    .bind(owner.user_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO native_automation_domain_task_events
         (task_id,plant_id,event_type,actor_id,details)
         VALUES($1,$2,'ACKNOWLEDGED',$3,'{}'::jsonb)",
    )
    .bind(task_id)
    .bind(plant)
    .bind(owner.user_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'automation.domain_task.acknowledged','native_domain_task',$2,$3)",
    )
    .bind(owner.user_id)
    .bind(task_id.to_string())
    .bind(json!({"plant_id":plant,"template_key":template,"business_record_unchanged":true}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"status":"ACKNOWLEDGED",
                   "business_record_unchanged":true})))
}
