---
status: accepted
date: 2026-11-03
---

# One `resource` post type with a `resource_type` taxonomy, not a post type per kind

The library holds articles, ebooks, webinars, podcasts, and case studies, and the front end shows them in one filterable list. The natural WordPress modelling question is whether each kind is its own post type or a term on a shared type. We register one post type, `resource`, and put the kind in a taxonomy, `resource_type`, alongside `resource_topic`.

The deciding fact is on the read side. The core REST API has no cross-type collection that returns full objects and filters by taxonomy: `/wp/v2/articles` and `/wp/v2/webinars` are separate collections with separate pagination. What does exist is `/wp/v2/search?type=post&subtype=article,webinar`, a paginated collection across post types, but it filters only by text search, not by taxonomy, and returns just `id`, `title`, `url`, `type`, and `subtype`, with the full object reachable only through an embeddable link. A combined listing would mean either merging several paginated collections on the client, where page boundaries drift as content is added and every view costs one request per kind, or writing a custom collection route that re-implements pagination, filtering, `_embed`, and schema that `WP_REST_Posts_Controller` already provides. With one post type, "all resources about performance, newest first, page two" is one core request: `/wp/v2/resources?resource_topic=…&page=2`.

## The type vocabulary is fixed; topics are open

The five kinds are a fixed list the front end designs for (a card style, a filter label), so a new kind is an editorial decision, not something to invent mid-sentence. `resource_type` is therefore hierarchical with `manage_terms`, `edit_terms`, and `delete_terms` set to `manage_categories` (editors and administrators) and `assign_terms` to `edit_posts`: contributors and authors pick one of the existing types, editors and administrators add or rename them. Hierarchical is what makes that hold, because core's terms controller asks for `edit_terms` before creating a term only in hierarchical taxonomies ([ADR 0009](0009-featured-is-a-term-not-meta.md)). The editor shows the types as a checkbox list, which suits a short fixed list.

`resource_topic` stays flat and open, like tags: anyone who can write a resource can add a topic as they write, because topics grow with the content and a curated list would lag it.

## Considered options

- **A post type per kind.** The right move the day the kinds stop sharing a shape: a webinar's date and recording URL, a podcast's audio file and duration, an ebook's page count. None of that exists yet; every kind today is a title, a body, a summary, an optional external link, and a set of topics. Splitting now would buy flexibility nobody has asked for at the price described above.
- **One post type, kind as meta.** Rejected for the same reason `featured` is a term ([ADR 0009](0009-featured-is-a-term-not-meta.md)): filtering by a meta value is an unindexed query that the coding standards flag, while term relationships are indexed and already have REST filter parameters.

## Consequences

- A resource is a landing page the site owns. `source_url` is an optional external destination for resources that live elsewhere; the WordPress post is still the canonical record the front end lists and links to. If a kind ever needs hosted files, the right tool is an attachment ID stored in meta, pointing at the media library; there is no custom table.
- The per-kind model is the recorded next step if types diverge: add a post type for the kind that grew fields, keep `resource` for the rest, and accept the listing cost then, when it buys something.
- This is the place a GraphQL comparison would favour GraphQL. WPGraphQL queries across content types natively (a `contentNodes` query with a `contentTypes` filter), so the per-kind model costs much less on the read side there than over REST. The stretch goal that adds WPGraphQL should revisit this record.
