<?php
/**
 * The front end's card and article markup in PHP: the row, the resource page's meta line, summary and source line, and the text rules they share.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\Taxonomies;
use WP_Post;
use WP_Term;
use WpOrg\Requests\Exception as RequestsException;
use WpOrg\Requests\IdnaEncoder;

/**
 * One renderer for every block that writes a resource the way the front end does.
 *
 * Six blocks use it: `resource-hub/related-resources` and `resource-hub/related` (their rows, at `h3`),
 * `resource-hub/resource-card` (one row in a post template), `resource-hub/resource-meta` (the single
 * resource page's meta line), `resource-hub/resource-summary` (its lead paragraph),
 * `resource-hub/resource-source` (its source line) and `resource-hub/featured-lead` (the library's lead).
 * The markup is the front end's, element for element, class for class and attribute for attribute, in
 * the front end's order: `row()` is `ResourceCard` (`apps/web/components/ResourceCard.tsx`); `meta()`,
 * `summary()` and `source()` are the meta line, the summary and the source line `ResourceArticle` writes
 * (`apps/web/components/ResourceArticle.tsx`); and `lead()` is `FeaturedLead`
 * (`apps/web/components/FeaturedLead.tsx`), whose meta line and topics are the row's own parts.
 * The contract's markup fixtures (`packages/ui/fixtures/markup/`, `packages/ui/README.md`, "Markup
 * fixtures") hold both sides to the same HTML for a few sample resources (every part, no summary and no
 * topics, an unmapped type with apostrophes): the front end's vitest renders the components and this
 * side's PHPUnit renders the blocks, and each compares its output with the fixtures.
 *
 *     row():  <article class="rh-card">
 *               <p class="rh-card__meta"><span class="rh-card__type" data-accent="{accent}">{type}</span><time datetime="{ISO}">{Nov 1, 2026}</time></p>
 *               <div class="rh-card__body">
 *                 <h{n} class="rh-card__title"><a class="rh-card__link" href="{permalink}">{title}</a></h{n}>
 *                 <p class="rh-card__summary">{summary}</p>                                   (when it has one)
 *                 <ul class="rh-card__topics" aria-label="Topics" role="list"><li class="rh-card__topic">{topic}</li>…</ul>
 *               </div>                                                                       (topics when it has any)
 *             </article>
 *
 *     lead(): <article class="rh-lead">
 *               <div class="rh-lead__media"><img src="…" width="…" height="…" alt="…" …></div>   (when it has a sized image)
 *               <div class="rh-lead__body">
 *                 <p class="rh-card__meta">…the row's meta line…</p>
 *                 <h3 class="rh-lead__title"><a class="rh-lead__link" href="{permalink}">{title}</a></h3>
 *                 <p class="rh-lead__summary">{summary}</p>                                   (when it has one)
 *                 <ul class="rh-card__topics" aria-label="Topics" role="list">…</ul>           (when it has topics)
 *               </div>
 *             </article>
 *
 *     meta(): <div class="rh-resource__meta">
 *               <span class="rh-card__type" data-accent="{accent}"><a class="rh-resource__type" href="{type listing}">{type}</a></span>
 *               <time datetime="{ISO}">{Nov 1, 2026}</time>
 *               <ul class="rh-card__topics" aria-label="Topics" role="list">                   (when it has topics)
 *                 <li class="rh-card__topic"><a class="rh-resource__topic" href="{topic listing}">{topic}</a></li>…
 *               </ul>
 *             </div>
 *
 *     summary(): <p class="rh-resource__summary">{summary}</p>                                 (nothing when it is empty)
 *
 *     source():  <footer class="rh-resource__source"><p>Source: <a href="{href}" rel="noopener noreferrer">{label}</a></p></footer>
 *                                                                (nothing without a source; `rel` on an external link only)
 *
 * The rules, each the front end's:
 *
 * - **The type's mark.** The type's span carries `data-accent` from the shared type-accent table
 *   (`TypeAccents`), the type's accent or `neutral`, as the front end's `typeAccent()` writes it. In the
 *   meta line the name is a link inside that span, so the dot, the span's `::before`, sits outside the
 *   link's text and underline (`packages/ui/DESIGN.md`, "The article").
 * - **The date** is `date_gmt` in UTC, as an ISO instant in `datetime` and as "Nov 1, 2026" in the text,
 *   the front end's format (`apps/web/lib/dates.ts`).
 * - **Escaping.** Every text is the text the front end prints, escaped with `htmlspecialchars()`, which
 *   encodes every `&` as React escapes text, where `esc_html()` would leave an `&amp;` already in the text
 *   alone (so a title `Tips &amp;amp; tricks` or a summary `Tips &amp; tricks` reads "Tips &amp; tricks"
 *   on both sites). React writes `'` as `&#x27;` and this as `&#039;`: the same character in the page.
 * - **Plain text.** The title (`get_the_title()`, as `title.rendered`), the type's name and each topic's
 *   name are plain text, as the front end's `plainText()` makes them (`apps/web/lib/wp/cards.ts`): tags
 *   stripped, entities decoded, runs of whitespace collapsed to one space and trimmed (`plain_text()`).
 *   The names are the stored `name`, the string the REST API embeds; core stores `&` in it as `&amp;`, so
 *   most names read the same either way, but `Caf&eacute;`, `A&nbsp;&nbsp;B` or markup a PHP caller saved
 *   do not. A name that is empty as plain text keeps its (empty) element, as the front end keeps it. Exact
 *   parity is not attempted for two cases, reachable only with `unfiltered_html` or rare:
 *   `wp_strip_all_tags()` removes a `<script>` or `<style>` element's contents where the front end keeps
 *   their text, which is the safer side; and `html_entity_decode()` reads a reference with no semicolon,
 *   or a numeric one in the C1 range, differently from htmlparser2.
 * - **Topics** are in `get_the_terms()` order, which is the order the REST API lists them in. The row
 *   lists each once as plain text: the front end's `toCard()` dedupes after `plainText()`, so `A&nbsp;B`
 *   and `A B` are one topic. The meta line lists each term once, as the front end's `resourceTopics()`
 *   dedupes by slug, which no two terms share, so two topics with the same plain name are both linked.
 * - **The summary** in the row is the stored `summary` meta as it is, the front end's `meta.summary`, which
 *   it renders as React text with nothing stripped, decoded or collapsed: `MetaRules::sanitize_summary()`
 *   already stores plain text, so an entity left in it (`Caf&eacute;`) is literal text on both sites. Its
 *   `<p>` is left out only when it is the empty string, the front end's `summary &&` test, so a summary of
 *   `0` still gets one. The resource page's lead paragraph (`summary()`) is the same text with every run of
 *   JavaScript's whitespace collapsed to one space and the ends trimmed, the front end's `description`
 *   (`ResourceArticle`'s `resourceView()`), and is left out when nothing is left, so a summary of spaces
 *   gets no paragraph there while its row still shows one. It is not part of the meta line.
 * - **The source line** (`source()`) is the front end's `sourceLink()` (`apps/web/lib/source-link.ts`) on
 *   the stored `source_url`: nothing unless it is an absolute http(s) URL with a host and no user name or
 *   password (`MetaRules::sanitize_source_url()` stores nothing else, but a row may predate it). The URL
 *   is read as the front end's URL parser reads it before any rule applies: the host percent-decoded,
 *   lower-cased and in punycode when it is not ASCII (`hostname()`), and the path with its dot segments
 *   resolved (`resolved_path()`), so `/wp-content/uploads/../../wp-admin/export.php`, its `%2e%2e` form
 *   and `/resources/../wp-admin/` are the `/wp-admin/` paths a click reaches, and give no line. A URL
 *   under the CMS's uploads directory links the file and shows its name, the last path segment decoded,
 *   where the front end links `/media/…` to the same file (and as the front end's `uploadsPath()`, not when
 *   nothing follows the directory, a second slash does or the rest holds `%2f`, `%5c` or `%25`); a URL on
 *   the CMS's own host is kept only when its path, under the install's path, is `/resources` or below it,
 *   linked on the CMS's origin with the trailing slash every public URL has and shown as that path with
 *   its query and fragment, as the front end shows the root-relative path, and any other CMS URL
 *   (`/wp-admin/`, a page, the CMS's host on another port) gives no line; any other URL is external, shown
 *   as its host with a port that is not the scheme's default, and carries `rel="noopener noreferrer"`.
 *   Hosts compare without trailing dots, and on their name alone for the last of those tests, as the front
 *   end's `hostname()` does. The label of an internationalised host is its punycode, the front end's
 *   anti-spoofing rule: `аpple.example` with a Cyrillic "а" shows as `xn--pple-43d.example` and cannot
 *   pass for a Latin name. Of UTS 46's mapping only lower-casing is attempted (not NFC, full-width forms
 *   or the ideographic full stop), and a label longer than DNS allows gives no line where the front end
 *   would show it; either way a non-ASCII host is never shown as it came.
 * - **Links.** The row's title links `get_permalink()`, which is absolute: public paths are the same on
 *   both sites and the front end strips the CMS's origin from every link it renders (`packages/ui/README.md`,
 *   "Public URL shape"), so the path is the front end's `/resources/{type}/{slug}/`. The meta line's links
 *   are the front end's listing paths on the CMS's origin, `/resources/{type}/` and
 *   `/resources/topic/{topic}/` (`type_listing_url()`, `topic_listing_url()`), not core's term links,
 *   whose paths (`/resource-type/…`, `/resource-topic/…`) the front end has no route for.
 * - **The lead's image** is the front end's `featuredImage()` rule as far as the CMS can follow it
 *   (`apps/web/lib/wp/images.ts`): the resource's featured image, only when WordPress has measured it
 *   (an SVG has no width and height and gets no box), in a 16:9 box with its dimensions on the `<img>`
 *   so nothing moves when it lands, eager, at high fetch priority, with the front end's `sizes` for the
 *   lead's two-column layout (`SIZES`). The `<img>` itself cannot match: the front end's is `next/image`'s,
 *   with the optimizer's `src` and `srcset`, where this is `wp_get_attachment_image_src()`'s `large` size
 *   and core's `srcset` of the uploaded sizes. So the contract's lead fixtures hold a lead without an
 *   image, and the CMS's own test holds the box. The front end also preloads its image from the head,
 *   which no block can.
 * - **"Topics"** is the topics list's label in plain English, not `esc_attr__()`: the front end hard-codes
 *   it, so a translated label here would make the two sites' markup differ. "Untitled resource" is the
 *   front end's `UNTITLED` for the same reason.
 *
 * Which resources get markup at all is each caller's rule: the related list drops a resource whose title is
 * empty (`title()` is null) or that does not have exactly one type (`type()` is null); the card and the
 * meta line render nothing without exactly one type, and the card shows `UNTITLED` for an empty title, as
 * the front end's listing does.
 */
