# Architecture Overview

## Primary Product Shape
- Desktop-first Electron application
- Next.js App Router UI
- Postgres + Prisma
- Provider abstraction for local filesystem + Dropbox
- Background jobs for indexing, previews, OCR, transcription, and AI enrichment
- Realtime UX via subscriptions/events/invalidations
- Permission-aware multi-user data model
- Hidden private roots and capability-driven archive operations
- First-class entity linking through the database
- Optional MCP extension layer for tooling and integrations
