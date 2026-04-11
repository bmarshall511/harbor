export { db } from './client';
export * from './repositories/index';
// Re-export Prisma namespace (for `Prisma.sql`, `Prisma.empty`, etc.)
// and all generated types/enums so consumers don't need a direct
// `@prisma/client` dependency.
export * from '../generated/prisma/client';
