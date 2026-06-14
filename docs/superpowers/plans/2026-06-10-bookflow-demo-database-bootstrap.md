# Bookflow Demo Database Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deployable Bookflow demo database flow that bootstraps schema, seeds full sample data, and supports reseeding for external users.

**Architecture:** Keep SQLx migrations as the only schema source of truth. Add a minimal Postgres init hook for extensions, small Rust binaries for migration/password hashing, and shell scripts plus SQL seed data for first-run bootstrap and reseed.

**Tech Stack:** Docker Compose, Postgres 16, SQLx migrations, Rust binaries, Bash scripts, psql

---

### Task 1: Add database bootstrap utilities

**Files:**
- Create: `bookflow/api/crates/app/src/bin/hash_password.rs`
- Create: `bookflow/api/crates/app/src/bin/migrate_db.rs`

- [ ] Add a tiny password hash helper binary using the existing `argon2` dependency.
- [ ] Add a migration runner binary that only needs `DATABASE_URL`.
- [ ] Verify both binaries compile with `cargo test --workspace`.

### Task 2: Add demo database assets and scripts

**Files:**
- Create: `bookflow/docker/postgres/initdb/00-extensions.sql`
- Create: `bookflow/db/demo-seed.sql`
- Create: `bookflow/scripts/seed-demo.sh`
- Create: `bookflow/scripts/reseed-demo.sh`
- Create: `bookflow/scripts/bootstrap-demo.sh`

- [ ] Add the Postgres extension init file for `pgcrypto`.
- [ ] Write an idempotent full demo seed SQL file with fixed UUIDs and full sample coverage.
- [ ] Add a seed script that reads `.env`, hashes the demo password, and runs the seed SQL through Dockerized `psql`.
- [ ] Add a reseed script that clears the demo user’s related data and reruns the seed.
- [ ] Add a bootstrap script that starts Postgres, waits for health, runs migrations, and seeds the demo data.

### Task 3: Wire deployment config and docs

**Files:**
- Modify: `bookflow/docker-compose.yml`
- Modify: `bookflow/.env.example`
- Modify: `bookflow/README.md`

- [ ] Mount the Postgres initdb directory in Docker Compose.
- [ ] Document demo account and optional `DEMO_*` overrides in `.env.example`.
- [ ] Update README with external deployment, bootstrap, and reseed instructions.

### Task 4: Verify bootstrap and reseed flow

**Files:**
- Verify against: `bookflow/docker-compose.yml`
- Verify against: `bookflow/db/demo-seed.sql`
- Verify against: `bookflow/scripts/*.sh`

- [ ] Run `cargo test --workspace`.
- [ ] Run `bash scripts/bootstrap-demo.sh`.
- [ ] Run `bash scripts/reseed-demo.sh`.
- [ ] Query the demo database to confirm user, seeds, projects, chapters, artifacts, reviews, and notifications exist.
