'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { archiveRoots, adminDeleteQueue, getPreviewUrl } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { formatBytes } from '@harbor/utils';
import { fetchApi } from '@/lib/fetch-api';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/cn';
import {
  Settings,
  HardDrive,
  Cloud,
  Plus,
  Sun,
  Moon,
  Monitor,
  Database,
  Cpu,
  Shield,
  Check,
  ExternalLink,
  Loader2,
  Trash2,
  AlertTriangle,
  Pencil,
  Folder,
  Users,
  UserPlus,
  FileText,
  FileImage,
  FileVideo,
  File as FileIcon,
  Image as ImageIcon,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Search,
  LogIn,
  Link2,
  PawPrint,
  Network,
  ArrowRight,
  ArrowLeftRight,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/use-auth';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useIsElectron, useMounted } from '@/lib/use-mounted';
import { SecretField } from '@/components/secret-field';
import { AvatarPicker } from '@/components/avatar-picker';
import { DropboxFolderPicker } from '@/components/dropbox-folder-picker';
import { LocalFolderPicker } from '@/components/local-folder-picker';

/**
 * Settings is organised into discrete subpages selected via the
 * `?s=<section>` query param. A single canonical SETTINGS_NAV array
 * drives both the left rail and the section dispatch, so adding a
 * new section is a one-liner: register it here and render it inside
 * `SettingsContent`. The previous version rendered every section
 * stacked vertically in one giant scroll, which had become
 * unwieldy as the surface grew.
 */
type SettingsSectionId =
  | 'appearance'
  | 'general'
  | 'users'
  | 'people'
  | 'search-analytics'
  | 'metadata'
  | 'archive-roots'
  | 'dropbox'
  | 'ai'
  | 'delete-queue'
  | 'database'
  | 'about';

interface SettingsNavEntry {
  id: SettingsSectionId;
  label: string;
  icon: typeof Settings;
  group: 'workspace' | 'data' | 'system';
}

const SETTINGS_NAV: SettingsNavEntry[] = [
  { id: 'appearance', label: 'Appearance', icon: Sun, group: 'workspace' },
  { id: 'general', label: 'General', icon: Settings, group: 'workspace' },
  { id: 'users', label: 'Users & Roles', icon: Users, group: 'workspace' },
  { id: 'people', label: 'People', icon: Users, group: 'workspace' },
  { id: 'search-analytics', label: 'Search Analytics', icon: Search, group: 'workspace' },
  { id: 'metadata', label: 'Metadata Fields', icon: FileText, group: 'data' },
  { id: 'archive-roots', label: 'Archive Roots', icon: HardDrive, group: 'data' },
  { id: 'dropbox', label: 'Dropbox', icon: Cloud, group: 'data' },
  { id: 'ai', label: 'AI Features', icon: Cpu, group: 'data' },
  { id: 'delete-queue', label: 'Delete Queue', icon: Trash2, group: 'system' },
  { id: 'database', label: 'Database', icon: Database, group: 'system' },
  { id: 'about', label: 'About', icon: Shield, group: 'system' },
];

const GROUP_LABELS: Record<SettingsNavEntry['group'], string> = {
  workspace: 'Workspace',
  data: 'Data & Content',
  system: 'System',
};

export default function SettingsPage() {
  // Read the active section from `?s=`. Defaults to 'appearance' so
  // the page always has something to show on a fresh load. We use
  // `useState(() => ...)` so the initial render already reflects the
  // URL — no flash of the wrong section while React mounts.
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() => {
    if (typeof window === 'undefined') return 'appearance';
    const param = new URLSearchParams(window.location.search).get('s');
    if (param && SETTINGS_NAV.some((n) => n.id === param)) return param as SettingsSectionId;
    return 'appearance';
  });

  // Push the section into the URL so back/forward and bookmarks work,
  // and so a deep link to a specific settings page is possible.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('s', activeSection);
    const newUrl = `/settings?${params.toString()}`;
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.replaceState(null, '', newUrl);
    }
  }, [activeSection]);

  // Browser back/forward — keep the active section in sync.
  useEffect(() => {
    function onPop() {
      const param = new URLSearchParams(window.location.search).get('s');
      if (param && SETTINGS_NAV.some((n) => n.id === param)) {
        setActiveSection(param as SettingsSectionId);
      }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const groups: Record<SettingsNavEntry['group'], SettingsNavEntry[]> = {
    workspace: [],
    data: [],
    system: [],
  };
  for (const entry of SETTINGS_NAV) groups[entry.group].push(entry);

  return (
    <div className="flex h-full">
      {/* Left rail — grouped, sticky, full-height. */}
      <aside
        className="hidden w-60 shrink-0 border-r border-border bg-muted/20 md:block"
        aria-label="Settings sections"
      >
        <div className="sticky top-0 max-h-screen overflow-y-auto p-4">
          <div className="mb-6 flex items-center gap-2">
            <Settings className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-base font-semibold tracking-tight">Settings</h1>
          </div>

          <nav className="space-y-5">
            {(Object.keys(groups) as SettingsNavEntry['group'][]).map((group) => (
              <div key={group}>
                <p className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {GROUP_LABELS[group]}
                </p>
                <ul className="space-y-0.5">
                  {groups[group].map((entry) => {
                    const Icon = entry.icon;
                    const isActive = activeSection === entry.id;
                    return (
                      <li key={entry.id}>
                        <button
                          onClick={() => setActiveSection(entry.id)}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                            isActive
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="truncate">{entry.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      {/* Mobile section picker — replaces the rail on small screens. */}
      <div className="md:hidden">
        <div className="border-b border-border bg-card px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <Settings className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-base font-semibold tracking-tight">Settings</h1>
          </div>
          <select
            value={activeSection}
            onChange={(e) => setActiveSection(e.target.value as SettingsSectionId)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Select settings section"
          >
            {SETTINGS_NAV.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Content pane — only the active section is rendered, so the
          page is always one focused surface instead of a 1700-line
          scroll. */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-6">
          <SettingsContent section={activeSection} />
        </div>
      </main>
    </div>
  );
}

function SettingsContent({ section }: { section: SettingsSectionId }) {
  switch (section) {
    case 'appearance': return <AppearanceSection />;
    case 'general': return <GeneralSettingsSection />;
    case 'users': return <UserManagementSection />;
    case 'people': return <><PeopleManagementSection /><PersonRelationshipsSection /><PersonGroupsSection /></>;
    case 'search-analytics': return <SearchAnalyticsSection />;
    case 'metadata': return <MetadataFieldsSection />;
    case 'archive-roots': return <ArchiveRootsSection />;
    case 'dropbox': return <DropboxSection />;
    case 'ai': return <AiSettingsSection />;
    case 'delete-queue': return <DeleteQueueSection />;
    case 'database': return <DatabaseSection />;
    case 'about': return <AboutSection />;
  }
}

function SectionHeader({ icon: Icon, title, description }: { icon: typeof Settings; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-lg bg-muted p-2">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <section>
      <SectionHeader icon={Sun} title="Appearance" description="Customize how Harbor looks" />
      <div className="mt-4 flex gap-2">
        {(['light', 'dark', 'system'] as const).map((t) => {
          const icons = { light: Sun, dark: Moon, system: Monitor };
          const Icon = icons[t];
          return (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm capitalize transition-colors',
                theme === t ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:border-primary/30',
              )}
            >
              <Icon className="h-4 w-4" />
              {t}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function GeneralSettingsSection() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => { const r = await fetch('/api/settings'); return r.json() as Promise<Record<string, string>>; },
  });

  const saveMutation = useMutation({
    mutationFn: async (patch: Record<string, string>) => {
      const r = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error('Failed to save');
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Settings saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !settings) return null;

  return (
    <section>
      <SectionHeader icon={Settings} title="General" description="Core Harbor configuration — stored in the database" />
      <div className="mt-4 space-y-4">
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Authentication Mode</p>
              <p className="text-xs text-muted-foreground">
                Local: single user, no login. Multi: shared/self-hosted with login.
              </p>
            </div>
            <select
              value={settings['auth.mode'] ?? 'local'}
              onChange={(e) => saveMutation.mutate({ 'auth.mode': e.target.value })}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="local">Local (single user)</option>
              <option value="multi">Multi-user</option>
            </select>
          </div>
        </div>

        {settings['auth.mode'] === 'multi' && (
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">User Registration</p>
                <p className="text-xs text-muted-foreground">
                  Allow new users to create accounts via the login page
                </p>
              </div>
              <select
                value={settings['registration.enabled'] ?? 'true'}
                onChange={(e) => saveMutation.mutate({ 'registration.enabled': e.target.value })}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Search Engine Indexing</p>
              <p className="text-xs text-muted-foreground">
                Allow search engines and AI crawlers to index this site. Disabled by default for privacy.
              </p>
            </div>
            <button
              onClick={() => {
                const current = settings['seo.allowCrawlers'] === 'true';
                saveMutation.mutate({ 'seo.allowCrawlers': current ? 'false' : 'true' });
              }}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                settings['seo.allowCrawlers'] === 'true' ? 'bg-primary' : 'bg-muted',
              )}
              role="switch"
              aria-checked={settings['seo.allowCrawlers'] === 'true'}
            >
              <span className={cn('inline-block h-4 w-4 rounded-full bg-white transition-transform', settings['seo.allowCrawlers'] === 'true' ? 'translate-x-6' : 'translate-x-1')} />
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Preview Cache Directory</p>
              <p className="text-xs text-muted-foreground">Where generated thumbnails and previews are stored</p>
            </div>
            <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">
              {settings['preview.cacheDir'] ?? './data/preview-cache'}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Log Level</p>
              <p className="text-xs text-muted-foreground">Controls server-side log verbosity</p>
            </div>
            <select
              value={settings['log.level'] ?? 'info'}
              onChange={(e) => saveMutation.mutate({ 'log.level': e.target.value })}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
            </select>
          </div>
        </div>

        <IgnorePatternsEditor
          value={settings['indexing.ignorePatterns'] ?? '.gitkeep,.DS_Store,Thumbs.db,.harbor,desktop.ini'}
          onSave={(val) => saveMutation.mutate({ 'indexing.ignorePatterns': val })}
        />
      </div>
    </section>
  );
}

function UserManagementSection() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRoleId, setNewRoleId] = useState('');

  const isAdmin = hasPermission('admin', 'manage');

  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const r = await fetch('/api/users');
      if (!r.ok) return [];
      return r.json();
    },
    enabled: isAdmin,
  });

  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const r = await fetch('/api/roles');
      if (!r.ok) return [];
      return r.json();
    },
    enabled: isAdmin,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername,
          displayName: newDisplayName || newUsername,
          password: newPassword,
          roleId: newRoleId || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setShowCreate(false);
      setNewUsername('');
      setNewDisplayName('');
      setNewPassword('');
      setNewRoleId('');
      toast.success('User created');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, roleId }: { userId: string; roleId: string }) => {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleId }),
      });
      if (!res.ok) throw new Error('Failed to update role');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Role updated');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error('Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User updated');
    },
  });

  if (!isAdmin) return null;

  return (
    <section>
      <SectionHeader icon={Users} title="Users & Roles" description="Manage user accounts and permissions" />
      <div className="mt-4 space-y-3">
        {usersLoading ? (
          <div className="h-20 animate-pulse rounded-lg bg-muted" />
        ) : (
          <div className="rounded-lg border border-border">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
              <span>User</span>
              <span className="w-32">Role</span>
              <span className="w-16 text-center">Status</span>
              <span className="w-8" />
            </div>
            {(users ?? []).map((user: any) => (
              <div key={user.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-border/50 px-4 py-2.5 last:border-0">
                <div>
                  <p className="text-sm font-medium">{user.displayName}</p>
                  <p className="text-xs text-muted-foreground">@{user.username}{user.email ? ` · ${user.email}` : ''}</p>
                </div>
                <select
                  value={user.roles[0]?.id ?? ''}
                  onChange={(e) => updateRoleMutation.mutate({ userId: user.id, roleId: e.target.value })}
                  disabled={user.isLocalUser}
                  className="w-32 rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-50"
                >
                  {(roles ?? []).map((role: any) => (
                    <option key={role.id} value={role.id}>{role.name} ({role.systemRole})</option>
                  ))}
                </select>
                <div className="flex w-16 justify-center">
                  {user.isActive ? (
                    <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">Active</span>
                  ) : (
                    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">Inactive</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {!user.isLocalUser && (
                    <button
                      onClick={() => toggleActiveMutation.mutate({ userId: user.id, isActive: !user.isActive })}
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent"
                      title={user.isActive ? 'Deactivate' : 'Activate'}
                    >
                      {user.isActive ? <Shield className="h-3 w-3" /> : <Shield className="h-3 w-3 text-destructive" />}
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      if (!confirm(`Login as "${user.displayName}"? You can switch back from the banner at the top.`)) return;
                      try {
                        const res = await fetch('/api/admin/impersonate', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ userId: user.id }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.message);
                        // Navigate to the activate URL — sets cookies via
                        // a redirect response (reliable across all browsers)
                        window.location.href = data.redirectUrl;
                      } catch (err: unknown) {
                        toast.error(err instanceof Error ? err.message : 'Failed to impersonate');
                      }
                    }}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title={`Login as ${user.displayName}`}
                  >
                    <LogIn className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showCreate ? (
          <div className="rounded-lg border border-border p-4 space-y-3">
            <h3 className="text-sm font-medium">Create User</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Username</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Display Name</label>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder={newUsername || 'Display name'}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Role</label>
                <select
                  value={newRoleId}
                  onChange={(e) => setNewRoleId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select role...</option>
                  {(roles ?? []).map((role: any) => (
                    <option key={role.id} value={role.id}>{role.name} ({role.systemRole})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => createMutation.mutate()}
                disabled={!newUsername.trim() || !newPassword.trim() || createMutation.isPending}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {createMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
                Create User
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowCreate(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-sm text-muted-foreground hover:border-primary/30 hover:text-foreground"
          >
            <UserPlus className="h-4 w-4" />
            Add User
          </button>
        )}
      </div>
    </section>
  );
}

function MetadataFieldsSection() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = hasPermission('admin', 'manage');

  const { data: fields, isLoading } = useQuery({
    queryKey: ['metadata-fields'],
    queryFn: async () => { const r = await fetch('/api/metadata-fields'); return r.json(); },
    enabled: isAdmin,
  });

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newType, setNewType] = useState('text');

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/metadata-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, key: newKey || newName.toLowerCase().replace(/\s+/g, '_'), fieldType: newType }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metadata-fields'] });
      setShowAdd(false); setNewName(''); setNewKey(''); setNewType('text');
      toast.success('Field created');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/metadata-fields/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metadata-fields'] });
      toast.success('Field removed');
    },
  });

  const moveMutation = useMutation({
    mutationFn: async ({ id, sortOrder }: { id: string; sortOrder: number }) => {
      await fetch(`/api/metadata-fields/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['metadata-fields'] }),
  });

  const toggleFieldProp = useMutation({
    mutationFn: async ({ id, prop, value }: { id: string; prop: string; value: boolean }) => {
      await fetch(`/api/metadata-fields/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [prop]: value }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['metadata-fields'] }),
  });

  if (!isAdmin) return null;

  return (
    <section>
      <SectionHeader icon={FileText} title="Metadata Fields" description="Configure default metadata fields shown in the item pullout" />
      <div className="mt-4 space-y-2">
        {isLoading ? (
          <div className="h-20 animate-pulse rounded-lg bg-muted" />
        ) : (
          <div className="rounded-lg border border-border">
            {(fields ?? []).map((field: any, idx: number) => (
              <div key={field.id} className="flex items-center gap-2 border-b border-border/50 px-4 py-2.5 last:border-0">
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => idx > 0 && moveMutation.mutate({ id: field.id, sortOrder: field.sortOrder - 1 })}
                    disabled={idx === 0}
                    className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20"
                  ><ArrowUp className="h-3 w-3" /></button>
                  <button
                    onClick={() => idx < (fields?.length ?? 0) - 1 && moveMutation.mutate({ id: field.id, sortOrder: field.sortOrder + 1 })}
                    disabled={idx >= (fields?.length ?? 0) - 1}
                    className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20"
                  ><ArrowDown className="h-3 w-3" /></button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{field.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    key: <code className="rounded bg-muted px-1">{field.key}</code> · type: {field.fieldType}
                    {field.appliesTo?.length > 0 && field.appliesTo[0] !== 'all' && ` · ${field.appliesTo.join(', ')}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer" title="Show as a filter on the search page">
                    <input
                      type="checkbox"
                      checked={field.showInSearch ?? false}
                      onChange={(e) => toggleFieldProp.mutate({ id: field.id, prop: 'showInSearch', value: e.target.checked })}
                      className="h-3 w-3 rounded border-input"
                    />
                    Search
                  </label>
                  {field.showInSearch && (
                    <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer" title="Hide behind 'More filters' on search page">
                      <input
                        type="checkbox"
                        checked={field.hiddenByDefault ?? false}
                        onChange={(e) => toggleFieldProp.mutate({ id: field.id, prop: 'hiddenByDefault', value: e.target.checked })}
                        className="h-3 w-3 rounded border-input"
                      />
                      Hidden
                    </label>
                  )}
                </div>
                <button
                  onClick={() => deleteMutation.mutate(field.id)}
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {showAdd ? (
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Name</label>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Field name"
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" autoFocus />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Key</label>
                <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder={newName.toLowerCase().replace(/\s+/g, '_') || 'auto'}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Type</label>
                <select value={newType} onChange={(e) => setNewType(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="text">Text</option>
                  <option value="textarea">Text Area</option>
                  <option value="select">Select</option>
                  <option value="multiselect">Multi-Select</option>
                  <option value="boolean">Boolean</option>
                  <option value="number">Number</option>
                  <option value="people">People</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => createMutation.mutate()} disabled={!newName.trim() || createMutation.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {createMutation.isPending ? 'Creating...' : 'Add Field'}
              </button>
              <button onClick={() => setShowAdd(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAdd(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-primary/30 hover:text-foreground">
            <Plus className="h-4 w-4" /> Add Metadata Field
          </button>
        )}
      </div>
    </section>
  );
}

function ArchiveRootsSection() {
  const queryClient = useQueryClient();
  const isElectron = useIsElectron();
  const { data: roots, isLoading } = useQuery({ queryKey: ['archive-roots'], queryFn: archiveRoots.list });
  const { data: dropboxStatus } = useQuery({
    queryKey: ['dropbox-status'],
    queryFn: async () => { const r = await fetch('/api/auth/dropbox/status'); return r.json(); },
  });
  const { data: deploymentInfo } = useQuery({
    queryKey: ['deployment-mode'],
    queryFn: async () => { const r = await fetch('/api/deployment'); return r.json() as Promise<{ mode: string }>; },
    staleTime: Infinity,
  });
  const deploymentMode = deploymentInfo?.mode;
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [newProvider, setNewProvider] = useState<'LOCAL_FILESYSTEM' | 'DROPBOX'>(deploymentMode === 'cloud' ? 'DROPBOX' : 'LOCAL_FILESYSTEM');
  const [showDropboxPicker, setShowDropboxPicker] = useState(false);
  const [showLocalPicker, setShowLocalPicker] = useState(false);

  const dropboxConnected = dropboxStatus?.connected === true;

  const [pathError, setPathError] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: async () => {
      // Validate local paths before creating
      if (newProvider === 'LOCAL_FILESYSTEM') {
        const validation = await fetchApi<{ valid: boolean; error?: string }>('/validate-path', {
          method: 'POST',
          body: JSON.stringify({ path: newPath }),
          retries: 2,
        });
        if (!validation.valid) {
          throw new Error(validation.error || 'Invalid path');
        }
      }

      const capabilities = ['READ', 'WRITE', 'DELETE', 'MOVE', 'RENAME', 'CREATE_FOLDERS', 'SEARCH'];
      return fetchApi('/archive-roots', {
        method: 'POST',
        body: JSON.stringify({ name: newName, providerType: newProvider, rootPath: newPath, capabilities }),
        retries: 1,
      });
    },
    onSuccess: async (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['archive-roots'] });
      setShowAdd(false);
      setNewName('');
      setNewPath('');
      setNewProvider('LOCAL_FILESYSTEM');

      // Trigger indexing for the new root
      if (result?.id) {
        try {
          await fetchApi('/indexing', {
            method: 'POST',
            body: JSON.stringify({ archiveRootId: result.id }),
            retries: 2,
          });
          toast.success('Archive root added — indexing started');
        } catch {
          toast.success('Archive root added (indexing will start when ready)');
        }
      } else {
        toast.success('Archive root added');
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <section>
      <SectionHeader icon={HardDrive} title="Archive Roots" description="Manage the directories and cloud sources Harbor monitors" />
      <div className="mt-4 space-y-2">
        {isLoading ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
        ) : roots?.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No archive roots configured yet. Add one below to get started.
          </div>
        ) : (
          roots?.map((root) => (
            <ArchiveRootCard key={root.id} root={root} />
          ))
        )}

        {showAdd ? (
          <div className="rounded-lg border border-border p-4 space-y-3">
            {/* Provider selection — Local Folder hidden in cloud mode */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">Provider</label>
              <div className="flex gap-2">
                {deploymentMode !== 'cloud' && (
                <button
                  onClick={() => { setNewProvider('LOCAL_FILESYSTEM'); setNewPath(''); }}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                    newProvider === 'LOCAL_FILESYSTEM' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30',
                  )}
                >
                  <HardDrive className="h-4 w-4" />
                  Local Folder
                </button>
                )}
                <button
                  onClick={() => { setNewProvider('DROPBOX'); setNewPath(''); setShowDropboxPicker(true); }}
                  disabled={!dropboxConnected}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                    newProvider === 'DROPBOX' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30',
                    !dropboxConnected && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  <Cloud className="h-4 w-4" />
                  Dropbox
                  {!dropboxConnected && <span className="text-[10px] text-muted-foreground">(not connected)</span>}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Archive Name</label>
              <input
                type="text"
                placeholder={newProvider === 'DROPBOX' ? 'e.g. My Dropbox Photos' : 'e.g. Photos, Documents'}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                {newProvider === 'DROPBOX' ? 'Dropbox Folder' : 'Local Folder'}
              </label>

              {newProvider === 'LOCAL_FILESYSTEM' ? (
                <div className="space-y-2">
                  {isElectron ? (
                    /* Electron: native directory picker as primary action */
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          const dir = await (window as any).harbor.selectDirectory();
                          if (dir) {
                            setNewPath(dir);
                            setPathError(null);
                            if (!newName) setNewName(dir.split('/').filter(Boolean).pop() || '');
                          }
                        }}
                        className={cn(
                          'flex w-full items-center justify-center gap-3 rounded-lg border-2 py-6 text-sm font-medium transition-colors',
                          newPath
                            ? 'border-primary/30 bg-primary/5 text-foreground'
                            : 'border-dashed border-border text-muted-foreground hover:border-primary/40 hover:bg-accent/50',
                        )}
                      >
                        <Folder className="h-6 w-6" />
                        <span>{newPath || 'Choose Folder...'}</span>
                      </button>
                      {newPath && (
                        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                          <Folder className="h-4 w-4 text-primary" />
                          <span className="truncate text-sm font-medium">{newPath}</span>
                          <button onClick={() => setNewPath('')} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Change</button>
                        </div>
                      )}
                    </>
                  ) : (
                    /* Web: server-side folder browser */
                    <>
                      {showLocalPicker ? (
                        <LocalFolderPicker
                          onSelect={(selectedPath, name) => {
                            setNewPath(selectedPath);
                            setPathError(null);
                            if (!newName) setNewName(name);
                            setShowLocalPicker(false);
                          }}
                          onCancel={() => setShowLocalPicker(false)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowLocalPicker(true)}
                          className={cn(
                            'flex w-full items-center justify-center gap-3 rounded-lg border-2 py-6 text-sm font-medium transition-colors',
                            newPath
                              ? 'border-primary/30 bg-primary/5 text-foreground'
                              : 'border-dashed border-border text-muted-foreground hover:border-primary/40 hover:bg-accent/50',
                          )}
                        >
                          <Folder className="h-6 w-6" />
                          <span>{newPath || 'Browse Folders...'}</span>
                        </button>
                      )}
                      {newPath && !showLocalPicker && (
                        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                          <Folder className="h-4 w-4 text-primary" />
                          <span className="truncate text-sm font-medium">{newPath}</span>
                          <button onClick={() => { setNewPath(''); setShowLocalPicker(true); }} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Change</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                /* Dropbox: folder picker — always shown when Dropbox is selected */
                <div className="space-y-2">
                  <DropboxFolderPicker
                    onSelect={(path, name) => {
                      setNewPath(path);
                      setPathError(null);
                      if (!newName) setNewName(name);
                    }}
                    onCancel={() => { setNewProvider('LOCAL_FILESYSTEM'); setNewPath(''); }}
                  />
                  {newPath && (
                    <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                      <Cloud className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Selected: {newPath}</span>
                    </div>
                  )}
                </div>
              )}

              {pathError && (
                <p className="mt-1 text-xs text-destructive">{pathError}</p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => addMutation.mutate()}
                disabled={!newName || !newPath || addMutation.isPending}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {addMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Add Archive Root
              </button>
              <button
                onClick={() => { setShowAdd(false); setNewProvider('LOCAL_FILESYSTEM'); }}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setShowAdd(true); setShowLocalPicker(!isElectron); }}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-sm text-muted-foreground hover:border-primary/30 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
            Add Archive Root
          </button>
        )}
      </div>
    </section>
  );
}

function ArchiveRootCard({ root }: { root: { id: string; name: string; providerType: string; rootPath: string; isPrivate: boolean } }) {
  const queryClient = useQueryClient();
  const [showRemove, setShowRemove] = useState(false);
  const [cleanMetadata, setCleanMetadata] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(root.name);
  const [showAccess, setShowAccess] = useState(false);

  const renameMutation = useMutation({
    mutationFn: () => archiveRoots.rename(root.id, editName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['archive-roots'] });
      setEditing(false);
      toast.success('Archive root renamed');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Show latest indexing job status for this root
  const { data: jobsList } = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => { const r = await fetch('/api/jobs'); return r.json(); },
    refetchInterval: 10000,
  });
  const latestJob = (jobsList as any[])?.find?.((j: any) =>
    j.type === 'index' && j.metadata?.archiveRootId === root.id
  );

  const removeMutation = useMutation({
    mutationFn: () => fetchApi(`/archive-roots/${root.id}${cleanMetadata ? '?cleanMetadata=true' : ''}`, { method: 'DELETE' }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['archive-roots'] });
      toast.success(`Removed "${root.name}" — ${result.removed.files} files and ${result.removed.folders} folders cleaned up from Harbor. Source files were not modified.`);
      setShowRemove(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reindexMutation = useMutation({
    mutationFn: async () => fetchApi('/indexing', {
      method: 'POST',
      body: JSON.stringify({ archiveRootId: root.id }),
      retries: 2,
    }),
    onSuccess: () => toast.success(`Re-indexing "${root.name}" started`),
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
        <div className="flex items-center gap-3">
          {root.providerType === 'DROPBOX' ? <Cloud className="h-4 w-4 text-blue-500" /> : <HardDrive className="h-4 w-4 text-muted-foreground" />}
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && editName.trim()) renameMutation.mutate();
                    if (e.key === 'Escape') { setEditing(false); setEditName(root.name); }
                  }}
                  className="w-full rounded border border-input bg-background px-2 py-0.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                />
                <button
                  onClick={() => renameMutation.mutate()}
                  disabled={!editName.trim() || editName === root.name || renameMutation.isPending}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                >
                  {renameMutation.isPending ? '...' : 'Save'}
                </button>
                <button
                  onClick={() => { setEditing(false); setEditName(root.name); }}
                  className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setEditing(true); setEditName(root.name); }}
                className="group flex items-center gap-1 text-left"
                title="Click to rename"
              >
                <p className="text-sm font-medium group-hover:text-primary">{root.name}</p>
                <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </button>
            )}
            <p className="text-xs text-muted-foreground">{root.rootPath || '/'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {root.isPrivate && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">Restricted</span>}
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {root.providerType === 'DROPBOX' ? 'Dropbox' : 'Local'}
          </span>
          <button
            onClick={() => setShowAccess(!showAccess)}
            className="rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Access
          </button>
          <button
            onClick={() => reindexMutation.mutate()}
            disabled={reindexMutation.isPending}
            className="rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label={`Re-index ${root.name}`}
          >
            {reindexMutation.isPending ? 'Indexing...' : 'Re-index'}
          </button>
          <button
            onClick={() => setShowRemove(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Remove ${root.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Job status */}
      {latestJob?.status === 'FAILED' && latestJob.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Indexing failed: {latestJob.error}
        </div>
      )}
      {latestJob?.status === 'RUNNING' && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          Indexing in progress...
        </div>
      )}

      {/* User access panel */}
      {showAccess && <ArchiveAccessPanel archiveRootId={root.id} onClose={() => setShowAccess(false)} />}

      {showRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setShowRemove(false); }} role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-border bg-popover p-5 shadow-2xl">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="text-base font-semibold">Remove Archive Root</h3>
            </div>

            <div className="mt-3 space-y-2 text-sm">
              <p>
                Are you sure you want to remove <strong>{root.name}</strong> from Harbor?
              </p>

              <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1.5">
                <p className="font-medium">What will be removed from Harbor:</p>
                <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                  <li>All indexed file and folder records</li>
                  <li>Metadata, tags, and relations for those files</li>
                  <li>Cached preview thumbnails</li>
                  <li>Edit history and audit records for those files</li>
                </ul>
              </div>

              <div className="rounded-md border border-green-500/20 bg-green-500/5 p-3 text-xs space-y-1">
                <p className="font-medium text-green-700 dark:text-green-400">What will NOT be affected:</p>
                <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                  <li>Your actual files and folders on disk{root.providerType === 'DROPBOX' ? ' or Dropbox' : ''}</li>
                  <li>No source data will be deleted or modified</li>
                </ul>
              </div>

              {root.providerType === 'LOCAL_FILESYSTEM' && (
                <label className="flex items-start gap-2 rounded-md border border-border p-3 text-xs cursor-pointer hover:bg-accent/50">
                  <input
                    type="checkbox"
                    checked={cleanMetadata}
                    onChange={(e) => setCleanMetadata(e.target.checked)}
                    className="mt-0.5 rounded border-input"
                  />
                  <div>
                    <p className="font-medium">Also remove .harbor metadata files</p>
                    <p className="text-muted-foreground">Delete the .harbor/ JSON metadata directories from inside the archive. Leave unchecked to keep your metadata portable.</p>
                  </div>
                </label>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowRemove(false)}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => removeMutation.mutate()}
                disabled={removeMutation.isPending}
                className={cn(
                  'flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground',
                  'hover:bg-destructive/90 disabled:opacity-50',
                )}
              >
                {removeMutation.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Removing...
                  </>
                ) : (
                  'Remove from Harbor'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DropboxSection() {
  const queryClient = useQueryClient();
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['dropbox-status'],
    queryFn: async () => { const r = await fetch('/api/auth/dropbox/status'); return r.json(); },
  });
  const { data: secretStatus } = useQuery({
    queryKey: ['secrets-status'],
    queryFn: async () => { const r = await fetch('/api/settings/secrets'); return r.json() as Promise<Record<string, boolean>>; },
  });

  const mounted = useMounted();
  const [dropboxResult, setDropboxResult] = useState<string | null>(null);
  const [dropboxReason, setDropboxReason] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Array<{ step: string; ok: boolean; detail: string }> | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setDropboxResult(p.get('dropbox'));
    setDropboxReason(p.get('reason'));
  }, []);

  const testConnection = async (rootPath?: string) => {
    setTesting(true);
    setTestResults(null);
    try {
      const r = await fetch('/api/auth/dropbox/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootPath: rootPath || '/' }),
      });
      const data = await r.json();
      setTestResults(data.results);
    } catch {
      setTestResults([{ step: 'Connection', ok: false, detail: 'Failed to reach Harbor server.' }]);
    }
    setTesting(false);
  };

  return (
    <section>
      <SectionHeader icon={Cloud} title="Dropbox" description="Connect your Dropbox account to browse cloud files" />
      <div className="mt-4 space-y-3">
        {dropboxResult === 'success' && (
          <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
            <Check className="mr-1.5 inline h-4 w-4" />
            Dropbox connected successfully. You can now add a Dropbox archive root above.
          </div>
        )}
        {dropboxResult === 'error' && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Connection failed{dropboxReason ? `: ${dropboxReason.replace(/_/g, ' ')}` : ''}.
          </div>
        )}

        {/* Setup guide */}
        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">How to set up Dropbox:</p>
          <ol className="list-decimal pl-4 space-y-0.5">
            <li>Go to the <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Dropbox App Console</a> and create a new app</li>
            <li>Choose <strong>"Scoped access"</strong> and <strong>"Full Dropbox"</strong> access type</li>
            <li>Go to the <strong>Permissions</strong> tab and enable: <code className="rounded bg-muted px-1">files.metadata.read</code>, <code className="rounded bg-muted px-1">files.content.read</code>, <code className="rounded bg-muted px-1">files.content.write</code></li>
            <li>Copy the App Key and App Secret from the <strong>Settings</strong> tab</li>
            <li>Enter them below, then click <strong>Connect Dropbox</strong> to authorize</li>
          </ol>
          <div className="mt-2 rounded border border-amber-500/20 bg-amber-500/5 p-2 text-amber-700 dark:text-amber-400">
            <strong>Important:</strong> If you change scopes after connecting, you must <strong>Reconnect Dropbox</strong> so Harbor gets a fresh token with the new permissions.
          </div>
        </div>

        <SecretField label="Dropbox App Key" description="The App Key from your Dropbox app's settings page." secretKey="dropbox.appKey" isSet={secretStatus?.['dropbox.appKey'] ?? false} helpUrl="https://www.dropbox.com/developers/apps" helpText="Open Dropbox App Console" />
        <SecretField label="Dropbox App Secret" description="The App Secret from your Dropbox app's settings page." secretKey="dropbox.appSecret" isSet={secretStatus?.['dropbox.appSecret'] ?? false} helpUrl="https://www.dropbox.com/developers/apps" helpText="Open Dropbox App Console" />

        {/* Connection status */}
        <div className="rounded-lg border border-border p-4">
          {statusLoading ? (
            <div className="h-10 animate-pulse rounded bg-muted" />
          ) : status?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-full bg-green-500/20 p-1">
                    <Check className="h-3 w-3 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      Connected
                      {status.accountInfo?.displayName && (
                        <span className="ml-1 font-normal text-muted-foreground">
                          — {status.accountInfo.displayName}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {status.accountInfo?.accountType && (
                        <span className="capitalize">{status.accountInfo.accountType} account</span>
                      )}
                      {status.accountInfo?.hasTeamSpace && (
                        <span className="ml-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                          Team Space
                        </span>
                      )}
                      {status.connectedAt && (
                        <span>{status.accountInfo?.accountType ? ' · ' : ''}Since {new Date(status.connectedAt).toLocaleDateString()}</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => testConnection()}
                    disabled={testing}
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
                  >
                    {testing ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const r = await fetch('/api/auth/dropbox/refresh', { method: 'POST' });
                        const d = await r.json();
                        if (r.ok) { toast.success('Token refreshed with current scopes'); queryClient.invalidateQueries({ queryKey: ['dropbox-status'] }); }
                        else toast.error(d.message);
                      } catch { toast.error('Failed to refresh token'); }
                    }}
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
                  >
                    Refresh Token
                  </button>
                  <a href="/api/auth/dropbox" className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
                    Reconnect
                  </a>
                  <button
                    onClick={async () => {
                      if (!confirm('Disconnect Dropbox? You will need to reconnect to use Dropbox archives.')) return;
                      try {
                        await fetch('/api/auth/dropbox/disconnect', { method: 'POST' });
                        queryClient.invalidateQueries({ queryKey: ['dropbox-status'] });
                        toast.success('Dropbox disconnected');
                      } catch { toast.error('Failed to disconnect'); }
                    }}
                    className="rounded-md border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Changed scopes? Click <strong>Refresh Token</strong> to get updated permissions, or <strong>Reconnect</strong> for a full reauth. <strong>Disconnect</strong> removes the stored token.
              </p>
            </div>
          ) : status?.configured ? (
            <div className="space-y-3">
              <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3 text-xs space-y-1">
                <p className="font-medium text-amber-700 dark:text-amber-400">Before connecting:</p>
                <p className="text-muted-foreground">Add this Redirect URI to your Dropbox app's OAuth settings:</p>
                <code className="block mt-1 rounded bg-muted px-2 py-1 text-[11px] font-mono select-all">
                  {mounted ? `${window.location.origin}/api/auth/dropbox/callback` : '/api/auth/dropbox/callback'}
                </code>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Ready to connect</p>
                  <p className="text-xs text-muted-foreground">Credentials configured. Click to start OAuth.</p>
                </div>
                <a href="/api/auth/dropbox" className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                  <ExternalLink className="h-3 w-3" />
                  Connect Dropbox
                </a>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground">
                Enter your Dropbox App Key and App Secret above to get started. Follow the setup steps to create a Dropbox app if you don't have one.
              </p>
            </div>
          )}
        </div>

        {/* Test connection results */}
        {testResults && (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <p className="text-xs font-medium">Connection test results:</p>
            {testResults.map((r, i) => (
              <div key={i} className={cn('flex items-start gap-2 text-xs', r.ok ? 'text-green-700 dark:text-green-400' : 'text-destructive')}>
                {r.ok ? <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                <div>
                  <span className="font-medium">{r.step}:</span> {r.detail}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Admin "Delete Queue" surface. Lists every file currently in
 * `PENDING_DELETE` state along with the user who requested it,
 * the reason, and the cumulative space the queue is sitting on.
 *
 * Approving a row removes the bytes from the provider (local
 * unlink or Dropbox `files_delete_v2`), hard-deletes the row,
 * and bumps the lifetime "reclaimed" counter shown at the top.
 * Rejecting a row restores the file to `INDEXED` state.
 *
 * The Approve button has a two-step inline confirm so an admin
 * can't permanently delete a file with a single accidental click.
 */
function DeleteQueueSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'delete-queue'],
    queryFn: adminDeleteQueue.list,
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => adminDeleteQueue.approve(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'delete-queue'] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      if (res.providerError) {
        toast.warning(`Removed from queue, but provider returned: ${res.providerError}`);
      } else {
        toast.success(`Permanently deleted (${formatBytes(res.bytesReclaimed)} freed)`);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rejectMut = useMutation({
    mutationFn: (id: string) => adminDeleteQueue.reject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'delete-queue'] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
      toast.success('Restored — file is visible again');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <section>
      <SectionHeader
        icon={Trash2}
        title="Delete Queue"
        description="Files marked for delete by users. Approving permanently removes the bytes from the provider."
      />

      {isLoading ? (
        <div className="mt-4 rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Loading queue…
        </div>
      ) : (
        <>
          {/* Stat row: pending + cumulative reclaimed */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="Pending items"
              value={(data?.pendingCount ?? 0).toLocaleString()}
            />
            <StatTile
              label="Pending bytes"
              value={formatBytes(data?.pendingBytes ?? 0)}
            />
            <StatTile
              label="Reclaimed items"
              value={(data?.reclaimedCount ?? 0).toLocaleString()}
              accent="green"
            />
            <StatTile
              label="Reclaimed bytes"
              value={formatBytes(data?.reclaimedBytes ?? 0)}
              accent="green"
            />
          </div>

          {/* Pending list */}
          <div className="mt-4 rounded-lg border border-border">
            {data && data.pending.length > 0 ? (
              <div className="divide-y divide-border">
                {data.pending.map((entry) => (
                  <DeleteQueueRow
                    key={entry.id}
                    entry={entry}
                    onApprove={() => approveMut.mutate(entry.id)}
                    onReject={() => rejectMut.mutate(entry.id)}
                    busy={approveMut.isPending || rejectMut.isPending}
                  />
                ))}
              </div>
            ) : (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Nothing in the queue. Files marked for delete will appear here for review.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'green';
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-lg font-bold tabular-nums',
          accent === 'green' && 'text-green-600 dark:text-green-400',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function DeleteQueueRow({
  entry,
  onApprove,
  onReject,
  busy,
}: {
  entry: import('@/lib/api').DeleteQueueEntry;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);

  // The DeleteRequest snapshots `fileId` so the original row can be
  // looked up even after a hard delete drops the file from disk. As
  // long as the file row still exists (i.e. the request is still
  // PENDING), the admin can open the regular detail panel from this
  // queue row to inspect tags, metadata, EXIF, etc. before deciding
  // whether to approve or restore.
  const canOpenDetail = !!entry.fileId;
  const handleOpenDetail = () => {
    if (entry.fileId) openDetailPanel('file', entry.fileId);
  };

  // Pick an icon hint to fall back to when the thumbnail fails to load
  // (or there is no preview at all). Mirrors the categorisation we use
  // in the file grid so the visual language stays consistent.
  const mime = entry.fileMimeType ?? '';
  const FallbackIcon =
    mime.startsWith('image/') ? FileImage
    : mime.startsWith('video/') ? FileVideo
    : mime.startsWith('text/') || mime.includes('pdf') || mime.includes('document') ? FileText
    : FileIcon;

  return (
    <div className="flex flex-wrap items-start gap-3 px-4 py-3">
      {/* Thumbnail. Clicking it opens the detail panel; we render
          the underlying preview when one exists, falling back to a
          mime-typed icon when the file has no preview yet (or the
          fetch fails). The wrapper button stays focusable for
          keyboard users. */}
      <button
        type="button"
        onClick={handleOpenDetail}
        disabled={!canOpenDetail}
        aria-label={canOpenDetail ? `Open details for ${entry.fileName}` : entry.fileName}
        className={cn(
          'group relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted',
          canOpenDetail
            ? 'cursor-pointer transition hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            : 'cursor-default',
        )}
      >
        {entry.fileId && (mime.startsWith('image/') || mime.startsWith('video/')) ? (
          <img
            src={getPreviewUrl(entry.fileId, 'THUMBNAIL')}
            alt=""
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            loading="lazy"
            onError={(e) => {
              // Fall back to the icon overlay by hiding the broken img.
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null}
        <div
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground',
            entry.fileId && (mime.startsWith('image/') || mime.startsWith('video/'))
              ? 'opacity-0'
              : 'opacity-100',
          )}
        >
          <FallbackIcon className="h-6 w-6" aria-hidden="true" />
        </div>
      </button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={handleOpenDetail}
          disabled={!canOpenDetail}
          className={cn(
            'block w-full text-left',
            canOpenDetail && 'hover:underline focus-visible:underline focus-visible:outline-none',
          )}
          title={entry.fileName}
        >
          <p className="truncate text-sm font-medium">{entry.fileName}</p>
        </button>
        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={entry.filePath}>
          {entry.archiveRootName} · {entry.filePath}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span>{formatBytes(entry.fileSize)}</span>
          <span>·</span>
          <span>{entry.providerType}</span>
          <span>·</span>
          <span>by {entry.requestedBy.displayName}</span>
          <span>·</span>
          <span>{new Date(entry.requestedAt).toLocaleString()}</span>
        </div>
        {entry.reason && (
          <p className="mt-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-foreground">
            <span className="font-medium">Reason:</span> {entry.reason}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {confirming ? (
          <>
            <button
              onClick={() => { onApprove(); setConfirming(false); }}
              disabled={busy}
              className="rounded-md bg-destructive px-2.5 py-1 text-[11px] font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Permanently delete'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" /> Approve delete
            </button>
            <button
              onClick={onReject}
              disabled={busy}
              className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              Restore
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ArchiveAccessPanel({ archiveRootId, onClose }: { archiveRootId: string; onClose: () => void }) {
  const queryClient = useQueryClient();

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users');
      return res.json() as Promise<Array<{ id: string; username: string; displayName: string; isLocalUser: boolean }>>;
    },
  });

  const { data: access, isLoading } = useQuery({
    queryKey: ['archive-access', archiveRootId],
    queryFn: async () => {
      const res = await fetch(`/api/archive-roots/${archiveRootId}/access`);
      return res.json() as Promise<{ isPrivate: boolean; userIds: string[] }>;
    },
  });

  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);

  // Sync from server when loaded
  useEffect(() => {
    if (access && !initialized) {
      setSelectedUserIds(new Set(access.userIds));
      setInitialized(true);
    }
  }, [access, initialized]);

  const saveMut = useMutation({
    mutationFn: async (userIds: string[]) => {
      const res = await fetch(`/api/archive-roots/${archiveRootId}/access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['archive-roots'] });
      queryClient.invalidateQueries({ queryKey: ['archive-access', archiveRootId] });
      toast.success('Access updated');
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const realUsers = (users ?? []).filter((u) => !u.isLocalUser);
  const allSelected = selectedUserIds.size === 0;

  const toggleUser = (userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">User Access</p>
        <button onClick={onClose} className="text-[10px] text-muted-foreground hover:text-foreground">Close</button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelectedUserIds(new Set())}
              className="h-3.5 w-3.5 rounded border-input"
            />
            <span className={allSelected ? 'font-medium' : 'text-muted-foreground'}>Everyone (all users)</span>
          </label>

          {realUsers.length > 0 && (
            <div className="space-y-1 pl-1">
              <p className="text-[10px] text-muted-foreground">Or select specific users:</p>
              {realUsers.map((user) => (
                <label key={user.id} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedUserIds.has(user.id)}
                    onChange={() => toggleUser(user.id)}
                    className="h-3.5 w-3.5 rounded border-input"
                  />
                  <span>{user.displayName}</span>
                  <span className="text-[10px] text-muted-foreground">@{user.username}</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded-md border border-border px-3 py-1 text-[11px] text-muted-foreground hover:bg-accent">
              Cancel
            </button>
            <button
              onClick={() => saveMut.mutate([...selectedUserIds])}
              disabled={saveMut.isPending}
              className="rounded-md bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saveMut.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function DatabaseSection() {
  const { data: dbInfo } = useQuery({
    queryKey: ['db-info'],
    queryFn: async () => {
      // Extract host info from a test query to show connection details
      try {
        const res = await fetch('/api/settings');
        return res.ok ? { connected: true } : { connected: false };
      } catch {
        return { connected: false };
      }
    },
  });

  const deploymentMode = typeof window !== 'undefined'
    ? (document.cookie.includes('harbor-admin-session') ? 'cloud' : undefined)
    : undefined;

  return (
    <section>
      <SectionHeader icon={Database} title="Database" description="Database connection and maintenance" />
      <div className="mt-4 rounded-lg border border-border p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className={cn(
            'h-2 w-2 rounded-full',
            dbInfo?.connected ? 'bg-green-500' : 'bg-red-500',
          )} />
          <p className="text-sm font-medium">
            {dbInfo?.connected ? 'Connected' : 'Connection error'}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          PostgreSQL database connection is configured via the <code className="rounded bg-muted px-1">DATABASE_URL</code> environment variable.
          {process.env.NEXT_PUBLIC_VERCEL_URL && ' Hosted on Supabase via Vercel.'}
        </p>
      </div>
    </section>
  );
}

function AiSettingsSection() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => { const r = await fetch('/api/settings'); return r.json() as Promise<Record<string, string>>; },
  });
  const { data: secretStatus } = useQuery({
    queryKey: ['secrets-status'],
    queryFn: async () => { const r = await fetch('/api/settings/secrets'); return r.json() as Promise<Record<string, boolean>>; },
  });

  const saveMutation = useMutation({
    mutationFn: async (patch: Record<string, string>) => {
      const r = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!r.ok) throw new Error('Failed to save');
      return r.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings'] }); toast.success('Setting saved'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const aiEnabled = settings?.['ai.enabled'] === 'true';

  return (
    <section>
      <SectionHeader icon={Cpu} title="AI Features" description="Configure AI providers and enrichment features" />
      <div className="mt-4 space-y-3">
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">AI Features</p>
              <p className="text-xs text-muted-foreground">Enable OCR, auto-tagging, title generation, and transcription</p>
            </div>
            <button
              onClick={() => saveMutation.mutate({ 'ai.enabled': aiEnabled ? 'false' : 'true' })}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                aiEnabled ? 'bg-primary' : 'bg-muted',
              )}
              role="switch"
              aria-checked={aiEnabled}
            >
              <span className={cn('inline-block h-4 w-4 rounded-full bg-white transition-transform', aiEnabled ? 'translate-x-6' : 'translate-x-1')} />
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Default AI Provider</p>
              <p className="text-xs text-muted-foreground">Which provider to use for enrichment tasks</p>
            </div>
            <select
              value={settings?.['ai.defaultProvider'] ?? 'openai'}
              onChange={(e) => saveMutation.mutate({ 'ai.defaultProvider': e.target.value })}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Default AI Model</p>
              <p className="text-xs text-muted-foreground">Which model to use for content generation</p>
            </div>
            <select
              value={settings?.['ai.defaultModel'] ?? 'gpt-4o'}
              onChange={(e) => saveMutation.mutate({ 'ai.defaultModel': e.target.value })}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <optgroup label="OpenAI">
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
              </optgroup>
              <optgroup label="Anthropic">
                <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
              </optgroup>
              <optgroup label="Google Gemini">
                <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
              </optgroup>
            </select>
          </div>
        </div>

        <SecretField label="OpenAI API Key" description="Powers OCR, image analysis, transcription (Whisper), and text embeddings." secretKey="openai.apiKey" isSet={secretStatus?.['openai.apiKey'] ?? false} helpUrl="https://platform.openai.com/api-keys" helpText="Get API key" />
        <SecretField label="Anthropic API Key" description="Powers auto-tagging, title generation, descriptions, and summarization." secretKey="anthropic.apiKey" isSet={secretStatus?.['anthropic.apiKey'] ?? false} helpUrl="https://console.anthropic.com/settings/keys" helpText="Get API key" />
        <SecretField label="Google Gemini API Key" description="Powers title generation, descriptions, and tags via Gemini vision." secretKey="gemini.apiKey" isSet={secretStatus?.['gemini.apiKey'] ?? false} helpUrl="https://aistudio.google.com/app/apikey" helpText="Get API key" />

        <FaceDetectionControls
          aiEnabled={aiEnabled}
          faceEnabled={settings?.['ai.faceRecognition'] === 'true'}
          onToggleFace={(on) => saveMutation.mutate({ 'ai.faceRecognition': on ? 'true' : 'false' })}
          hasOpenAiKey={secretStatus?.['openai.apiKey'] ?? false}
          faceProvider={settings?.['ai.faceDetection.provider'] ?? 'openai'}
          onFaceProviderChange={(p) => saveMutation.mutate({ 'ai.faceDetection.provider': p })}
        />

        {/* Content Generation Settings */}
        <div className="rounded-lg border border-border p-4 space-y-4">
          <div>
            <p className="text-sm font-medium">Content Generation</p>
            <p className="text-xs text-muted-foreground">AI-powered title suggestions, descriptions, and auto-tagging for images</p>
          </div>

          {aiEnabled && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Tone</label>
                <select
                  value={settings?.['ai.title.tone'] ?? 'descriptive'}
                  onChange={(e) => saveMutation.mutate({ 'ai.title.tone': e.target.value })}
                  className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <optgroup label="Standard">
                    <option value="descriptive">Descriptive</option>
                    <option value="professional">Professional</option>
                    <option value="casual">Casual</option>
                    <option value="minimal">Minimal</option>
                    <option value="technical">Technical</option>
                    <option value="journalistic">Journalistic</option>
                  </optgroup>
                  <optgroup label="Creative">
                    <option value="creative">Creative</option>
                    <option value="poetic">Poetic</option>
                    <option value="dramatic">Dramatic</option>
                    <option value="nostalgic">Nostalgic</option>
                    <option value="cinematic">Cinematic</option>
                    <option value="whimsical">Whimsical</option>
                    <option value="mysterious">Mysterious</option>
                    <option value="romantic">Romantic</option>
                  </optgroup>
                  <optgroup label="Fun">
                    <option value="humorous">Humorous</option>
                    <option value="sarcastic">Sarcastic</option>
                    <option value="clickbait">Clickbait</option>
                    <option value="roast">Roast</option>
                    <option value="meme">Meme-style</option>
                    <option value="deadpan">Deadpan</option>
                  </optgroup>
                  <optgroup label="Intimate">
                    <option value="sensual">Sensual</option>
                    <option value="alluring">Alluring</option>
                    <option value="intimate">Intimate</option>
                    <option value="bold-artistic">Bold Artistic</option>
                    <option value="provocative">Provocative</option>
                    <option value="seductive">Seductive</option>
                    <option value="risque">Risqué</option>
                    <option value="boudoir">Boudoir</option>
                  </optgroup>
                  <optgroup label="Mood">
                    <option value="dark">Dark</option>
                    <option value="uplifting">Uplifting</option>
                    <option value="melancholic">Melancholic</option>
                    <option value="ethereal">Ethereal</option>
                    <option value="edgy">Edgy</option>
                    <option value="serene">Serene</option>
                  </optgroup>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Max title length</label>
                <input
                  type="number"
                  min={20}
                  max={200}
                  value={settings?.['ai.title.maxLength'] ?? '80'}
                  onChange={(e) => saveMutation.mutate({ 'ai.title.maxLength': e.target.value })}
                  className="w-20 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Suggestions per request</label>
                <input
                  type="number"
                  min={2}
                  max={6}
                  value={settings?.['ai.title.suggestionCount'] ?? '4'}
                  onChange={(e) => saveMutation.mutate({ 'ai.title.suggestionCount': e.target.value })}
                  className="w-20 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Max description length</label>
                <input
                  type="number"
                  min={50}
                  max={500}
                  value={settings?.['ai.description.maxLength'] ?? '200'}
                  onChange={(e) => saveMutation.mutate({ 'ai.description.maxLength': e.target.value })}
                  className="w-20 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Tags per request</label>
                <input
                  type="number"
                  min={3}
                  max={20}
                  value={settings?.['ai.tags.count'] ?? '8'}
                  onChange={(e) => saveMutation.mutate({ 'ai.tags.count': e.target.value })}
                  className="w-20 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Archive context (optional)</label>
                <textarea
                  value={settings?.['ai.title.systemContext'] ?? ''}
                  onChange={(e) => saveMutation.mutate({ 'ai.title.systemContext': e.target.value })}
                  placeholder="e.g. This archive contains family photos from the Marshall family, taken between 2010-2024. People include Ben, Angel, Robin, and Andy."
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Providing context about your archive helps the AI generate more relevant titles, descriptions, and tags.
                </p>
              </div>
            </div>
          )}

          {!aiEnabled && (
            <p className="text-[11px] text-amber-600">Enable AI features above to configure content generation.</p>
          )}
        </div>

        {/* AI Usage Dashboard */}
        {aiEnabled && <AiUsageDashboard />}
      </div>
    </section>
  );
}

function AiUsageDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['ai-usage'],
    queryFn: async () => {
      const res = await fetch('/api/admin/ai-usage');
      if (!res.ok) return null;
      return res.json() as Promise<{
        totalJobs: number;
        totalCost: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        byPurpose: Record<string, { count: number; cost: number }>;
        recent: Array<{ id: string; purpose: string; provider: string; model: string; cost: number | null; elapsedMs: number | null; status: string; createdAt: string }>;
      }>;
    },
    staleTime: 30_000,
  });

  if (isLoading || !data) return null;
  if (data.totalJobs === 0) return null;

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <p className="text-sm font-medium">AI Usage</p>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-md bg-muted/40 p-2.5 text-center">
          <p className="text-lg font-bold tabular-nums">{data.totalJobs}</p>
          <p className="text-[10px] text-muted-foreground">Total requests</p>
        </div>
        <div className="rounded-md bg-muted/40 p-2.5 text-center">
          <p className="text-lg font-bold tabular-nums">${data.totalCost.toFixed(3)}</p>
          <p className="text-[10px] text-muted-foreground">Estimated cost</p>
        </div>
        <div className="rounded-md bg-muted/40 p-2.5 text-center">
          <p className="text-lg font-bold tabular-nums">{((data.totalInputTokens + data.totalOutputTokens) / 1000).toFixed(1)}k</p>
          <p className="text-[10px] text-muted-foreground">Total tokens</p>
        </div>
      </div>
      {Object.keys(data.byPurpose).length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">By purpose</p>
          {Object.entries(data.byPurpose).map(([purpose, stats]) => (
            <div key={purpose} className="flex items-center justify-between text-xs">
              <span className="capitalize">{purpose.replace(/_/g, ' ')}</span>
              <span className="tabular-nums text-muted-foreground">{stats.count} requests · ${stats.cost.toFixed(3)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FaceDetectionControls({
  aiEnabled,
  faceEnabled,
  onToggleFace,
  hasOpenAiKey,
  faceProvider,
  onFaceProviderChange,
}: {
  aiEnabled: boolean;
  faceEnabled: boolean;
  onToggleFace: (on: boolean) => void;
  hasOpenAiKey: boolean;
  faceProvider: string;
  onFaceProviderChange: (provider: string) => void;
}) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ processed: number; facesFound: number } | null>(null);

  const canRun = aiEnabled && faceEnabled && hasOpenAiKey;

  const handleRun = async (opts?: { limit?: number }) => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/face-detection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: opts?.limit ?? 50 }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      const data = await res.json();
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['persons'] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
      toast.success(`Processed ${data.processed} images, found ${data.facesFound} faces`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Face detection failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Face Detection</p>
          <p className="text-xs text-muted-foreground">
            Detect faces in images using AI vision. Detected faces are linked to People records for search and filtering.
          </p>
        </div>
        <button
          onClick={() => onToggleFace(!faceEnabled)}
          disabled={!aiEnabled}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
            faceEnabled && aiEnabled ? 'bg-primary' : 'bg-muted',
            !aiEnabled && 'opacity-50 cursor-not-allowed',
          )}
          role="switch"
          aria-checked={faceEnabled}
        >
          <span className={cn('inline-block h-4 w-4 rounded-full bg-white transition-transform', faceEnabled ? 'translate-x-6' : 'translate-x-1')} />
        </button>
      </div>

      {aiEnabled && faceEnabled && (
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">Vision provider</label>
          <select
            value={faceProvider}
            onChange={(e) => onFaceProviderChange(e.target.value)}
            className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="openai">OpenAI (GPT-4o)</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="gemini">Google Gemini</option>
          </select>
        </div>
      )}

      {!aiEnabled && (
        <p className="text-[11px] text-amber-600">Enable AI features above to use face detection.</p>
      )}
      {aiEnabled && !hasOpenAiKey && faceProvider === 'openai' && (
        <p className="text-[11px] text-amber-600">Set an OpenAI API key above — face detection uses GPT-4o vision.</p>
      )}

      {canRun && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-3">
          <p className="flex-1 text-xs text-muted-foreground">
            Scan unprocessed images for faces. Uses GPT-4o vision — costs ~$0.01-0.03 per image.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleRun({ limit: 10 })}
              disabled={running}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              {running ? 'Running...' : 'Test (10 images)'}
            </button>
            <button
              type="button"
              onClick={() => handleRun({ limit: 100 })}
              disabled={running}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {running ? 'Running...' : 'Run (100 images)'}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-md bg-green-500/10 border border-green-500/30 p-3 text-xs text-green-700 dark:text-green-400">
          Processed {result.processed} images — found {result.facesFound} faces.
          {result.facesFound > 0 && ' Check the People section to review and name detected faces.'}
        </div>
      )}
    </div>
  );
}

function IgnorePatternsEditor({ value, onSave }: { value: string; onSave: (val: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const patterns = value.split(',').map((p) => p.trim()).filter(Boolean);

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div>
        <p className="text-sm font-medium">Ignored Files & Patterns</p>
        <p className="text-xs text-muted-foreground">
          Files and folders matching these names are skipped during indexing, watching, and listing.
          Matching is case-insensitive and applies to existing files immediately. Supports exact
          names (e.g. <code className="rounded bg-muted px-1">Icon</code>),{' '}
          leading wildcards (<code className="rounded bg-muted px-1">*.aae</code>),{' '}
          and trailing wildcards (<code className="rounded bg-muted px-1">Thumbs*</code>).
        </p>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder=".gitkeep, .DS_Store, Thumbs.db"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-[10px] text-muted-foreground">Comma-separated list of filenames or patterns</p>
          <div className="flex gap-2">
            <button
              onClick={() => { onSave(draft); setEditing(false); }}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Save
            </button>
            <button
              onClick={() => { setDraft(value); setEditing(false); }}
              className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap gap-1.5">
            {patterns.map((p, i) => (
              <span key={i} className="rounded-md bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">
                {p}
              </span>
            ))}
          </div>
          <button
            onClick={() => { setDraft(value); setEditing(true); }}
            className="mt-2 text-xs font-medium text-primary hover:underline"
          >
            Edit ignore list
          </button>
        </div>
      )}
    </div>
  );
}

// ─── People management ────────────────────────────────────────────────────────

function PeopleManagementSection() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEntityType, setNewEntityType] = useState<'PERSON' | 'PET'>('PERSON');
  const [newGender, setNewGender] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editGender, setEditGender] = useState<string>('');
  const [editEntityType, setEditEntityType] = useState<'PERSON' | 'PET'>('PERSON');
  const [linkingUserId, setLinkingUserId] = useState<string | null>(null);
  const [mergeSelection, setMergeSelection] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);

  const { data: people, isLoading } = useQuery({
    queryKey: ['persons'],
    queryFn: async () => {
      const res = await fetch('/api/persons');
      return res.json() as Promise<Array<{
        id: string | null;
        name: string | null;
        avatarUrl: string | null;
        avatarFileId?: string | null;
        entityType?: 'PERSON' | 'PET';
        gender?: 'MALE' | 'FEMALE' | 'OTHER' | null;
        isConfirmed: boolean;
        faceCount: number;
        linkedUser: { id: string; username: string; displayName: string } | null;
        source: 'record' | 'metadata';
        fileCount?: number;
      }>>;
    },
  });

  const createMut = useMutation({
    mutationFn: async (opts?: { name?: string; entityType?: 'PERSON' | 'PET' }) => {
      const personName = (opts?.name ?? newName).trim();
      if (!personName) throw new Error('Name is required');
      const res = await fetch('/api/persons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: personName, entityType: opts?.entityType ?? newEntityType, ...(newGender ? { gender: newGender } : {}) }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['persons'] });
      setNewName('');
      setNewEntityType('PERSON');
      setShowCreate(false);
      toast.success(newEntityType === 'PET' ? 'Pet created' : 'Person created');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, name, gender, entityType }: { id: string; name: string; gender?: string; entityType?: string }) => {
      const res = await fetch(`/api/persons/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, gender: gender || null, ...(entityType ? { entityType } : {}) }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['persons'] });
      setEditingId(null);
      toast.success('Person updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/persons/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('Delete failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['persons'] });
      toast.success('Person removed');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const metadataOnly = (people ?? []).filter((p) => p.source === 'metadata');

  const promoteAllMut = useMutation({
    mutationFn: async () => {
      const names = metadataOnly.map((p) => p.name).filter(Boolean) as string[];
      const results = await Promise.allSettled(
        names.map((name) =>
          fetch('/api/persons', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          }),
        ),
      );
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      return succeeded;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['persons'] });
      toast.success(`Promoted ${count} people to managed records`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMergeSelect = (id: string) => {
    setMergeSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMerge = async () => {
    const ids = [...mergeSelection];
    if (ids.length < 2) { toast.error('Select at least 2 people to merge'); return; }
    const targetId = ids[0]; // First selected becomes the target
    const target = people?.find((p) => p.id === targetId);
    if (!confirm(`Merge ${ids.length} people into "${target?.name ?? 'Unknown'}"? This will reassign all faces and update file metadata.`)) return;

    setMerging(true);
    try {
      const res = await fetch('/api/persons/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId, sourceIds: ids.slice(1) }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      queryClient.invalidateQueries({ queryKey: ['persons'] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
      setMergeSelection(new Set());
      toast.success(`Merged ${ids.length} people`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setMerging(false);
    }
  };

  return (
    <section>
      <SectionHeader
        icon={Users}
        title="People & Pets"
        description="Manage people and pets that appear in your archive. People can be linked to app users or exist independently."
      />

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {people?.length ?? 0} {(people?.length ?? 0) === 1 ? 'entry' : 'entries'}
        </p>
        <div className="flex items-center gap-2">
          {mergeSelection.size >= 2 && (
            <button
              type="button"
              onClick={handleMerge}
              disabled={merging}
              className="rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              {merging ? 'Merging...' : `Merge ${mergeSelection.size} people`}
            </button>
          )}
          {mergeSelection.size > 0 && (
            <button
              type="button"
              onClick={() => setMergeSelection(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          )}
          {metadataOnly.length > 0 && (
            <button
              type="button"
              onClick={() => promoteAllMut.mutate()}
              disabled={promoteAllMut.isPending}
              className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-600 hover:bg-amber-500/10 disabled:opacity-50"
            >
              {promoteAllMut.isPending ? 'Promoting...' : `Promote all (${metadataOnly.length})`}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Add person or pet
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="mt-3 rounded-lg border border-border bg-card p-3 space-y-2">
          <div className="flex items-center gap-2">
            {/* Person/Pet toggle */}
            <div className="flex items-center rounded-md border border-border">
              <button
                type="button"
                onClick={() => setNewEntityType('PERSON')}
                className={cn(
                  'flex items-center gap-1.5 rounded-l-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                  newEntityType === 'PERSON' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
                )}
              >
                <Users className="h-3 w-3" /> Person
              </button>
              <button
                type="button"
                onClick={() => setNewEntityType('PET')}
                className={cn(
                  'flex items-center gap-1.5 rounded-r-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                  newEntityType === 'PET' ? 'bg-amber-500 text-white' : 'text-muted-foreground hover:bg-accent',
                )}
              >
                <PawPrint className="h-3 w-3" /> Pet
              </button>
            </div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={newEntityType === 'PET' ? 'Pet name' : 'Person name'}
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) createMut.mutate({});
                if (e.key === 'Escape') setShowCreate(false);
              }}
            />
            <select
              value={newGender}
              onChange={(e) => setNewGender(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Gender</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
            <button
              type="button"
              onClick={() => newName.trim() && createMut.mutate({})}
              disabled={!newName.trim() || createMut.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setNewName(''); setNewEntityType('PERSON'); }}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="mt-4 text-sm text-muted-foreground">Loading...</div>
      ) : (
        <div className="mt-4 rounded-lg border border-border">
          {people && people.length > 0 ? (
            <div className="divide-y divide-border">
              {people.map((person, idx) => {
                const isRecord = person.source === 'record';
                const rowKey = person.id ?? `meta-${idx}`;
                return (
                  <div key={rowKey} className="flex items-center gap-3 px-4 py-3">
                    {/* Merge checkbox (only for DB records) */}
                    {isRecord && person.id && (
                      <input
                        type="checkbox"
                        checked={mergeSelection.has(person.id)}
                        onChange={() => toggleMergeSelect(person.id!)}
                        className="h-3.5 w-3.5 shrink-0 rounded border-border"
                        aria-label={`Select ${person.name} for merge`}
                      />
                    )}
                    {/* Avatar — clickable for DB records to open image picker */}
                    {(() => {
                      const isPet = person.entityType === 'PET';
                      const avatarContent = person.avatarUrl ? (
                        <div className="relative shrink-0">
                          <img
                            src={person.avatarUrl}
                            alt=""
                            className={cn('h-10 w-10 object-cover', isPet ? 'rounded-xl' : 'rounded-full')}
                          />
                          {isPet && (
                            <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500">
                              <PawPrint className="h-2 w-2 text-white" />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center',
                          isPet ? 'rounded-xl bg-amber-500/10 text-amber-600' :
                          isRecord ? 'rounded-full bg-muted text-muted-foreground' : 'rounded-full bg-amber-500/10 text-amber-600',
                        )}>
                          {isPet ? <PawPrint className="h-5 w-5" /> : <Users className="h-5 w-5" />}
                        </div>
                      );

                      if (!isRecord || !person.id) return avatarContent;

                      return (
                        <AvatarPicker
                          currentFileId={person.avatarFileId ?? null}
                          onSelect={async (fileId) => {
                            try {
                              const res = await fetch(`/api/persons/${person.id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ avatarFileId: fileId }),
                              });
                              if (!res.ok) throw new Error('Failed');
                              queryClient.invalidateQueries({ queryKey: ['persons'] });
                              queryClient.invalidateQueries({ queryKey: ['connections'] });
                              toast.success(fileId ? 'Avatar set' : 'Avatar removed');
                            } catch {
                              toast.error('Failed to update avatar');
                            }
                          }}
                        >
                          <button
                            type="button"
                            className="group relative shrink-0 cursor-pointer rounded-full"
                            title="Click to set avatar"
                          >
                            {avatarContent}
                            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 transition group-hover:bg-black/30">
                              <ImageIcon className="h-4 w-4 text-white opacity-0 transition group-hover:opacity-100" />
                            </div>
                          </button>
                        </AvatarPicker>
                      );
                    })()}

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      {isRecord && editingId === person.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Person/Pet toggle */}
                          <div className="flex items-center rounded-md border border-border">
                            <button type="button" onClick={() => setEditEntityType('PERSON')}
                              className={cn('flex items-center gap-1 rounded-l-md px-2 py-1 text-[10px] font-medium',
                                editEntityType === 'PERSON' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}>
                              <Users className="h-2.5 w-2.5" /> Person
                            </button>
                            <button type="button" onClick={() => setEditEntityType('PET')}
                              className={cn('flex items-center gap-1 rounded-r-md px-2 py-1 text-[10px] font-medium',
                                editEntityType === 'PET' ? 'bg-amber-500 text-white' : 'text-muted-foreground hover:bg-accent')}>
                              <PawPrint className="h-2.5 w-2.5" /> Pet
                            </button>
                          </div>
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="flex-1 min-w-[120px] rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && editName.trim()) updateMut.mutate({ id: person.id!, name: editName.trim(), gender: editGender, entityType: editEntityType });
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                          />
                          <select
                            value={editGender}
                            onChange={(e) => setEditGender(e.target.value)}
                            className="rounded-md border border-border bg-background px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            <option value="">Gender</option>
                            <option value="MALE">Male</option>
                            <option value="FEMALE">Female</option>
                            <option value="OTHER">Other</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => editName.trim() && updateMut.mutate({ id: person.id!, name: editName.trim(), gender: editGender, entityType: editEntityType })}
                            disabled={updateMut.isPending || !editName.trim()}
                            className="text-xs text-primary hover:underline disabled:opacity-50"
                          >
                            {updateMut.isPending ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-xs text-muted-foreground hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{person.name ?? 'Unnamed'}</p>
                            {person.entityType === 'PET' && (
                              <span className="flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-600">
                                <PawPrint className="h-2 w-2" /> Pet
                              </span>
                            )}
                            {person.gender === 'MALE' && (
                              <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-medium text-blue-600">M</span>
                            )}
                            {person.gender === 'FEMALE' && (
                              <span className="rounded-full bg-pink-500/10 px-1.5 py-0.5 text-[9px] font-medium text-pink-600">F</span>
                            )}
                            {person.gender === 'OTHER' && (
                              <span className="rounded-full bg-purple-500/10 px-1.5 py-0.5 text-[9px] font-medium text-purple-600">O</span>
                            )}
                            {!isRecord && (
                              <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-600">
                                From metadata
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {isRecord && (
                              <span>{person.faceCount} {person.faceCount === 1 ? 'face' : 'faces'}</span>
                            )}
                            {!isRecord && person.fileCount && (
                              <span>Referenced in {person.fileCount} {person.fileCount === 1 ? 'file' : 'files'}</span>
                            )}
                            {person.isConfirmed && <span className="text-green-600">Confirmed</span>}
                            {person.linkedUser ? (
                              <span className="flex items-center gap-1">
                                <Link2 className="h-2.5 w-2.5" />
                                @{person.linkedUser.username}
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await fetch(`/api/persons/${person.id}`, {
                                        method: 'PATCH',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ linkedUserId: null }),
                                      });
                                      queryClient.invalidateQueries({ queryKey: ['persons'] });
                                      toast.success('Unlinked');
                                    } catch { toast.error('Failed to unlink'); }
                                  }}
                                  className="rounded p-0.5 hover:bg-accent"
                                  title="Unlink"
                                >
                                  <X className="h-2 w-2" />
                                </button>
                              </span>
                            ) : isRecord && (
                              <button
                                type="button"
                                onClick={() => setLinkingUserId(linkingUserId === person.id ? null : person.id!)}
                                className="flex items-center gap-1 text-primary hover:underline"
                              >
                                <Link2 className="h-2.5 w-2.5" />
                                Link to user
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Actions */}
                    {editingId !== person.id && (
                      <div className="flex items-center gap-1">
                        {isRecord ? (
                          <>
                            <button
                              type="button"
                              onClick={() => { setEditingId(person.id); setEditName(person.name ?? ''); setEditGender(person.gender ?? ''); setEditEntityType(person.entityType ?? 'PERSON'); }}
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                              aria-label="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Remove "${person.name}"? Detected faces will be unlinked but not deleted.`)) {
                                  deleteMut.mutate(person.id!);
                                }
                              }}
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                              aria-label="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => createMut.mutate({ name: person.name ?? undefined })}
                            disabled={createMut.isPending}
                            className="rounded-md border border-primary/40 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                          >
                            Create as person
                          </button>
                        )}
                      </div>
                    )}

                    {/* Inline user link picker */}
                    {linkingUserId === person.id && (
                      <UserLinkPicker
                        personId={person.id!}
                        personName={person.name ?? ''}
                        onLinked={() => {
                          queryClient.invalidateQueries({ queryKey: ['persons'] });
                          setLinkingUserId(null);
                        }}
                        onCancel={() => setLinkingUserId(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No people or pets registered yet. Add them here or they will be created automatically when face detection runs.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ─── User Link Picker ─────────────────────────────────────────────────────────

/** Inline searchable user picker for linking a person to an app user. */
function UserLinkPicker({
  personId,
  personName,
  onLinked,
  onCancel,
}: {
  personId: string;
  personName: string;
  onLinked: () => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState('');
  const [linking, setLinking] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ['users-picker'],
    queryFn: async () => {
      const res = await fetch('/api/users/picker');
      if (!res.ok) return [];
      return res.json() as Promise<Array<{ id: string; username: string; displayName: string }>>;
    },
  });

  const filtered = users.filter((u) =>
    !search || u.displayName.toLowerCase().includes(search.toLowerCase()) || u.username.toLowerCase().includes(search.toLowerCase()),
  );

  const handleLink = async (userId: string, username: string) => {
    setLinking(true);
    try {
      const res = await fetch(`/api/persons/${personId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedUserId: userId }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      toast.success(`${personName} linked to @${username}`);
      onLinked();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to link');
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-medium text-foreground">
          Link <span className="font-semibold">{personName}</span> to an app user
        </p>
        <button type="button" onClick={onCancel} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search users..."
        className="mb-2 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      />
      <div className="max-h-36 overflow-y-auto space-y-0.5">
        {filtered.length > 0 ? filtered.slice(0, 20).map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => handleLink(u.id, u.username)}
            disabled={linking}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-accent disabled:opacity-50"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <UserPlus className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{u.displayName}</p>
              <p className="text-[10px] text-muted-foreground">@{u.username}</p>
            </div>
          </button>
        )) : (
          <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
            {search ? 'No users match' : 'No users available'}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Person Relationships ─────────────────────────────────────────────────────

const RELATIONSHIP_TYPES = [
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'partner', label: 'Partner' },
  { value: 'grandparent', label: 'Grandparent' },
  { value: 'grandchild', label: 'Grandchild' },
  { value: 'aunt/uncle', label: 'Aunt/Uncle' },
  { value: 'niece/nephew', label: 'Niece/Nephew' },
  { value: 'cousin', label: 'Cousin' },
  { value: 'friend', label: 'Friend' },
  { value: 'colleague', label: 'Colleague' },
  { value: 'manager', label: 'Manager' },
  { value: 'owner', label: 'Owner' },
  { value: 'pet_of', label: 'Pet Of' },
];

const INVERSE_DISPLAY: Record<string, string> = {
  parent: 'Child',
  child: 'Parent',
  grandparent: 'Grandchild',
  grandchild: 'Grandparent',
  'aunt/uncle': 'Niece/Nephew',
  'niece/nephew': 'Aunt/Uncle',
  manager: 'Report',
  report: 'Manager',
  owner: 'Pet Of',
  pet_of: 'Owner',
};

const SYMMETRIC_DISPLAY = new Set([
  'spouse', 'partner', 'sibling', 'friend', 'cousin', 'colleague',
]);

/** Compact inline person picker — shows avatar + name as a button that opens a dropdown. */
function PersonPickerInline({
  people,
  selectedId,
  onSelect,
  placeholder,
}: {
  people: Array<{ id: string | null; name: string | null; avatarUrl: string | null; entityType?: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = people.find((p) => p.id === selectedId);
  const filtered = people.filter((p) => p.id && (!search || p.name?.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(''); }}
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition',
          selected
            ? 'border-primary/30 bg-primary/5 hover:bg-primary/10'
            : 'border-dashed border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
        )}
      >
        {selected ? (
          <>
            {selected.avatarUrl ? (
              <img src={selected.avatarUrl} alt="" className={cn('h-6 w-6 object-cover', selected.entityType === 'PET' ? 'rounded-md' : 'rounded-full')} />
            ) : (
              <div className={cn('flex h-6 w-6 items-center justify-center', selected.entityType === 'PET' ? 'rounded-md bg-amber-500/10' : 'rounded-full bg-muted')}>
                {selected.entityType === 'PET' ? <PawPrint className="h-3 w-3 text-amber-500" /> : <Users className="h-3 w-3 text-muted-foreground" />}
              </div>
            )}
            <span className="font-medium">{selected.name}</span>
          </>
        ) : (
          <>
            <Users className="h-4 w-4" />
            <span>{placeholder}</span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-border bg-popover shadow-xl">
          <div className="p-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
            />
          </div>
          <div className="max-h-48 overflow-y-auto px-1 pb-1">
            {filtered.slice(0, 50).map((p) => {
              if (!p.id) return null;
              const isPet = p.entityType === 'PET';
              return (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); onSelect(p.id!); setOpen(false); }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition',
                    selectedId === p.id ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent',
                  )}
                >
                  {p.avatarUrl ? (
                    <img src={p.avatarUrl} alt="" className={cn('h-6 w-6 object-cover', isPet ? 'rounded-md' : 'rounded-full')} />
                  ) : (
                    <div className={cn('flex h-6 w-6 items-center justify-center', isPet ? 'rounded-md bg-amber-500/10' : 'rounded-full bg-muted')}>
                      {isPet ? <PawPrint className="h-3 w-3 text-amber-500" /> : <Users className="h-3 w-3 text-muted-foreground" />}
                    </div>
                  )}
                  <span className="flex-1 truncate">{p.name}</span>
                  {isPet && <span className="text-[9px] text-amber-500">Pet</span>}
                  {selectedId === p.id && <Check className="h-3 w-3 text-primary" />}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PersonRelationshipsSection() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [relType, setRelType] = useState('friend');
  const [label, setLabel] = useState('');
  const [bidir, setBidir] = useState(false);

  const { data: people } = useQuery({
    queryKey: ['persons'],
    queryFn: async () => {
      const res = await fetch('/api/persons');
      return res.json() as Promise<Array<{ id: string | null; name: string | null; avatarUrl: string | null; entityType?: string; source: string }>>;
    },
  });

  const { data: relationships, isLoading } = useQuery({
    queryKey: ['person-relationships'],
    queryFn: async () => {
      const res = await fetch('/api/person-relationships');
      return res.json() as Promise<Array<{
        id: string;
        relationType: string;
        label: string | null;
        isBidirectional: boolean;
        sourcePerson: { id: string; name: string | null; avatarUrl: string | null; entityType: string };
        targetPerson: { id: string; name: string | null; avatarUrl: string | null; entityType: string };
      }>>;
    },
  });

  const dbPeople = (people ?? []).filter((p) => p.source === 'record' && p.id);

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/person-relationships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePersonId: sourceId, targetPersonId: targetId, relationType: relType, label: label || undefined, isBidirectional: bidir }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-relationships'] });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      setShowAdd(false);
      setSourceId('');
      setTargetId('');
      setRelType('friend');
      setLabel('');
      setBidir(false);
      toast.success('Relationship created');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/person-relationships/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('Delete failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-relationships'] });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      toast.success('Relationship removed');
    },
  });

  return (
    <section className="mt-10">
      <SectionHeader
        icon={Network}
        title="Relationships"
        description="Define how people and pets are connected. Reciprocal relationships are created automatically — adding &quot;Mom is parent of Ben&quot; also creates &quot;Ben is child of Mom&quot;."
      />

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {relationships?.length ?? 0} {(relationships?.length ?? 0) === 1 ? 'relationship' : 'relationships'}
        </p>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Add relationship
        </button>
      </div>

      {showAdd && (() => {
        const sourcePerson = dbPeople.find((p) => p.id === sourceId);
        const targetPerson = dbPeople.find((p) => p.id === targetId);
        const inverseLabel = INVERSE_DISPLAY[relType] ?? relType;
        const isSymmetric = SYMMETRIC_DISPLAY.has(relType);

        return (
          <div className="mt-3 rounded-lg border border-border bg-card p-4 space-y-4">
            {/* Sentence builder: [Person] is [type] of [Person] */}
            <div className="flex flex-wrap items-center gap-2">
              <PersonPickerInline
                people={dbPeople}
                selectedId={sourceId}
                onSelect={setSourceId}
                placeholder="Select person..."
              />

              <span className="text-xs text-muted-foreground">is</span>

              <select
                value={relType}
                onChange={(e) => setRelType(e.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {RELATIONSHIP_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>

              <span className="text-xs text-muted-foreground">of</span>

              <PersonPickerInline
                people={dbPeople.filter((p) => p.id !== sourceId)}
                selectedId={targetId}
                onSelect={setTargetId}
                placeholder="Select person..."
              />
            </div>

            {/* Preview of what will be created */}
            {sourceId && targetId && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Will create:</p>
                <p>• {sourcePerson?.name ?? '?'} → <span className="font-medium">{RELATIONSHIP_TYPES.find((t) => t.value === relType)?.label ?? relType}</span> → {targetPerson?.name ?? '?'}</p>
                <p className="text-muted-foreground/70">
                  • {targetPerson?.name ?? '?'} → <span className="font-medium">{isSymmetric ? (RELATIONSHIP_TYPES.find((t) => t.value === relType)?.label ?? relType) : inverseLabel}</span> → {sourcePerson?.name ?? '?'}
                  <span className="ml-1 italic">(auto)</span>
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowAdd(false); setSourceId(''); setTargetId(''); }}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => createMut.mutate()}
                disabled={!sourceId || !targetId || createMut.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                {createMut.isPending ? 'Creating...' : 'Create relationship'}
              </button>
            </div>
          </div>
        );
      })()}

      {isLoading ? (
        <div className="mt-4 text-sm text-muted-foreground">Loading...</div>
      ) : (
        <div className="mt-4 rounded-lg border border-border">
          {relationships && relationships.length > 0 ? (
            <div className="divide-y divide-border">
              {relationships.map((rel) => (
                <div key={rel.id} className="flex items-center gap-3 px-4 py-3">
                  {/* Source */}
                  <div className="flex items-center gap-2 min-w-0">
                    {rel.sourcePerson.avatarUrl ? (
                      <img src={rel.sourcePerson.avatarUrl} alt="" className={cn('h-7 w-7 object-cover', rel.sourcePerson.entityType === 'PET' ? 'rounded-lg' : 'rounded-full')} />
                    ) : (
                      <div className={cn('flex h-7 w-7 items-center justify-center', rel.sourcePerson.entityType === 'PET' ? 'rounded-lg bg-amber-500/10' : 'rounded-full bg-muted')}>
                        {rel.sourcePerson.entityType === 'PET' ? <PawPrint className="h-3 w-3 text-amber-500" /> : <Users className="h-3 w-3 text-muted-foreground" />}
                      </div>
                    )}
                    <span className="text-sm font-medium truncate">{rel.sourcePerson.name}</span>
                  </div>

                  {/* Relationship label */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {rel.isBidirectional ? <ArrowLeftRight className="h-3 w-3 text-muted-foreground" /> : <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {rel.label ?? rel.relationType.replace(/_/g, ' ')}
                    </span>
                  </div>

                  {/* Target */}
                  <div className="flex items-center gap-2 min-w-0">
                    {rel.targetPerson.avatarUrl ? (
                      <img src={rel.targetPerson.avatarUrl} alt="" className={cn('h-7 w-7 object-cover', rel.targetPerson.entityType === 'PET' ? 'rounded-lg' : 'rounded-full')} />
                    ) : (
                      <div className={cn('flex h-7 w-7 items-center justify-center', rel.targetPerson.entityType === 'PET' ? 'rounded-lg bg-amber-500/10' : 'rounded-full bg-muted')}>
                        {rel.targetPerson.entityType === 'PET' ? <PawPrint className="h-3 w-3 text-amber-500" /> : <Users className="h-3 w-3 text-muted-foreground" />}
                      </div>
                    )}
                    <span className="text-sm font-medium truncate">{rel.targetPerson.name}</span>
                  </div>

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Remove this relationship?')) deleteMut.mutate(rel.id);
                    }}
                    className="ml-auto shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                    aria-label="Delete relationship"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No relationships yet. Add relationships to see them in the Connections graph.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Person Picker Grid (avatar-based selector) ──────────────────────────────

// ─── Person Groups ────────────────────────────────────────────────────────────

function PersonGroupsSection() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupColor, setEditGroupColor] = useState('#3b82f6');

  const { data: people } = useQuery({
    queryKey: ['persons'],
    queryFn: async () => {
      const res = await fetch('/api/persons');
      return res.json() as Promise<Array<{ id: string | null; name: string | null; avatarUrl: string | null; entityType?: string; source: string }>>;
    },
  });

  const dbPeople = (people ?? []).filter((p) => p.source === 'record' && p.id);

  const { data: groups, isLoading } = useQuery({
    queryKey: ['person-groups'],
    queryFn: async () => {
      const res = await fetch('/api/person-groups');
      return res.json() as Promise<Array<{
        id: string;
        name: string;
        color: string | null;
        members: Array<{
          id: string;
          role: string | null;
          person: { id: string; name: string | null; avatarUrl: string | null; entityType: string };
        }>;
      }>>;
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/person-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-groups'] });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      setNewName('');
      setShowCreate(false);
      toast.success('Group created');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateGroupMut = useMutation({
    mutationFn: async ({ id, name, color }: { id: string; name: string; color: string }) => {
      const res = await fetch(`/api/person-groups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-groups'] });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      setEditingGroupId(null);
      toast.success('Group updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/person-groups/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-groups'] });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      toast.success('Group deleted');
    },
  });

  const addMemberMut = useMutation({
    mutationFn: async ({ groupId, personId, role }: { groupId: string; personId: string; role?: string }) => {
      const res = await fetch(`/api/person-groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId, role }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-groups'] });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMemberMut = useMutation({
    mutationFn: async ({ groupId, personId }: { groupId: string; personId: string }) => {
      await fetch(`/api/person-groups/${groupId}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-groups'] });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });

  return (
    <section className="mt-10">
      <SectionHeader
        icon={Users}
        title="Groups"
        description="Organize people into named groups (families, teams, friend circles). Groups are shown as visual clusters on the Connections graph."
      />

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {groups?.length ?? 0} {(groups?.length ?? 0) === 1 ? 'group' : 'groups'}
        </p>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Create group
        </button>
      </div>

      {showCreate && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-card p-3">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="h-8 w-8 shrink-0 cursor-pointer rounded border border-border"
            title="Group color"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Group name (e.g. Marshall Family)"
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) createMut.mutate();
              if (e.key === 'Escape') setShowCreate(false);
            }}
          />
          <button
            type="button"
            onClick={() => newName.trim() && createMut.mutate()}
            disabled={!newName.trim() || createMut.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => { setShowCreate(false); setNewName(''); }}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="mt-4 text-sm text-muted-foreground">Loading...</div>
      ) : (
        <div className="mt-4 space-y-3">
          {groups && groups.length > 0 ? groups.map((group) => {
            const memberIds = new Set(group.members.map((m) => m.person.id));
            const availablePeople = dbPeople.filter((p) => p.id && !memberIds.has(p.id));

            return (
              <div key={group.id} className="rounded-lg border border-border">
                {/* Group header */}
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  {editingGroupId === group.id ? (
                    <>
                      <input
                        type="color"
                        value={editGroupColor}
                        onChange={(e) => setEditGroupColor(e.target.value)}
                        className="h-7 w-7 shrink-0 cursor-pointer rounded border border-border p-0"
                      />
                      <input
                        value={editGroupName}
                        onChange={(e) => setEditGroupName(e.target.value)}
                        className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editGroupName.trim()) updateGroupMut.mutate({ id: group.id, name: editGroupName.trim(), color: editGroupColor });
                          if (e.key === 'Escape') setEditingGroupId(null);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => editGroupName.trim() && updateGroupMut.mutate({ id: group.id, name: editGroupName.trim(), color: editGroupColor })}
                        disabled={updateGroupMut.isPending || !editGroupName.trim()}
                        className="text-xs text-primary hover:underline disabled:opacity-50"
                      >
                        {updateGroupMut.isPending ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingGroupId(null)}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: group.color ?? '#6b7280' }} />
                      <h4 className="flex-1 text-sm font-semibold">{group.name}</h4>
                      <span className="text-[10px] text-muted-foreground">{group.members.length} members</span>
                      <button
                        type="button"
                        onClick={() => { setEditingGroupId(group.id); setEditGroupName(group.name); setEditGroupColor(group.color ?? '#6b7280'); }}
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label="Edit group"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (confirm(`Delete group "${group.name}"?`)) deleteMut.mutate(group.id); }}
                        className="rounded-md p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                        aria-label="Delete group"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>

                {/* Members */}
                <div className="p-3">
                  <div className="flex flex-wrap gap-2">
                    {group.members.map((m) => {
                      const isPet = m.person.entityType === 'PET';
                      return (
                        <div key={m.id} className="group flex items-center gap-1.5 rounded-full border border-border bg-card pl-1 pr-2 py-0.5">
                          {m.person.avatarUrl ? (
                            <img src={m.person.avatarUrl} alt="" className={cn('h-5 w-5 object-cover', isPet ? 'rounded-md' : 'rounded-full')} />
                          ) : (
                            <div className={cn('flex h-5 w-5 items-center justify-center', isPet ? 'rounded-md bg-amber-500/10' : 'rounded-full bg-muted')}>
                              {isPet ? <PawPrint className="h-2.5 w-2.5 text-amber-500" /> : <Users className="h-2.5 w-2.5 text-muted-foreground" />}
                            </div>
                          )}
                          <span className="text-xs">{m.person.name}</span>
                          {m.role && <span className="text-[9px] text-muted-foreground">({m.role})</span>}
                          <button
                            type="button"
                            onClick={() => removeMemberMut.mutate({ groupId: group.id, personId: m.person.id })}
                            className="opacity-0 group-hover:opacity-100 rounded-full p-0.5 text-muted-foreground hover:text-destructive transition-opacity"
                            aria-label={`Remove ${m.person.name}`}
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      );
                    })}

                    {/* Add member dropdown */}
                    {availablePeople.length > 0 && (
                      <PersonAddDropdown
                        people={availablePeople}
                        onAdd={(personId) => addMemberMut.mutate({ groupId: group.id, personId })}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          }) : (
            <div className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No groups yet. Create a group to organize people into families, teams, or circles.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Small "+" button that opens a searchable person dropdown for adding group members. */
function PersonAddDropdown({
  people,
  onAdd,
}: {
  people: Array<{ id: string | null; name: string | null; avatarUrl: string | null; entityType?: string }>;
  onAdd: (personId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = people.filter((p) => p.id && (!search || p.name?.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(''); }}
        className="flex h-7 items-center gap-1 rounded-full border border-dashed border-border px-2 text-[11px] text-muted-foreground hover:border-primary/30 hover:text-foreground transition"
      >
        <Plus className="h-3 w-3" /> Add
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-border bg-popover shadow-xl">
          <div className="p-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
            />
          </div>
          <div className="max-h-40 overflow-y-auto px-1 pb-1">
            {filtered.slice(0, 30).map((p) => {
              if (!p.id) return null;
              const isPet = p.entityType === 'PET';
              return (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); onAdd(p.id!); setOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-accent"
                >
                  {p.avatarUrl ? (
                    <img src={p.avatarUrl} alt="" className={cn('h-5 w-5 object-cover', isPet ? 'rounded-md' : 'rounded-full')} />
                  ) : (
                    <div className={cn('flex h-5 w-5 items-center justify-center', isPet ? 'rounded-md bg-amber-500/10' : 'rounded-full bg-muted')}>
                      {isPet ? <PawPrint className="h-2.5 w-2.5 text-amber-500" /> : <Users className="h-2.5 w-2.5 text-muted-foreground" />}
                    </div>
                  )}
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-2 py-2 text-center text-[11px] text-muted-foreground">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Search Analytics ─────────────────────────────────────────────────────────

function SearchAnalyticsSection() {
  const queryClient = useQueryClient();

  const clearMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/search-analytics', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'search-analytics'] });
      toast.success(`Cleared ${data.deleted} search log entries`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'search-analytics'],
    queryFn: async () => {
      const res = await fetch('/api/admin/search-analytics');
      if (!res.ok) throw new Error('Failed to load analytics');
      return res.json() as Promise<{
        topQueries: Array<{ query: string; count: number; avgResults: number }>;
        zeroResultQueries: Array<{ query: string; count: number; lastSearched: string }>;
        perUserCounts: Array<{ userId: string; displayName: string; username: string; count: number }>;
        stats: { totalSearches: number; searchesToday: number; avgDurationMs: number };
        recentLogs: Array<{
          id: string; query: string; filters: Record<string, unknown>;
          resultCount: number; durationMs: number; createdAt: string;
          user: { id: string; username: string; displayName: string };
        }>;
      }>;
    },
  });

  return (
    <section>
      <div className="flex items-start justify-between">
        <SectionHeader icon={Search} title="Search Analytics" description="View search activity, popular queries, and zero-result queries across all users." />
        {data && data.stats.totalSearches > 0 && (
          <button
            type="button"
            onClick={() => {
              if (confirm('Clear all search log entries? This cannot be undone.')) {
                clearMut.mutate();
              }
            }}
            disabled={clearMut.isPending}
            className="shrink-0 rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {clearMut.isPending ? 'Clearing...' : 'Clear all logs'}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="mt-4 text-sm text-muted-foreground">Loading analytics...</div>
      ) : data ? (
        <div className="mt-4 space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Total searches</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{data.stats.totalSearches.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Today</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{data.stats.searchesToday.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Avg response</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{data.stats.avgDurationMs}ms</p>
            </div>
          </div>

          {/* Top queries */}
          <div>
            <h3 className="text-sm font-medium">Top queries (7 days)</h3>
            <div className="mt-2 rounded-lg border border-border">
              {data.topQueries.length > 0 ? (
                <div className="divide-y divide-border">
                  {data.topQueries.map((q) => (
                    <div key={q.query} className="flex items-center justify-between px-4 py-2">
                      <span className="text-sm font-mono">{q.query}</span>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span>{q.count} searches</span>
                        <span>{q.avgResults} avg results</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-3 text-sm text-muted-foreground">No searches yet.</p>
              )}
            </div>
          </div>

          {/* Zero-result queries */}
          {data.zeroResultQueries.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-amber-600">Zero-result queries</h3>
              <p className="text-[11px] text-muted-foreground">Users searched for these but got no results — consider adding content or tags.</p>
              <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5">
                <div className="divide-y divide-amber-500/20">
                  {data.zeroResultQueries.map((q) => (
                    <div key={q.query} className="flex items-center justify-between px-4 py-2">
                      <span className="text-sm font-mono">{q.query}</span>
                      <span className="text-[11px] text-muted-foreground">{q.count}x</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Per-user counts */}
          <div>
            <h3 className="text-sm font-medium">Searches by user (7 days)</h3>
            <div className="mt-2 rounded-lg border border-border">
              {data.perUserCounts.length > 0 ? (
                <div className="divide-y divide-border">
                  {data.perUserCounts.map((u) => (
                    <div key={u.userId} className="flex items-center justify-between px-4 py-2">
                      <div>
                        <span className="text-sm font-medium">{u.displayName}</span>
                        <span className="ml-2 text-[11px] text-muted-foreground">@{u.username}</span>
                      </div>
                      <span className="text-sm tabular-nums text-muted-foreground">{u.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-3 text-sm text-muted-foreground">No user search data yet.</p>
              )}
            </div>
          </div>

          {/* Recent logs */}
          <div>
            <h3 className="text-sm font-medium">Recent searches</h3>
            <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-border">
              {data.recentLogs.length > 0 ? (
                <div className="divide-y divide-border">
                  {data.recentLogs.map((log) => (
                    <div key={log.id} className="px-4 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-mono">{log.query || '(filter only)'}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {log.resultCount} results in {log.durationMs}ms
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{log.user.displayName}</span>
                        <span>{new Date(log.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-3 text-sm text-muted-foreground">No search logs yet.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AboutSection() {
  return (
    <section>
      <SectionHeader icon={Shield} title="About" description="Harbor — Open-source archive and media intelligence" />
      <div className="mt-4 rounded-lg border border-border p-4">
        <p className="text-sm">Version 0.1.0</p>
        <p className="mt-1 text-xs text-muted-foreground">Licensed under open source. See LICENSE for details.</p>
      </div>
    </section>
  );
}
