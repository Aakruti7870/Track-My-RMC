CREATE INDEX idx_stored_files_postgres_uploader_created_at
    ON stored_files (uploaded_by, created_at DESC)
    WHERE storage_provider = 'postgres';
