import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { db } from '@harbor/database';

const server = new McpServer({
  name: 'harbor-devtools',
  version: '0.1.0',
});

// Tool: List archive roots
server.tool(
  'list-archive-roots',
  'List all configured archive roots with their provider type and capabilities',
  {},
  async () => {
    const roots = await db.archiveRoot.findMany({ orderBy: { name: 'asc' } });
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(roots.map(r => ({
          id: r.id,
          name: r.name,
          providerType: r.providerType,
          rootPath: r.rootPath,
          isActive: r.isActive,
          isPrivate: r.isPrivate,
          capabilities: r.capabilities,
        })), null, 2),
      }],
    };
  },
);

// Tool: Get indexing status
server.tool(
  'indexing-status',
  'Show the status of background indexing and preview jobs',
  {},
  async () => {
    const jobs = await db.backgroundJob.findMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      orderBy: { createdAt: 'asc' },
    });
    const recentCompleted = await db.backgroundJob.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      take: 10,
    });
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ active: jobs, recentCompleted }, null, 2),
      }],
    };
  },
);

// Tool: AI usage summary
server.tool(
  'ai-usage-summary',
  'Show AI provider usage, costs, and job statistics',
  {},
  async () => {
    const jobs = await db.aiJob.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const totalCost = jobs.reduce((sum, j) => sum + (j.estimatedCost ?? 0), 0);
    const totalTokens = jobs.reduce((sum, j) => sum + (j.inputTokens ?? 0) + (j.outputTokens ?? 0), 0);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          totalJobs: jobs.length,
          totalCost: `$${totalCost.toFixed(4)}`,
          totalTokens,
          recentJobs: jobs.slice(0, 10).map(j => ({
            id: j.id,
            provider: j.provider,
            model: j.model,
            purpose: j.purpose,
            status: j.status,
            cost: j.estimatedCost,
            elapsedMs: j.elapsedMs,
          })),
        }, null, 2),
      }],
    };
  },
);

// Tool: Database stats
server.tool(
  'database-stats',
  'Show counts of files, folders, tags, relations, and users',
  {},
  async () => {
    const [fileCount, folderCount, tagCount, relationCount, userCount] = await Promise.all([
      db.file.count(),
      db.folder.count(),
      db.tag.count(),
      db.entityRelation.count(),
      db.user.count(),
    ]);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ files: fileCount, folders: folderCount, tags: tagCount, relations: relationCount, users: userCount }, null, 2),
      }],
    };
  },
);

// Tool: Recent audit log
server.tool(
  'recent-audit-log',
  'Show recent audit log entries for monitoring changes',
  { limit: z.number().optional().default(20).describe('Number of entries to return') },
  async ({ limit }) => {
    const logs = await db.auditLog.findMany({
      include: { user: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(logs.map(l => ({
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId,
          user: l.user?.displayName ?? 'system',
          createdAt: l.createdAt,
        })), null, 2),
      }],
    };
  },
);

// Tool: Check relation integrity
server.tool(
  'check-relation-integrity',
  'Verify entity relations point to existing files/folders',
  {},
  async () => {
    const relations = await db.entityRelation.findMany();
    const issues: string[] = [];

    for (const rel of relations) {
      if (rel.sourceType === 'FILE') {
        const exists = await db.file.findUnique({ where: { id: rel.sourceId } });
        if (!exists) issues.push(`Relation ${rel.id}: source FILE ${rel.sourceId} not found`);
      } else {
        const exists = await db.folder.findUnique({ where: { id: rel.sourceId } });
        if (!exists) issues.push(`Relation ${rel.id}: source FOLDER ${rel.sourceId} not found`);
      }

      if (rel.targetType === 'FILE') {
        const exists = await db.file.findUnique({ where: { id: rel.targetId } });
        if (!exists) issues.push(`Relation ${rel.id}: target FILE ${rel.targetId} not found`);
      } else {
        const exists = await db.folder.findUnique({ where: { id: rel.targetId } });
        if (!exists) issues.push(`Relation ${rel.id}: target FOLDER ${rel.targetId} not found`);
      }
    }

    return {
      content: [{
        type: 'text' as const,
        text: issues.length === 0
          ? `All ${relations.length} relations are valid.`
          : `Found ${issues.length} issues:\n${issues.join('\n')}`,
      }],
    };
  },
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Harbor DevTools MCP server running on stdio');
}

main().catch(console.error);
