import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/**
 * POST /api/person-relationships/infer
 *
 * Given a person and their role relative to one or more existing people,
 * compute all the relationships that should be created (including
 * transitive family relationships). Returns the inferred list without
 * creating anything — the client reviews and confirms.
 *
 * Body: {
 *   personId: string,            // The new person
 *   role: 'child' | 'spouse' | 'sibling' | 'parent' | 'pet' | 'friend',
 *   relatedToIds: string[],      // e.g. parent IDs when role='child'
 * }
 *
 * Response: {
 *   relationships: Array<{
 *     sourcePersonId: string,
 *     sourceName: string,
 *     targetPersonId: string,
 *     targetName: string,
 *     relationType: string,
 *     alreadyExists: boolean,
 *     inferred: boolean,          // true = auto-derived, false = explicitly stated
 *   }>,
 *   suggestedGroups: Array<{
 *     groupId: string,
 *     groupName: string,
 *     groupColor: string | null,
 *   }>,
 * }
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const denied = requirePermission(auth, 'settings.people', 'access');
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const { personId, role, relatedToIds } = body as {
    personId?: string;
    role?: string;
    relatedToIds?: string[];
  };

  if (!personId || !role || !Array.isArray(relatedToIds) || relatedToIds.length === 0) {
    return NextResponse.json(
      { error: 'personId, role, and relatedToIds[] are required' },
      { status: 400 },
    );
  }

  // Load all people and existing relationships for inference
  const [allPersons, allRelationships, allGroups] = await Promise.all([
    db.person.findMany({ select: { id: true, name: true } }),
    db.personRelationship.findMany({
      select: {
        sourcePersonId: true,
        targetPersonId: true,
        relationType: true,
      },
    }),
    db.personGroup.findMany({
      include: {
        members: { select: { personId: true } },
      },
    }),
  ]);

  const nameMap = new Map(allPersons.map((p) => [p.id, p.name ?? 'Unknown']));
  const personName = nameMap.get(personId) ?? 'Unknown';

  // Build adjacency for fast lookups
  const relsByPerson = new Map<string, Array<{ targetId: string; type: string }>>();
  for (const r of allRelationships) {
    if (!relsByPerson.has(r.sourcePersonId)) relsByPerson.set(r.sourcePersonId, []);
    relsByPerson.get(r.sourcePersonId)!.push({ targetId: r.targetPersonId, type: r.relationType });
  }

  // Check if a relationship already exists (in either direction)
  const existingSet = new Set(
    allRelationships.map((r) => `${r.sourcePersonId}:${r.targetPersonId}:${r.relationType}`),
  );
  function exists(sourceId: string, targetId: string, type: string): boolean {
    return existingSet.has(`${sourceId}:${targetId}:${type}`);
  }

  // Get relationships of a person by type
  function getRelated(pid: string, type: string): string[] {
    return (relsByPerson.get(pid) ?? [])
      .filter((r) => r.type === type)
      .map((r) => r.targetId);
  }

  // Collect inferred relationships
  type InferredRel = {
    sourcePersonId: string;
    sourceName: string;
    targetPersonId: string;
    targetName: string;
    relationType: string;
    alreadyExists: boolean;
    inferred: boolean;
  };

  const results: InferredRel[] = [];
  const seen = new Set<string>();

  function addRel(sourceId: string, targetId: string, type: string, inferred: boolean) {
    if (sourceId === targetId) return; // No self-relationships
    const key = `${sourceId}:${targetId}:${type}`;
    const reverseKey = `${targetId}:${sourceId}:${type}`;
    // For symmetric types, dedupe both directions
    const SYMMETRIC = new Set(['sibling', 'spouse', 'partner', 'cousin', 'friend', 'colleague']);
    if (SYMMETRIC.has(type) && seen.has(reverseKey)) return;
    if (seen.has(key)) return;
    seen.add(key);

    results.push({
      sourcePersonId: sourceId,
      sourceName: nameMap.get(sourceId) ?? 'Unknown',
      targetPersonId: targetId,
      targetName: nameMap.get(targetId) ?? 'Unknown',
      relationType: type,
      alreadyExists: exists(sourceId, targetId, type) || exists(targetId, sourceId, type),
      inferred,
    });
  }

  // ─── Inference logic per role ────────────────────────────────

  if (role === 'child') {
    // relatedToIds = parent IDs
    const parentIds = relatedToIds;

    // Direct: parent → child
    for (const parentId of parentIds) {
      addRel(parentId, personId, 'parent', false);
    }

    // Siblings: other children of these parents
    const siblingIds = new Set<string>();
    for (const parentId of parentIds) {
      for (const childId of getRelated(parentId, 'parent')) {
        if (childId !== personId) siblingIds.add(childId);
      }
    }
    for (const sibId of siblingIds) {
      addRel(personId, sibId, 'sibling', true);
    }

    // Grandparents: parents of the parents
    for (const parentId of parentIds) {
      const grandparentIds = getRelated(parentId, 'child');
      for (const gpId of grandparentIds) {
        addRel(gpId, personId, 'grandparent', true);
      }
    }

    // Aunts/Uncles: siblings of the parents
    for (const parentId of parentIds) {
      const parentSiblings = getRelated(parentId, 'sibling');
      for (const auId of parentSiblings) {
        addRel(auId, personId, 'aunt/uncle', true);
      }
    }

    // Cousins: children of aunts/uncles
    for (const parentId of parentIds) {
      const parentSiblings = getRelated(parentId, 'sibling');
      for (const auId of parentSiblings) {
        const cousinIds = getRelated(auId, 'parent');
        for (const cousinId of cousinIds) {
          if (cousinId !== personId) {
            addRel(personId, cousinId, 'cousin', true);
          }
        }
      }
    }
  }

  if (role === 'spouse') {
    // relatedToIds = spouse ID(s) (usually one)
    for (const spouseId of relatedToIds) {
      addRel(personId, spouseId, 'spouse', false);
    }
  }

  if (role === 'partner') {
    for (const partnerId of relatedToIds) {
      addRel(personId, partnerId, 'partner', false);
    }
  }

  if (role === 'sibling') {
    // relatedToIds = sibling ID(s)
    for (const sibId of relatedToIds) {
      addRel(personId, sibId, 'sibling', false);
    }

    // Also sibling of their existing siblings
    const allSiblings = new Set<string>();
    for (const sibId of relatedToIds) {
      allSiblings.add(sibId);
      for (const existingSibId of getRelated(sibId, 'sibling')) {
        if (existingSibId !== personId) allSiblings.add(existingSibId);
      }
    }
    for (const sibId of allSiblings) {
      addRel(personId, sibId, 'sibling', sibId === relatedToIds[0] ? false : true);
    }

    // Child of sibling's parents
    for (const sibId of relatedToIds) {
      const parentIds = getRelated(sibId, 'child'); // sibId is child of these parents
      for (const parentId of parentIds) {
        addRel(parentId, personId, 'parent', true);
      }
    }

    // Grandchild of sibling's grandparents
    for (const sibId of relatedToIds) {
      const parentIds = getRelated(sibId, 'child');
      for (const parentId of parentIds) {
        const gpIds = getRelated(parentId, 'child');
        for (const gpId of gpIds) {
          addRel(gpId, personId, 'grandparent', true);
        }
      }
    }

    // Niece/nephew of sibling's aunts/uncles
    for (const sibId of relatedToIds) {
      const auIds = getRelated(sibId, 'niece/nephew'); // sibId is niece/nephew → source is aunt/uncle
      // Actually, look for who has aunt/uncle relationship TO the sibling
      for (const r of allRelationships) {
        if (r.targetPersonId === sibId && r.relationType === 'aunt/uncle') {
          addRel(r.sourcePersonId, personId, 'aunt/uncle', true);
        }
      }
    }

    // Cousin of sibling's cousins
    for (const sibId of relatedToIds) {
      const cousinIds = getRelated(sibId, 'cousin');
      for (const cousinId of cousinIds) {
        if (cousinId !== personId) {
          addRel(personId, cousinId, 'cousin', true);
        }
      }
    }
  }

  if (role === 'parent') {
    // relatedToIds = child ID(s)
    for (const childId of relatedToIds) {
      addRel(personId, childId, 'parent', false);
    }

    // Also parent of the children's siblings
    for (const childId of relatedToIds) {
      const childSiblings = getRelated(childId, 'sibling');
      for (const sibId of childSiblings) {
        addRel(personId, sibId, 'parent', true);
      }
    }

    // Grandparent of children's children
    for (const childId of relatedToIds) {
      const grandchildIds = getRelated(childId, 'parent');
      for (const gcId of grandchildIds) {
        addRel(personId, gcId, 'grandparent', true);
      }
    }
  }

  if (role === 'pet') {
    // relatedToIds = owner IDs
    for (const ownerId of relatedToIds) {
      addRel(ownerId, personId, 'owner', false);
    }
  }

  if (role === 'friend') {
    for (const friendId of relatedToIds) {
      addRel(personId, friendId, 'friend', false);
    }
  }

  // ─── Suggest groups ──────────────────────────────────────────

  const suggestedGroupIds = new Set<string>();
  for (const relId of relatedToIds) {
    for (const group of allGroups) {
      if (group.members.some((m) => m.personId === relId)) {
        suggestedGroupIds.add(group.id);
      }
    }
  }

  // Check if person is already in these groups
  const personGroupIds = new Set(
    allGroups
      .filter((g) => g.members.some((m) => m.personId === personId))
      .map((g) => g.id),
  );

  const suggestedGroups = allGroups
    .filter((g) => suggestedGroupIds.has(g.id) && !personGroupIds.has(g.id))
    .map((g) => ({
      groupId: g.id,
      groupName: g.name,
      groupColor: g.color,
    }));

  return NextResponse.json({
    relationships: results,
    suggestedGroups,
  });
}
