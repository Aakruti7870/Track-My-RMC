# TrackMyRMC — Database & Architecture Migration Guide

This guide outlines the transition from Python/FastAPI + MongoDB to Rust/Axum + PostgreSQL.

---

## 1. Migration Overview

1. **Schema Initialization**: Execute SQLx migrations in `backend/migrations/`:
   ```bash
   sqlx migrate run --source backend/migrations
   ```
2. **Data Transformation (ETL)**:
   - Extract MongoDB collections (`users`, `plants`, `orders`, etc.).
   - Normalize embedded load arrays into individual `order_loads` rows.
   - Insert into PostgreSQL using `ON CONFLICT DO NOTHING`.
3. **Cutover Strategy**:
   - Zero-downtime cutover by running dual-write or brief scheduled maintenance window.
   - Update client base URLs in `frontend/src/api/client.ts` and `admin-web/src/api.ts`.