final class ResourceCardMarkup {
	/**
	 * The title a card shows when the resource's is empty as plain text: the front end's `UNTITLED`.
	 */
	public const UNTITLED = 'Untitled resource';

	/**
	 * The heading levels a row's title may take, as `ResourceCard`'s `headingLevel` prop allows.
	 */
	public const HEADINGS = array( 'h2', 'h3', 'h4' );

	/**
	 * The heading levels the lead's title may take, as `FeaturedLead`'s `headingLevel` prop allows.
	 */
	public const LEAD_HEADINGS = array( 'h2', 'h3' );

	/**
	 * `sizes` for the lead's image: the front end's `IMAGE_SIZES` (`apps/web/components/FeaturedLead.tsx`),
	 * derived there from `lead.css`'s two columns and the shell's width; change the three together.
	 */
	public const SIZES = '(min-width: 72rem) 39rem, (min-width: 44rem) 58vw, 100vw';

	/**
	 * The image size the lead's `<img>` names: WordPress's 1024-wide `large`, the smallest core size over
	 * the front end's 800 px minimum for a sharp lead at a device pixel ratio of two.
	 */
	public const IMAGE_SIZE = 'large';

	/**
	 * One resource as a row in `card.css`'s markup, as the front end's `ResourceCard` renders it.
	 *
	 * @param WP_Post $post    A published resource.
	 * @param string  $title   Its title as plain text, from `title()` or `UNTITLED`; escaped here.
	 * @param WP_Term $type    Its one type, from `type()`.
	 * @param string  $heading The title's element, one of `HEADINGS`; anything else is `h3`.
	 */
	public static function row( WP_Post $post, string $title, WP_Term $type, string $heading = 'h3' ): string {
		$heading = in_array( $heading, self::HEADINGS, true ) ? $heading : 'h3';
		$summary = (string) get_post_meta( $post->ID, Meta::SUMMARY, true );

		$html  = '<article class="rh-card">';
		$html .= self::meta_line( $post, $type );
		$html .= '<div class="rh-card__body">';
		$html .= '<' . $heading . ' class="rh-card__title"><a class="rh-card__link" href="' . esc_url( (string) get_permalink( $post ) ) . '">' . self::text_html( $title ) . '</a></' . $heading . '>';

		if ( '' !== $summary ) {
			$html .= '<p class="rh-card__summary">' . self::text_html( $summary ) . '</p>';
		}

		$html .= self::topics_list( $post );

		return $html . '</div></article>';
	}

