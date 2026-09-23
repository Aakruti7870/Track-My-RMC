# TrackMyRMC — API Specification & Contract Reference

This document specifies the complete REST API contract for the TrackMyRMC Rust backend service.

---

## 1. Global Conventions

- **Base URL**: `http://localhost:8000` (Local) / `https://trackmyrmc-backend.onrender.com` (Production)
- **Content-Type**: `application/json`
- **Authentication**: `Authorization: Bearer <JWT>`
- **Error Response Standard**:
  ```json
  {
    "success": false,
    "message": "Human-readable sanitized error description",
    "error_code": "OPTIONAL_MACHINE_CODE"
  }
  ```

---

## 2. Authentication Endpoints (`/api/auth`)

### 2.1 Password Authentication

#### `POST /api/auth/register`
- **Access**: Public
- **Request**:
  ```json
  {
    "phone": "9823012345",
    "email": "user@example.com",
    "password": "SecurePassword123",
    "full_name": "Ramesh Kumar",
    "role": "customer",
    "business_name": "ABC Infra Pvt Ltd"
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "role": "customer",
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "phone": "9823012345",
      "email": "user@example.com",
      "full_name": "Ramesh Kumar",
      "role": "customer",
      "kyc_status": "unverified",
      "verified_name": null
    }
  }
  ```

#### `POST /api/auth/login`
- **Access**: Public
- **Request**:
  ```json
  {
    "username_or_phone": "9823012345",
    "password": "SecurePassword123"
  }
  ```
- **Response** (`200 OK`): Returns `AuthResponse`.

#### `GET /api/me`
- **Access**: Authenticated
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "user": { ... },
    "profile": { ... }
  }
  ```

---

### 2.2 Customer & Driver Authentication: Meta WhatsApp Cloud API

#### `POST /api/auth/otp/whatsapp/send`
- **Access**: Public (Restricted server-side to `customer` and `driver` accounts)
- **Request**:
  ```json
  {
    "phone": "9823012345",
    "purpose": "login"
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Verification code dispatched via WhatsApp"
  }
  ```

#### `POST /api/auth/otp/whatsapp/verify`
- **Access**: Public (Enforces server-side that resolved user is Customer or Driver)
- **Request**:
  ```json
  {
    "phone": "9823012345",
    "otp": "482910"
  }
  ```
- **Response** (`200 OK`): Returns `AuthResponse`.

---

### 2.3 Plant Staff, Owner & Admin Authentication: Email OTP

#### `POST /api/auth/otp/email/send` (Also aliased to `/api/staff/auth/send-otp`)
- **Access**: Public (Rejects customer and driver roles; verifies plant staff membership)
- **Request**:
  ```json
  {
    "email": "dispatcher@plant.trackmyrmc.com",
    "plant_code": "PUN-01"
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Verification code dispatched to your email address"
  }
  ```

#### `POST /api/auth/otp/email/verify` (Also aliased to `/api/staff/auth/verify-otp`)
- **Access**: Public
- **Request**:
  ```json
  {
    "email": "dispatcher@plant.trackmyrmc.com",
    "otp": "651924",
    "plant_code": "PUN-01"
  }
  ```
- **Response** (`200 OK`): Returns `AuthResponse`.

---

### 2.4 Authenticator App (RFC 6238 TOTP)

#### `POST /api/auth/totp/setup`
- **Access**: Authenticated Staff, Owner, Admin
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "secret": "JBSWY3DPEHPK3PXP...",
    "otpauth_uri": "otpauth://totp/TrackMyRMC:admin@trackmyrmc.com?secret=...",
    "backup_codes": ["A1B2-C3D4", "E5F6-G7H8", ...]
  }
  ```

#### `POST /api/auth/totp/verify-setup`
- **Access**: Authenticated Staff, Owner, Admin
- **Request**: `{"code": "123456"}`

#### `POST /api/auth/totp/login`
- **Access**: Public (Accepts 6-digit TOTP or 8-character single-use recovery code)
- **Request**:
  ```json
  {
    "username_or_phone": "admin@trackmyrmc.com",
    "code_or_recovery": "A1B2-C3D4"
  }
  ```

---

### 2.5 WebAuthn / FIDO2 Passkeys

- `POST /api/auth/passkey/register/options`: Initiates registration ceremony
- `POST /api/auth/passkey/register/verify`: Cryptographically verifies attestation
- `POST /api/auth/passkey/login/options`: Initiates authentication assertion
- `POST /api/auth/passkey/login/verify`: Verifies cryptographic signature & issues JWT

---

## 3. Customer Domain APIs

- `GET /api/customer/plants`: Lists batching plants with optional geo-filtering (`lat`, `lng`, `radius_km`)
- `GET /api/customer/grades`: Returns concrete grades `["M-10", "M-15", ..., "M-45"]`
- `GET /api/customer/sites`: Lists customer pouring project sites
- `POST /api/customer/sites`: Creates project site with coordinates
- `POST /api/customer/orders`: Places new order; calculates pricing and generates order number `RMC-{PLANT}-{GRADE}-{NUM}`
- `GET /api/customer/orders`: Paginated list of customer orders
- `GET /api/customer/orders/:id`: Full details of order, loads, status timeline, and test certificates

---

## 4. Dispatcher & Fleet APIs

- `GET /api/dispatcher/fleet/:plant_id`: Fleet status (idle, loading, in_transit, returning, breakdown)
- `POST /api/dispatcher/loads/assign`: Assigns transit mixer and driver to an order load
- `PATCH /api/dispatcher/orders/:id/status`: Updates order batching/delivery status

---

## 5. Driver & Telemetry APIs

- `GET /api/driver/trips`: Active trips assigned to driver
- `POST /api/driver/location`: High-frequency live GPS update (lat, lng, speed, heading, timestamp)
- `POST /api/driver/trips/:load_id/sign`: Customer digital signature on delivery challan
- `POST /api/driver/trips/:load_id/pod`: Proof-of-delivery upload (receiver name, photo, signature)

---

## 6. Workforce & Plant Operations

- `GET /api/workforce/roster`: Daily attendance roster for plant by date
- `POST /api/workforce/attendance/mark`: Geofenced clock-in/out
- `GET /api/payroll/closure`: Monthly payroll closure review and lock status
- `POST /api/owner/plants`: Plant profile creation
- `GET /api/owner/billing`: Subscription tier and usage ledger
