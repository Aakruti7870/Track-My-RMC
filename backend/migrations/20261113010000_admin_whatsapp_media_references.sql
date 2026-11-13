-- Preserve only validated provider media references, never customer media bytes.
-- Existing messages keep media_id NULL; their attachments cannot be recovered
-- from the old placeholder because the webhook did not save the provider ID.
ALTER TABLE admin_whatsapp_messages
    ADD COLUMN IF NOT EXISTS media_id VARCHAR(128);
ALTER TABLE admin_whatsapp_messages
    ADD CONSTRAINT admin_whatsapp_media_id_numeric
    CHECK (media_id IS NULL OR media_id ~ '^[0-9]{6,128}$');
COMMENT ON COLUMN admin_whatsapp_messages.media_id IS
    'Inbound Meta numeric media ID only. Private authenticated on-demand retrieval; no public URL or binary persisted.';