	/**
	 * One resource as the library's lead in `lead.css`'s markup, as the front end's `FeaturedLead` renders it.
	 *
	 * @param WP_Post $post    A published resource.
	 * @param string  $title   Its title as plain text, from `title()` or `UNTITLED`; escaped here.
	 * @param WP_Term $type    Its one type, from `type()`.
	 * @param string  $heading The title's element, one of `LEAD_HEADINGS`; anything else is `h3`.
	 */
	public static function lead( WP_Post $post, string $title, WP_Term $type, string $heading = 'h3' ): string {
		$heading = in_array( $heading, self::LEAD_HEADINGS, true ) ? $heading : 'h3';
		$summary = (string) get_post_meta( $post->ID, Meta::SUMMARY, true );

		$html  = '<article class="rh-lead">';
		$html .= self::lead_media( $post );
		$html .= '<div class="rh-lead__body">';
		$html .= self::meta_line( $post, $type );
		$html .= '<' . $heading . ' class="rh-lead__title"><a class="rh-lead__link" href="' . esc_url( (string) get_permalink( $post ) ) . '">' . self::text_html( $title ) . '</a></' . $heading . '>';

		if ( '' !== $summary ) {
			$html .= '<p class="rh-lead__summary">' . self::text_html( $summary ) . '</p>';
		}

		$html .= self::topics_list( $post );

		return $html . '</div></article>';
	}

