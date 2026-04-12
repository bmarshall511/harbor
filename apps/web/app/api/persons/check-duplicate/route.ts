import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/persons/check-duplicate?name=...
 *
 * Check if a person with a similar name already exists.
 * Returns matches using case-insensitive and fuzzy matching.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const name = url.searchParams.get('name')?.trim();

  if (!name || name.length < 2) {
    return NextResponse.json({ matches: [] });
  }

  const lower = name.toLowerCase();

  // Find exact and similar matches
  const allPersons = await db.person.findMany({
    where: { name: { not: null } },
    select: {
      id: true,
      name: true,
      entityType: true,
      avatarUrl: true,
      gender: true,
    },
  });

  const matches = allPersons
    .filter((p) => {
      if (!p.name) return false;
      const pLower = p.name.toLowerCase();
      // Exact match
      if (pLower === lower) return true;
      // Contains match
      if (pLower.includes(lower) || lower.includes(pLower)) return true;
      // First name match
      const firstName = lower.split(' ')[0];
      const pFirstName = pLower.split(' ')[0];
      if (firstName && pFirstName && firstName === pFirstName && firstName.length > 2) return true;
      // Last name match
      const lastName = lower.split(' ').pop();
      const pLastName = pLower.split(' ').pop();
      if (lastName && pLastName && lastName === pLastName && lastName.length > 2) return true;
      return false;
    })
    .map((p) => ({
      id: p.id,
      name: p.name,
      entityType: p.entityType,
      avatarUrl: p.avatarUrl,
      gender: p.gender,
      exactMatch: p.name!.toLowerCase() === lower,
    }));

  return NextResponse.json({ matches });
}
