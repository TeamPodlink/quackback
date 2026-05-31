import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

type Node = {
  type: string
  attrs?: Record<string, unknown>
  content?: Node[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

type Article = {
  sourcePath: string
  slug: string
  title: string
  description: string | null
  categorySlug: 'getting-started' | 'troubleshooting' | 'legal'
  categoryName: string
  position: number
  content: string
  contentJson: Node
}

const PODLINK_DOCS_DIR =
  process.env.PODLINK_DOCS_DIR ?? '/tmp/teampodlink-help/src/content/docs'

const CATEGORY_IDS = {
  'getting-started': '00000000-0000-7000-8000-000000000101',
  troubleshooting: '00000000-0000-7000-8000-000000000104',
  legal: '00000000-0000-7000-8000-000000000103',
} as const

const ARTICLE_METADATA: Record<
  string,
  { title: string; categorySlug: Article['categorySlug']; position: number }
> = {
  searching: {
    title: 'Find your podcast on Podlink',
    categorySlug: 'getting-started',
    position: 0,
  },
  linking: {
    title: 'Create links for shows and episodes',
    categorySlug: 'getting-started',
    position: 1,
  },
  sorting: {
    title: 'Understand app sorting and popularity',
    categorySlug: 'getting-started',
    position: 2,
  },
  analytics: {
    title: 'See how Podlink traffic appears in analytics',
    categorySlug: 'getting-started',
    position: 3,
  },
  caching: {
    title: 'Why episode, artwork, title, or description updates look outdated',
    categorySlug: 'troubleshooting',
    position: 0,
  },
  rehosting: {
    title: 'Whether Podlink caches or rehosts your audio',
    categorySlug: 'troubleshooting',
    position: 1,
  },
  cookies: {
    title: 'How Podlink uses cookies for app preferences',
    categorySlug: 'troubleshooting',
    position: 2,
  },
  'adding-platforms': {
    title: 'Why a platform may not be supported yet',
    categorySlug: 'troubleshooting',
    position: 3,
  },
}

const CATEGORY_ROWS = [
  {
    id: CATEGORY_IDS['getting-started'],
    slug: 'getting-started',
    name: 'Getting Started',
    description: 'Start here to understand Podlink and find the right article.',
    position: 0,
    icon: 'Rocket',
  },
  {
    id: CATEGORY_IDS.troubleshooting,
    slug: 'troubleshooting',
    name: 'Troubleshooting',
    description:
      'Fix common Podlink issues with podcast updates, app preferences, audio hosting, and platform support.',
    position: 1,
    icon: 'Wrench',
  },
  {
    id: CATEGORY_IDS.legal,
    slug: 'legal',
    name: 'Legal',
    description: 'Podlink policies and terms.',
    position: 2,
    icon: 'FileText',
  },
]

function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  if (!raw.startsWith('---\n')) return { data: {}, body: raw.trim() }
  const end = raw.indexOf('\n---', 4)
  if (end === -1) return { data: {}, body: raw.trim() }
  const yaml = raw.slice(4, end).trim()
  const body = raw.slice(end + 4).trim()
  const data: Record<string, string> = {}
  for (const line of yaml.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (match) data[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
  return { data, body }
}

function textNode(text: string): Node {
  return { type: 'text', text }
}

function paragraph(text: string): Node {
  return text.trim()
    ? { type: 'paragraph', content: parseInline(text.trim()) }
    : { type: 'paragraph' }
}

function parseInline(text: string): Node[] {
  const nodes: Node[] = []
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = linkPattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(textNode(text.slice(lastIndex, match.index)))
    if (match[1] && match[2]) {
      nodes.push({
        type: 'text',
        text: match[1],
        marks: [{ type: 'link', attrs: { href: rewriteLink(match[2]) } }],
      })
    } else if (match[3]) {
      nodes.push({ type: 'text', text: match[3], marks: [{ type: 'code' }] })
    } else if (match[4]) {
      nodes.push({ type: 'text', text: match[4], marks: [{ type: 'bold' }] })
    }
    lastIndex = linkPattern.lastIndex
  }

  if (lastIndex < text.length) nodes.push(textNode(text.slice(lastIndex)))
  return nodes
}

function rewriteLink(href: string): string {
  const helpMatch = href.match(/^\/help\/([^/]+)\/?$/)
  if (helpMatch) {
    const slug = helpMatch[1]
    const category = ARTICLE_METADATA[slug]?.categorySlug ?? 'getting-started'
    return `/hc/articles/${category}/${slug}`
  }

  return href
    .replace(/^\/legal\/([^/]+)\/?$/, '/hc/articles/legal/$1')
}

function markdownToJson(markdown: string): Node {
  const content: Node[] = []
  const lines = markdown.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      content.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        content: parseInline(heading[2].trim()),
      })
      i += 1
      continue
    }

    if (line.startsWith('> ')) {
      content.push({ type: 'blockquote', content: [paragraph(line.slice(2))] })
      i += 1
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      const items: Node[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push({
          type: 'listItem',
          content: [paragraph(lines[i].replace(/^[-*]\s+/, ''))],
        })
        i += 1
      }
      content.push({ type: 'bulletList', content: items })
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: Node[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push({
          type: 'listItem',
          content: [paragraph(lines[i].replace(/^\d+\.\s+/, ''))],
        })
        i += 1
      }
      content.push({ type: 'orderedList', attrs: { start: 1 }, content: items })
      continue
    }

    const paragraphLines = [line.trim()]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !lines[i].startsWith('> ')
    ) {
      paragraphLines.push(lines[i].trim())
      i += 1
    }
    content.push(paragraph(paragraphLines.join(' ')))
  }

  return { type: 'doc', content }
}

