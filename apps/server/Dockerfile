# IFC-Lite Server Dockerfile
# Optimized multi-stage build for Railway deployment

# Stage 1: Chef - prepare recipe for dependency caching
FROM lukemathwalker/cargo-chef:latest-rust-1.83 AS chef
WORKDIR /app

# Stage 2: Planner - create dependency recipe
FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

# Stage 3: Builder - build dependencies (cached) then app
FROM chef AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Build dependencies first (cached layer)
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

# Copy source and build application
COPY . .
RUN cargo build --release --package ifc-lite-server

# Stage 4: Runtime - minimal image
FROM debian:bookworm-slim AS runtime

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 appuser

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/target/release/ifc-lite-server /app/ifc-lite-server

# Create cache directory with proper permissions
RUN mkdir -p /app/cache && chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Environment defaults
ENV RUST_LOG=info
ENV PORT=8080
ENV CACHE_DIR=/app/cache
ENV MAX_FILE_SIZE_MB=500
ENV REQUEST_TIMEOUT_SECS=300
ENV WORKER_THREADS=4
ENV BATCH_SIZE=50
ENV CACHE_MAX_AGE_DAYS=7

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/api/v1/health || exit 1

CMD ["/app/ifc-lite-server"]
