#!/usr/bin/env python3
"""Generate the platform wiki pages from what the tree actually contains.

Six wiki pages describe the platform around the code - data, services,
observability, standards, security and integrations. Each is only worth reading
if it is true, so each opens with a generated block of **detected** facts and
leaves everything below it to a person:

    docs/wiki/data/README.md           databases, caches, queues, ORMs, migrations
    docs/wiki/services/README.md       frameworks, entrypoints, containers, modules
    docs/wiki/observability/README.md  logging, error tracking, tracing, health
    docs/wiki/standards/README.md      languages, linters, hooks, tests, CI, owners
    docs/wiki/security/README.md       secret handling (names only), scanning, auth
    docs/wiki/integrations/README.md   external services, by SDK and by env name

Nothing is guessed. A technology appears only when a manifest dependency, a
config file, a compose image or a source pattern says so, and every row names
the file it was detected in. A group with no detection says `Nothing detected.`
- an honest absence, not a gap to fill with a guess.

Secrets: only environment variable NAMES are ever read, from `.env.example` /
`.env.sample` style files. Values are discarded at parse time and `.env` itself
is never opened.

Detection is table driven: the constants at the top of this file are the whole
vocabulary, so supporting a technology is one added line.

The generated block is rewritten on every run; everything outside the markers
is preserved byte for byte (CRLF included). A page that does not exist is
created with a title, the block, and one curated stub holding the gap marker.

Travels into host repositories: run it from the host repository root.
Standard library only; deterministic (sorted, no clock, no absolute paths).

Usage:
    python skills/akinator/scripts/extract_platform.py [root]            # dry run, exit 1 if anything would change
    python skills/akinator/scripts/extract_platform.py [root] --write    # write the pages
    python skills/akinator/scripts/extract_platform.py [root] --check    # exit 1 on any drift
    python skills/akinator/scripts/extract_platform.py [root] --wiki docs/wiki

Exit codes:
    0  pages match the tree (or --write succeeded)
    1  drift detected (dry run or --check)
    2  the tool could not run, or a page has a broken generated block
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import extract_libraries as el  # noqa: E402
import extract_stack as es  # noqa: E402

DEFAULT_WIKI = "docs/wiki"
BEGIN, END, GAP = el.BEGIN, el.END, el.GAP
REGENERATE = "python skills/akinator/scripts/extract_platform.py --write"
NOTHING = "Nothing detected."
SKIP_DIRS = frozenset(es.SKIP_DIRS) | {
    ".git", ".tox", ".mypy_cache", ".ruff_cache", ".idea", "coverage",
}
LOCAL_ONLY = (".ai/cache/",)
MAX_READ_BYTES = 1_000_000
MAX_EVIDENCE = 3

# page key -> (path under the wiki dir, title, groups in render order)
PAGES: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "data": ("data/README.md", "Data", (
        "Databases", "Caches", "Queues and brokers", "ORMs and query layers",
        "Migrations", "Connection settings (env var names)")),
    "services": ("services/README.md", "Services", (
        "Frontend frameworks", "Backend frameworks", "Entrypoints",
        "Containers and deployment descriptors", "Workspaces and modules")),
    "observability": ("observability/README.md", "Observability", (
        "Logging", "Error tracking", "Tracing and metrics", "Health endpoints",
        "Configuration files")),
    "standards": ("standards/README.md", "Standards", (
        "Languages", "Linters, formatters and type checkers",
        "Pre-commit and git hooks", "Test frameworks", "CI", "Ownership",
        "Import conventions")),
    "security": ("security/README.md", "Security", (
        "Secret handling", "Environment variable names",
        "Dependency and vulnerability scanning", "Authentication libraries",
        "Ownership and policy")),
    "integrations": ("integrations/README.md", "Integrations", (
        "SDKs and clients", "Environment variables naming an external service")),
}

# --------------------------------------------------------------------------
# Detection vocabulary. One line per technology.
# --------------------------------------------------------------------------

# (page, group, label, space-separated dependency names). A name matches a
# declared dependency exactly or as a path prefix (`@aws-sdk` matches
# `@aws-sdk/client-s3`). Names compare lowercased with `-_.` folded together.
DEPS: list[tuple[str, str, str, str]] = [
    # data - databases
    ("data", "Databases", "PostgreSQL", "pg postgres psycopg psycopg2 psycopg2-binary asyncpg pg-promise tokio-postgres github.com/jackc/pgx github.com/lib/pq"),
    ("data", "Databases", "MySQL / MariaDB", "mysql mysql2 mysqlclient pymysql aiomysql mysql-connector-python github.com/go-sql-driver/mysql"),
    ("data", "Databases", "SQLite", "sqlite3 better-sqlite3 aiosqlite rusqlite github.com/mattn/go-sqlite3"),
    ("data", "Databases", "MongoDB", "mongodb mongoose pymongo motor go.mongodb.org/mongo-driver"),
    ("data", "Databases", "DynamoDB", "@aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb pynamodb dynamodb"),
    ("data", "Databases", "Elasticsearch / OpenSearch", "elasticsearch @elastic/elasticsearch opensearch-py @opensearch-project/opensearch"),
    ("data", "Databases", "Cassandra", "cassandra-driver"),
    ("data", "Databases", "SQL Server", "mssql pyodbc tedious pymssql"),
    ("data", "Databases", "ClickHouse", "clickhouse-driver @clickhouse/client clickhouse-connect"),
    ("data", "Databases", "Neo4j", "neo4j neo4j-driver"),
    ("data", "Databases", "Firestore", "@google-cloud/firestore google-cloud-firestore"),
    # data - caches
    ("data", "Caches", "Redis", "redis ioredis aioredis hiredis github.com/redis/go-redis github.com/go-redis/redis"),
    ("data", "Caches", "Memcached", "pymemcache python-memcached memcached github.com/bradfitz/gomemcache"),
    # data - queues
    ("data", "Queues and brokers", "Kafka", "kafkajs kafka-python confluent-kafka aiokafka github.com/segmentio/kafka-go github.com/shopify/sarama"),
    ("data", "Queues and brokers", "RabbitMQ", "amqplib pika aio-pika github.com/rabbitmq/amqp091-go github.com/streadway/amqp"),
    ("data", "Queues and brokers", "SQS", "@aws-sdk/client-sqs sqs-consumer"),
    ("data", "Queues and brokers", "Celery", "celery"),
    ("data", "Queues and brokers", "BullMQ / Bull", "bullmq bull"),
    ("data", "Queues and brokers", "Python job queues", "rq dramatiq huey arq"),
    ("data", "Queues and brokers", "NATS", "nats nats-py github.com/nats-io/nats.go"),
    ("data", "Queues and brokers", "Pub/Sub", "@google-cloud/pubsub google-cloud-pubsub"),
    # data - ORMs
    ("data", "ORMs and query layers", "Prisma", "prisma @prisma/client"),
    ("data", "ORMs and query layers", "SQLAlchemy", "sqlalchemy"),
    ("data", "ORMs and query layers", "Alembic", "alembic"),
    ("data", "ORMs and query layers", "TypeORM", "typeorm"),
    ("data", "ORMs and query layers", "Sequelize", "sequelize"),
    ("data", "ORMs and query layers", "Drizzle", "drizzle-orm"),
    ("data", "ORMs and query layers", "Knex", "knex"),
    ("data", "ORMs and query layers", "Tortoise / Peewee", "tortoise-orm peewee"),
    ("data", "ORMs and query layers", "GORM / sqlx (Go)", "gorm.io/gorm github.com/jmoiron/sqlx"),
    ("data", "ORMs and query layers", "Diesel / SQLx (Rust)", "diesel sqlx"),
    # services
    ("services", "Frontend frameworks", "React", "react"),
    ("services", "Frontend frameworks", "Vue", "vue"),
    ("services", "Frontend frameworks", "Svelte / SvelteKit", "svelte @sveltejs/kit"),
    ("services", "Frontend frameworks", "Next.js", "next"),
    ("services", "Frontend frameworks", "Nuxt", "nuxt"),
    ("services", "Frontend frameworks", "Angular", "@angular/core"),
    ("services", "Frontend frameworks", "Solid / Preact", "solid-js preact"),
    ("services", "Frontend frameworks", "Astro", "astro"),
    ("services", "Frontend frameworks", "Remix", "@remix-run"),
    ("services", "Frontend frameworks", "Vite", "vite"),
    ("services", "Backend frameworks", "FastAPI", "fastapi"),
    ("services", "Backend frameworks", "Django", "django"),
    ("services", "Backend frameworks", "Flask", "flask"),
    ("services", "Backend frameworks", "Starlette / aiohttp / Tornado / Sanic", "starlette aiohttp tornado sanic"),
    ("services", "Backend frameworks", "Express", "express"),
    ("services", "Backend frameworks", "NestJS", "@nestjs/core"),
    ("services", "Backend frameworks", "Fastify / Koa / Hono", "fastify koa hono"),
    ("services", "Backend frameworks", "Gin", "github.com/gin-gonic/gin"),
    ("services", "Backend frameworks", "Echo / Fiber (Go)", "github.com/labstack/echo github.com/gofiber/fiber"),
    ("services", "Backend frameworks", "Actix / Axum / Rocket (Rust)", "actix-web axum rocket"),
    # observability
    ("observability", "Logging", "pino", "pino"),
    ("observability", "Logging", "winston", "winston"),
    ("observability", "Logging", "bunyan / log4js", "bunyan log4js"),
    ("observability", "Logging", "structlog", "structlog"),
    ("observability", "Logging", "loguru", "loguru"),
    ("observability", "Logging", "python-json-logger", "python-json-logger"),
    ("observability", "Logging", "logrus / zap / zerolog (Go)", "github.com/sirupsen/logrus go.uber.org/zap github.com/rs/zerolog"),
    ("observability", "Logging", "tracing / log (Rust)", "tracing log env-logger"),
    ("observability", "Error tracking", "Sentry", "sentry-sdk @sentry github.com/getsentry/sentry-go sentry"),
    ("observability", "Error tracking", "Rollbar / Bugsnag", "rollbar bugsnag @bugsnag/js"),
    ("observability", "Tracing and metrics", "OpenTelemetry", "opentelemetry-api opentelemetry-sdk opentelemetry-distro opentelemetry-instrumentation opentelemetry-exporter-otlp @opentelemetry go.opentelemetry.io opentelemetry"),
    ("observability", "Tracing and metrics", "Prometheus", "prom-client prometheus-client prometheus-fastapi-instrumentator github.com/prometheus"),
    ("observability", "Tracing and metrics", "Datadog", "dd-trace ddtrace datadog datadog-api-client gopkg.in/datadog"),
    ("observability", "Tracing and metrics", "New Relic", "newrelic"),
    ("observability", "Tracing and metrics", "Elastic APM / Jaeger / StatsD", "elastic-apm jaeger-client statsd"),
    # standards
    ("standards", "Linters, formatters and type checkers", "Ruff", "ruff"),
    ("standards", "Linters, formatters and type checkers", "Black", "black"),
    ("standards", "Linters, formatters and type checkers", "mypy", "mypy"),
    ("standards", "Linters, formatters and type checkers", "Pyright", "pyright"),
    ("standards", "Linters, formatters and type checkers", "flake8 / pylint / isort", "flake8 pylint isort"),
    ("standards", "Linters, formatters and type checkers", "ESLint", "eslint"),
    ("standards", "Linters, formatters and type checkers", "Prettier", "prettier"),
    ("standards", "Linters, formatters and type checkers", "TypeScript", "typescript"),
    ("standards", "Linters, formatters and type checkers", "Biome", "@biomejs/biome"),
    ("standards", "Pre-commit and git hooks", "Husky", "husky"),
    ("standards", "Pre-commit and git hooks", "lint-staged", "lint-staged"),
    ("standards", "Pre-commit and git hooks", "pre-commit", "pre-commit"),
    ("standards", "Test frameworks", "pytest", "pytest"),
    ("standards", "Test frameworks", "Hypothesis", "hypothesis"),
    ("standards", "Test frameworks", "Jest", "jest"),
    ("standards", "Test frameworks", "Vitest", "vitest"),
    ("standards", "Test frameworks", "Mocha / Jasmine", "mocha jasmine"),
    ("standards", "Test frameworks", "Playwright", "playwright @playwright/test"),
    ("standards", "Test frameworks", "Cypress", "cypress"),
    ("standards", "Test frameworks", "Testing Library", "@testing-library"),
    ("standards", "Test frameworks", "testify (Go)", "github.com/stretchr/testify"),
    # security
    ("security", "Authentication libraries", "Passport", "passport"),
    ("security", "Authentication libraries", "NextAuth / Auth.js", "next-auth @auth/core"),
    ("security", "Authentication libraries", "JWT libraries", "jsonwebtoken jose pyjwt python-jose github.com/golang-jwt/jwt"),
    ("security", "Authentication libraries", "Password hashing", "bcrypt bcryptjs argon2 argon2-cffi passlib"),
    ("security", "Authentication libraries", "OAuth clients", "authlib oauthlib requests-oauthlib"),
    ("security", "Authentication libraries", "Hosted identity", "@clerk auth0 @auth0 firebase-admin"),
    ("security", "Authentication libraries", "Django allauth", "django-allauth"),
    ("security", "Dependency and vulnerability scanning", "pip-audit / safety / bandit", "pip-audit safety bandit"),
    # integrations
    ("integrations", "SDKs and clients", "Stripe", "stripe github.com/stripe/stripe-go"),
    ("integrations", "SDKs and clients", "Twilio", "twilio"),
    ("integrations", "SDKs and clients", "SendGrid", "sendgrid @sendgrid/mail"),
    ("integrations", "SDKs and clients", "Mailgun / Postmark / Resend", "mailgun mailgun.js postmark postmarker resend"),
    ("integrations", "SDKs and clients", "AWS", "boto3 botocore aws-sdk @aws-sdk github.com/aws/aws-sdk-go github.com/aws/aws-sdk-go-v2"),
    ("integrations", "SDKs and clients", "Google Cloud", "google-cloud-storage google-cloud-bigquery google-cloud-secret-manager @google-cloud cloud.google.com/go"),
    ("integrations", "SDKs and clients", "Azure", "azure-identity azure-storage-blob @azure"),
    ("integrations", "SDKs and clients", "OpenAI", "openai"),
    ("integrations", "SDKs and clients", "Anthropic", "anthropic @anthropic-ai"),
    ("integrations", "SDKs and clients", "Other model providers", "cohere mistralai google-generativeai @google/generative-ai huggingface-hub langchain"),
    ("integrations", "SDKs and clients", "GitHub", "octokit @octokit pygithub"),
    ("integrations", "SDKs and clients", "Slack", "slack-sdk slack-bolt @slack"),
    ("integrations", "SDKs and clients", "Firebase / Supabase", "firebase @supabase/supabase-js supabase"),
    ("integrations", "SDKs and clients", "Payments (PayPal, Braintree, Plaid)", "paypal braintree plaid plaid-python"),
    ("integrations", "SDKs and clients", "Search and media (Algolia, Cloudinary)", "algoliasearch cloudinary"),
]

# (page, group, label, regex on the repo-relative posix path)
FILES: list[tuple[str, str, str, str]] = [
    ("data", "Migrations", "Prisma migrations", r"(^|/)prisma/migrations/"),
    ("data", "Migrations", "Alembic", r"(^|/)alembic\.ini$|(^|/)alembic/versions/"),
    ("data", "Migrations", "Knex", r"(^|/)knexfile\.\w+$"),
    ("data", "Migrations", "Rails migrations", r"(^|/)db/migrate/"),
    ("data", "Migrations", "Flyway", r"(^|/)db/migration/V[^/]+\.sql$"),
    ("data", "Migrations", "Liquibase", r"(^|/)liquibase[^/]*\.(xml|ya?ml|properties)$"),
    ("data", "Migrations", "Migration directory", r"(^|/)migrations/[^/]+\.(py|sql|js|ts)$"),
    ("services", "Entrypoints", "Python entrypoints", r"(^|/)(main|app|manage|wsgi|asgi|__main__)\.py$"),
    ("services", "Entrypoints", "JavaScript / TypeScript entrypoints", r"^(src/)?(server|index|main|app)\.(js|ts|mjs|cjs)$"),
    ("services", "Entrypoints", "Go entrypoints", r"(^|/)main\.go$"),
    ("services", "Entrypoints", "Rust entrypoints", r"(^|/)src/(main\.rs|bin/[^/]+\.rs)$"),
    ("services", "Entrypoints", "Java application classes", r"(^|/)[A-Z]\w*Application\.java$"),
    ("services", "Entrypoints", ".NET entrypoints", r"(^|/)Program\.cs$"),
    ("services", "Containers and deployment descriptors", "Dockerfiles", r"(^|/)(Dockerfile(\.[\w.-]+)?|[\w.-]+\.Dockerfile)$"),
    ("services", "Containers and deployment descriptors", "Docker Compose", r"(^|/)(docker-)?compose[\w.-]*\.ya?ml$"),
    ("services", "Containers and deployment descriptors", "Procfile", r"(^|/)Procfile$"),
    ("services", "Containers and deployment descriptors", "Vercel / Netlify / Fly", r"(^|/)(vercel\.json|netlify\.toml|fly\.toml)$"),
    ("services", "Containers and deployment descriptors", "Serverless", r"(^|/)serverless\.ya?ml$"),
    ("services", "Workspaces and modules", "pnpm workspaces", r"(^|/)pnpm-workspace\.yaml$"),
    ("services", "Workspaces and modules", "Lerna", r"(^|/)lerna\.json$"),
    ("services", "Workspaces and modules", "Nx", r"(^|/)nx\.json$"),
    ("services", "Workspaces and modules", "Turborepo", r"(^|/)turbo\.json$"),
    ("services", "Workspaces and modules", "Go workspace", r"(^|/)go\.work$"),
    ("observability", "Configuration files", "Prometheus config", r"(^|/)prometheus[\w.-]*\.ya?ml$"),
    ("observability", "Configuration files", "OpenTelemetry collector config", r"(^|/)otel[\w.-]*\.ya?ml$"),
    ("observability", "Configuration files", "Datadog config", r"(^|/)datadog[\w.-]*\.ya?ml$"),
    ("observability", "Configuration files", "Grafana", r"(^|/)grafana/"),
    ("observability", "Configuration files", "Sentry config", r"(^|/)(sentry\.[\w.]+|\.sentryclirc)$"),
    ("standards", "Linters, formatters and type checkers", "Ruff", r"(^|/)\.?ruff\.toml$"),
    ("standards", "Linters, formatters and type checkers", "mypy", r"(^|/)\.?mypy\.ini$"),
    ("standards", "Linters, formatters and type checkers", "Pyright", r"(^|/)pyrightconfig\.json$"),
    ("standards", "Linters, formatters and type checkers", "flake8 / pylint / isort", r"(^|/)(\.flake8|\.pylintrc|\.isort\.cfg)$"),
    ("standards", "Linters, formatters and type checkers", "ESLint", r"(^|/)(\.eslintrc(\.[\w]+)?|eslint\.config\.\w+)$"),
    ("standards", "Linters, formatters and type checkers", "Prettier", r"(^|/)(\.prettierrc(\.[\w]+)?|prettier\.config\.\w+)$"),
    ("standards", "Linters, formatters and type checkers", "tsconfig", r"(^|/)tsconfig[\w.-]*\.json$"),
    ("standards", "Linters, formatters and type checkers", "Biome", r"(^|/)biome\.jsonc?$"),
    ("standards", "Linters, formatters and type checkers", "golangci-lint", r"(^|/)\.golangci\.ya?ml$"),
    ("standards", "Linters, formatters and type checkers", "rustfmt / clippy", r"(^|/)\.?(rustfmt|clippy)\.toml$"),
    ("standards", "Linters, formatters and type checkers", "EditorConfig", r"(^|/)\.editorconfig$"),
    ("standards", "Linters, formatters and type checkers", "Stylelint / RuboCop", r"(^|/)(\.stylelintrc[\w.]*|\.rubocop\.yml)$"),
    ("standards", "Pre-commit and git hooks", "pre-commit config", r"(^|/)\.pre-commit-config\.ya?ml$"),
    ("standards", "Pre-commit and git hooks", "Husky hooks", r"(^|/)\.husky/"),
    ("standards", "Pre-commit and git hooks", "Lefthook", r"(^|/)\.?lefthook(-local)?\.ya?ml$"),
    ("standards", "Pre-commit and git hooks", "Versioned hooks directory", r"(^|/)\.githooks/"),
    ("standards", "Test frameworks", "pytest config", r"(^|/)(pytest\.ini|conftest\.py)$"),
    ("standards", "Test frameworks", "tox", r"(^|/)tox\.ini$"),
    ("standards", "Test frameworks", "Jest config", r"(^|/)jest\.config\.\w+$"),
    ("standards", "Test frameworks", "Vitest config", r"(^|/)vitest\.config\.\w+$"),
    ("standards", "Test frameworks", "Playwright config", r"(^|/)playwright\.config\.\w+$"),
    ("standards", "Test frameworks", "Cypress config", r"(^|/)cypress\.config\.\w+$"),
    ("standards", "Test frameworks", "RSpec", r"(^|/)\.rspec$"),
    ("standards", "Test frameworks", "Go test files", r"_test\.go$"),
    ("standards", "CI", "GitHub Actions workflows", r"(^|/)\.github/workflows/[^/]+\.ya?ml$"),
    ("standards", "CI", "GitLab CI", r"(^|/)\.gitlab-ci\.ya?ml$"),
    ("standards", "CI", "Jenkins", r"(^|/)Jenkinsfile$"),
    ("standards", "CI", "CircleCI", r"(^|/)\.circleci/config\.ya?ml$"),
    ("standards", "CI", "Other CI", r"(^|/)(azure-pipelines|bitbucket-pipelines|cloudbuild|\.travis|\.drone)\.ya?ml$"),
    ("standards", "Ownership", "CODEOWNERS", r"^(\.github/|docs/)?CODEOWNERS$"),
    ("security", "Dependency and vulnerability scanning", "Dependabot", r"^\.github/dependabot\.ya?ml$"),
    ("security", "Dependency and vulnerability scanning", "Renovate", r"^(\.github/)?(renovate\.json5?|\.renovaterc(\.json5?)?)$"),
    ("security", "Dependency and vulnerability scanning", "Scanner config", r"(^|/)(\.snyk|\.trivyignore|\.gitleaks\.toml|deny\.toml|\.bandit)$"),
    ("security", "Ownership and policy", "SECURITY.md", r"^(\.github/|docs/)?SECURITY\.md$"),
    ("security", "Ownership and policy", "CODEOWNERS", r"^(\.github/|docs/)?CODEOWNERS$"),
]

# (page, group, label, file regex, content regex) - the file must contain it.
CONTENT: list[tuple[str, str, str, str, str]] = [
    ("standards", "Linters, formatters and type checkers", "Ruff", r"(^|/)pyproject\.toml$", r"(?m)^\[tool\.ruff"),
    ("standards", "Linters, formatters and type checkers", "Black", r"(^|/)pyproject\.toml$", r"(?m)^\[tool\.black"),
    ("standards", "Linters, formatters and type checkers", "mypy", r"(^|/)(pyproject\.toml|setup\.cfg)$", r"(?m)^\[(tool\.mypy|mypy)\]?"),
    ("standards", "Linters, formatters and type checkers", "Pyright", r"(^|/)pyproject\.toml$", r"(?m)^\[tool\.pyright"),
    ("standards", "Linters, formatters and type checkers", "flake8 / pylint / isort", r"(^|/)(pyproject\.toml|setup\.cfg|tox\.ini)$", r"(?m)^\[(tool\.(pylint|isort)|flake8)"),
    ("standards", "Test frameworks", "pytest config", r"(^|/)pyproject\.toml$", r"(?m)^\[tool\.pytest"),
    ("services", "Workspaces and modules", "Cargo workspace", r"(^|/)Cargo\.toml$", r"(?m)^\[workspace\]"),
]

# (page, group, label, image base names) - from `image:` lines in compose files.
IMAGES: list[tuple[str, str, str, str]] = [
    ("data", "Databases", "PostgreSQL", "postgres postgis timescaledb"),
    ("data", "Databases", "MySQL / MariaDB", "mysql mariadb"),
    ("data", "Databases", "MongoDB", "mongo"),
    ("data", "Databases", "Elasticsearch / OpenSearch", "elasticsearch opensearch"),
    ("data", "Databases", "ClickHouse", "clickhouse-server"),
    ("data", "Databases", "Cassandra", "cassandra"),
    ("data", "Databases", "DynamoDB", "dynamodb-local localstack"),
    ("data", "Caches", "Redis", "redis valkey"),
    ("data", "Caches", "Memcached", "memcached"),
    ("data", "Queues and brokers", "Kafka", "kafka zookeeper redpanda"),
    ("data", "Queues and brokers", "RabbitMQ", "rabbitmq"),
    ("data", "Queues and brokers", "NATS", "nats"),
    ("observability", "Tracing and metrics", "Prometheus", "prometheus"),
    ("observability", "Tracing and metrics", "Jaeger", "jaeger all-in-one"),
    ("observability", "Configuration files", "Grafana", "grafana"),
]

# (page, group, label, regex) over non-test source files.
SOURCE_GREP: list[tuple[str, str, str, str]] = [
    ("observability", "Health endpoints", "Health / readiness route",
     r"""["'`]/(?:api/)?(?:healthz?|readyz?|livez?|ready|live|ping|health[-_]?check|status)["'`]"""),
]
SOURCE_EXTENSIONS = frozenset(
    {".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".go", ".rs", ".java",
     ".kt", ".rb", ".php", ".cs"})

