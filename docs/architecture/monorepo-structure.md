# Monorepo Structure

## apps/desktop
Electron shell, app lifecycle, secure IPC boundaries, desktop-only concerns.

## apps/web
Next.js App Router UI, routes, layouts, feature pages, settings, onboarding, archive browser.

## packages/ui
Reusable UI primitives, wrappers, patterns, and keyboard shortcut surfaces.

## packages/database
Prisma schema, migrations, seeders, repositories, and database access utilities.

## packages/providers
Storage provider contracts and implementations for local filesystem and Dropbox.

## packages/ai
AI provider abstraction, OCR/transcription/tagging/title generation pipelines, usage/cost tracking.

## packages/jobs
Indexing jobs, preview generation jobs, OCR jobs, transcription jobs, duplicate detection, retries, scheduling.

## packages/auth
Users, roles, permissions, capability checks, hidden root enforcement, audit boundaries.

## packages/realtime
Event bus, subscriptions, invalidation, sync channels, live UI update contracts.

## packages/config
Environment parsing, runtime flags, feature flags, deployment modes.

## packages/types
Shared type contracts and model DTOs.

## packages/utils
Low-level utilities only. Avoid dumping business logic here.

## mcp/servers
Optional MCP servers for development/admin/integration tooling.
