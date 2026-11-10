-- Explicit approval, consent evidence, and durable fail-closed broadcast queue.
-- No campaign sends merely because a CSV is imported or a draft is created.
ALTER TABLE admin_marketing_campaign_drafts
    DROP CONSTRAINT IF EXISTS admin_marketing_campaign_drafts_status_check;
ALTER TABLE admin_marketing_campaign_drafts
    ADD CONSTRAINT admin_marketing_campaign_status_check
      CHECK (status IN ('DRAFT','APPROVED','SENDING','FINISHED','CANCELLED'));
ALTER TABLE admin_marketing_campaign_drafts
    ADD COLUMN approved_by UUID REFERENCES users(id),
    ADD COLUMN approved_at TIMESTAMPTZ,
    ADD COLUMN approval_reason VARCHAR(500),
    ADD COLUMN launched_at TIMESTAMPTZ,
    ADD COLUMN cancelled_at TIMESTAMPTZ;

CREATE TABLE admin_marketing_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES admin_marketing_campaign_drafts(id),
    contact_id UUID NOT NULL REFERENCES admin_marketing_contacts(id),
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','uncertain','accepted','sent','delivered','read','failed','cancelled')),
    provider_message_id VARCHAR(200) UNIQUE,
    operator_id UUID REFERENCES users(id),
    reserved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(campaign_id,contact_id)
);
CREATE INDEX idx_admin_marketing_deliveries_pending
  ON admin_marketing_deliveries(created_at,id) WHERE status='pending';
CREATE INDEX idx_admin_marketing_deliveries_campaign
  ON admin_marketing_deliveries(campaign_id,status);
COMMENT ON TABLE admin_marketing_deliveries IS
 'Meta acceptance is not delivery. A reserved uncertain message is not blindly retried; only provider callbacks can confirm delivery.';