# (page, group, label, regex) over CI workflow files.
CI_GREP: list[tuple[str, str, str, str]] = [
    ("security", "Dependency and vulnerability scanning", "pip-audit", r"\bpip-audit\b"),
    ("security", "Dependency and vulnerability scanning", "npm / yarn audit", r"\b(npm|yarn|pnpm) audit\b"),
    ("security", "Dependency and vulnerability scanning", "cargo audit / deny", r"\bcargo (audit|deny)\b"),
    ("security", "Dependency and vulnerability scanning", "Trivy", r"\btrivy\b"),
    ("security", "Dependency and vulnerability scanning", "Snyk", r"\bsnyk\b"),
    ("security", "Dependency and vulnerability scanning", "OSV-Scanner", r"\bosv-scanner\b"),
    ("security", "Dependency and vulnerability scanning", "CodeQL", r"\bcodeql\b"),
    ("security", "Dependency and vulnerability scanning", "Secret scanning (gitleaks / trufflehog)", r"\b(gitleaks|trufflehog)\b"),
    ("security", "Dependency and vulnerability scanning", "Bandit / safety", r"\b(bandit|safety check)\b"),
]

LANGUAGES: dict[str, str] = {
    ".py": "Python", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript",
    ".cjs": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript", ".go": "Go",
    ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".rb": "Ruby", ".php": "PHP",
    ".cs": "C#", ".swift": "Swift", ".c": "C", ".h": "C", ".cpp": "C++", ".cc": "C++",
    ".hpp": "C++", ".sh": "Shell", ".ps1": "PowerShell", ".sql": "SQL",
    ".scala": "Scala", ".dart": "Dart", ".ex": "Elixir", ".exs": "Elixir",
    ".lua": "Lua", ".vue": "Vue", ".svelte": "Svelte",
}