	/**
	 * The row's meta line: the type's name with its mark, and the date. Shared by the row and the lead.
	 *
	 * @param WP_Post $post The post.
	 * @param WP_Term $type Its one type.
	 */
	private static function meta_line( WP_Post $post, WP_Term $type ): string {
		return '<p class="rh-card__meta">'
			. '<span class="rh-card__type" data-accent="' . esc_attr( TypeAccents::accent( $type ) ) . '">' . self::text_html( self::plain_text( $type->name ) ) . '</span>'
			. self::time( $post )
			. '</p>';
	}

	/**
	 * The row's topics as plain labels in a list named "Topics", or nothing when there are none. Shared by the row and the lead.
	 *
	 * @param WP_Post $post The post.
	 */
	private static function topics_list( WP_Post $post ): string {
		$topics = self::term_names( $post, Taxonomies::TOPIC );

		if ( array() === $topics ) {
			return '';
		}

		$html = '<ul class="rh-card__topics" aria-label="Topics" role="list">';

		foreach ( $topics as $name ) {
			$html .= '<li class="rh-card__topic">' . self::text_html( $name ) . '</li>';
		}

		return $html . '</ul>';
	}

	/**
	 * The lead's image in its box, or nothing when the resource has no featured image WordPress has measured.
	 *
	 * @param WP_Post $post The post.
	 */
	private static function lead_media( WP_Post $post ): string {
		$id = (int) get_post_thumbnail_id( $post );

		if ( $id <= 0 ) {
			return '';
		}

		// Measured by WordPress, as the front end's rule asks of `media_details`: an SVG has no metadata and no box.
		$metadata = wp_get_attachment_metadata( $id );

		if ( ! is_array( $metadata ) || (int) ( $metadata['width'] ?? 0 ) <= 0 || (int) ( $metadata['height'] ?? 0 ) <= 0 ) {
			return '';
		}

		$image = wp_get_attachment_image_src( $id, self::IMAGE_SIZE );

		if ( ! is_array( $image ) || (int) $image[1] <= 0 || (int) $image[2] <= 0 ) {
			return '';
		}

		$alt    = (string) get_post_meta( $id, '_wp_attachment_image_alt', true );
		$srcset = wp_get_attachment_image_srcset( $id, self::IMAGE_SIZE );

		$html = '<div class="rh-lead__media"><img src="' . esc_url( (string) $image[0] ) . '" alt="' . esc_attr( $alt ) . '" width="' . (int) $image[1] . '" height="' . (int) $image[2] . '"';

		if ( is_string( $srcset ) && '' !== $srcset ) {
			$html .= ' srcset="' . esc_attr( $srcset ) . '"';
		}

		return $html . ' sizes="' . esc_attr( self::SIZES ) . '" loading="eager" fetchpriority="high" decoding="async"></div>';
	}

