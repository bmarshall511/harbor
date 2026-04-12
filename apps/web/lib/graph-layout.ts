import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

/**
 * Compute layouted positions for graph nodes using dagre.
 * Returns nodes with updated position.x and position.y.
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
    ranksep: 100,
    nodesep: 60,
    marginx: 40,
    marginy: 40,
  });

  for (const node of nodes) {
    g.setNode(node.id, { width: 180, height: 100 });
  }

  // For bidirectional edges, only add one direction to dagre
  // to avoid layout conflicts.
  const seen = new Set<string>();
  for (const edge of edges) {
    const key = [edge.source, edge.target].sort().join('→');
    if (seen.has(key)) continue;
    seen.add(key);
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - 90, y: pos.y - 50 },
    };
  });

  return { nodes: layoutedNodes, edges };
}
