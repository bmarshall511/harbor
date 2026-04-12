import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/**
 * GET /api/person-relationships/suggestions
 *
 * Analyzes the existing relationship graph and identifies missing
 * connections that should logically exist. Returns suggestions grouped
 * by inference rule.
 *
 * Rules checked:
 *   1. Missing siblings: A is parent of X and Y, but X↔Y not siblings
 *   2. Missing grandparents: A is parent of B, B is parent of C,
 *      but A↔C not grandparent/grandchild
 *   3. Missing aunt/uncle: A is sibling of B, B is parent of C,
 *      but A↔C not aunt/uncle
 *   4. Missing cousins: A is parent of X, B is parent of Y, A↔B
 *      are siblings, but X↔Y not cousins
 *   5. Duplicate relationships: same pair linked twice with same type
 *   6. Missing reciprocals: A→parent→B exists but B→child→A doesn't
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'settings.people', 'access');
  if (denied) return denied;

  const [allPersons, allRels] = await Promise.all([
    db.person.findMany({ select: { id: true, name: true, entityType: true } }),
    db.personRelationship.findMany({
      select: {
        id: true,
        sourcePersonId: true,
        targetPersonId: true,
        relationType: true,
        reciprocalId: true,
      },
    }),
  ]);

  const nameMap = new Map(allPersons.map((p) => [p.id, p.name ?? 'Unknown']));

  // Build lookup structures
  const relSet = new Set(
    allRels.map((r) => `${r.sourcePersonId}:${r.targetPersonId}:${r.relationType}`),
  );

  function hasRel(a: string, b: string, type: string): boolean {
    return relSet.has(`${a}:${b}:${type}`) || relSet.has(`${b}:${a}:${type}`);
  }

  function getTargets(sourceId: string, type: string): string[] {
    return allRels
      .filter((r) => r.sourcePersonId === sourceId && r.relationType === type)
      .map((r) => r.targetPersonId);
  }

  type Suggestion = {
    sourcePersonId: string;
    sourceName: string;
    targetPersonId: string;
    targetName: string;
    relationType: string;
    rule: string;
    reason: string;
  };

  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();

  function addSuggestion(a: string, b: string, type: string, rule: string, reason: string) {
    if (a === b) return;
    const SYMMETRIC = new Set(['sibling', 'cousin', 'spouse', 'partner', 'friend']);
    const key = SYMMETRIC.has(type)
      ? [a, b].sort().join(':') + ':' + type
      : `${a}:${b}:${type}`;
    if (seen.has(key)) return;
    if (hasRel(a, b, type)) return;
    seen.add(key);
    suggestions.push({
      sourcePersonId: a,
      sourceName: nameMap.get(a) ?? 'Unknown',
      targetPersonId: b,
      targetName: nameMap.get(b) ?? 'Unknown',
      relationType: type,
      rule,
      reason,
    });
  }

  // ── Rule 1: Missing siblings ──────────────────────────────────
  // If A is parent of both X and Y, then X and Y should be siblings
  const parentOf = new Map<string, string[]>();
  for (const r of allRels) {
    if (r.relationType === 'parent') {
      if (!parentOf.has(r.sourcePersonId)) parentOf.set(r.sourcePersonId, []);
      parentOf.get(r.sourcePersonId)!.push(r.targetPersonId);
    }
  }

  for (const [parentId, children] of parentOf) {
    if (children.length < 2) continue;
    const parentName = nameMap.get(parentId) ?? 'Unknown';
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        addSuggestion(
          children[i]!, children[j]!, 'sibling',
          'Missing sibling',
          `Both are children of ${parentName}`,
        );
      }
    }
  }

  // ── Rule 2: Missing grandparents ──────────────────────────────
  // If A is parent of B, and B is parent of C, then A is grandparent of C
  for (const [grandparentId, parentIds] of parentOf) {
    for (const parentId of parentIds) {
      const grandchildren = parentOf.get(parentId) ?? [];
      const gpName = nameMap.get(grandparentId) ?? 'Unknown';
      const parentName = nameMap.get(parentId) ?? 'Unknown';
      for (const gcId of grandchildren) {
        addSuggestion(
          grandparentId, gcId, 'grandparent',
          'Missing grandparent',
          `${gpName} is parent of ${parentName}, who is parent of ${nameMap.get(gcId) ?? 'Unknown'}`,
        );
      }
    }
  }

  // ── Rule 3: Missing aunt/uncle ────────────────────────────────
  // If A is sibling of B, and B is parent of C, then A is aunt/uncle of C
  for (const r of allRels) {
    if (r.relationType !== 'sibling') continue;
    const siblingId = r.sourcePersonId;
    const otherId = r.targetPersonId;
    const siblingChildren = parentOf.get(otherId) ?? [];
    const sibName = nameMap.get(siblingId) ?? 'Unknown';
    const otherName = nameMap.get(otherId) ?? 'Unknown';
    for (const childId of siblingChildren) {
      addSuggestion(
        siblingId, childId, 'aunt/uncle',
        'Missing aunt/uncle',
        `${sibName} is sibling of ${otherName}, who is parent of ${nameMap.get(childId) ?? 'Unknown'}`,
      );
    }
  }

  // ── Rule 4: Missing cousins ───────────────────────────────────
  // If A and B are siblings, and A is parent of X, B is parent of Y,
  // then X and Y are cousins
  for (const r of allRels) {
    if (r.relationType !== 'sibling') continue;
    const aChildren = parentOf.get(r.sourcePersonId) ?? [];
    const bChildren = parentOf.get(r.targetPersonId) ?? [];
    if (aChildren.length === 0 || bChildren.length === 0) continue;
    for (const x of aChildren) {
      for (const y of bChildren) {
        addSuggestion(
          x, y, 'cousin',
          'Missing cousin',
          `Their parents (${nameMap.get(r.sourcePersonId)} and ${nameMap.get(r.targetPersonId)}) are siblings`,
        );
      }
    }
  }

  // ── Rule 5: Duplicate relationships ───────────────────────────
  const pairCounts = new Map<string, number>();
  const duplicates: Array<{ sourcePersonId: string; targetPersonId: string; relationType: string; count: number }> = [];
  for (const r of allRels) {
    const key = `${r.sourcePersonId}:${r.targetPersonId}:${r.relationType}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of pairCounts) {
    if (count > 1) {
      const [s, t, type] = key.split(':');
      duplicates.push({
        sourcePersonId: s!,
        targetPersonId: t!,
        relationType: type!,
        count,
      });
    }
  }

  // ── Rule 6: Missing reciprocals ───────────────────────────────
  const INVERSE_MAP: Record<string, string> = {
    parent: 'child', child: 'parent',
    grandparent: 'grandchild', grandchild: 'grandparent',
    'aunt/uncle': 'niece/nephew', 'niece/nephew': 'aunt/uncle',
    manager: 'report', report: 'manager',
    owner: 'pet_of', pet_of: 'owner',
  };
  const SYMMETRIC = new Set(['sibling', 'spouse', 'partner', 'friend', 'cousin', 'colleague']);

  const missingReciprocals: Array<{
    sourcePersonId: string; sourceName: string;
    targetPersonId: string; targetName: string;
    relationType: string; expectedInverse: string;
  }> = [];

  for (const r of allRels) {
    if (r.reciprocalId) continue; // Primary record — check if inverse exists
    const inverse = SYMMETRIC.has(r.relationType) ? r.relationType : INVERSE_MAP[r.relationType];
    if (!inverse) continue;
    const hasInverse = relSet.has(`${r.targetPersonId}:${r.sourcePersonId}:${inverse}`);
    if (!hasInverse) {
      missingReciprocals.push({
        sourcePersonId: r.sourcePersonId,
        sourceName: nameMap.get(r.sourcePersonId) ?? 'Unknown',
        targetPersonId: r.targetPersonId,
        targetName: nameMap.get(r.targetPersonId) ?? 'Unknown',
        relationType: r.relationType,
        expectedInverse: inverse,
      });
    }
  }

  // ── Rule 7: Missing group memberships ──────────────────────────
  // If a person is related (parent/child/sibling/spouse) to someone in
  // a group, they probably belong in that group too.
  const allGroupsWithMembers = await db.personGroup.findMany({
    include: { members: { select: { personId: true } } },
  });

  type MissingGroupMembership = {
    personId: string;
    personName: string;
    groupId: string;
    groupName: string;
    groupColor: string | null;
    reason: string;
  };

  const missingGroupMembers: MissingGroupMembership[] = [];
  const seenGroupSuggestions = new Set<string>();
  const FAMILY_TYPES = new Set(['parent', 'child', 'sibling', 'spouse', 'partner', 'grandparent', 'grandchild']);

  for (const group of allGroupsWithMembers) {
    const memberIds = new Set(group.members.map((m) => m.personId));

    // For each member, find people related by family types who aren't in the group
    for (const memberId of memberIds) {
      const rels = allRels.filter(
        (r) => r.sourcePersonId === memberId && FAMILY_TYPES.has(r.relationType),
      );
      for (const rel of rels) {
        if (memberIds.has(rel.targetPersonId)) continue; // Already in group
        const key = `${rel.targetPersonId}:${group.id}`;
        if (seenGroupSuggestions.has(key)) continue;
        seenGroupSuggestions.add(key);

        const memberName = nameMap.get(memberId) ?? 'Unknown';
        const targetName = nameMap.get(rel.targetPersonId) ?? 'Unknown';
        missingGroupMembers.push({
          personId: rel.targetPersonId,
          personName: targetName,
          groupId: group.id,
          groupName: group.name,
          groupColor: group.color,
          reason: `${rel.relationType} of ${memberName} (in ${group.name})`,
        });
      }
    }
  }

  // ── Rule 8: Suggest new family groups ─────────────────────────
  // Find clusters of people connected by parent/child/spouse who
  // don't share any group. Identify by last name if available.
  type SuggestedGroup = {
    suggestedName: string;
    memberIds: string[];
    memberNames: string[];
    reason: string;
  };

  const suggestedNewGroups: SuggestedGroup[] = [];

  // Build family clusters using union-find on family relationships
  const familyParent = new Map<string, string>();
  function find(x: string): string {
    if (!familyParent.has(x)) familyParent.set(x, x);
    if (familyParent.get(x) !== x) familyParent.set(x, find(familyParent.get(x)!));
    return familyParent.get(x)!;
  }
  function union(a: string, b: string) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) familyParent.set(ra, rb);
  }

  for (const r of allRels) {
    if (FAMILY_TYPES.has(r.relationType)) {
      union(r.sourcePersonId, r.targetPersonId);
    }
  }

  // Group people by their cluster root
  const clusters = new Map<string, Set<string>>();
  for (const p of allPersons) {
    if (!familyParent.has(p.id)) continue; // No family relationships
    const root = find(p.id);
    if (!clusters.has(root)) clusters.set(root, new Set());
    clusters.get(root)!.add(p.id);
  }

  // Find clusters with 3+ people that don't already share a group
  const existingGroupSets = allGroupsWithMembers.map((g) => new Set(g.members.map((m) => m.personId)));

  for (const [, memberIds] of clusters) {
    if (memberIds.size < 3) continue;

    // Check if they already share a group
    const membersArr = [...memberIds];
    const alreadyGrouped = existingGroupSets.some((gs) =>
      membersArr.filter((id) => gs.has(id)).length >= Math.min(3, membersArr.length),
    );
    if (alreadyGrouped) continue;

    // Try to determine a family name from last names
    const lastNames = new Map<string, number>();
    for (const id of memberIds) {
      const name = nameMap.get(id);
      if (!name) continue;
      const parts = name.trim().split(' ');
      if (parts.length >= 2) {
        const lastName = parts[parts.length - 1]!;
        lastNames.set(lastName, (lastNames.get(lastName) ?? 0) + 1);
      }
    }

    // Use the most common last name
    let suggestedName = 'Family Group';
    let maxCount = 0;
    for (const [lastName, count] of lastNames) {
      if (count > maxCount) {
        maxCount = count;
        suggestedName = `${lastName} Family`;
      }
    }

    suggestedNewGroups.push({
      suggestedName,
      memberIds: membersArr,
      memberNames: membersArr.map((id) => nameMap.get(id) ?? 'Unknown'),
      reason: `${membersArr.length} people connected by family relationships without a shared group`,
    });
  }

  const totalIssues = suggestions.length + duplicates.length + missingReciprocals.length
    + missingGroupMembers.length + suggestedNewGroups.length;

  return NextResponse.json({
    suggestions,
    duplicates,
    missingReciprocals,
    missingGroupMembers,
    suggestedNewGroups,
    totalIssues,
  });
}