function buildArticle(sourcePath: string, categorySlug: Article['categorySlug'], position: number): Article {
  const raw = readFileSync(sourcePath, 'utf8')
  const { data, body } = parseFrontmatter(raw)
  const sourceSlug = basename(sourcePath).replace(/\.(md|mdx)$/, '')
  const slug = sourceSlug
  const meta = ARTICLE_METADATA[slug]
  const title = meta?.title ?? data.title ?? slug
  const effectiveCategorySlug = meta?.categorySlug ?? categorySlug
  return {
    sourcePath,
    slug,
    title,
    description: data.description ?? null,
    categorySlug: effectiveCategorySlug,
    categoryName:
      effectiveCategorySlug === 'getting-started'
        ? 'Getting Started'
        : effectiveCategorySlug === 'legal'
          ? 'Legal'
          : 'Troubleshooting',
    position: meta?.position ?? position,
    content: body
      .replaceAll('/help/searching/', '/hc/articles/getting-started/searching')
      .replaceAll('/help/linking/', '/hc/articles/getting-started/linking')
      .replaceAll('/help/sorting/', '/hc/articles/getting-started/sorting')
      .replaceAll('/help/analytics/', '/hc/articles/getting-started/analytics')
      .replaceAll('/help/caching/', '/hc/articles/troubleshooting/caching')
      .replaceAll('/help/rehosting/', '/hc/articles/troubleshooting/rehosting')
      .replaceAll('/help/cookies/', '/hc/articles/troubleshooting/cookies')
      .replaceAll('/help/adding-platforms/', '/hc/articles/troubleshooting/adding-platforms')
      .replaceAll('/legal/', '/hc/articles/legal/'),
    contentJson: markdownToJson(body),
  }
}

function loadArticles(): Article[] {
  const articles: Article[] = []
  const helpFiles = readdirSync(join(PODLINK_DOCS_DIR, 'help')).filter((file) => file.endsWith('.md')).sort()
  helpFiles.forEach((file) => {
    articles.push(buildArticle(join(PODLINK_DOCS_DIR, 'help', file), 'getting-started', 0))
  })
  const legalFiles = readdirSync(join(PODLINK_DOCS_DIR, 'legal')).filter((file) => file.endsWith('.md')).sort()
  legalFiles.forEach((file, index) => {
    articles.push(buildArticle(join(PODLINK_DOCS_DIR, 'legal', file), 'legal', index))
  })
  return articles
}

function quote(value: string | null): string {
  if (value === null) return 'null'
  return `'${value.replaceAll("'", "''")}'`
}

function sqlJson(value: unknown): string {
  return `${quote(JSON.stringify(value))}::jsonb`
}

