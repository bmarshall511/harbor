-- =============================================================================
-- Harbor — Search Foundation Migration
-- =============================================================================
--
-- Run this AFTER `prisma db push` has created the search_logs table and added
-- pg_trgm to the extensions list. This script adds the custom SQL that Prisma
-- can't express: triggers, GIN indexes on tsvector/trigram columns, and the
-- one-time backfill of existing rows.
--
-- Safe to re-run (all statements are idempotent).
-- =============================================================================

-- ─── 1. Extensions ──────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── 2. Search vector trigger function ──────────────────────────────────────
--
-- Populates the `search_vector` tsvector column on every INSERT/UPDATE to the
-- `files` table. Uses weighted ranks so title/name matches score higher than
-- OCR text or transcripts.
--
-- Weights:
--   A — name, title (highest relevance)
--   B — description, caption, altText, aiTitle, tag names, people names
--   C — aiDescription, ocrText, transcript (broad content, lower weight)
--
-- People names are extracted from the JSONB array at `meta.fields.people`,
-- where each element is `{ "kind": "free"|"user", "name": "..." }`.
-- We extract all `name` values and concatenate them into the vector.

CREATE OR REPLACE FUNCTION file_search_vector_update() RETURNS trigger AS $$
DECLARE
  tag_names TEXT;
  people_names TEXT;
  people_arr jsonb;
  elem jsonb;
BEGIN
  -- Aggregate tag names from the file_tags + tags join
  SELECT string_agg(t.name, ' ')
    INTO tag_names
    FROM file_tags ft
    JOIN tags t ON t.id = ft.tag_id
   WHERE ft.file_id = NEW.id;

  -- Extract people names from meta.fields.people JSON array.
  -- Each element is an object like {"kind":"free","name":"Jane Doe"},
  -- so we need to extract the "name" key from each.
  people_names := '';
  people_arr := NEW.meta -> 'fields' -> 'people';
  IF people_arr IS NOT NULL AND jsonb_typeof(people_arr) = 'array' THEN
    FOR elem IN SELECT * FROM jsonb_array_elements(people_arr)
    LOOP
      IF elem ->> 'name' IS NOT NULL THEN
        people_names := people_names || ' ' || (elem ->> 'name');
      END IF;
    END LOOP;
  END IF;

  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.meta -> 'fields' ->> 'caption', '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.meta -> 'fields' ->> 'altText', '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.meta -> 'fields' ->> 'aiTitle', '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.meta -> 'fields' ->> 'aiDescription', '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.meta -> 'fields' ->> 'ocrText', '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.meta -> 'fields' ->> 'transcript', '')), 'C') ||
    setweight(to_tsvector('english', coalesce(tag_names, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(people_names, '')), 'B');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach the trigger to the files table.
DROP TRIGGER IF EXISTS files_search_vector_trigger ON files;
CREATE TRIGGER files_search_vector_trigger
  BEFORE INSERT OR UPDATE ON files
  FOR EACH ROW
  EXECUTE FUNCTION file_search_vector_update();

-- ─── 3. Tag-change sync trigger ─────────────────────────────────────────────
--
-- When a tag is added to or removed from a file (file_tags row INSERT/DELETE),
-- we need to re-compute the search vector for that file. We do this by
-- touching the file's updated_at, which fires the BEFORE UPDATE trigger above.

CREATE OR REPLACE FUNCTION file_tags_search_vector_sync() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE files SET updated_at = now() WHERE id = OLD.file_id;
  ELSE
    UPDATE files SET updated_at = now() WHERE id = NEW.file_id;
  END IF;
  RETURN NULL; -- AFTER trigger, return value is ignored
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS file_tags_search_sync ON file_tags;
CREATE TRIGGER file_tags_search_sync
  AFTER INSERT OR DELETE ON file_tags
  FOR EACH ROW
  EXECUTE FUNCTION file_tags_search_vector_sync();

-- ─── 4. GIN indexes ─────────────────────────────────────────────────────────

-- Full-text search index on the materialized tsvector column.
CREATE INDEX IF NOT EXISTS idx_files_search_vector
  ON files USING GIN (search_vector);

-- Trigram index on file name for fuzzy/partial substring matching
-- (e.g. "2022-01" or "photo_shoot" that tsvector word-stemming misses).
CREATE INDEX IF NOT EXISTS idx_files_name_trgm
  ON files USING GIN (name gin_trgm_ops);

-- Trigram index on title for the same reason.
CREATE INDEX IF NOT EXISTS idx_files_title_trgm
  ON files USING GIN (title gin_trgm_ops);

-- ─── 5. Backfill existing rows ──────────────────────────────────────────────
--
-- A no-op UPDATE that fires the BEFORE UPDATE trigger on every row that
-- doesn't already have a search_vector. On a large table this may take a
-- while; it's safe to interrupt and re-run (rows that already have a
-- search_vector will just recompute — fast because the trigger is cheap).

UPDATE files SET updated_at = updated_at WHERE search_vector IS NULL;