	/**
	 * A resource's meta line, as the front end's `ResourceArticle` renders it in the page's header.
	 *
	 * @param WP_Post $post A resource the caller may show: published, or readable by the current user (`ContextResource::readable()`).
	 * @param WP_Term $type Its one type, from `type()`.
	 */
	public static function meta( WP_Post $post, WP_Term $type ): string {
		$html  = '<div class="rh-resource__meta">';
		$html .= '<span class="rh-card__type" data-accent="' . esc_attr( TypeAccents::accent( $type ) ) . '">';
		$html .= '<a class="rh-resource__type" href="' . esc_url( self::type_listing_url( $type ) ) . '">' . self::text_html( self::plain_text( $type->name ) ) . '</a>';
		$html .= '</span>';
		$html .= self::time( $post );

		$topics = get_the_terms( $post, Taxonomies::TOPIC );

		if ( is_array( $topics ) && array() !== $topics ) {
			$html .= '<ul class="rh-card__topics" aria-label="Topics" role="list">';

			foreach ( $topics as $topic ) {
				$html .= '<li class="rh-card__topic"><a class="rh-resource__topic" href="' . esc_url( self::topic_listing_url( $topic ) ) . '">' . self::text_html( self::plain_text( $topic->name ) ) . '</a></li>';
			}

			$html .= '</ul>';
		}

		return $html . '</div>';
	}

	/**
	 * A resource's summary as the lead paragraph of the front end's resource page, or nothing (see the class docblock).
	 *
	 * @param WP_Post $post A resource the caller may show: published, or readable by the current user (`ContextResource::readable()`).
	 */
	public static function summary( WP_Post $post ): string {
		$text = self::collapse_whitespace( (string) get_post_meta( $post->ID, Meta::SUMMARY, true ) );

		return '' === $text ? '' : '<p class="rh-resource__summary">' . self::text_html( $text ) . '</p>';
	}

	/**
	 * A resource's source line as the front end's resource page prints it under the body, or nothing (see the class docblock).
	 *
	 * @param WP_Post $post A resource the caller may show: published, or readable by the current user (`ContextResource::readable()`).
	 */
	public static function source( WP_Post $post ): string {
		$link = self::source_link( (string) get_post_meta( $post->ID, Meta::SOURCE_URL, true ) );

		if ( null === $link ) {
			return '';
		}

		return '<footer class="rh-resource__source"><p>Source: <a href="' . esc_url( $link['href'] ) . '"'
			. ( $link['external'] ? ' rel="noopener noreferrer"' : '' ) . '>' . self::text_html( $link['label'] ) . '</a></p></footer>';
	}

	/**
	 * The post's title as the front end's card shows it, or null when that is empty.
	 *
	 * `hasVisibleTitle()` in `apps/web/lib/wp/cards.ts`: `plain_text()` of the rendered title, empty when
	 * nothing is left once JavaScript's whitespace (U+0009–U+000D, `\p{Z}`, NBSP among them, and U+FEFF)
	 * and the zero-width U+200B–U+200D are removed too, so `&nbsp;`, `&#8203;` or `<em></em>` alone is empty.
	 *
	 * The rendered title is `title.rendered` as the REST API gives it, which leaves out core's "Protected: "
	 * prefix on a password-protected post: the posts controller filters `protected_title_format` to `%s`
	 * while it renders, and so does this, for the one call, so a protected resource's row reads as the
	 * front end's does.
	 *
	 * @param WP_Post $post The post.
	 */
	public static function title( WP_Post $post ): ?string {
		add_filter( 'protected_title_format', array( self::class, 'bare_title_format' ) );
		$text = self::plain_text( get_the_title( $post ) );
		remove_filter( 'protected_title_format', array( self::class, 'bare_title_format' ) );

		return 1 === preg_match( '/^[\x{9}-\x{D}\p{Z}\x{200B}-\x{200D}\x{FEFF}]*$/u', $text ) ? null : $text;
	}

	/**
	 * The title format with no prefix, as the REST posts controller's `protected_title_format()` returns it.
	 *
	 * Public only so `title()` can hook it.
	 */
	public static function bare_title_format(): string {
		return '%s';
	}

