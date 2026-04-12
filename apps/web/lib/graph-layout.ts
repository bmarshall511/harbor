import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

/**
 * Relationship types that flow downward (parent → child direction).
 * Dagre edges go from source to target, and dagre places sources
 * above targets in TB mode. So "parent → child" means the parent
 * node is source and the child is target.
 */
const DOWNWARD_TYPES = new Set(['parent', 'grandparent', 'owner', 'aunt/uncle', 'manager']);

/** Relationship types where both people should be on the same rank. */
const SAME_RANK_TYPES = new Set([
  'spouse', 'partner', 'sibling', 'friend', 'cousin', 'colleague',
]);

/**
 * Compute semantically-aware layouted positions for a people graph.
 *
 * Unlike a generic dagre layout, this understands relationship types:
 *   - Parents appear above children
 *   - Spouses/partners appear side by side (same rank)
 *   - Siblings appear on the same level
 *   - Pets appear at the same level as children
 *   - Grandparents appear above parents
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB',
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep: 120,
    nodesep: 80,
    marginx: 50,
    marginy: 50,
  });

  const nodeWidth = 180;
  const nodeHeight = 110;

  for (const node of nodes) {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  }

  // Track same-rank pairs for dagre constraints
  const sameRankPairs: Array<[string, string]> = [];

  // Add edges with semantic direction awareness.
  // For each relationship, determine which direction the dagre edge
  // should flow so that the visual hierarchy makes sense.
  const seen = new Set<string>();
  for (const edge of edges) {
    const key = [edge.source, edge.target].sort().join('→');
    if (seen.has(key)) continue;
    seen.add(key);

    const relationType = (edge.data as { relationType?: string })?.relationType ?? '';

    if (SAME_RANK_TYPES.has(relationType)) {
      // Same-rank relationships: add a non-directional edge
      // and record the pair for rank constraint.
      sameRankPairs.push([edge.source, edge.target]);
      // Still add an edge so dagre knows they're connected,
      // but with minlen 0 to keep them on the same level.
      g.setEdge(edge.source, edge.target, { minlen: 0 });
    } else if (DOWNWARD_TYPES.has(relationType)) {
      // Parent-like: source (the parent) above target (the child)
      g.setEdge(edge.source, edge.target, { minlen: 1 });
    } else {
      // Default: child, grandchild, pet_of, niece/nephew, report —
      // these are the "inverse" types where the source should be
      // below the target. Flip the edge direction for dagre.
      g.setEdge(edge.target, edge.source, { minlen: 1 });
    }
  }

  dagre.layout(g);

  // Post-process: enforce same-rank for spouse/sibling/partner pairs.
  // Dagre doesn't have native same-rank constraints, so we manually
  // align Y coordinates (or X in LR mode) for paired nodes.
  const posMap = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const pos = g.node(node.id);
    if (pos) posMap.set(node.id, { x: pos.x, y: pos.y });
  }

  for (const [a, b] of sameRankPairs) {
    const posA = posMap.get(a);
    const posB = posMap.get(b);
    if (!posA || !posB) continue;

    if (direction === 'TB') {
      // Align Y (vertical position) — use the average
      const avgY = (posA.y + posB.y) / 2;
      posA.y = avgY;
      posB.y = avgY;
    } else {
      // LR mode: align X
      const avgX = (posA.x + posB.x) / 2;
      posA.x = avgX;
      posB.x = avgX;
    }
  }

  const layoutedNodes = nodes.map((node) => {
    const pos = posMap.get(node.id) ?? { x: 0, y: 0 };
    return {
      ...node,
      position: {
        x: pos.x - nodeWidth / 2,
        y: pos.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
