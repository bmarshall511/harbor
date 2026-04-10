export { db } from './client';
export * from './repositories/index';
// Re-export Prisma for safe SQL composition (`Prisma.sql`,
// `Prisma.empty`) without forcing every consumer package to add
// `@prisma/client` as a direct dependency.
export { Prisma } from '@prisma/client';
