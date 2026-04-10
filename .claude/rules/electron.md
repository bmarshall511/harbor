# Electron Rules
- Preserve strict boundaries between main, preload, and renderer.
- No unsafe direct privileged APIs in renderer.
- Use explicit typed IPC contracts.
- Filesystem and provider operations must run through secure boundaries.
