# ADR-001: Initial Implementation Decisions

## Status
Accepted

## Context
Harbor is a production-grade open-source archive and media intelligence application built as a desktop-first Electron app with a Next.js frontend, PostgreSQL database, and provider abstraction for multiple storage backends.

## Decisions

### Database
- **PostgreSQL** via Prisma ORM as the primary production target
- **pgvector extension** enabled in Docker Compose for future semantic search
- **Typed core schema** with first-class fields (title, description, rating, dimensions, duration, etc.) plus flexible metadata extension tables
- **UUID primary keys** generated at the database level via `gen_random_uuid()`

### Provider Abstraction
- **Capability-driven interface** (`StorageProvider`) with methods for traversal, read, write, mutation, watch, and search
- **Local filesystem** as the first fully implemented provider
- **Dropbox** provider implemented with full read/write parity using the Dropbox SDK
- **Provider registry** for runtime provider management
- **Path traversal protection** built into the local filesystem provider

### Auth & Permissions
- **Dual mode**: `local` (single-user, no login) and `multi` (shared/self-hosted with JWT sessions)
- **Role-based**: Owner, Admin, Editor, Viewer, Guest with explicit resource/action permissions
- **Archive root access control**: private roots hidden from unauthorized roles
- **JWT tokens** via `jose` library with 30-day session expiry

### Entity Relations
- **Generic relation table** with source/target entity type+ID, typed relation types, bidirectionality, confidence, and source attribution
- **Seven relation types**: RELATED, ALTERNATE_VERSION, DERIVED_FROM, DUPLICATE_CANDIDATE, SAME_EVENT, SCAN_OF_SAME_SOURCE, CURATED_ASSOCIATION

### Realtime
- **Event bus** singleton with type-specific and global handlers
- **SSE** endpoint for web clients
- **Electron IPC forwarding** planned for desktop

### AI Integration
- **Provider abstraction** with OpenAI and Anthropic as initial implementations
- **Purpose-based routing**: configure which provider handles which AI task
- **Full usage tracking**: provider, model, tokens, elapsed time, estimated cost, purpose, user, status
- **Face recognition schema and interface** scaffolded, implementation deferred

### Preview System
- **In-process generation** using `sharp` for images
- **Four preview sizes**: thumbnail (200px), small (400px), medium (800px), large (1600px)
- **WebP format** for cached previews
- **Cache stored outside source archives** in a configurable directory

### MCP
- **Optional extension layer** for dev/admin tooling
- **Six tools**: list-archive-roots, indexing-status, ai-usage-summary, database-stats, recent-audit-log, check-relation-integrity
- **Not a runtime dependency** — Harbor functions without MCP

### Frontend
- **Next.js 15 App Router** with React 19
- **shadcn/ui patterns** with Radix primitives
- **Zustand** for client state, **TanStack Query** for server state
- **Command palette** (Cmd+K) for quick search and navigation
- **Grid and list view modes** with keyboard shortcuts
- **Full dark/light mode** with design token parity
- **Reduced motion support** via CSS media query

### Electron
- **Strict main/preload/renderer boundaries**
- **`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`**
- **Typed IPC contracts** via shared type definitions
- **Safe file dialog** access through preload bridge

## Consequences
- The schema supports both current features and planned semantic search, face recognition, and advanced relation types
- The provider abstraction allows adding new storage backends without touching UI or business logic
- The dual auth mode allows frictionless local desktop use while supporting shared deployments
- Preview generation is image-only initially; video/PDF previews require ffmpeg/other tools as follow-up
