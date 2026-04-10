# Architecture Rules
- Favor clear layers: UI, features, domain/services, providers/adapters, persistence, jobs, Electron boundaries.
- No direct provider logic inside presentational UI.
- No direct database access from random components.
- Prefer capability-driven interfaces and stable contracts.
- Design for local filesystem and Dropbox as first-class providers.
- Include a first-class relation/linking model in the schema and services.
- Treat MCP as optional tooling/integration infrastructure, not a core runtime dependency.
