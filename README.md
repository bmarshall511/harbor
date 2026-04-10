# Harbor

Open-source archive and media intelligence application.

Harbor lets you browse, organize, search, and enrich your file archives with AI-powered metadata, rich previews, and a modern desktop-grade UI.

## Features

- **Archive Browser** — Navigate files and folders in a polished, keyboard-first interface with grid and list views
- **Multiple Archive Roots** — Connect local filesystem directories and Dropbox accounts
- **Rich Previews** — Image thumbnails, cached previews, and multi-format support
- **Metadata & Tags** — Typed core metadata plus flexible extensions, fast autocomplete tagging
- **People Management** — Admin-managed people registry, face detection, metadata-based tagging
- **Collections & Favorites** — Curate items into collections (public/private), star favorites
- **Full-Text Search** — PostgreSQL tsvector search across filenames, metadata, tags, people, OCR text, AI descriptions with faceted filtering
- **AI Enrichment** — OCR, auto-tags, auto-titles, transcription, face detection, and semantic search readiness
- **Entity Linking** — Relate files and folders: alternate versions, duplicates, same event, derived-from
- **Multi-User Permissions** — Roles (Owner/Admin/Editor/Viewer/Guest), private roots, audit logging
- **Admin Dashboard** — Search analytics, people management, delete queue, user impersonation
- **Realtime Updates** — SSE-based events + Dropbox change polling, no page refreshes needed
- **Cloud & Local** — Deploy on Vercel (Dropbox-only) or self-host with local filesystem support
- **Electron Desktop** — Secure Electron shell with typed IPC contracts
- **Dark/Light Mode** — Full design token parity, respects system preference
- **Accessibility** — AAA target, full keyboard support, screen reader semantics, reduced motion

## Quick Start (Local Development)

### Prerequisites

- Node.js >= 22
- pnpm >= 9
- Docker (for PostgreSQL)

### Setup

```bash
# Clone and install
git clone <repo-url> harbor && cd harbor
cp .env.example .env
pnpm install

# Start PostgreSQL
docker compose up -d

# Set up database
pnpm db:generate
pnpm db:push
pnpm db:seed

# Run the search foundation SQL (full-text search indexes + triggers)
cat packages/database/prisma/sql/001_search_foundation.sql | \
  docker exec -i harbor-postgres psql -U harbor -d harbor

# Start development
pnpm dev
```

The dev server automatically finds a free port. The URL is printed in the console.

### Dev Scripts

| Script | What it runs |
|--------|-------------|
| `pnpm dev` | Web app only — **use this for daily development** |
| `pnpm dev:desktop` | Web app + Electron desktop shell |
| `pnpm dev:mcp` | MCP dev tools server (stdio) — run separately |
| `pnpm dev:full` | All packages (web + desktop + MCP) |

### Adding an Archive Root

1. Go to Settings > Archive Roots
2. Click "Add Archive Root"
3. Enter a name and the absolute path to a directory (local) or connect your Dropbox account (cloud)
4. The directory will be indexed and files will appear in the browser

## Deploy to Vercel (Cloud Mode)

Harbor can run entirely on Vercel with Dropbox as the storage provider. Local filesystem archives are disabled in cloud mode.

### 1. Set Up Supabase