ENV_EXAMPLE = re.compile(
    r"(^|/)(\.env(\.[\w-]+)*\.(example|sample|template|dist)|(example|sample)\.env)$")
ENV_NAME = re.compile(r"^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=", re.MULTILINE)
INTEGRATION_ENV = re.compile(r"_(URL|KEY|TOKEN|ENDPOINT)$")
DATA_ENV = re.compile(
    r"(DATABASE|(^|_)DB(_|$)|REDIS|MONGO|POSTGRES|MYSQL|CACHE|QUEUE|BROKER|AMQP|KAFKA)")
GITIGNORE_ENV = frozenset(
    {".env", "/.env", ".env*", "/.env*", ".env.*", "*.env", "**/.env", "**/.env*"})
COMPOSE = re.compile(r"(^|/)(docker-)?compose[\w.-]*\.ya?ml$")
COMPOSE_IMAGE = re.compile(r"^[ \t]*image:[ \t]*[\"']?([^\s\"'#]+)", re.MULTILINE)
TSCONFIG = re.compile(r"(^|/)tsconfig[\w.-]*\.json$")
TS_PATHS = re.compile(r'"paths"\s*:\s*\{(.*?)\}', re.DOTALL)
TS_KEY = re.compile(r'"([^"]+)"\s*:')
TESTISH = re.compile(r"(^|/)(tests?|__tests__|spec)/|\.(test|spec)\.|(^|/)test_[^/]*$|_test\.[a-z]+$")


