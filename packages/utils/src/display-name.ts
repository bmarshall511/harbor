/**
 * Parse structured filenames/folder names into human-friendly display names.
 *
 * Recognized patterns:
 *   NN_Category_Name          → "Category Name" (strips leading number prefix)
 *   YYYY-MM-DD_the_title_001  → "The Title #001" + date
 *   YYYY-MM-DD-Title Words    → "Title Words" + date
 *   YYYYs_Name_Parts          → "Name Parts" (decade prefix preserved)
 *   YYYY                      → "YYYY" (year-only left as-is)
 *   MM-DD-YY                  → reformatted date
 *   General underscores       → spaces, title-cased if all lowercase
 */

export interface ParsedName {
  displayName: string;
  date: string | null;
  sequence: string | null;
  extension: string | null;
  originalName: string;
}

// Leading numbered prefix like 01_, 02_, 00_
const NUMBERED_PREFIX = /^(\d{1,3})[_\s-]+/;
// ISO date prefix YYYY-MM-DD
const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})[_\s-]+/;
// US date folder MM-DD-YY
const US_DATE = /^(\d{2})-(\d{2})-(\d{2})$/;
// Decade prefix like 1990s_
const DECADE_PREFIX = /^(\d{4}s)[_\s-]+/;
// YYYY-MM-DD-Title (dash-separated instead of underscore)
const DATE_DASH_TITLE = /^(\d{4}-\d{2}-\d{2})-(.+)/;
// YYYY-MM format
const YEAR_MONTH = /^(\d{4})-(\d{2})$/;
// Trailing sequence number _001 or _01
const SEQUENCE_SUFFIX = /[_\s-](\d{2,4})$/;

export function parseDisplayName(name: string, isDirectory: boolean = false): ParsedName {
  const originalName = name;
  let working = name;
  let date: string | null = null;
  let sequence: string | null = null;
  let extension: string | null = null;

  // Strip extension for files
  if (!isDirectory) {
    const lastDot = working.lastIndexOf('.');
    if (lastDot > 0) {
      extension = working.slice(lastDot + 1);
      working = working.slice(0, lastDot);
    }
  }

  // Year-only (just return as-is)
  if (/^\d{4}$/.test(working)) {
    return { displayName: working, date: null, sequence: null, extension, originalName };
  }

  // Decade-only like "1990s" (return as-is)
  if (/^\d{4}s$/.test(working)) {
    return { displayName: working, date: null, sequence: null, extension, originalName };
  }

  // US date format MM-DD-YY
  const usMatch = working.match(US_DATE);
  if (usMatch) {
    const yr = Number(usMatch[3]) > 50 ? `19${usMatch[3]}` : `20${usMatch[3]}`;
    date = `${yr}-${usMatch[1]}-${usMatch[2]}`;
    return { displayName: new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), date, sequence: null, extension, originalName };
  }

  // YYYY-MM format
  const ymMatch = working.match(YEAR_MONTH);
  if (ymMatch) {
    date = `${ymMatch[1]}-${ymMatch[2]}-01`;
    return { displayName: new Date(date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), date, sequence: null, extension, originalName };
  }

  // Strip numbered prefix (01_, 02_, etc.)
  const numMatch = working.match(NUMBERED_PREFIX);
  if (numMatch) {
    working = working.slice(numMatch[0].length);
  }

  // Extract ISO date prefix YYYY-MM-DD_
  const isoMatch = working.match(ISO_DATE_PREFIX);
  if (isoMatch) {
    date = isoMatch[1];
    working = working.slice(isoMatch[0].length);
  }

  // Handle YYYY-MM-DD-Title (dash-joined title after date)
  if (!date) {
    const dashMatch = working.match(DATE_DASH_TITLE);
    if (dashMatch) {
      date = dashMatch[1];
      working = dashMatch[2];
    }
  }

  // Extract decade prefix
  if (!date) {
    const decMatch = working.match(DECADE_PREFIX);
    if (decMatch) {
      working = working.slice(decMatch[0].length);
    }
  }

  // Extract trailing sequence number (for files only)
  if (!isDirectory) {
    const seqMatch = working.match(SEQUENCE_SUFFIX);
    if (seqMatch) {
      sequence = seqMatch[1];
      working = working.slice(0, -seqMatch[0].length);
    }
  }

  // Convert separators to spaces
  let displayName = working
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Title case if all lowercase
  if (displayName && displayName === displayName.toLowerCase()) {
    displayName = displayName.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Add sequence as nice format
  if (sequence) {
    displayName = displayName ? `${displayName} #${sequence}` : `#${sequence}`;
  }

  // Fallback
  if (!displayName) displayName = originalName;

  return { displayName, date, sequence, extension, originalName };
}

/** Quick display name helper. */
export function friendlyName(name: string, isDirectory: boolean = false): string {
  return parseDisplayName(name, isDirectory).displayName;
}