1. Create a [Supabase](https://supabase.com) project (recommended region: **US Central** for lowest latency)
2. Go to Project Settings > Database and copy the **Connection string (URI)** — use the **pooler** connection (port 6543)
3. Enable these extensions in the SQL Editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```

### 2. Prepare the Database

```bash
# Push the schema to your Supabase database
DATABASE_URL="postgresql://postgres.[ref]:[pass]@aws-0-us-central1.pooler.supabase.com:6543/postgres" \
  npx prisma db push --schema=packages/database/prisma/schema.prisma

# Run the search foundation SQL
cat packages/database/prisma/sql/001_search_foundation.sql | \
  psql "postgresql://postgres.[ref]:[pass]@db.[ref].supabase.co:5432/postgres"

# Seed default data (roles, admin user)
DATABASE_URL="..." pnpm db:seed
```

### 3. Create Vercel Project

1. Push your repo to GitHub/GitLab
2. Import the repo in [Vercel](https://vercel.com)
3. Framework: **Next.js** (auto-detected)
4. Root directory: `.` (monorepo root)
5. Build command: auto-detected from `vercel.json`

### 4. Set Environment Variables

In Vercel > Project Settings > Environment Variables:

| Variable | Value | Required |
|----------|-------|----------|
| `HARBOR_DEPLOYMENT_MODE` | `cloud` | Yes |
| `DATABASE_URL` | Your Supabase pooled connection string | Yes |
| `HARBOR_SESSION_SECRET` | Random 64+ character string | Yes |
| `DROPBOX_APP_KEY` | Your Dropbox app key | Yes (for Dropbox) |
| `DROPBOX_APP_SECRET` | Your Dropbox app secret | Yes (for Dropbox) |
| `CRON_SECRET` | Random string for cron auth | Yes |
| `OPENAI_API_KEY` | OpenAI API key | Optional (AI features) |
| `ANTHROPIC_API_KEY` | Anthropic API key | Optional (AI features) |

### 5. Configure Dropbox

1. Go to the [Dropbox App Console](https://www.dropbox.com/developers/apps)
2. Add your Vercel domain to the OAuth 2 redirect URIs:
   ```
   https://your-app.vercel.app/api/auth/dropbox/callback
   ```
3. Ensure `files.content.write` scope is enabled (for writing metadata JSON to Dropbox)

### 6. Deploy

1. Deploy to Vercel (push to main branch or manual deploy)
2. Visit your app URL and complete initial setup
3. Go to Settings > Dropbox to connect your Dropbox account
4. Go to Settings > Archive Roots to add a Dropbox archive root
5. Trigger an initial index from the archive root context menu

### 7. Automatic Sync

Harbor automatically syncs Dropbox changes:
- **Vercel Cron** runs every 15 minutes (configured in `vercel.json`)
- New files, modifications, and deletions are detected via Dropbox's cursor-based change API
- No manual re-indexing needed after the initial setup

### 8. Add Users

1. Go to Settings > General and set **User Registration** to **Disabled**
2. Go to Settings > Users to create accounts for other users
3. Assign roles and archive root access permissions

## Deployment Modes

| Feature | Local (`HARBOR_DEPLOYMENT_MODE=local`) | Cloud (`HARBOR_DEPLOYMENT_MODE=cloud`) |
|---------|---------------------------------------|---------------------------------------|
| Local filesystem archives | Yes | No |
| Dropbox archives | Yes | Yes |
| File watcher (local) | Yes | No |
| Dropbox change polling | Yes (60s loop) | Yes (15min cron) |
| Preview generation (ffmpeg) | Yes | No (uses Dropbox thumbnails) |
| Metadata JSON storage | Local disk | Dropbox API |
| Face detection (AI) | Yes | Yes |
| Multi-user | Yes | Yes |

## File & Folder Naming Conventions

Harbor uses a consistent naming convention for organizing archive content. While not enforced, following these patterns improves search, filtering, and automatic date detection:

### Files

```
YYYY-MM-DD_description_NNN.ext
```

Examples:
- `2024-03-15_beach_sunset_001.jpg`
- `2023-12-25_holiday_dinner.mp4`
- `2022-07-04_fireworks_003.heic`

The date prefix (`YYYY-MM-DD`) enables automatic date detection during indexing. The description uses underscores. The optional `_NNN` suffix handles multiple files from the same event.

### Folders

```
YYYY-MM-DD_Event_Name/
YYYY/
YYYY-MM/
```

Examples:
- `2024-03-15_Beach_Trip/`
- `2024/`
- `2024-03/`

Year and year-month folders work as natural date-based groupings. Event folders combine a date with a descriptive name.

### Archive Roots

Name your archive roots descriptively:
- `Family Photos` — a shared family photo archive
- `Work Projects` — professional project files
- `Video Archive` — video collection

Private roots (hidden from non-admin users) can be configured in Settings > Archive Roots.

## Architecture

```
harbor/
├── apps/
│   ├── web/          # Next.js App Router (UI + API)
│   └── desktop/      # Electron shell
├── packages/
│   ├── database/     # Prisma schema + repositories
│   ├── types/        # Shared type contracts
│   ├── config/       # Environment parsing
│   ├── providers/    # Storage provider abstraction (Local FS, Dropbox)
│   ├── auth/         # Authentication & permissions
│   ├── jobs/         # Background indexing, preview generation, Dropbox sync
│   ├── ai/           # AI provider abstraction (OpenAI, Anthropic, face detection)
│   ├── realtime/     # Event bus + SSE
│   ├── ui/           # Shared UI components
│   └── utils/        # Low-level utilities
└── mcp/
    └── servers/      # Optional MCP dev tools
```

## Privacy & Security

- **Crawlers blocked by default** — `robots.txt` disallows all user agents. Admins can enable indexing in Settings > General.
- **No telemetry** — Harbor sends no data to external services unless you explicitly configure AI providers or Dropbox.
- **Private archive roots** — Roots can be marked private and are completely hidden from unauthorized users.
- **Audit logging** — All destructive and privileged actions are logged with user, timestamp, and details.
- **Delete queue** — File deletions go through an admin approval queue before bytes are permanently removed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Read [CLAUDE.md](CLAUDE.md) and the rules in `.claude/rules/` before making changes.

## License

See [LICENSE.md](LICENSE.md) for guidance. Choose a license before public release.
