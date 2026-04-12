import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

const DOWNWARD_TYPES = new Set(['parent', 'grandparent', 'owner', 'aunt/uncle', 'manager']);
const SAME_RANK_TYPES = new Set(['spouse', 'partner', 'sibling', 'friend', 'cousin', 'colleague']);

const NODE_W = 160;
const NODE_H = 120;
const PAD_X = 60; // minimum horizontal gap between node centers
const PAD_Y = 40; // minimum vertical gap

/**
 * Semantic relationship-aware layout.
 *
 * 1. Build a dagre graph with edges directed so parents sit above
 *    children. Same-rank types (spouse, sibling) get minlen=0.
 * 2. Run dagre for initial positions.
 * 3. Align same-rank pairs to the same Y (TB) or X (LR).
 * 4. Resolve ALL overlaps with a simple iterative push-apart pass.
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB',
): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };

  // ── Step 1: dagre layout ──────────────────────────────────────
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep: 160,
    nodesep: 120,
    marginx: 60,
    marginy: 60,
  });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_W, height: NODE_H });
  }

  const sameRankPairs: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    const key = [edge.source, edge.target].sort().join(':');
    if (seen.has(key)) continue;
    seen.add(key);

    const rel = (edge.data as { relationType?: string })?.relationType ?? '';

    if (SAME_RANK_TYPES.has(rel)) {
      sameRankPairs.push([edge.source, edge.target]);
      g.setEdge(edge.source, edge.target, { minlen: 0, weight: 2 });
    } else if (DOWNWARD_TYPES.has(rel)) {
      g.setEdge(edge.source, edge.target, { minlen: 1, weight: 1 });
    } else {
      g.setEdge(edge.target, edge.source, { minlen: 1, weight: 1 });
    }
  }

  dagre.layout(g);

  const pos = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const p = g.node(node.id);
    if (p) pos.set(node.id, { x: p.x, y: p.y });
  }

  // ── Step 2: align same-rank pairs ─────────────────────────────
  for (const [a, b] of sameRankPairs) {
    const pa = pos.get(a);
    const pb = pos.get(b);
    if (!pa || !pb) continue;

    if (direction === 'TB') {
      const y = Math.min(pa.y, pb.y);
      pa.y = y;
      pb.y = y;
    } else {
      const x = Math.min(pa.x, pb.x);
      pa.x = x;
      pb.x = x;
    }
  }

  // ── Step 3: resolve overlaps ──────────────────────────────────
  // Simple iterative separation: for every pair of nodes that
  // overlap, push them apart along the axis where they're closest.
  // Run a few passes since pushing apart can cause new overlaps.
  const ids = nodes.map((n) => n.id);
  const minDx = NODE_W + PAD_X;
  const minDy = NODE_H + PAD_Y;

  for (let pass = 0; pass < 10; pass++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pi = pos.get(ids[i])!;
        const pj = pos.get(ids[j])!;
        const dx = Math.abs(pi.x - pj.x);
        const dy = Math.abs(pi.y - pj.y);

        // Only fix if they actually overlap (both axes within threshold)
        if (dx < minDx && dy < minDy) {
          // Push apart on the axis with the smaller overlap
          if (dx < dy || (direction === 'TB' && Math.abs(pi.y - pj.y) < 5)) {
            // Push horizontally
            const overlap = minDx - dx;
            const half = overlap / 2 + 1;
            if (pi.x <= pj.x) {
              pi.x -= half;
              pj.x += half;
            } else {
              pi.x += half;
              pj.x -= half;
            }
          } else {
            // Push vertically
            const overlap = minDy - dy;
            const half = overlap / 2 + 1;
            if (pi.y <= pj.y) {
              pi.y -= half;
              pj.y += half;
            } else {
              pi.y += half;
              pj.y -= half;
            }
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  // ── Step 4: convert to React Flow positions ───────────────────
  const layoutedNodes = nodes.map((node) => {
    const p = pos.get(node.id) ?? { x: 0, y: 0 };
    return {
      ...node,
      position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
    };
  });

  return { nodes: layoutedNodes, edges };
}
