<?php
/**
 * The `resource-hub/related-resources` block: its registration and its server render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_Block;
use WP_Post;
use WP_Query;
use WP_Term;

/**
 * Registers the block from its compiled copy and renders the contract's marker around rows of resources.
 *
 * One job (issue #50): the newest `count` published resources in one `resource_topic` term, leaving out
 * the post the block sits in, on any host post type. No picks, no fill from other topics.
 *
 * Registration reads `build/related-resources/block.json`, not `blocks/related-resources/block.json`:
 * the deploy syncs `build/` and `src/` to the host and leaves `blocks/` behind (`.depot/workflows/ci.yml`,
 * "Sync the plugin"), and the compiled `block.json` sits beside the script and the stylesheet it names.
 * Without a build the block is simply not registered, as the editor scripts are not enqueued without
 * theirs; `pnpm build` is part of running the plugin (`README.md`). The stylesheet is the shared
 * package's `tokens.css` and `card.css`, inlined into `build/related-resources/style-index.css` by the
 * build and listed as the block's `style`, so core enqueues it where the block is used and nowhere else.
 *
 * The render is the contract's marker (`packages/ui/README.md`, "Block marker") around the heading and
 * rows in `card.css`'s markup, the same rows the front end's `ResourceCard` renders, titles at `h3`:
 *
 *     <div class="rh-related …" data-rh-block="related-resources" data-count="3" data-topic="{slug}"
 *          data-topic-id="{id}" data-exclude="{post id}">
 *       <h2>{heading}</h2>
 *       <ul class="rh-card-grid" role="list"><li><article class="rh-card">
 *         <p class="rh-card__meta"><span class="rh-card__type" data-accent="{accent}">{type}</span><time datetime="{ISO}">{Nov 1, 2026}</time></p>
 *         <div class="rh-card__body">
 *           <h3 class="rh-card__title"><a class="rh-card__link" href="{permalink}">{title}</a></h3>
 *           <p class="rh-card__summary">{summary}</p>                                   (when it has one)
 *           <ul class="rh-card__topics" aria-label="Topics" role="list"><li class="rh-card__topic">{topic}</li>…</ul>
 *         </div>                                                                         (topics when it has any)
 *       </article></li>…</ul>
 *     </div>
 *
 * The rows are the card's markup because the CMS's own pages and the editor preview then show the
 * same rows the front end shows, styled by the stylesheet the block already loads; the front end swaps
 * the whole wrapper for its own component and reads only the `data-*` attributes and the `<h2>`'s
 * text, so what is inside the wrapper costs it nothing. The type's span carries `data-accent` from the
 * shared type-accent table (`TypeAccents`), the type's accent or `neutral`, as the front end's
 * `ResourceCard` writes it, so the CMS's own pages mark each type as the site does; the front end drops
 * the attribute from the rows it keeps as its fallback. The date is `date_gmt` in UTC, as an ISO instant in `datetime` and as
 * "Nov 1, 2026" in the text, the front end's format (`apps/web/lib/dates.ts`). Every text in a row is
 * the text the front end's card prints, escaped with `htmlspecialchars()`, which encodes every `&` as
 * React escapes text, where `esc_html()` would leave an `&amp;` already in the text alone (so a title
 * `Tips &amp;amp; tricks` or a summary `Tips &amp; tricks` reads "Tips &amp; tricks" on both sites):
 *
 * - The title (`get_the_title()`, as `title.rendered`), the type's name and each topic's name are plain
 *   text, as the front end's `plainText()` makes them (`apps/web/lib/wp/cards.ts`): tags stripped,
 *   entities decoded, runs of whitespace collapsed to one space and trimmed (`plain_text()`). The names
 *   are the stored `name`, the string the REST API embeds; core stores `&` in it as `&amp;`, so most
 *   names read the same either way, but `Caf&eacute;`, `A&nbsp;&nbsp;B` or markup a PHP caller saved do
 *   not. A name that is empty as plain text keeps its (empty) element, as the front end keeps it. Exact
 *   parity is not attempted for two cases, reachable only with `unfiltered_html` or rare:
 *   `wp_strip_all_tags()` removes a `<script>` or `<style>` element's contents where the front end keeps
 *   their text, which is the safer side; and `html_entity_decode()` reads a reference with no semicolon,
 *   or a numeric one in the C1 range, differently from htmlparser2.
 * - Topics are in `get_the_terms()` order, which is the order the REST API lists them in, each once as
 *   plain text: the front end dedupes after `plainText()`, so `A&nbsp;B` and `A B` are one topic.
 * - The summary is the stored `summary` meta as it is, the front end's `meta.summary`, which it renders
 *   as React text with nothing stripped, decoded or collapsed: `MetaRules::sanitize_summary()` already
 *   stores plain text, so an entity left in it (`Caf&eacute;`) is literal text on both sites. Its `<p>`
 *   is left out only when it is the empty string, the front end's `summary &&` test, so a summary of
 *   `0` still gets one.
 *
 * - **Dropped rows.** A resource whose title is empty, or that does not have exactly one type, gets no
 *   row at all: no "Untitled resource" row, no typeless row. "Empty" is the front end's test
 *   (`cardTitle()`): nothing left of the plain-text title once JavaScript's whitespace (U+0009–U+000D,
 *   `\p{Z}`, NBSP among them, and U+FEFF) and the zero-width U+200B–U+200D are removed, so `&nbsp;`, `&#8203;` or `<em></em>`
 *   alone is empty. "Exactly one type" counts the `resource_type` terms directly, not names, as the
 *   front end's `resourceType()` counts IDs, since the taxonomy is hierarchical and two terms can share
 *   a name; only a PHP caller can publish a resource with no type or two (ADR 0024). Typeless ones
 *   never come back from SQL (an `EXISTS` clause on `resource_type`); the PHP check catches the rest.
 *   The drops happen in the same pass as the host's exclusion, before the list is cut to `count`, so
 *   a list emptied by drops renders the one-line `<p>`.
 * - `topic` is the term's ID, chosen in the editor, never a slug: a renamed topic keeps working, and
 *   `data-topic` is the term's *current* slug, resolved here on every render, so the front end's
 *   `topic:{slug}` tag names the right topic after a rename. `data-topic-id` saves the front end a
 *   term lookup for its `resource_topic` REST filter.
 * - No topic, or a stored term that no longer exists, renders nothing: an empty string, no wrapper.
 *   The editor shows a placeholder or a warning in those two cases (`blocks/related-resources/edit.js`).
 *   A topic with no other published resource renders the wrapper, the heading and a one-line `<p>`.
 * - `count` is clamped to 1–10 here as well as in the editor, since a saved attribute can be edited in
 *   the code editor and the front end rejects a marker outside that range.
 * - `data-exclude` is the host post from the block's `postId` context, which the editor preview sends
 *   as the post being edited and `do_blocks()` sets from the global post. The host is left out of the
 *   list here, by fetching one more row than `count` and dropping its ID in PHP, rather than with
 *   `post__not_in`, which the VIP ruleset flags because MySQL cannot use an index for it. With no host
 *   post (a template part outside a post) the attribute is `0`, which the front end treats as an
 *   invalid marker and renders as the fallback.
 * - The query over-fetches `count + 1 + SLACK` rows, one for the host and `SLACK` for dropped rows,
 *   so `count` stays filled when a few of the newest are dropped. When more than `SLACK` of them are
 *   dropped, fewer than `count` rows come back. A type violation is something only a PHP caller can
 *   make, but an editor can publish a blank-titled resource, so it is not out of reach; a shorter list
 *   is still cheaper than a second query. The extra rows cost no extra queries: the
 *   priming below covers every row fetched, before any is filtered.
 * - Only published resources, newest first (date, then ID, so equal dates order the same way every
 *   time), and `no_found_rows` because nothing paginates. The query primes the term cache and the meta
 *   cache in one query each: every row reads its type and topics, `get_permalink()` reads the type
 *   again (`Permalink::fill_type`), and the summary is post meta, so without the priming each row
 *   would cost its own lookups. The query is by `tax_query`, the one query this block exists to run,
 *   with a line-level PHPCS ignore that says why.
 * - A heading left empty means "More on {topic name}". Every attribute and every text node is escaped
 *   here; the title, the term names, the summary and the permalink come from core, which does not
 *   escape them. The heading keeps `esc_html()` and the raw name: the front end reads the `<h2>`'s text
 *   back out of the HTML rather than rendering the name itself.
 */
