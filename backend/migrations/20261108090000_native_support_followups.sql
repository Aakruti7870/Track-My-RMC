-- Platform-scoped, in-app Customer Support follow-ups.
-- Separate from tenant/plant native_automation_jobs: a support case has no
-- authorized plant_id. Additive and inert until both existing native worker
-- and NATIVE_SUPPORT_AUTOMATION_ENABLED are explicitly enabled.
-- No external messages, AI replies, financial actions or automatic closure.
CREATE TABLE native_support_followups (
    case_id UUID PRIMARY KEY REFERENCES support_cases(id) ON DELETE CASCADE,
    cycle BIGINT NOT NULL DEFAULT 1 CHECK (cycle >= 1),
    awaiting_staff_reply BOOLEAN NOT NULL DEFAULT TRUE,
    due_at TIMESTAMPTZ,
    reminder_count SMALLINT NOT NULL DEFAULT 0 CHECK (reminder_count BETWEEN 0 AND 2),
    last_customer_message_at TIMESTAMPTZ,
    last_staff_response_at TIMESTAMPTZ,
    last_reminder_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT native_support_not_waiting_has_no_due
      CHECK (awaiting_staff_reply OR due_at IS NULL)
);
CREATE INDEX native_support_followups_due_idx
    ON native_support_followups (due_at,case_id)
    WHERE awaiting_staff_reply AND reminder_count < 2 AND due_at IS NOT NULL;

-- Independent technical event history records delivery without storing customer
-- messages, ticket content, identifiers of recipients, OTPs or private evidence.
CREATE TABLE native_support_followup_events (
    id BIGSERIAL PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
    cycle BIGINT NOT NULL CHECK (cycle >= 1),
    reminder_number SMALLINT NOT NULL CHECK (reminder_number BETWEEN 1 AND 2),
    recipient_count INTEGER NOT NULL CHECK (recipient_count BETWEEN 1 AND 20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(case_id,cycle,reminder_number)
);
CREATE INDEX native_support_followup_events_case
    ON native_support_followup_events (case_id,created_at DESC);

-- Historical cases are NOT enrolled automatically. Manual cases remain manual
-- until the customer submits a new reply or an explicitly approved backfill.