# --------------------------------------------------------------------------
# Detection
# --------------------------------------------------------------------------

def _norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name.lower())


class Found:
    """(page, group, label) -> the files that evidence it."""

    def __init__(self) -> None:
        self.rows: dict[tuple[str, str, str], tuple[str, set[str]]] = {}

    def add(self, page: str, group: str, label: str, path: str,
            sortkey: str | None = None) -> None:
        key = (page, group, label)
        current = self.rows.get(key)
        paths = current[1] if current else set()
        paths.add(path)
        self.rows[key] = (sortkey if sortkey is not None else label.lower(), paths)


def walk(repo: Path) -> list[str]:
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(repo):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(filenames):
            rel = (Path(dirpath) / name).relative_to(repo).as_posix()
            # Machine-local caches exist on one machine only: listing them
            # would make the generated page differ between a clone and CI.
            if rel.startswith(LOCAL_ONLY):
                continue
            out.append(rel)
    return sorted(out)


def _read(repo: Path, rel: str) -> str:
    path = repo / rel
    try:
        if path.stat().st_size > MAX_READ_BYTES:
            return ""
        return path.read_bytes().decode("utf-8", errors="replace")
    except OSError:
        return ""


def _detect_deps(repo: Path, found: Found) -> None:
    declared: dict[str, set[str]] = {}
    for entries in es.discover(repo).values():
        for name, _version, _kind, manifest in entries:
            declared.setdefault(_norm(name), set()).add(manifest)
    for page, group, label, names in DEPS:
        for wanted in names.split():
            wanted = _norm(wanted)
            for token in sorted(declared):
                if token == wanted or token.startswith(wanted + "/"):
                    for manifest in declared[token]:
                        found.add(page, group, label, manifest)