final class RelatedResourcesBlock {
	/**
	 * The block name, as in `block.json`.
	 */
	public const NAME = 'resource-hub/related-resources';

	/**
	 * The value of the marker's `data-rh-block` attribute.
	 */
	public const MARKER = 'related-resources';

	/**
	 * The wrapper's class, part of the contract.
	 */
	public const CLASS_NAME = 'rh-related';

	/**
	 * The smallest, the largest and the default `count`, matching `block.json` and the contract.
	 */
	public const MIN_COUNT     = 1;
	public const MAX_COUNT     = 10;
	public const DEFAULT_COUNT = 3;

	/**
	 * How many rows past `count + 1` the query fetches, so dropped rows do not shorten the list.
	 */
	public const SLACK = 5;

	/**
	 * Hooks the registration onto `init`.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	/**
	 * Registers the block from `build/related-resources/`, when the build exists.
	 */
	public function register_block(): void {
		$dir = dirname( __DIR__, 2 ) . '/build/related-resources';

		if ( ! is_readable( $dir . '/block.json' ) ) {
			return;
		}

		register_block_type( $dir, array( 'render_callback' => array( $this, 'render' ) ) );
	}

	/**
	 * Renders the marker, or nothing without a topic.
	 *
	 * @param array<string, mixed> $attributes The block's attributes.
	 * @param string               $content    The saved content, always empty for this block.
	 * @param WP_Block             $block      The block being rendered, for its context.
	 */
	public function render( array $attributes, string $content, WP_Block $block ): string {
		$term = $this->topic( $attributes );

		if ( null === $term ) {
			return '';
		}

		$count   = self::clamp_count( $attributes['count'] ?? self::DEFAULT_COUNT );
		$exclude = $this->host_post_id( $block );
		$rows    = $this->newest_in_topic( $term, $count, $exclude );
		$heading = trim( (string) ( $attributes['heading'] ?? '' ) );

		if ( '' === $heading ) {
			/* translators: %s: the topic's name. */
			$heading = sprintf( __( 'More on %s', 'resource-hub' ), $term->name );
		}

		$wrapper = get_block_wrapper_attributes(
			array(
				'class'         => self::CLASS_NAME,
				'data-rh-block' => self::MARKER,
				'data-count'    => (string) $count,
				'data-topic'    => $term->slug,
				'data-topic-id' => (string) $term->term_id,
				'data-exclude'  => (string) $exclude,
			)
		);

		$html = '<div ' . $wrapper . '>';

		$html .= '<h2>' . esc_html( $heading ) . '</h2>';

		if ( array() === $rows ) {
			$html .= '<p>' . esc_html__( 'No other resources in this topic yet.', 'resource-hub' ) . '</p>';
		} else {
			$html .= '<ul class="rh-card-grid" role="list">';

			foreach ( $rows as $row ) {
				$html .= '<li>' . $this->row( $row['post'], $row['title'], $row['type'] ) . '</li>';
			}

			$html .= '</ul>';
		}

		return $html . '</div>';
	}

