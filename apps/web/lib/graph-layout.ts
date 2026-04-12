import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

/** Relationship types where the source is "above" the target. */
const DOWNWARD_TYPES = new Set(['parent', 'grandparent', 'owner', 'aunt/uncle', 'manager']);

/** Relationship types where both people should be on the same rank. */
const SAME_RANK_TYPES = new Set([
  'spouse', 'partner', 'sibling', 'friend', 'cousin', 'colleague',
]);

const NODE_WIDTH = 160;
const NODE_HEIGHT = 120;

/**
 * Compute semantically-aware layout for a people relationship graph.
 *
 * - Parents placed above children
 * - Spouses/partners side by side on the same level
 * - Siblings on the same level
 * - Prevents overlaps by using dagre's ranking with minlen constraints
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB',
): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep: 140,
    nodesep: 100,
    marginx: 60,
    marginy: 60,
    align: 'UL',
  });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // Build edges with semantic direction.
  // For same-rank types, we still need a dagre edge for connectivity,
  // but we use minlen:0 so dagre tries to keep them on the same rank.
  const seen = new Set<string>();
  for (const edge of edges) {
    const key = [edge.source, edge.target].sort().join(':');
    if (seen.has(key)) continue;
    seen.add(key);

    const relationType = (edge.data as { relationType?: string })?.relationType ?? '';

    if (SAME_RANK_TYPES.has(relationType)) {
      // Same rank — minlen 0 tells dagre to try keeping them together
      g.setEdge(edge.source, edge.target, { minlen: 0, weight: 2 });
    } else if (DOWNWARD_TYPES.has(relationType)) {
      // Source (parent) above target (child)
      g.setEdge(edge.source, edge.target, { minlen: 1, weight: 1 });
    } else {
      // Inverse types (child, pet_of, etc.) — flip so dagre puts
      // the "parent-like" node above
      g.setEdge(edge.target, edge.source, { minlen: 1, weight: 1 });
    }
  }

  dagre.layout(g);

  // Collect positions from dagre
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const pos = g.node(node.id);
    if (pos) positions.set(node.id, { x: pos.x, y: pos.y });
  }

  // Post-process: align same-rank pairs on the same Y (TB) or X (LR).
  // Unlike the previous approach that averaged coordinates (causing
  // overlaps), we move the "lower" node up to the "higher" node's
  // level, then spread them horizontally if they're too close.
  for (const edge of edges) {
    const relationType = (edge.data as { relationType?: string })?.relationType ?? '';
    if (!SAME_RANK_TYPES.has(relationType)) continue;

    const posA = positions.get(edge.source);
    const posB = positions.get(edge.target);
    if (!posA || !posB) continue;

    if (direction === 'TB') {
      // Align to the higher (smaller Y) position
      const alignY = Math.min(posA.y, posB.y);
      posA.y = alignY;
      posB.y = alignY;

      // Ensure minimum horizontal spacing
      const minGap = NODE_WIDTH + 40;
      const dx = Math.abs(posA.x - posB.x);
      if (dx < minGap) {
        const mid = (posA.x + posB.x) / 2;
        posA.x = mid - minGap / 2;
        posB.x = mid + minGap / 2;
      }
    } else {
      const alignX = Math.min(posA.x, posB.x);
      posA.x = alignX;
      posB.x = alignX;

      const minGap = NODE_HEIGHT + 40;
      const dy = Math.abs(posA.y - posB.y);
      if (dy < minGap) {
        const mid = (posA.y + posB.y) / 2;
        posA.y = mid - minGap / 2;
        posB.y = mid + minGap / 2;
      }
    }
  }

  const layoutedNodes = nodes.map((node) => {
    const pos = positions.get(node.id) ?? { x: 0, y: 0 };
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
