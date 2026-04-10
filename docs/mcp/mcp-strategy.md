# MCP Strategy

Use MCP as an optional extension layer, not a core runtime dependency.

## Why include MCP
- dev/admin tooling
- diagnostics
- safe automation
- integration with external tools and data sources
- future Harbor-specific maintenance tools

## Recommended Harbor MCP use cases
- inspect archive root/provider capabilities
- run safe diagnostics on indexing jobs and preview pipelines
- inspect AI usage/cost logs
- inspect relation/link integrity
- perform guarded admin workflows in development/self-hosted environments

## Design guidance
- keep MCP servers repo-local and optional
- do not make the app require MCP to function
- keep sensitive actions permission-aware and auditable