	/**
	 * The post's one `resource_type` term, or null when it has none or several.
	 *
	 * Terms are counted, not names (the taxonomy is hierarchical, so two terms can share a name), as the
	 * front end's `resourceType()` counts the IDs in `resource_type`.
	 *
	 * @param WP_Post $post The post.
	 */
	public static function type( WP_Post $post ): ?WP_Term {
		$terms = get_the_terms( $post, Taxonomies::TYPE );

		return is_array( $terms ) && 1 === count( $terms ) ? reset( $terms ) : null;
	}

	/**
	 * The front end's listing path for a filter, `listingPath()` in `apps/web/lib/routes.ts`, on the CMS's origin:
	 * `/resources/`, `/resources/{type}/`, `/resources/topic/{topic}/` or `/resources/{type}/topic/{topic}/`.
	 *
	 * The slugs are stored ones, in the lower-case percent-encoded form the front end's `canonicalSlug()`
	 * writes (`SlugEscapes` keeps out the escapes its router would decode), so they go in as they are.
	 *
	 * @param string|null $type  A `resource_type` slug, or null.
	 * @param string|null $topic A `resource_topic` slug, or null.
	 */
	public static function listing_url( ?string $type, ?string $topic ): string {
		$path = '/resources/';

		if ( null !== $type && '' !== $type ) {
			$path .= $type . '/';
		}

		if ( null !== $topic && '' !== $topic ) {
			$path .= 'topic/' . $topic . '/';
		}

		return home_url( $path );
	}

	/**
	 * The front end's listing of one type, `/resources/{type}/`, on the CMS's origin.
	 *
	 * The slug is the stored one, which WordPress keeps in the lower-case percent-encoded form the front
	 * end's `canonicalSlug()` writes (`SlugEscapes` keeps out the escapes its router would decode).
	 *
	 * @param WP_Term $type A `resource_type` term.
	 */
	public static function type_listing_url( WP_Term $type ): string {
		return self::listing_url( $type->slug, null );
	}

	/**
	 * The front end's listing of one topic, `/resources/topic/{topic}/`, on the CMS's origin.
	 *
	 * @param WP_Term $topic A `resource_topic` term.
	 */
	public static function topic_listing_url( WP_Term $topic ): string {
		return self::listing_url( null, $topic->slug );
	}

	/**
	 * The `<time>` both lines carry: `date_gmt` as an ISO instant and as the front end's date.
	 *
	 * @param WP_Post $post The post.
	 */
	private static function time( WP_Post $post ): string {
		$timestamp = (int) get_post_time( 'U', true, $post );

		return '<time datetime="' . esc_attr( gmdate( 'Y-m-d\TH:i:s\Z', $timestamp ) ) . '">' . esc_html( gmdate( 'M j, Y', $timestamp ) ) . '</time>';
	}

	/**
	 * The names of a post's terms in one taxonomy as plain text, in `get_the_terms()` order, each once.
	 *
	 * Deduplicated after `plain_text()`, as the front end's `toCard()` puts the `plainText()` labels in a `Set`.
	 *
	 * @param WP_Post $post     The post.
	 * @param string  $taxonomy The taxonomy.
	 * @return string[]
	 */
	private static function term_names( WP_Post $post, string $taxonomy ): array {
		$terms = get_the_terms( $post, $taxonomy );

		if ( ! is_array( $terms ) ) {
			return array();
		}

		return array_values( array_unique( array_map( array( self::class, 'plain_text' ), wp_list_pluck( $terms, 'name' ) ) ) );
	}