def _detect_files(repo: Path, files: list[str], found: Found) -> None:
    for page, group, label, pattern in FILES:
        regex = re.compile(pattern)
        for rel in files:
            if regex.search(rel):
                found.add(page, group, label, rel)
    for page, group, label, file_re, content_re in CONTENT:
        f_regex, c_regex = re.compile(file_re), re.compile(content_re)
        for rel in files:
            if f_regex.search(rel) and c_regex.search(_read(repo, rel)):
                found.add(page, group, label, rel)
    for rel in files:
        if not COMPOSE.search(rel):
            continue
        for image in COMPOSE_IMAGE.findall(_read(repo, rel)):
            base = image.split("/")[-1].split("@")[0].split(":")[0].lower()
            for page, group, label, names in IMAGES:
                if base in names.split():
                    found.add(page, group, label, rel)
    greps = [(p, g, lbl, re.compile(rx)) for p, g, lbl, rx in SOURCE_GREP]
    for rel in files:
        if Path(rel).suffix.lower() not in SOURCE_EXTENSIONS or TESTISH.search(rel):
            continue
        text = _read(repo, rel)
        for page, group, label, regex in greps:
            if regex.search(text):
                found.add(page, group, label, rel)
    ci = [(p, g, lbl, re.compile(rx, re.IGNORECASE)) for p, g, lbl, rx in CI_GREP]
    workflow = re.compile(r"^\.github/workflows/[^/]+\.ya?ml$")
    for rel in files:
        if workflow.match(rel):
            text = _read(repo, rel)
            for page, group, label, regex in ci:
                if regex.search(text):
                    found.add(page, group, label, rel)