	/**
	 * One resource as a row in `card.css`'s markup, as the front end's `ResourceCard` renders it at `h3`.
	 *
	 * @param WP_Post $post  A published resource.
	 * @param string  $title Its title as plain text, from `card_title()`; escaped with `text_html()`, see the class docblock.
	 * @param WP_Term $type  Its one type, from `card_type()`.
	 */
	private function row( WP_Post $post, string $title, WP_Term $type ): string {
		$timestamp = (int) get_post_time( 'U', true, $post );
		$topics    = $this->term_names( $post, Taxonomies::TOPIC );
		$summary   = (string) get_post_meta( $post->ID, Meta::SUMMARY, true );

		$html  = '<article class="rh-card">';
		$html .= '<p class="rh-card__meta">';
		$html .= '<span class="rh-card__type" data-accent="' . esc_attr( TypeAccents::accent( $type ) ) . '">' . self::text_html( self::plain_text( $type->name ) ) . '</span>';
		$html .= '<time datetime="' . esc_attr( gmdate( 'Y-m-d\TH:i:s\Z', $timestamp ) ) . '">' . esc_html( gmdate( 'M j, Y', $timestamp ) ) . '</time>';
		$html .= '</p>';
		$html .= '<div class="rh-card__body">';
		$html .= '<h3 class="rh-card__title"><a class="rh-card__link" href="' . esc_url( (string) get_permalink( $post ) ) . '">' . self::text_html( $title ) . '</a></h3>';

		if ( '' !== $summary ) {
			$html .= '<p class="rh-card__summary">' . self::text_html( $summary ) . '</p>';
		}

		if ( array() !== $topics ) {
			// Plain English, not `esc_attr__()`: the front end's `ResourceCard` hard-codes "Topics", so a
			// translated label here would make the CMS's rows and the front end's differ.
			$html .= '<ul class="rh-card__topics" aria-label="Topics" role="list">';

			foreach ( $topics as $name ) {
				$html .= '<li class="rh-card__topic">' . self::text_html( $name ) . '</li>';
			}

			$html .= '</ul>';
		}

		return $html . '</div></article>';
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
	private function term_names( WP_Post $post, string $taxonomy ): array {
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
	 * React writes `'` as `&#x27;` and this as `&#039;`: the same character in the page.
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

	/**
	 * The post's title as the front end's card shows it, or null when that is empty and the row is dropped.
	 *
	 * `cardTitle()` in `apps/web/lib/wp/cards.ts`: `plain_text()` of the rendered title, empty when nothing
	 * is left once whitespace and the zero-width U+200B–U+200D are removed too.
	 *
	 * @param WP_Post $post The post.
	 */
	private static function card_title( WP_Post $post ): ?string {
		$text = self::plain_text( get_the_title( $post ) );

		return 1 === preg_match( '/^[\x{9}-\x{D}\p{Z}\x{200B}-\x{200D}\x{FEFF}]*$/u', $text ) ? null : $text;
	}

	/**
	 * The post's one `resource_type` term, or null when it has none or several and the row is dropped.
	 *
	 * Terms are counted, not names (the taxonomy is hierarchical, so two terms can share a name), as the
	 * front end's `resourceType()` counts the IDs in `resource_type`.
	 *
	 * @param WP_Post $post The post.
	 */
	private static function card_type( WP_Post $post ): ?WP_Term {
		$terms = get_the_terms( $post, Taxonomies::TYPE );

		return is_array( $terms ) && 1 === count( $terms ) ? reset( $terms ) : null;
	}

	/**
	 * Clamps a stored `count` to the contract's range; anything that is not a number is the default.
	 *
	 * @param mixed $value The stored attribute.
	 */
	public static function clamp_count( mixed $value ): int {
		if ( ! is_numeric( $value ) ) {
			return self::DEFAULT_COUNT;
		}

		return max( self::MIN_COUNT, min( self::MAX_COUNT, (int) $value ) );
	}

	/**
	 * The chosen topic, or null when none is chosen or the term is gone.
	 *
	 * @param array<string, mixed> $attributes The block's attributes.
	 */
	private function topic( array $attributes ): ?WP_Term {
		$id = $attributes['topic'] ?? 0;

		if ( ! is_numeric( $id ) || (int) $id <= 0 ) {
			return null;
		}

		$term = get_term( (int) $id, Taxonomies::TOPIC );

		return $term instanceof WP_Term ? $term : null;
	}

	/**
	 * The post the block sits in: the `postId` context, else the global post, else 0.
	 *
	 * @param WP_Block $block The block being rendered.
	 */
	private function host_post_id( WP_Block $block ): int {
		$id = $block->context['postId'] ?? get_the_ID();

		return is_numeric( $id ) && (int) $id > 0 ? (int) $id : 0;
	}

	/**
	 * The newest `count` published resources in the topic that get a row, without the host post.
	 *
	 * Fewer than `count` when more than `SLACK` of the newest are dropped (see the class docblock).
	 *
	 * @param WP_Term $term    The topic.
	 * @param int     $count   How many to return.
	 * @param int     $exclude The host post's ID, or 0.
	 * @return array<int, array{post: WP_Post, title: string, type: WP_Term}>
	 */
	private function newest_in_topic( WP_Term $term, int $count, int $exclude ): array {
		$query = new WP_Query(
			array(
				'post_type'           => PostType::NAME,
				'post_status'         => 'publish',
				'posts_per_page'      => $count + 1 + self::SLACK,
				'orderby'             => array(
					'date' => 'DESC',
					'ID'   => 'DESC',
				),
				'no_found_rows'       => true,
				'ignore_sticky_posts' => true,
				'tax_query'           => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query -- The topic query is the block's one job; the scale path (search-backed or precomputed lists) is out of scope here.
					'relation' => 'AND',
					array(
						'taxonomy' => Taxonomies::TOPIC,
						'field'    => 'term_id',
						'terms'    => array( $term->term_id ),
					),
					array(
						'taxonomy' => Taxonomies::TYPE,
						'operator' => 'EXISTS',
					),
				),
			)
		);

		$rows = array();

		foreach ( $query->posts as $post ) {
			if ( $post->ID === $exclude ) {
				continue;
			}

			$title = self::card_title( $post );
			$type  = self::card_type( $post );

			if ( null !== $title && null !== $type ) {
				$rows[] = array(
					'post'  => $post,
					'title' => $title,
					'type'  => $type,
				);
			}

			if ( count( $rows ) >= $count ) {
				break;
			}
		}

		return $rows;
	}
}
