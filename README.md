# TrackMyRMC — Production System

TrackMyRMC is a comprehensive enterprise cloud and mobile management platform engineered specifically for the Ready-Mix Concrete (RMC) industry. It powers concrete batching operations, customer pour planning, quality testing, fleet dispatch, driver live GPS tracking, digital delivery challans, proof-of-delivery (POD), workforce management, and automated payroll closure.

---

## 1. System Architecture

```
                               TrackMyRMC Platform
                                        │
        ┌───────────────────────────────┴───────────────────────────────┐
        │                                                               │
   Mobile App (Expo / React Native)                           Admin Dashboard (Vite / React)
        │                                                               │
        └────────────────────────── REST API ───────────────────────────┘
                                        │
                         ┌──────────────┴──────────────┐
                         │   Rust Backend (Axum API)   │
                         └──────────────┬──────────────┘
                                        │
                   ┌────────────────────┼────────────────────┐
                   │                    │                    │
              PostgreSQL           Meta WhatsApp        Transactional
             Database Pool           Cloud API              Email
```

- **Backend**: High-performance, memory-safe service written in **Rust** using **Axum 0.7**, **Tokio**, and **SQLx 0.7** with compile-time checked queries and automated migrations.
- **Database**: Relational **PostgreSQL 16+** replacing un-normalized document persistence with strictly typed foreign keys, indexes, and constraints.
- **Mobile Client (`frontend/`)**: **Expo / React Native / TypeScript** multi-role app supporting Customers, Drivers, Dispatchers, Operators, Supervisors, Quality Engineers, and Plant Owners.
- **Admin Portal (`admin-web/`)**: **React / Vite / TypeScript** command center for central platform administration.

---

## 2. Directory Structure

```
TrackMyRMC/
├── backend/                  # Rust Axum + SQLx backend
│   ├── Cargo.toml            # Pinned stable dependencies
│   ├── Dockerfile            # Multi-stage production container
│   ├── migrations/           # PostgreSQL relational schema migrations
│   ├── src/
│   │   ├── main.rs           # Server lifecycle & signal handling
│   │   ├── lib.rs            # Library entrypoint for integration testing
│   │   ├── config.rs         # Strongly typed environment configuration
│   │   ├── error.rs          # Centralized error mapping (no stack traces leaked)
│   │   ├── state.rs          # Application state & connection pooling
│   │   ├── db/               # PostgreSQL pool & migration runner
│   │   ├── models/           # Domain entity structs
│   │   ├── schemas/          # Serde Request/Response DTOs
│   │   ├── repositories/     # Parameterized database query layer
│   │   ├── services/         # Core business logic
│   │   ├── middleware/       # Auth extraction & RBAC verification
│   │   ├── handlers/         # HTTP request handlers
│   │   ├── routes/           # Axum router registration
│   │   └── utils/            # Geofencing (Haversine) & helpers
│   └── tests/                # Automated integration & security test suites
├── frontend/                 # Expo / React Native TypeScript mobile client
├── docs/                     # Technical specifications
│   ├── API.md                # Complete API contract reference
│   ├── DATABASE.md           # PostgreSQL schema & MongoDB mapping
│   ├── MIGRATION.md          # Zero-downtime data migration guide
│   └── DEPLOYMENT.md         # Render & PostgreSQL production deployment
├── .github/workflows/        # Production CI/CD pipelines
│   ├── backend.yml           # Rust CI
│   └── frontend.yml          # Expo / TypeScript CI
├── .gitignore                # Clean build artifact exclusions
├── .env.example              # Configuration template
└── README.md                 # Project guide
```

---

## 3. Getting Started

### Backend Setup (Rust + PostgreSQL)

1. **Prerequisites**: Install Rust stable (1.78+) and PostgreSQL 16+.
2. **Configure Environment**:
   ```bash
   cp .env.example backend/.env
   # Edit backend/.env with your local PostgreSQL credentials
   ```
3. **Run Migrations and Server**:
   ```bash
   cd backend
   cargo run
   ```
4. **Health Check**:
   ```bash
   curl http://localhost:8000/health
   # Returns: {"status":"ok","database":"connected",...}
   ```

### Frontend Setup (Expo Mobile App)

1. **Prerequisites**: Install Node.js 18+ and npm.
2. **Install & Run**:
   ```bash
   cd frontend
   npm install
   npx expo start
   ```

---

## 4. Production Build & Validation

```bash
# Backend verification
cd backend
cargo check
cargo test
cargo fmt --check
cargo clippy -- -D warnings
cargo build --release

# Frontend verification
cd frontend
npm run typecheck
npm run lint
```
