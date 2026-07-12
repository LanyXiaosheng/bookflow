# ===== build frontend =====
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY web/package.json web/tsconfig*.json web/vite.config.ts web/postcss* web/tailwind* web/index.html ./
RUN npm install --ignore-scripts
COPY web/src ./src
COPY web/public ./public
RUN npm run build && mkdir -p /app/dist

# ===== build backend =====
FROM rust:1.86-alpine AS backend-builder
RUN apk add --no-cache musl-dev pkgconfig openssl-dev perl make
WORKDIR /app
# sqlx compile-time queries — use offline cache
COPY Cargo.toml Cargo.lock ./
COPY .sqlx ./.sqlx/
COPY api ./api/

# sqlx compile-time queries check — set dummy DATABASE_URL for docker build
ENV SQLX_OFFLINE=true
RUN cargo build --release --manifest-path ./Cargo.toml -p bookflow-app --ignore-rust-version

# ===== runtime =====
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata libgcc nginx bash
WORKDIR /app

COPY --from=backend-builder /app/target/release/bookflow-app .
# frontend dist may not exist if web build failed; create empty dir as fallback
RUN mkdir -p /app/web/dist
COPY --from=frontend-builder /app/dist /app/web/dist
RUN mkdir -p /app/tracks /app/playbook

COPY <<'NGINX_EOF' /etc/nginx/http.d/default.conf
server {
    listen 5174;
    root /app/web/dist;
    index index.html;
    location /api/ { proxy_pass http://127.0.0.1:3000; proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_buffering off; proxy_cache off; proxy_read_timeout 360s; }
    location / { try_files $uri $uri/ /index.html; }
}
NGINX_EOF

EXPOSE 5174
CMD nginx && ./bookflow-app
