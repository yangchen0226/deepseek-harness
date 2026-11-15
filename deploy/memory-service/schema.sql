-- Memory service schema.
--
-- One end user owns many memory items. Retrieval is lexical (PostgreSQL full-text
-- on the `simple` configuration) blended with trigram similarity, so Chinese text
-- matches through pg_trgm while Latin words also score through the text index.
-- Recency decays with a 30-day half-life.
--
-- Apply with: psql "$MEMORY_DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- One external identity resolved to a durable row. `other_id` is the caller's
-- stable user identifier; (workspace_id, other_id) is unique.
create table if not exists memory_end_user (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  other_id text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, other_id)
);

-- One durable memory. `content_hash` deduplicates restated facts per user.
create table if not exists memory_item (
  id uuid primary key default gen_random_uuid(),
  end_user_id uuid not null references memory_end_user (id) on delete cascade,
  content text not null check (length(content) > 0),
  content_hash bytea not null,
  kind text not null default 'event',
  source text not null default 'autosave',
  confidence real not null default 0.5,
  session_id text,
  turn integer,
  archived boolean not null default false,
  hits integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tsv tsvector generated always as (to_tsvector('simple', content)) stored,
  unique (end_user_id, content_hash)
);

create index if not exists memory_item_user_recent
  on memory_item (end_user_id, created_at desc)
  where not archived;

create index if not exists memory_item_tsv
  on memory_item using gin (tsv);

create index if not exists memory_item_trgm
  on memory_item using gin (content gin_trgm_ops);

-- Resolve an external identity to its row, creating it on first use.
create or replace function memory_ensure_end_user(
  p_workspace text,
  p_other_id text
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into memory_end_user (workspace_id, other_id)
  values (p_workspace, p_other_id)
  on conflict (workspace_id, other_id) do update set other_id = excluded.other_id
  returning id into v_id;
  return v_id;
end;
$$;

-- The CJK character bigrams of a text. Chinese has no word boundaries, so a
-- whole-string trigram comparison scores zero whenever the question and the
-- memory share meaning but no phrasing. Per-bigram coverage fixes that: the
-- question `前端样式用什么` shares the bigram `前端` with `所有前端组件都用
-- CSS Modules`, which a trigram over the full strings never sees.
create or replace function memory_bigrams(p_text text)
returns text[]
language sql
immutable
as $$
  select coalesce(
    array_agg(distinct substr(p_text, i, 2)) filter (where substr(p_text, i, 2) ~ '[一-鿿]'),
    '{}'::text[]
  )
  from generate_series(1, greatest(length(p_text) - 1, 0)) as i
$$;

-- Ranked recall. Score blends CJK bigram coverage, trigram similarity, lexical
-- relevance, and a 30-day half-life recency term. Coverage carries the most
-- weight because it is the only signal that survives Chinese paraphrase.
create or replace function memory_recall(
  p_end_user uuid,
  p_question text,
  p_limit integer default 8,
  p_min_score real default 0.08
) returns table (
  id uuid,
  content text,
  kind text,
  source text,
  score real,
  created_at timestamptz
)
language sql
stable
as $$
  with q as (
    select
      websearch_to_tsquery('simple', p_question) as tsq,
      memory_bigrams(p_question) as grams
  ),
  scored as (
    select
      i.id,
      i.content,
      i.kind,
      i.source,
      i.created_at,
      coalesce(
        (select count(*) from unnest(q.grams) as gram
          where i.content like '%' || gram || '%')::real
          / nullif(array_length(q.grams, 1), 0),
        0::real
      ) as coverage,
      word_similarity(p_question, i.content) as similarity,
      ts_rank_cd(i.tsv, q.tsq, 32) as lexical
    from memory_item i, q
    where i.end_user_id = p_end_user
      and not i.archived
  )
  select
    s.id,
    s.content,
    s.kind,
    s.source,
    (
      0.35 * s.coverage
      + 0.25 * s.similarity
      + 0.25 * least(s.lexical, 1.0)
      + 0.15 * exp(
          -extract(epoch from (now() - s.created_at)) / (30 * 86400) * ln(2)
        )
    )::real as score,
    s.created_at
  from scored s
  where s.coverage > 0 or s.similarity > 0.1 or s.lexical > 0
  order by score desc, s.created_at desc
  limit greatest(1, least(p_limit, 50))
$$;

-- Mark recalled items as used, which the recency term and the UI both read.
create or replace function memory_touch(p_ids uuid[])
returns void
language sql
as $$
  update memory_item
  set hits = hits + 1, last_used_at = now()
  where id = any (p_ids);
$$;

-- Browsing list: what this user holds, newest first, optionally filtered by a
-- substring. Distinct from `memory_recall`, which ranks against a question.
create or replace function memory_list(
  p_end_user uuid,
  p_query text default null,
  p_limit integer default 50
) returns table (
  id uuid,
  content text,
  kind text,
  created_at timestamptz,
  hits integer,
  total bigint
)
language sql
stable
as $$
  with matched as (
    select i.id, i.content, i.kind, i.created_at, i.hits
    from memory_item i
    where i.end_user_id = p_end_user
      and not i.archived
      and (p_query is null or p_query = '' or i.content ilike '%' || p_query || '%')
  )
  select
    m.id,
    m.content,
    m.kind,
    m.created_at,
    m.hits,
    (select count(*) from matched) as total
  from matched m
  order by m.created_at desc
  limit greatest(1, least(p_limit, 200))
$$;

-- Derived profile sections. There is no separate profile table: a section is a
-- projection of the items a user has stated under the matching kind.
create or replace function memory_profile(
  p_end_user uuid,
  p_sections text[] default null,
  p_per_section integer default 12
) returns table (section text, content text)
language sql
stable
as $$
  with mapped as (
    select
      case i.kind
        when 'preference' then 'interests'
        when 'procedure' then 'habits'
        when 'relationship' then 'emotions'
        else 'basic'
      end as section,
      i.content,
      i.created_at,
      row_number() over (
        partition by case i.kind
          when 'preference' then 'interests'
          when 'procedure' then 'habits'
          when 'relationship' then 'emotions'
          else 'basic'
        end
        order by i.created_at desc
      ) as rn
    from memory_item i
    where i.end_user_id = p_end_user
      and not i.archived
  )
  select m.section, m.content
  from mapped m
  where m.rn <= greatest(1, least(p_per_section, 100))
    and (p_sections is null or m.section = any (p_sections))
  order by m.section, m.created_at desc
$$;
