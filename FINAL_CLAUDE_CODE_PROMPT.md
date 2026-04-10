You are Claude Code acting as a principal software architect, staff-level full-stack engineer, UX systems thinker, accessibility expert, and codebase steward.

Your job is to design and build Harbor, a production-grade open-source archive and media intelligence application. This is not a toy, prototype, or rough proof of concept. It should be architected and implemented with the quality bar of serious open-source software that welcomes contributors, scales cleanly, and remains maintainable long-term.

Before you write or change any code, follow this exact process in order:
1. Deeply inspect the full repository structure and all existing relevant files.
2. Ask any targeted clarifying questions needed to eliminate ambiguity. Never guess when a direct question is warranted.
3. Propose the architecture, data model, provider model, desktop/web boundaries, auth/permissions model, realtime strategy, AI integration strategy, MCP strategy, and testing strategy.
4. Propose the full directory structure and the implementation plan in logical slices.
5. Only after the plan is approved or sufficiently grounded by the requirements below, implement the app carefully.
6. After implementation, validate everything with tests, linting, type-checking, and run instructions.
7. Document every important architectural decision in the repo.

Non-negotiable product requirements:
- Build Harbor as a sleek, modern, engaging, highly visual archive app.
- Primary product surface: Electron desktop app.
- Web stack: Next.js App Router with TypeScript.
- UI stack: shadcn/ui, lucide-react, Tailwind, tasteful page transitions, subtle micro animations, and motion that respects reduced-motion preferences.
- Must support light mode and dark mode with high polish.
- Must meet AAA accessibility standards as closely as reasonably achievable.
- Must feel realtime. The user should never need to refresh the page to see updated state.
- Build this as open-source quality software: readable, modular, scalable, maintainable, tested, and documented.
- Primary deployment bias: Electron desktop + self-hosted + configurable remote database support.
- Build a provider abstraction from day one.
- Implement local filesystem support and Dropbox support now.
- Support multiple archive roots with permissions and hidden private roots.
- Support permission-based file operations: delete, move, create folders, rename folders, and other safe archive actions.
- Use capability modes such as read-only, metadata-only, and full file operations.
- Use Postgres as the real target and Prisma for schema management. SQLite is acceptable only for dev/demo if useful.
- Support connecting to a remote database.
- Do not rely on a naive file_id/meta_key/meta_value-only model. Use typed core schema plus flexible metadata.
- Support metadata on both files and folders/events.
- Support linking files, folders, and other entities together through the database using typed relationships. Design a generic relation model that can express things like related files, alternate versions, same event, derived from, duplicate candidate, scans of same source, and manually curated associations.
- Metadata entry must be fast, assisted, and autocomplete-friendly.
- Search must be comprehensive, modern, permission-aware, and polished.
- Support previews for as many file types as reasonably possible, including beautiful text previews.
- Cache previews/thumbnails outside the source archive.
- AI features are in scope now.
- Design an AI provider abstraction.
- Track AI provider, model, tokens, latency, estimated cost, purpose, user, timestamps, and status.
- Support OCR, text extraction, transcription where practical, auto-titles, auto-tags, duplicate grouping suggestions, and semantic-search readiness.
- Support face recognition / face clustering as a configurable feature with careful privacy-aware design.
- Support multi-user permissions, collaborative metadata editing, edit history, audit logs, and user-specific preferences/favorites/saved searches.
- Use Electron securely with strict main/preload/renderer boundaries and typed IPC contracts.
- Include tests, docs, setup instructions, contributor docs, architecture docs, and open-source community docs.
- Add an MCP strategy and repo-local MCP scaffold for development/admin/integration tooling. Do not make the application runtime depend on MCP. Use MCP as an optional extension layer for tool integrations, diagnostics, and safe admin workflows.
- Respect and use the repo’s Claude/Cursor/agent guidance files if present.

Open-source repo requirements:
- Add CONTRIBUTING.md
- Add CODE_OF_CONDUCT.md
- Add SECURITY.md
- Add LICENSE placeholder guidance
- Add architecture decision docs where useful
- Keep extension points clear for community contributions
- Keep onboarding and local development setup as smooth as possible

At the end, provide:
- what was built
- architecture summary
- schema summary
- provider summary
- relation/linking model summary
- MCP strategy summary
- AI usage tracking summary
- how to run locally
- how to self-host
- how to connect a remote database
- known tradeoffs and follow-up recommendations

Also: before coding, inspect the codebase and ask any remaining targeted questions needed to avoid assumptions.