function emitSql(articles: Article[]): void {
  console.log('begin;')
  console.log(`do $$
declare author_id uuid;
begin
  select id into author_id
  from principal p
  left join "user" u on u.id = p.user_id
  where p.type = 'user'
    and (
      lower(coalesce(p.display_name, '')) = 'nathan gathright'
      or lower(coalesce(u.name, '')) = 'nathan gathright'
      or lower(coalesce(u.email, '')) = 'nathan@pod.link'
    )
  order by p.created_at asc
  limit 1;

  if author_id is null then
    raise exception 'No Nathan Gathright principal found for help-center article author';
  end if;`)

  for (const category of CATEGORY_ROWS) {
    console.log(`
  insert into kb_categories (id, slug, name, description, icon, is_public, position, updated_at)
  values (
    ${quote(category.id)},
    ${quote(category.slug)},
    ${quote(category.name)},
    ${quote(category.description)},
    ${quote(category.icon)},
    true,
    ${category.position},
    now()
  )
  on conflict (slug) do update set
    name = excluded.name,
    description = excluded.description,
    icon = excluded.icon,
    is_public = excluded.is_public,
    position = excluded.position,
    deleted_at = null,
    updated_at = now();`)
  }

  console.log(`
  delete from kb_articles where slug = 'getting-started';
  delete from kb_categories where slug = 'podlink-help';`)

  for (const article of articles) {
    console.log(`
  insert into kb_articles (
    id,
    category_id,
    slug,
    title,
    description,
    position,
    content,
    content_json,
    principal_id,
    published_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    ${quote(CATEGORY_IDS[article.categorySlug])},
    ${quote(article.slug)},
    ${quote(article.title)},
    ${quote(article.description)},
    ${article.position},
    ${quote(article.content)},
    ${sqlJson(article.contentJson)},
    author_id,
    now(),
    now()
  )
  on conflict (slug) do update set
    category_id = excluded.category_id,
    title = excluded.title,
    description = excluded.description,
    position = excluded.position,
    content = excluded.content,
    content_json = excluded.content_json,
    principal_id = excluded.principal_id,
    published_at = excluded.published_at,
    deleted_at = null,
    updated_at = now();

  raise notice 'Imported %: %', ${quote(article.categoryName)}, ${quote(article.title)};`)
  }

  console.log('end $$;')
  console.log('commit;')
}

if (process.argv.includes('--sql')) {
  emitSql(loadArticles())
  process.exit(0)
}

const { default: postgres } = await import('postgres')
const sql = postgres(process.env.DATABASE_URL!, { max: 1 })

const [author] = await sql<{ id: string }[]>`
  select p.id
  from principal p
  left join "user" u on u.id = p.user_id
  where p.type = 'user'
    and (
      lower(coalesce(p.display_name, '')) = 'nathan gathright'
      or lower(coalesce(u.name, '')) = 'nathan gathright'
      or lower(coalesce(u.email, '')) = 'nathan@pod.link'
    )
  order by p.created_at asc
  limit 1
`

if (!author) {
  throw new Error('No Nathan Gathright principal found for help-center article author')
}

for (const category of CATEGORY_ROWS) {
  await sql`
    insert into kb_categories (id, slug, name, description, icon, is_public, position, updated_at)
    values (
      ${category.id},
      ${category.slug},
      ${category.name},
      ${category.description},
      ${category.icon},
      true,
      ${category.position},
      now()
    )
    on conflict (slug) do update set
      name = excluded.name,
      description = excluded.description,
      icon = excluded.icon,
      is_public = excluded.is_public,
      position = excluded.position,
      deleted_at = null,
      updated_at = now()
  `
}

const categoryRows = await sql<{ id: string; slug: Article['categorySlug'] }[]>`
  select id, slug from kb_categories where slug in ('getting-started', 'troubleshooting', 'legal')
`
const categoryIdBySlug = new Map(categoryRows.map((row) => [row.slug, row.id]))

await sql`delete from kb_articles where slug = 'getting-started'`
await sql`delete from kb_categories where slug = 'podlink-help'`

for (const article of loadArticles()) {
  const categoryId = categoryIdBySlug.get(article.categorySlug)
  if (!categoryId) throw new Error(`Missing category ${article.categorySlug}`)
  await sql`
    insert into kb_articles (
      id,
      category_id,
      slug,
      title,
      description,
      position,
      content,
      content_json,
      principal_id,
      published_at,
      updated_at
    )
    values (
      gen_random_uuid(),
      ${categoryId},
      ${article.slug},
      ${article.title},
      ${article.description},
      ${article.position},
      ${article.content},
      ${sql.json(article.contentJson)},
      ${author.id},
      now(),
      now()
    )
    on conflict (slug) do update set
      category_id = excluded.category_id,
      title = excluded.title,
      description = excluded.description,
      position = excluded.position,
      content = excluded.content,
      content_json = excluded.content_json,
      principal_id = excluded.principal_id,
      published_at = excluded.published_at,
      deleted_at = null,
      updated_at = now()
  `
  console.log(`Imported ${article.categoryName}: ${article.title}`)
}

await sql.end()