def _detect_languages(files: list[str], found: Found) -> None:
    by_language: dict[str, list[str]] = {}
    for rel in files:
        language = LANGUAGES.get(Path(rel).suffix.lower())
        if language:
            by_language.setdefault(language, []).append(rel)
    for language, paths in by_language.items():
        label = f"{language} ({len(paths)} file{'s' if len(paths) != 1 else ''})"
        for rel in paths:
            found.add("standards", "Languages", label, rel,
                      sortkey=f"{99999 - len(paths):05d}{language.lower()}")


def _detect_env(repo: Path, files: list[str], found: Found) -> None:
    """Variable NAMES only. Values are never captured, stored or rendered."""
    for rel in files:
        if not ENV_EXAMPLE.search(rel):
            continue
        for name in sorted(set(ENV_NAME.findall(_read(repo, rel)))):
            found.add("security", "Environment variable names", f"`{name}`", rel)
            if INTEGRATION_ENV.search(name):
                found.add("integrations",
                          "Environment variables naming an external service",
                          f"`{name}`", rel)
            if DATA_ENV.search(name):
                found.add("data", "Connection settings (env var names)",
                          f"`{name}`", rel)
    group = "Secret handling"
    examples = [rel for rel in files if ENV_EXAMPLE.search(rel)]
    for rel in examples:
        found.add("security", group, "Environment template present (names only are read)", rel)
    ignores = [rel for rel in files if Path(rel).name == ".gitignore"]
    covered = [
        rel for rel in ignores
        if any(line.strip() in GITIGNORE_ENV
               for line in _read(repo, rel).splitlines()
               if not line.lstrip().startswith(("#", "!")))
    ]
    if covered:
        for rel in covered:
            found.add("security", group, "`.env` is gitignored", rel)
    elif ignores:
        for rel in ignores:
            found.add("security", group, "No `.gitignore` rule covers `.env`", rel)
    else:
        found.add("security", group, "No `.gitignore` file found", "(none)")


