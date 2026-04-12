'use client';

/**
 * Connections graph — interactive relationship visualization using
 * @xyflow/react with dagre for hierarchical layout.
 *
 * Custom nodes show person/pet avatars with relationship counts.
 * Custom edges show relationship types with color coding.
 * Supports zoom, pan, minimap, layout toggle, and keyboard nav.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  Handle,
  Position,
  getBezierPath,
  BaseEdge,
  EdgeLabelRenderer,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion } from 'framer-motion';
import { PawPrint, User, Network, TreePine, Shuffle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { getLayoutedElements } from '@/lib/graph-layout';
import { useRouter } from 'next/navigation';

// ─── Types ───────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  entityType: string;
  gender: string | null;
  faceCount: number;
  relationshipCount: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationType: string;
  label: string | null;
  isBidirectional: boolean;
}

interface ConnectionsGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ─── Edge color mapping ──────────────────────────────────────────────────────

const EDGE_COLORS: Record<string, string> = {
  parent: '#d97706',
  child: '#d97706',
  sibling: '#ea580c',
  grandparent: '#b45309',
  grandchild: '#b45309',
  'aunt/uncle': '#c2410c',
  'niece/nephew': '#c2410c',
  cousin: '#e07838',
  spouse: '#e11d48',
  partner: '#f43f5e',
  friend: '#3b82f6',
  colleague: '#6b7280',
  manager: '#6b7280',
  owner: '#f59e0b',
  pet_of: '#f59e0b',
};

function getEdgeColor(relationType: string): string {
  return EDGE_COLORS[relationType.toLowerCase()] ?? '#94a3b8';
}

// ─── Custom Person Node ──────────────────────────────────────────────────────

type PersonNodeData = {
  name: string;
  avatarUrl: string | null;
  entityType: string;
  gender: string | null;
  relationshipCount: number;
};

/** Border/accent color based on gender. */
function genderColor(gender: string | null): { border: string; bg: string; text: string } {
  switch (gender) {
    case 'MALE': return { border: 'border-blue-400/60', bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-500' };
    case 'FEMALE': return { border: 'border-pink-400/60', bg: 'bg-pink-50 dark:bg-pink-950/30', text: 'text-pink-500' };
    case 'OTHER': return { border: 'border-purple-400/60', bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-500' };
    default: return { border: 'border-border', bg: 'bg-card', text: 'text-muted-foreground' };
  }
}

function PersonNode({ data, selected }: NodeProps<Node<PersonNodeData>>) {
  const router = useRouter();
  const isPet = data.entityType === 'PET';
  const gc = isPet
    ? { border: 'border-amber-400/60', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-500' }
    : genderColor(data.gender);
  const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const handleClick = useCallback(() => {
    if (data.name) {
      router.push(`/search?mf_people=${encodeURIComponent(data.name)}`);
    }
  }, [data.name, router]);

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      onClick={handleClick}
      className={cn(
        'group relative flex flex-col items-center gap-2 cursor-pointer',
        'transition-all duration-200',
      )}
      title={`View ${data.name}'s files`}
    >
      {/* Avatar with gender-colored border */}
      <div className={cn(
        'relative flex items-center justify-center overflow-hidden transition-all duration-200',
        'shadow-md group-hover:shadow-xl group-hover:scale-105',
        isPet ? 'h-16 w-16 rounded-2xl' : 'h-16 w-16 rounded-full',
        'border-[3px]',
        gc.border,
        gc.bg,
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}>
        {data.avatarUrl ? (
          <img
            src={data.avatarUrl}
            alt={data.name ?? ''}
            className={cn('h-full w-full object-cover', isPet ? 'rounded-2xl' : 'rounded-full')}
          />
        ) : isPet ? (
          <PawPrint className={cn('h-6 w-6', gc.text)} />
        ) : (
          <User className={cn('h-6 w-6', gc.text)} />
        )}

        {/* Pet badge */}
        {isPet && data.avatarUrl && (
          <div className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 shadow-sm">
            <PawPrint className="h-2.5 w-2.5 text-white" />
          </div>
        )}

        {/* Relationship count badge */}
        {data.relationshipCount > 0 && (
          <div className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground shadow-sm">
            {data.relationshipCount}
          </div>
        )}
      </div>

      {/* Name */}
      <span className={cn(
        'max-w-[130px] truncate text-center text-xs font-medium',
        'text-foreground group-hover:text-primary transition-colors',
      )}>
        {data.name}
      </span>

      {/* Handles (invisible, for edge connections) */}
      <Handle type="target" position={Position.Top} className="!w-0 !h-0 !border-0 !bg-transparent" />
      <Handle type="source" position={Position.Bottom} className="!w-0 !h-0 !border-0 !bg-transparent" />
      <Handle type="target" position={Position.Left} className="!w-0 !h-0 !border-0 !bg-transparent" />
      <Handle type="source" position={Position.Right} className="!w-0 !h-0 !border-0 !bg-transparent" />
    </motion.div>
  );
}

// ─── Custom Relationship Edge ────────────────────────────────────────────────

function RelationshipEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const edgeData = data as { relationType: string; label: string | null; isBidirectional: boolean } | undefined;
  const relationType = edgeData?.relationType ?? '';
  const displayLabel = edgeData?.label ?? relationType.replace(/_/g, ' ');
  const color = getEdgeColor(relationType);
  const isSameRank = ['spouse', 'partner', 'sibling', 'friend', 'cousin', 'colleague'].includes(relationType);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: isSameRank ? '6 3' : undefined,
          opacity: selected ? 1 : 0.6,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={cn(
            'absolute pointer-events-none px-2 py-0.5 rounded-full text-[9px] font-medium',
            'bg-background/90 border border-border/50 backdrop-blur-sm',
            'transition-opacity',
            selected ? 'opacity-100' : 'opacity-70',
          )}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            color,
          }}
        >
          {edgeData?.isBidirectional && '↔ '}
          {displayLabel}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

// ─── Node types registry ─────────────────────────────────────────────────────

const nodeTypes = { person: PersonNode };
const edgeTypes = { relationship: RelationshipEdge };

// ─── Main Graph Component ────────────────────────────────────────────────────

export default function ConnectionsGraph({ nodes: graphNodes, edges: graphEdges }: ConnectionsGraphProps) {
  const [layout, setLayout] = useState<'TB' | 'LR'>('TB');

  // Convert graph data to React Flow nodes/edges
  const { initialNodes, initialEdges } = useMemo(() => {
    const rfNodes: Node<PersonNodeData>[] = graphNodes.map((n) => ({
      id: n.id,
      type: 'person',
      position: { x: 0, y: 0 },
      data: {
        name: n.name ?? 'Unknown',
        avatarUrl: n.avatarUrl,
        entityType: n.entityType,
        gender: n.gender,
        relationshipCount: n.relationshipCount,
      },
    }));

    const rfEdges: Edge[] = graphEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'relationship',
      data: {
        relationType: e.relationType,
        label: e.label,
        isBidirectional: e.isBidirectional,
      },
    }));

    const layouted = getLayoutedElements(rfNodes, rfEdges, layout);
    return { initialNodes: layouted.nodes, initialEdges: layouted.edges };
  }, [graphNodes, graphEdges, layout]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Re-layout when data or layout direction changes
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={2}
        attributionPosition="bottom-left"
        className="group"
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
        <Controls
          showInteractive={false}
          className="!border-border !bg-card !shadow-lg [&>button]:!border-border [&>button]:!bg-card [&>button]:hover:!bg-accent [&>button]:!text-foreground"
        />
        <MiniMap
          className="!border-border !bg-card/80 !shadow-lg hidden md:block"
          maskColor="var(--background)"
          nodeColor={(n) => {
            const d = n.data as PersonNodeData | undefined;
            if (d?.entityType === 'PET') return '#f59e0b';
            if (d?.gender === 'MALE') return '#3b82f6';
            if (d?.gender === 'FEMALE') return '#ec4899';
            if (d?.gender === 'OTHER') return '#a855f7';
            return 'var(--primary)';
          }}
        />
      </ReactFlow>

      {/* Layout toggle */}
      <div className="absolute top-3 right-3 flex items-center gap-1 rounded-lg border border-border bg-card/90 p-1 shadow-lg backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setLayout('TB')}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors',
            layout === 'TB' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
          )}
          title="Hierarchical layout"
        >
          <TreePine className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Tree</span>
        </button>
        <button
          type="button"
          onClick={() => setLayout('LR')}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors',
            layout === 'LR' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
          )}
          title="Horizontal layout"
        >
          <Shuffle className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Horizontal</span>
        </button>
      </div>
    </div>
  );
}
