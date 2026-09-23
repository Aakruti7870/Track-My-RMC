# Multi-stage production build for TrackMyRMC Rust Backend
FROM rust:1.80-slim-bookworm AS builder

WORKDIR /usr/src/app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Cache dependencies
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release || true
RUN rm -rf src

# Copy source code and migrations
COPY src src
COPY migrations migrations

# Build the release binary
RUN cargo build --release --bin trackmyrmc-backend

# Production runtime image
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Non-root user for security
RUN groupadd -r appgroup && useradd -r -g appgroup appuser
USER appuser

COPY --from=builder /usr/src/app/target/release/trackmyrmc-backend /app/server
COPY --from=builder /usr/src/app/migrations /app/migrations

EXPOSE 8000

ENV PORT=8000 \
    HOST=0.0.0.0 \
    RUST_LOG=info

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8000/health || exit 1

CMD ["/app/server"]
