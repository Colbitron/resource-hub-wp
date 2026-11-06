import type { MediaRecord, MockState, PageRecord, ResourceRecord, TermRecord } from "./state.mts";
import type { Taxonomy } from "./types.mts";

/**
 * Records to WordPress REST objects, field for field as the captured fixtures
 * in `test/fixtures/wp/` show them: a resource from `/wp/v2/resources`
 * (`_embed` optional), a term from a taxonomy endpoint, and the embedded
 * forms of a term and an attachment. Every absolute URL is built on the
 * mock's origin, as WordPress builds its own on the site URL, so the front
 * end has something to strip and rewrite.
 */

type Json = Record<string, unknown>;

const CURIES = [{ name: "wp", href: "https://api.w.org/{rel}", templated: true }];

/** What a resource with no term in `resource_type` links to: a permalink the CMS still answers. */
function permalink(state: MockState, resource: ResourceRecord, origin: string): string {
  const type = resource.typeIds.map((id) => state.term("resource_type", id)).find((term) => term !== undefined);
  return type ? `${origin}/resources/${type.slug}/${resource.slug}/` : `${origin}/?resource=${resource.slug}`;
}

function defaultContent(title: string): string {
  return `\n\n<p class="wp-block-paragraph">${escapeHtml(title)} is sample content created by the Resource Hub mock CMS. Everything in it is invented so the library has something to list, filter, and relate while the real content is written.</p>\n\n\n\n\n\n<p class="wp-block-paragraph">Replace this body with the resource itself, or leave it as a short landing page and point the source URL at where the resource actually lives.</p>\n\n`;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Fills `{{origin}}` and `{{topic-slug:ID}}` the way WordPress resolves them at render time. */
function renderContent(state: MockState, resource: ResourceRecord, origin: string): string {
  const template = resource.content ?? defaultContent(resource.title);
  return template
    .replaceAll("{{origin}}", origin)
    .replace(/\{\{topic-slug:(\d+)\}\}/g, (_, id: string) => state.term("resource_topic", Number(id))?.slug ?? "");
}

function termLink(term: TermRecord, origin: string): string {
  return term.taxonomy === "resource_flag"
    ? `${origin}/?taxonomy=resource_flag&term=${term.slug}`
    : `${origin}/${term.taxonomy.replace("_", "-")}/${term.slug}/`;
}

function termLinks(term: TermRecord, origin: string): Json {
  return {
    self: [{ href: `${origin}/wp-json/wp/v2/${term.taxonomy}/${term.id}`, targetHints: { allow: ["GET"] } }],
    collection: [{ href: `${origin}/wp-json/wp/v2/${term.taxonomy}` }],
    about: [{ href: `${origin}/wp-json/wp/v2/taxonomies/${term.taxonomy}` }],
    "wp:post_type": [{ href: `${origin}/wp-json/wp/v2/resources?${term.taxonomy}=${term.id}` }],
    curies: CURIES,
  };
}

/** A term as `/wp/v2/{taxonomy}` lists it. Hierarchical taxonomies (`resource_type`, `resource_flag`) carry `parent`. */
export function renderTerm(state: MockState, term: TermRecord, origin: string): Json {
  return {
    id: term.id,
    count: state.termCount(term),
    description: term.description,
    link: termLink(term, origin),
    name: term.name,
    slug: term.slug,
    taxonomy: term.taxonomy,
    ...(term.taxonomy === "resource_topic" ? {} : { parent: 0 }),
    meta: [],
    _links: termLinks(term, origin),
  };
}

/** A term as `_embedded['wp:term']` carries it: no `count`, `description`, `parent` or `meta`. */
export function renderEmbeddedTerm(term: TermRecord, origin: string): Json {
  return {
    id: term.id,
    link: termLink(term, origin),
    name: term.name,
    slug: term.slug,
    taxonomy: term.taxonomy,
    _links: termLinks(term, origin),
  };
}

const EMPTY_IMAGE_META = {
  aperture: "0",
  credit: "",
  camera: "",
  caption: "",
  created_timestamp: "0",
  copyright: "",
  focal_length: "0",
  iso: "0",
  shutter_speed: "0",
  title: "",
  orientation: "0",
  keywords: [],
  alt: "",
};

/** An attachment as `_embedded['wp:featuredmedia'][0]` carries it. */
export function renderMedia(media: MediaRecord, resource: ResourceRecord, state: MockState, origin: string): Json {
  const uploads = `${origin}/wp-content/uploads`;
  const slug = media.file.replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, "");
  // `media_details` is `{}` when WordPress could not read the file's dimensions.
  const details: Json =
    media.width === null || media.height === null
      ? {}
      : {
          width: media.width,
          height: media.height,
          file: media.file,
          filesize: 0,
          sizes: Object.fromEntries(
            Object.entries(media.sizes).map(([name, size]) => [
              name,
              {
                file: size.file.replace(/^.*\//, ""),
                width: size.width,
                height: size.height,
                filesize: 0,
                mime_type: media.mime,
                source_url: `${uploads}/${size.file}`,
              },
            ]),
          ),
          image_meta: EMPTY_IMAGE_META,
        };
  return {
    id: media.id,
    date: resource.date,
    slug,
    type: "attachment",
    link: `${permalink(state, resource, origin)}${slug}/`,
    title: { rendered: media.title },
    author: 0,
    featured_media: 0,
    caption: { rendered: "" },
    alt_text: media.alt,
    media_type: media.mime.startsWith("image/") ? "image" : "file",
    mime_type: media.mime,
    media_details: details,
    source_url: `${uploads}/${media.file}`,
    _links: {
      self: [{ href: `${origin}/wp-json/wp/v2/media/${media.id}`, targetHints: { allow: ["GET"] } }],
      collection: [{ href: `${origin}/wp-json/wp/v2/media` }],
      about: [{ href: `${origin}/wp-json/wp/v2/types/attachment` }],
      replies: [{ embeddable: true, href: `${origin}/wp-json/wp/v2/comments?post=${media.id}` }],
      "wp:attached-to": [
        { embeddable: true, post_type: "resource", id: resource.id, href: `${origin}/wp-json/wp/v2/resources/${resource.id}` },
      ],
      curies: CURIES,
    },
  };
}

const TAXONOMY_ORDER: Taxonomy[] = ["resource_topic", "resource_type", "resource_flag"];

/**
 * A resource as `/wp/v2/resources` returns it. With `embed`, `_embedded`
 * carries the featured image (left out when there is none) and `wp:term`, one
 * array per taxonomy in registration order (left out when every one is
 * empty), as core's `_embed` does. `embed` is what `rest_parse_embed_param()`
 * returns: `false` for none, `true` for every embeddable link, or a list of
 * link relations, when only those are embedded (`WP_REST_Server::embed_links`).
 */
export function renderResource(
  state: MockState,
  resource: ResourceRecord,
  origin: string,
  embed: boolean | readonly string[],
): Json {
  const link = permalink(state, resource, origin);
  const rest = `${origin}/wp-json/wp/v2/resources/${resource.id}`;
  const media = resource.mediaId === null ? undefined : state.mediaItem(resource.mediaId);
  const termsByTaxonomy = TAXONOMY_ORDER.map((taxonomy) =>
    state
      .termIds(resource, taxonomy)
      .map((id) => state.term(taxonomy, id))
      .filter((term): term is TermRecord => term !== undefined),
  );
  const classList = [
    `post-${resource.id}`,
    "resource",
    "type-resource",
    `status-${resource.status}`,
    ...(media ? ["has-post-thumbnail"] : []),
    "hentry",
    ...termsByTaxonomy.flat().map((term) => `${term.taxonomy}-${term.slug}`),
  ];

  const body: Json = {
    id: resource.id,
    date: resource.date,
    date_gmt: resource.date,
    guid: { rendered: `${origin}/?post_type=resource&p=${resource.id}` },
    modified: resource.modified,
    modified_gmt: resource.modified,
    slug: resource.slug,
    status: resource.status,
    type: "resource",
    link,
    // `the_title` texturizes and converts: an apostrophe is `&#8217;`, an ampersand `&#038;`.
    title: { rendered: resource.title.replace(/&/g, "&#038;").replace(/'/g, "&#8217;") },
    content: { rendered: renderContent(state, resource, origin), protected: false },
    excerpt: { rendered: resource.summary === "" ? "" : `<p>${escapeHtml(resource.summary)}</p>\n`, protected: false },
    featured_media: media?.id ?? 0,
    template: "",
    meta: { summary: resource.summary, source_url: resource.sourceUrl, footnotes: "" },
    resource_topic: [...resource.topicIds],
    resource_type: [...resource.typeIds],
    resource_flag: [...resource.flagIds],
    class_list: classList,
    _links: {
      self: [{ href: rest, targetHints: { allow: ["GET"] } }],
      collection: [{ href: `${origin}/wp-json/wp/v2/resources` }],
      about: [{ href: `${origin}/wp-json/wp/v2/types/resource` }],
      "version-history": [{ count: 0, href: `${rest}/revisions` }],
      ...(media ? { "wp:featuredmedia": [{ embeddable: true, href: `${origin}/wp-json/wp/v2/media/${media.id}` }] } : {}),
      "wp:attachment": [{ href: `${origin}/wp-json/wp/v2/media?parent=${resource.id}` }],
      "wp:term": TAXONOMY_ORDER.map((taxonomy) => ({
        taxonomy,
        embeddable: true,
        href: `${origin}/wp-json/wp/v2/${taxonomy}?post=${resource.id}`,
      })),
      curies: CURIES,
    },
  };

  if (embed !== false) {
    const wants = (rel: string) => embed === true || embed.includes(rel);
    const embedded: Json = {};
    if (media && wants("wp:featuredmedia")) embedded["wp:featuredmedia"] = [renderMedia(media, resource, state, origin)];
    if (wants("wp:term") && termsByTaxonomy.some((terms) => terms.length > 0)) {
      embedded["wp:term"] = termsByTaxonomy.map((terms) => terms.map((term) => renderEmbeddedTerm(term, origin)));
    }
    if (Object.keys(embedded).length > 0) body._embedded = embedded;
  }

  return body;
}

/** A page as `/wp/v2/pages/{id}` returns it, field for field as core's pages controller does; no `_embed` is served. */
export function renderPage(state: MockState, page: PageRecord, origin: string): Json {
  const link = `${origin}${state.pagePath(page)}`;
  const rest = `${origin}/wp-json/wp/v2/pages/${page.id}`;
  const content = (page.content ?? `\n<p class="wp-block-paragraph">${escapeHtml(page.title)} is a page of the Resource Hub mock CMS.</p>\n`).replaceAll("{{origin}}", origin);
  return {
    id: page.id,
    date: page.date,
    date_gmt: page.date,
    guid: { rendered: `${origin}/?page_id=${page.id}` },
    modified: page.modified,
    modified_gmt: page.modified,
    slug: page.slug,
    status: page.status,
    type: "page",
    link,
    title: { rendered: page.title.replace(/&/g, "&#038;").replace(/'/g, "&#8217;") },
    content: { rendered: content, protected: false },
    excerpt: { rendered: page.excerpt === "" ? "" : `<p>${escapeHtml(page.excerpt)}</p>\n`, protected: false },
    author: 1,
    featured_media: 0,
    parent: page.parent,
    menu_order: 0,
    comment_status: "closed",
    ping_status: "closed",
    template: "",
    meta: { footnotes: "" },
    class_list: [`post-${page.id}`, "page", "type-page", `status-${page.status}`, "hentry"],
    _links: {
      self: [{ href: rest, targetHints: { allow: ["GET"] } }],
      collection: [{ href: `${origin}/wp-json/wp/v2/pages` }],
      about: [{ href: `${origin}/wp-json/wp/v2/types/page` }],
      ...(page.parent === 0 ? {} : { up: [{ embeddable: true, href: `${origin}/wp-json/wp/v2/pages/${page.parent}` }] }),
      curies: CURIES,
    },
  };
}
