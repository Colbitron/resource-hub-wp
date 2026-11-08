<?php
/**
 * The front end's card markup in PHP: the row, the resource page's meta line, and the text rules they share.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\Taxonomies;
use WP_Post;
use WP_Term;

/**
 * One renderer for every block that writes a resource the way the front end does.
 *
 * Three blocks use it: `resource-hub/related-resources` (its rows, at `h3`), `resource-hub/resource-card`
 * (one row in a post template) and `resource-hub/resource-meta` (the single resource page's meta line).
 * The markup is the front end's, element for element, class for class and attribute for attribute, in
 * the front end's order: `row()` is `ResourceCard` (`apps/web/components/ResourceCard.tsx`) and `meta()`
 * is the meta line `ResourceArticle` writes in its header (`apps/web/components/ResourceArticle.tsx`).
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
 *     meta(): <div class="rh-resource__meta">
 *               <span class="rh-card__type" data-accent="{accent}"><a class="rh-resource__type" href="{type listing}">{type}</a></span>
 *               <time datetime="{ISO}">{Nov 1, 2026}</time>
 *               <ul class="rh-card__topics" aria-label="Topics" role="list">                   (when it has topics)
 *                 <li class="rh-card__topic"><a class="rh-resource__topic" href="{topic listing}">{topic}</a></li>…
 *               </ul>
 *             </div>
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
 * - **The summary** is the stored `summary` meta as it is, the front end's `meta.summary`, which it renders
 *   as React text with nothing stripped, decoded or collapsed: `MetaRules::sanitize_summary()` already
 *   stores plain text, so an entity left in it (`Caf&eacute;`) is literal text on both sites. Its `<p>` is
 *   left out only when it is the empty string, the front end's `summary &&` test, so a summary of `0`
 *   still gets one. Only the row shows it; the resource page's summary is not part of the meta line.
 * - **Links.** The row's title links `get_permalink()`, which is absolute: public paths are the same on
 *   both sites and the front end strips the CMS's origin from every link it renders (`packages/ui/README.md`,
 *   "Public URL shape"), so the path is the front end's `/resources/{type}/{slug}/`. The meta line's links
 *   are the front end's listing paths on the CMS's origin, `/resources/{type}/` and
 *   `/resources/topic/{topic}/` (`type_listing_url()`, `topic_listing_url()`), not core's term links,
 *   whose paths (`/resource-type/…`, `/resource-topic/…`) the front end has no route for.
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
	 * One resource as a row in `card.css`'s markup, as the front end's `ResourceCard` renders it.
	 *
	 * @param WP_Post $post    A published resource.
	 * @param string  $title   Its title as plain text, from `title()` or `UNTITLED`; escaped here.
	 * @param WP_Term $type    Its one type, from `type()`.
	 * @param string  $heading The title's element, one of `HEADINGS`; anything else is `h3`.
	 */
	public static function row( WP_Post $post, string $title, WP_Term $type, string $heading = 'h3' ): string {
		$heading = in_array( $heading, self::HEADINGS, true ) ? $heading : 'h3';
		$topics  = self::term_names( $post, Taxonomies::TOPIC );
		$summary = (string) get_post_meta( $post->ID, Meta::SUMMARY, true );

		$html  = '<article class="rh-card">';
		$html .= '<p class="rh-card__meta">';
		$html .= '<span class="rh-card__type" data-accent="' . esc_attr( TypeAccents::accent( $type ) ) . '">' . self::text_html( self::plain_text( $type->name ) ) . '</span>';
		$html .= self::time( $post );
		$html .= '</p>';
		$html .= '<div class="rh-card__body">';
		$html .= '<' . $heading . ' class="rh-card__title"><a class="rh-card__link" href="' . esc_url( (string) get_permalink( $post ) ) . '">' . self::text_html( $title ) . '</a></' . $heading . '>';

		if ( '' !== $summary ) {
			$html .= '<p class="rh-card__summary">' . self::text_html( $summary ) . '</p>';
		}

		if ( array() !== $topics ) {
			$html .= '<ul class="rh-card__topics" aria-label="Topics" role="list">';

			foreach ( $topics as $name ) {
				$html .= '<li class="rh-card__topic">' . self::text_html( $name ) . '</li>';
			}

			$html .= '</ul>';
		}

		return $html . '</div></article>';
	}

	/**
	 * A resource's meta line, as the front end's `ResourceArticle` renders it in the page's header.
	 *
	 * @param WP_Post $post A published resource.
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
	 * The post's title as the front end's card shows it, or null when that is empty.
	 *
	 * `hasVisibleTitle()` in `apps/web/lib/wp/cards.ts`: `plain_text()` of the rendered title, empty when
	 * nothing is left once JavaScript's whitespace (U+0009–U+000D, `\p{Z}`, NBSP among them, and U+FEFF)
	 * and the zero-width U+200B–U+200D are removed too, so `&nbsp;`, `&#8203;` or `<em></em>` alone is empty.
	 *
	 * @param WP_Post $post The post.
	 */
	public static function title( WP_Post $post ): ?string {
		$text = self::plain_text( get_the_title( $post ) );

		return 1 === preg_match( '/^[\x{9}-\x{D}\p{Z}\x{200B}-\x{200D}\x{FEFF}]*$/u', $text ) ? null : $text;
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
	 * The front end's listing of one type, `/resources/{type}/`, on the CMS's origin.
	 *
	 * The slug is the stored one, which WordPress keeps in the lower-case percent-encoded form the front
	 * end's `canonicalSlug()` writes (`SlugEscapes` keeps out the escapes its router would decode).
	 *
	 * @param WP_Term $type A `resource_type` term.
	 */
	public static function type_listing_url( WP_Term $type ): string {
		return home_url( '/resources/' . $type->slug . '/' );
	}

	/**
	 * The front end's listing of one topic, `/resources/topic/{topic}/`, on the CMS's origin.
	 *
	 * @param WP_Term $topic A `resource_topic` term.
	 */
	public static function topic_listing_url( WP_Term $topic ): string {
		return home_url( '/resources/topic/' . $topic->slug . '/' );
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
	 *
	 * @param string $text Plain text.
	 */
	private static function text_html( string $text ): string {
		return htmlspecialchars( $text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
	}

	/**
	 * HTML as the plain text the front end's `plainText()` gives (`apps/web/lib/wp/cards.ts`).
	 *
	 * Tags stripped, entities decoded, every run of JavaScript's `\s` collapsed to one space and trimmed.
	 * JavaScript's `\s` is spelled out as U+0009–U+000D, `\p{Z}` and U+FEFF, not PCRE's `\s`, which under
	 * `/u` also matches U+0085 (NEL), as JavaScript's does not.
	 *
	 * @param string $html A rendered title or a stored term name.
	 */
	private static function plain_text( string $html ): string {
		$text = html_entity_decode( wp_strip_all_tags( $html ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );

		return trim( (string) preg_replace( '/[\x{9}-\x{D}\p{Z}\x{FEFF}]+/u', ' ', $text ), ' ' );
	}
}
