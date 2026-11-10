-- Auditable central-only WhatsApp support inbox. No bulk sends or automatic responses.
-- Message text is confidential customer content; access is restricted in Rust to
-- the dedicated Control Center session with support.manage.
CREATE TABLE admin_whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_message_id VARCHAR(200) UNIQUE,
    sender_phone_id VARCHAR(64) NOT NULL,
    customer_phone VARCHAR(16) NOT NULL
        CHECK (customer_phone ~ '^[1-9][0-9]{7,14}$'),
    direction VARCHAR(3) NOT NULL CHECK (direction IN ('IN','OUT')),
    kind VARCHAR(32) NOT NULL DEFAULT 'text',
    body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 4096),
    status VARCHAR(16) NOT NULL CHECK (status IN ('received','accepted','sent','delivered','read','failed','uncertain')),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ,
    operator_id UUID REFERENCES users(id),
    request_id UUID UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX admin_whatsapp_messages_conversation_idx
    ON admin_whatsapp_messages(sender_phone_id,customer_phone,received_at DESC,id DESC);
CREATE INDEX admin_whatsapp_messages_unread_idx
    ON admin_whatsapp_messages(sender_phone_id,customer_phone)
    WHERE direction='IN' AND read_at IS NULL;
COMMENT ON TABLE admin_whatsapp_messages IS
    'Privacy-restricted central customer inbox. Incoming webhook messages do not grant marketing consent. Outbound support replies require verified 24-hour window and explicit feature flag.';