def _detect_structure(repo: Path, files: list[str], found: Found) -> None:
    for rel in files:
        name = Path(rel).name
        if name == "package.json":
            try:
                data = json.loads(_read(repo, rel))
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue
            workspaces = data.get("workspaces")
            if isinstance(workspaces, dict):
                workspaces = workspaces.get("packages")
            if isinstance(workspaces, list) and workspaces:
                found.add("services", "Workspaces and modules",
                          "npm workspaces: " + ", ".join(
                              f"`{w}`" for w in sorted(map(str, workspaces))), rel)
            if isinstance(data.get("main"), str):
                found.add("services", "Entrypoints", f"package.json `main`: `{data['main']}`", rel)
            bins = data.get("bin")
            if isinstance(bins, str):
                bins = {data.get("name", "bin"): bins}
            if isinstance(bins, dict):
                for key in sorted(bins):
                    found.add("services", "Entrypoints", f"package.json `bin`: `{key}`", rel)
            scripts = data.get("scripts")
            if isinstance(scripts, dict) and isinstance(scripts.get("start"), str):
                found.add("services", "Entrypoints",
                          f"package.json `start` script: `{scripts['start'][:80]}`", rel)
        if TSCONFIG.search(rel):
            match = TS_PATHS.search(_read(repo, rel))
            if match:
                aliases = sorted(set(TS_KEY.findall(match.group(1))))
                if aliases:
                    found.add("standards", "Import conventions",
                              "tsconfig path aliases: " + ", ".join(f"`{a}`" for a in aliases), rel)
    for directory, manifest in es.modules(repo):
        found.add("services", "Workspaces and modules", f"Module `{directory}`", manifest)
    packages: dict[str, str] = {}
    for rel in files:
        parts = rel.split("/")
        if parts[-1] != "__init__.py" or len(parts) < 2 or TESTISH.search(rel):
            continue
        if parts[0] == "src" and len(parts) == 3:
            packages[f"src layout package `src/{parts[1]}`"] = rel
        elif len(parts) == 2 and parts[0] not in ("src",):
            packages[f"flat package `{parts[0]}`"] = rel
    for label, rel in packages.items():
        found.add("standards", "Import conventions", "Python " + label, rel)


