# Provider Abstraction Rules
- Providers must be pluggable and capability-driven.
- Local filesystem and Dropbox are first-class providers.
- Do not hardcode source-specific assumptions into generic services or UI.
- Model provider identity, traversal, preview generation, file operations, and search as contracts.