	/**
	 * Text as the HTML React writes for it: every `&`, `<`, `>`, `"` and `'` encoded, an existing `&amp;` included.
	 *
	 * `htmlspecialchars()`, not `esc_html()`, which does not encode an `&` that already starts a reference.
	 * Public for the collection blocks, which print term names and counts the same way.
	 *
	 * @param string $text Plain text.
	 */
	public static function text_html( string $text ): string {
		return htmlspecialchars( $text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
	}

	/**
	 * HTML as the plain text the front end's `plainText()` gives (`apps/web/lib/wp/cards.ts`).
	 *
	 * Tags stripped, entities decoded, every run of JavaScript's `\s` collapsed to one space and trimmed.
	 * Public for the collection head, which names the terms it is filtered by and offers as the front end's
	 * `plainText()` does.
	 *
	 * @param string $html A rendered title or a stored term name.
	 */
	public static function plain_text( string $html ): string {
		return self::collapse_whitespace( html_entity_decode( wp_strip_all_tags( $html ), ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
	}

	/**
	 * Text with every run of JavaScript's `\s` collapsed to one space and the ends trimmed, the
	 * `replace(/\s+/g, " ").trim()` the front end applies to a plain-text title or name and to the page's summary.
	 *
	 * JavaScript's `\s` is spelled out as U+0009–U+000D, `\p{Z}` and U+FEFF, not PCRE's `\s`, which under
	 * `/u` also matches U+0085 (NEL), as JavaScript's does not.
	 *
	 * @param string $text Plain text.
	 */
	private static function collapse_whitespace( string $text ): string {
		return trim( (string) preg_replace( '/[\x{9}-\x{D}\p{Z}\x{FEFF}]+/u', ' ', $text ), ' ' );
	}

	/**
	 * The link the source line shows for a stored `source_url`, by the front end's `sourceLink()` rules (see
	 * the class docblock), or null for none.
	 *
	 * @param string $url The stored `source_url`.
	 * @return array{href: string, label: string, external: bool}|null
	 */
	private static function source_link( string $url ): ?array {
		$url   = trim( $url );
		$parts = '' === $url ? false : wp_parse_url( $url );

		if ( ! is_array( $parts ) || ! isset( $parts['scheme'], $parts['host'] ) || isset( $parts['user'] ) || isset( $parts['pass'] ) ) {
			return null;
		}

		$scheme = strtolower( $parts['scheme'] );
		$host   = self::hostname( $parts['host'] );

		if ( ! in_array( $scheme, array( 'http', 'https' ), true ) || null === $host ) {
			return null;
		}

		$key  = self::host_key( $host, $scheme, $parts['port'] ?? null );
		$path = self::resolved_path( $parts['path'] ?? '/' );
		$tail = ( '' !== ( $parts['query'] ?? '' ) ? '?' . $parts['query'] : '' ) . ( '' !== ( $parts['fragment'] ?? '' ) ? '#' . $parts['fragment'] : '' );

		// An upload: the file itself, shown by its name, as the front end links it under `/media/`.
		$uploads_url = wp_get_upload_dir()['baseurl'];
		$uploads     = self::configured_base( $uploads_url );

		if ( null !== $uploads && $uploads['key'] === $key && str_starts_with( $path, $uploads['prefix'] . '/' ) ) {
			$rest = substr( $path, strlen( $uploads['prefix'] ) + 1 );

			// The front end's `uploadsPath()`: no empty rest, no second slash, no escape a server could decode into a new segment.
			if ( '' !== $rest && ! str_starts_with( $rest, '/' ) && 1 !== preg_match( '/%(?:2f|5c|25)/i', $rest ) ) {
				$file = rawurldecode( substr( $rest, (int) strrpos( '/' . $rest, '/' ) ) );

				return array(
					'href'     => rtrim( $uploads_url, '/' ) . '/' . $rest . $tail,
					'label'    => '' === $file ? $path : $file,
					'external' => false,
				);
			}
		}

		// The CMS's own host: a front-end path under `/resources`, with its trailing slash, or nothing.
		$home = self::configured_base( home_url( '/' ) );

		if ( null !== $home && $home['key'] === $key ) {
			$prefix = $home['prefix'];
			$rest   = '' === $prefix ? $path : ( $path === $prefix ? '/' : ( str_starts_with( $path, $prefix . '/' ) ? substr( $path, strlen( $prefix ) ) : null ) );
			$rest   = null === $rest ? null : '/' . ltrim( $rest, '/' );

			if ( null === $rest || ( '/resources' !== $rest && ! str_starts_with( $rest, '/resources/' ) ) ) {
				return null;
			}

			$rest = trailingslashit( $rest ) . $tail;

			return array(
				'href'     => home_url( $rest ),
				'label'    => $rest,
				'external' => false,
			);
		}

		// Any other URL that names a CMS host, on another port say: the front end's last check gives it no link.
		if ( ( null !== $home && $home['host'] === $host ) || ( null !== $uploads && $uploads['host'] === $host ) ) {
			return null;
		}

		return array(
			'href'     => $url,
			'label'    => $key,
			'external' => true,
		);
	}

	/**
	 * A configured URL (the home URL, the uploads directory's) as the source line compares with it: its
	 * host, its host key and its path without trailing slashes, as the front end's `configuredBase()`.
	 *
	 * @param string $url The configured URL.
	 * @return array{host: string, key: string, prefix: string}|null
	 */
	private static function configured_base( string $url ): ?array {
		$parts = wp_parse_url( $url );
		$host  = is_array( $parts ) && isset( $parts['host'] ) ? self::hostname( $parts['host'] ) : null;

		if ( null === $host ) {
			return null;
		}

		return array(
			'host'   => $host,
			'key'    => self::host_key( $host, strtolower( (string) ( $parts['scheme'] ?? 'https' ) ), $parts['port'] ?? null ),
			'prefix' => rtrim( $parts['path'] ?? '', '/' ),
		);
	}

	/**
	 * A URL's host as the front end's URL parser gives `hostname`, every trailing dot removed, or null
	 * where that parser refuses it.
	 *
	 * Percent escapes decoded, then refused when it holds one of the WHATWG URL standard's forbidden domain
	 * code points or is not UTF-8, then lower-cased and, when anything in it is not ASCII, written in
	 * punycode with `IdnaEncoder` (core's Requests library, so the intl extension is not needed), as the
	 * parser's IDNA step writes it: `аpple.example` with a Cyrillic "а" is `xn--pple-43d.example`. An IPv6
	 * literal is kept as it came, lower-cased.
	 *
	 * @param string $host The host `wp_parse_url()` found.
	 */
	private static function hostname( string $host ): ?string {
		if ( str_starts_with( $host, '[' ) ) {
			return strtolower( $host );
		}

		$host = rawurldecode( $host );

		if ( '' === $host || 1 === preg_match( '/[\x00-\x20#\/:<>?@\[\\\\\]^|%\x7F]/', $host ) || 1 !== preg_match( '//u', $host ) ) {
			return null;
		}

		$host = function_exists( 'mb_strtolower' ) ? mb_strtolower( $host, 'UTF-8' ) : strtolower( $host );

		if ( 1 === preg_match( '/[^\x00-\x7F]/', $host ) ) {
			try {
				$host = strtolower( IdnaEncoder::encode( $host ) );
			} catch ( RequestsException $e ) {
				return null;
			}
		}

		return rtrim( $host, '.' );
	}

	/**
	 * A host as the front end's `hostKey()` compares it: the host, with its port when that is not the scheme's default.
	 *
	 * @param string          $host   The host, from `hostname()`.
	 * @param string          $scheme The URL's scheme, lower-cased.
	 * @param int|string|null $port   The URL's port, if it has one.
	 */
	private static function host_key( string $host, string $scheme, int|string|null $port ): string {
		$default = 'http' === $scheme ? 80 : 443;

		return null !== $port && (int) $port !== $default ? $host . ':' . (int) $port : $host;
	}

	/**
	 * A URL's path with its dot segments resolved, as the WHATWG URL parser resolves them for an http(s) URL.
	 *
	 * A backslash is a slash; a segment that is `.` or `%2e` is dropped, and one that is `..` or any mix of
	 * `.` and `%2e` (in either case) drops the segment before it; either as the last segment leaves a
	 * trailing slash. So `/wp-content/uploads/../../wp-admin/export.php` and its `%2e%2e` form are
	 * `/wp-admin/export.php`, and `/resources/../wp-admin/` is `/wp-admin/`, the paths the front end and a
	 * browser read. Nothing else is decoded.
	 *
	 * @param string $path The path `wp_parse_url()` found, starting with `/`.
	 */
	private static function resolved_path( string $path ): string {
		$path     = str_replace( '\\', '/', $path );
		$segments = explode( '/', substr( str_starts_with( $path, '/' ) ? $path : '/' . $path, 1 ) );
		$last     = array_key_last( $segments );
		$resolved = array();

		foreach ( $segments as $index => $segment ) {
			$dots = str_ireplace( '%2e', '.', $segment );

			if ( '..' === $dots ) {
				array_pop( $resolved );
			} elseif ( '.' !== $dots ) {
				$resolved[] = $segment;
				continue;
			}

			if ( $index === $last ) {
				$resolved[] = '';
			}
		}

		return '/' . implode( '/', $resolved );
	}
}
