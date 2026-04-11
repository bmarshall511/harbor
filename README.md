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

## Quick Start

### Prerequisites

- Node.js >= 22
- pnpm >= 9
- A [Supabase](https://supabase.com) project (free tier works)

### 1. Set Up Supabase

Harbor uses Supabase (hosted PostgreSQL) as its database. Both local development and cloud (Vercel) deployments share the same database — this means metadata, archives, and settings stay in sync everywhere.

See the [Supabase setup instructions](#set-up-supabase) below for how to create a project, find your connection strings, and enable extensions.

### 2. Install and configure

```bash
# Clone and install
git clone <repo-url> harbor && cd harbor
cp .env.example .env
pnpm install
```

Edit `.env` and fill in your Supabase connection strings:

```env
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"
DIRECT_URL="postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres"
HARBOR_SESSION_SECRET="generate-a-random-64-char-string"
HARBOR_DEPLOYMENT_MODE="local"
```

Also copy the same `DATABASE_URL` and `DIRECT_URL` to `packages/database/.env` (Prisma CLI reads from there).

### 3. Start development

```bash
pnpm dev
```

On first launch, Harbor detects an empty database and shows a **setup wizard**. Click **"Initialize Database"** to automatically create all tables, seed default roles and settings, and set up search indexes.

The dev server automatically finds a free port — the URL is printed in the console.

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
3. Enter a name and the absolute path to a directory (local) or connect your Dropbox account
4. The directory will be indexed and files will appear in the browser

## Deploy to Vercel (Cloud Mode)

Harbor can also run on Vercel with Dropbox as the storage provider. Local filesystem archives are disabled in cloud mode. Both local and Vercel share the same Supabase database, so metadata edits on either side are instantly visible everywhere.

### 1. Set Up Supabase

#### Create the project

1. Go to [supabase.com](https://supabase.com) and sign in (or create an account)
2. Click **New project**
3. Choose your organization (or create one)
4. Enter a project name (e.g. `harbor`)
5. Set a **database password** — save this, you'll need it for the connection string
6. Select a region closest to you and your users (e.g. **US Central (Iowa)** for Texas)
7. Click **Create new project** and wait ~2 minutes for provisioning

#### Find the connection strings

You need **two** connection strings — one for runtime (pooled) and one for migrations (direct):

1. In your Supabase project, go to **Project Settings** (gear icon in the sidebar) > **Database**
2. Scroll down to the **Connection string** section
3. Click the **URI** tab

**Copy the pooled connection string:**
- Select **Mode: Session** from the dropdown
- The connection string looks like:
  ```
  postgresql://postgres.[your-ref]:[your-password]@aws-0-[region].pooler.supabase.com:6543/postgres
  ```
- Note the port is **6543** (not 5432) — this goes through Supabase's built-in PgBouncer connection pooler, which is required for serverless (Vercel creates many short-lived connections)
- Replace `[your-password]` with the database password you set when creating the project
- This is your `DATABASE_URL` for Vercel

#### Enable required extensions

1. In your Supabase project, go to **SQL Editor** (left sidebar)
2. Click **New query** and run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```
3. Click **Run** — you should see "Success. No rows returned" for each

### 2. Prepare the Database

If you already ran the setup wizard during local development (same Supabase project), the database is already initialized — skip to step 3.

If this is a fresh Supabase project, the database will be initialized automatically on first visit via the setup wizard.

> **Note:** The three PostgreSQL extensions (`vector`, `pgcrypto`, `pg_trgm`) must be enabled manually in the Supabase SQL Editor BEFORE running the setup wizard, because they require superuser privileges. See step 1 above.

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
| `DATABASE_URL` | Same Supabase **pooled** connection string as your local `.env` (port **6543**) | Yes |
| `DIRECT_URL` | Same Supabase **direct** connection string as your local `.env` (port **5432**) | Yes |
| `HARBOR_SESSION_SECRET` | Same value as your local `.env` (so sessions work across both) | Yes |
| `CRON_SECRET` | Random string for cron auth | Yes |

> **Important:** Use the SAME `DATABASE_URL`, `DIRECT_URL`, and `HARBOR_SESSION_SECRET` on both local and Vercel. This ensures both instances share the same database and sessions.

> **Note:** Dropbox and AI API keys are configured through the Settings UI after your first login — they are stored in an encrypted database table, NOT as environment variables.

### 5. Configure Dropbox

1. Go to the [Dropbox App Console](https://www.dropbox.com/developers/apps)
2. Create a new app (or use an existing one):
   - Choose **Scoped access**
   - Choose **Full Dropbox** access type
3. Under the **Permissions** tab, enable these scopes:

   | Scope | Why |
   |-------|-----|
   | `account_info.read` | Read user profile during OAuth (display name, account type, namespace) |
   | `files.metadata.read` | Browse folders, list files, search, detect changes via cursor |
   | `files.content.read` | Download files, stream media, generate thumbnails |
   | `files.content.write` | Write `.harbor/` metadata JSON files to Dropbox, create folders, move/rename/delete files |

   > **Important:** Click **Submit** at the bottom of the Permissions page to save. Scope changes require the user to re-authorize — if you add scopes later, disconnect and reconnect Dropbox in Harbor's Settings.

4. Under the **Settings** tab, add your domain to the **OAuth 2 Redirect URIs**:
   ```
   https://your-app.vercel.app/api/auth/dropbox/callback
   ```
   For local development, also add:
   ```
   http://localhost:3000/api/auth/dropbox/callback
   ```
5. Copy the **App key** and **App secret** from the Settings tab — you'll enter these in Harbor's Settings UI after first login

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

Both modes share the same Supabase database. Metadata edits on either side are instantly visible everywhere.

| Feature | Local (`HARBOR_DEPLOYMENT_MODE=local`) | Cloud (`HARBOR_DEPLOYMENT_MODE=cloud`) |
|---------|---------------------------------------|---------------------------------------|
| Database | Supabase (shared) | Supabase (shared) |
| Local filesystem archives | Yes | No |
| Dropbox archives | Yes | Yes |
| File watcher (local FS) | Yes | No |
| Dropbox change polling | Yes (60s loop) | Yes (daily cron) |
| Preview generation (ffmpeg) | Yes | No (uses Dropbox thumbnails) |
| Metadata sync | JSON in archive + Dropbox API | Dropbox API + DB |
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
