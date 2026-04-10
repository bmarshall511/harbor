# Harbor — Project Instructions

## Mission
Build and maintain Harbor, a production-grade open-source archive and media intelligence application with a premium-quality UX, strong architecture, and long-term maintainability.

## Product Goals
- Sleek, modern, engaging, visual archive experience
- Electron desktop-first with self-hosted support
- Multiple archive roots with permissions and hidden private roots
- Provider abstraction from day one
- Rich previews, advanced search, metadata, linking, and AI enrichment
- Real-time desktop-app feel with no manual refreshes
- AAA accessibility, strong keyboard support, and dark/light mode parity
- Open-source quality codebase that is welcoming to contributors

## Open Source Non-Negotiables
- Prefer broadly adoptable architecture and documentation.
- Avoid artificial product-tier abstractions or monetization-specific code paths.
- Keep configuration, setup, and local development approachable.
- Include CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, LICENSE placeholder, and architecture docs.
- Design extension points cleanly so the community can add providers, AI adapters, and UI features.

## General Non-Negotiables
- Never guess when a targeted question is needed.
- Inspect the repository thoroughly before proposing changes.
- Propose architecture before major implementation.
- Keep code DRY, modular, typed, tested, and documented.
- Do not create large grab-bag files or leaky abstractions.
- Do not touch unrelated files.
- Keep UI polished and accessible.
- Preserve strong boundaries between Electron main, preload, renderer, server, providers, and data layer.
- Prefer typed core schemas plus flexible metadata extensions.
- Keep archive/provider operations observable, auditable, and permission-aware.
- Include a first-class relation model for linking files, folders, and other entities.