def detect(repo: Path) -> Found:
    found = Found()
    files = walk(repo)
    _detect_deps(repo, found)
    _detect_files(repo, files, found)
    _detect_languages(files, found)
    _detect_env(repo, files, found)
    _detect_structure(repo, files, found)
    return found


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

def _escape(text: str) -> str:
    return text.replace("|", "\\|")


def _evidence(paths: set[str]) -> str:
    ordered = sorted(paths)
    shown = ", ".join(p if p == "(none)" else f"`{p}`" for p in ordered[:MAX_EVIDENCE])
    more = len(ordered) - MAX_EVIDENCE
    return shown + (f" (+{more} more)" if more > 0 else "")


def render_block(page: str, found: Found) -> str:
    _path, _title, groups = PAGES[page]
    lines = [
        BEGIN,
        "<!-- Facts detected from the tree. This block is rewritten on every run;",
        "     write outside it. Nothing here is guessed: every row names its file. -->",
    ]
    for group in groups:
        rows = sorted(
            (sortkey, label, paths)
            for (p, g, label), (sortkey, paths) in found.rows.items()
            if p == page and g == group
        )
        lines += ["", f"### {group}", ""]
        if not rows:
            lines.append(NOTHING)
            continue
        lines += ["| Detected | Where |", "|---|---|"]
        lines += [f"| {_escape(label)} | {_escape(_evidence(paths))} |"
                  for _key, label, paths in rows]
    lines += ["", f"Regenerate with: `{REGENERATE}`", END]
    return "\n".join(lines)


def render_new_page(title: str, block: str) -> str:
    return f"# {title}\n\n{block}\n\n## Owner notes\n\n{GAP}\n"


def plan(repo: Path, wiki: str = DEFAULT_WIKI) -> tuple[dict[Path, str], list[str]]:
    found = detect(repo)
    changes: dict[Path, str] = {}
    errors: list[str] = []
    for page in sorted(PAGES):
        rel, title, _groups = PAGES[page]
        path = repo / wiki / rel
        block = render_block(page, found)
        current = path.read_bytes().decode("utf-8", errors="replace") if path.is_file() else None
        try:
            desired = el.merge(current, title, block, render_new_page(title, block))
        except el.BrokenBlock as exc:
            errors.append(f"{(Path(wiki) / rel).as_posix()}: {exc}")
            continue
        if not el._same(current, desired):
            changes[path] = desired
    return changes, errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="extract_platform")
    parser.add_argument("root", nargs="?", default=".")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    parser.add_argument("--wiki", default=DEFAULT_WIKI,
                        help=f"wiki directory, relative to root (default {DEFAULT_WIKI})")
    args = parser.parse_args(argv)

    repo = Path(args.root).resolve()
    if not repo.is_dir():
        print(f"not a directory: {args.root}", file=sys.stderr)
        return 2

    changes, errors = plan(repo, args.wiki)
    for error in errors:
        print(f"broken generated block - fix by hand: {error}", file=sys.stderr)

    if args.write:
        for path, content in sorted(changes.items()):
            existed = path.is_file()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content.encode("utf-8"))
            print(f"{'updated' if existed else 'created'} {path.relative_to(repo).as_posix()}")
        if not changes:
            print(f"{args.wiki} platform pages already up to date")
        return 2 if errors else 0

    for path in sorted(changes):
        print(f"{'stale' if path.is_file() else 'missing'}: {path.relative_to(repo).as_posix()}")
    if not changes and not errors:
        print(f"{args.wiki} platform pages match the tree.")
        return 0
    if changes:
        print(f"Fix with: {REGENERATE}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
