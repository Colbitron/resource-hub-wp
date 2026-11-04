<?php
/**
 * Seeds the resources library with fictional sample content.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Seed;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_Term;

/**
 * Plain PHP seeder with no output, so PHPUnit can call it directly. `wp resource-hub seed` wraps it.
 *
 * Everything is looked up by slug before it is created, so running the seeder twice leaves the
 * same content in place. The catalogue is invented: generic titles, placeholder prose, and source
 * URLs on the IANA-reserved example domains.
 */
final class Seeder {
	/**
	 * Resources created when no count is given.
	 */
	public const DEFAULT_COUNT = 12;

	/**
	 * The five resource types, slug => label.
	 */
	public const TYPES = array(
		'article'    => 'Article',
		'ebook'      => 'Ebook',
		'webinar'    => 'Webinar',
		'podcast'    => 'Podcast',
		'case-study' => 'Case study',
	);

	/**
	 * Topics the sample resources are spread across, slug => label.
	 */
	public const TOPICS = array(
		'content-modelling'  => 'Content modelling',
		'headless-delivery'  => 'Headless delivery',
		'editorial-workflow' => 'Editorial workflow',
		'performance'        => 'Performance',
		'accessibility'      => 'Accessibility',
	);

	/**
	 * The sample catalogue. Each entry: slug, title, type, topics, summary, source_url, featured.
	 *
	 * @var array<int, array{slug: string, title: string, type: string, topics: string[], summary: string, source_url: string, featured: bool}>
	 */
	private const CATALOGUE = array(
		array(
			'slug'       => 'modelling-content-for-more-than-one-screen',
			'title'      => 'Modelling content for more than one screen',
			'type'       => 'article',
			'topics'     => array( 'content-modelling', 'headless-delivery' ),
			'summary'    => 'Why a content model built around fields rather than layouts survives a redesign, with a worked example of splitting a landing page into reusable parts.',
			'source_url' => '',
			'featured'   => true,
		),
		array(
			'slug'       => 'the-headless-handbook',
			'title'      => 'The headless handbook',
			'type'       => 'ebook',
			'topics'     => array( 'headless-delivery' ),
			'summary'    => 'A short guide to running a CMS and a front end as separate systems: what each owns, how they talk, and where the seams tend to leak.',
			'source_url' => 'https://example.com/downloads/the-headless-handbook',
			'featured'   => true,
		),
		array(
			'slug'       => 'editorial-review-without-the-bottleneck',
			'title'      => 'Editorial review without the bottleneck',
			'type'       => 'webinar',
			'topics'     => array( 'editorial-workflow' ),
			'summary'    => 'A recorded session on review queues, roles, and the handful of statuses a small team actually needs.',
			'source_url' => 'https://example.org/events/editorial-review-without-the-bottleneck',
			'featured'   => false,
		),
		array(
			'slug'       => 'measuring-what-readers-feel',
			'title'      => 'Measuring what readers feel',
			'type'       => 'podcast',
			'topics'     => array( 'performance' ),
			'summary'    => 'Two engineers talk through the field metrics that track with reader frustration and the lab numbers that do not.',
			'source_url' => 'https://example.net/episodes/measuring-what-readers-feel',
			'featured'   => false,
		),
		array(
			'slug'       => 'a-library-relaunch-in-six-weeks',
			'title'      => 'A library relaunch in six weeks',
			'type'       => 'case-study',
			'topics'     => array( 'headless-delivery', 'editorial-workflow' ),
			'summary'    => 'How a fictional publisher moved a filterable library to a headless front end while editors kept publishing throughout.',
			'source_url' => '',
			'featured'   => true,
		),
		array(
			'slug'       => 'taxonomies-versus-fields',
			'title'      => 'Taxonomies versus fields',
			'type'       => 'article',
			'topics'     => array( 'content-modelling' ),
			'summary'    => 'When a property of a thing should be a term and when it should be a field, with the query shapes each one makes cheap or expensive.',
			'source_url' => '',
			'featured'   => false,
		),
		array(
			'slug'       => 'accessible-cards-and-lists',
			'title'      => 'Accessible cards and lists',
			'type'       => 'ebook',
			'topics'     => array( 'accessibility' ),
			'summary'    => 'Patterns for card grids and filter controls that work with a keyboard and a screen reader, with the mistakes most often found in audits.',
			'source_url' => 'https://example.com/downloads/accessible-cards-and-lists',
			'featured'   => false,
		),
		array(
			'slug'       => 'caching-a-content-api',
			'title'      => 'Caching a content API',
			'type'       => 'webinar',
			'topics'     => array( 'performance', 'headless-delivery' ),
			'summary'    => 'Where to cache between a CMS and a front end, how long, and how to invalidate on publish without a stale-page incident.',
			'source_url' => 'https://example.org/events/caching-a-content-api',
			'featured'   => false,
		),
		array(
			'slug'       => 'the-editor-is-the-customer',
			'title'      => 'The editor is the customer',
			'type'       => 'podcast',
			'topics'     => array( 'editorial-workflow' ),
			'summary'    => 'A conversation about building publishing tools for the people who use them every day, not the people who sign off on them.',
			'source_url' => 'https://example.net/episodes/the-editor-is-the-customer',
			'featured'   => false,
		),
		array(
			'slug'       => 'one-model-five-kinds-of-content',
			'title'      => 'One model, five kinds of content',
			'type'       => 'case-study',
			'topics'     => array( 'content-modelling' ),
			'summary'    => 'A fictional team weighs a post type per content kind against one type with a kind taxonomy, and what changed their minds.',
			'source_url' => '',
			'featured'   => false,
		),
		array(
			'slug'       => 'alt-text-at-scale',
			'title'      => 'Alt text at scale',
			'type'       => 'article',
			'topics'     => array( 'accessibility', 'editorial-workflow' ),
			'summary'    => 'A workflow for keeping image descriptions present and useful across thousands of items, and what to do about the backlog.',
			'source_url' => '',
			'featured'   => false,
		),
		array(
			'slug'       => 'a-field-guide-to-revalidation',
			'title'      => 'A field guide to revalidation',
			'type'       => 'ebook',
			'topics'     => array( 'headless-delivery', 'performance' ),
			'summary'    => 'On-demand, time-based, and tag-based revalidation compared, with the failure modes of each written down.',
			'source_url' => 'https://example.com/downloads/a-field-guide-to-revalidation',
			'featured'   => true,
		),
		array(
			'slug'       => 'reading-a-performance-trace-together',
			'title'      => 'Reading a performance trace together',
			'type'       => 'webinar',
			'topics'     => array( 'performance' ),
			'summary'    => 'A live walkthrough of a slow listing page, from the first request to the last layout shift.',
			'source_url' => 'https://example.org/events/reading-a-performance-trace-together',
			'featured'   => false,
		),
		array(
			'slug'       => 'what-a-good-summary-does',
			'title'      => 'What a good summary does',
			'type'       => 'podcast',
			'topics'     => array( 'editorial-workflow', 'content-modelling' ),
			'summary'    => 'Short-form copy for cards and previews: who writes it, how long it should be, and why the first sentence carries the weight.',
			'source_url' => 'https://example.net/episodes/what-a-good-summary-does',
			'featured'   => false,
		),
		array(
			'slug'       => 'an-accessibility-audit-and-what-came-after',
			'title'      => 'An accessibility audit and what came after',
			'type'       => 'case-study',
			'topics'     => array( 'accessibility' ),
			'summary'    => 'A fictional library site fails an audit, fixes the structural issues first, and keeps the gains with checks in the pipeline.',
			'source_url' => '',
			'featured'   => false,
		),
		array(
			'slug'       => 'filtering-without-a-search-service',
			'title'      => 'Filtering without a search service',
			'type'       => 'article',
			'topics'     => array( 'performance', 'content-modelling' ),
			'summary'    => 'How far indexed term relationships take a filterable library before a dedicated search index earns its place.',
			'source_url' => '',
			'featured'   => false,
		),
	);

	/**
	 * Seeds types, topics, the featured flag, and up to `$count` resources.
	 *
	 * A failed term assignment does not stop the run; it is recorded in `errors` and the resource
	 * still counts as created.
	 *
	 * @param int $count How many resources to ensure exist, capped at the catalogue size.
	 *
	 * @return array{created: int, skipped: int, total: int, terms: int, errors: string[]} What happened.
	 */
	public function seed( int $count = self::DEFAULT_COUNT ): array {
		$count = max( 0, min( $count, count( self::CATALOGUE ) ) );

		$type_ids = array();
		foreach ( self::TYPES as $slug => $label ) {
			$type_ids[ $slug ] = $this->ensure_term( Taxonomies::TYPE, $slug, $label );
		}

		$topic_ids = array();
		foreach ( self::TOPICS as $slug => $label ) {
			$topic_ids[ $slug ] = $this->ensure_term( Taxonomies::TOPIC, $slug, $label );
		}

		$featured_id = ( new Taxonomies() )->ensure_featured_flag();
		$author_id   = $this->author_id();

		$created = 0;
		$skipped = 0;
		$errors  = array();

		foreach ( array_slice( self::CATALOGUE, 0, $count ) as $entry ) {
			if ( $this->find_resource( $entry['slug'] ) > 0 ) {
				++$skipped;
				continue;
			}

			$post_id = wp_insert_post(
				array(
					'post_type'    => PostType::NAME,
					'post_status'  => 'publish',
					'post_author'  => $author_id,
					'post_name'    => $entry['slug'],
					'post_title'   => $entry['title'],
					'post_excerpt' => $entry['summary'],
					'post_content' => $this->body( $entry['title'] ),
					'meta_input'   => array(
						Meta::SUMMARY    => $entry['summary'],
						Meta::SOURCE_URL => $entry['source_url'],
					),
				),
				true
			);

			if ( is_wp_error( $post_id ) ) {
				continue;
			}

			// Set terms directly: `tax_input` is skipped when there is no current user, as in WP-CLI.
			$assignments = array(
				Taxonomies::TYPE  => array( $type_ids[ $entry['type'] ] ),
				Taxonomies::TOPIC => array_map( static fn( string $slug ): int => $topic_ids[ $slug ], $entry['topics'] ),
			);

			if ( $entry['featured'] && $featured_id > 0 ) {
				$assignments[ Taxonomies::FLAG ] = array( $featured_id );
			}

			foreach ( $assignments as $taxonomy => $term_ids ) {
				$result = wp_set_object_terms( $post_id, $term_ids, $taxonomy );

				if ( is_wp_error( $result ) ) {
					$errors[] = sprintf( '%s: could not set %s terms: %s', $entry['slug'], $taxonomy, $result->get_error_message() );
				}
			}

			++$created;
		}

		return array(
			'created' => $created,
			'skipped' => $skipped,
			'total'   => $created + $skipped,
			'terms'   => count( $type_ids ) + count( $topic_ids ) + ( $featured_id > 0 ? 1 : 0 ),
			'errors'  => $errors,
		);
	}

	/**
	 * Returns the term ID for a slug, creating the term if it is missing.
	 *
	 * @param string $taxonomy Taxonomy name.
	 * @param string $slug     Term slug.
	 * @param string $label    Term name used on creation.
	 */
	private function ensure_term( string $taxonomy, string $slug, string $label ): int {
		$existing = get_term_by( 'slug', $slug, $taxonomy );

		if ( $existing instanceof WP_Term ) {
			return $existing->term_id;
		}

		$created = wp_insert_term( $label, $taxonomy, array( 'slug' => $slug ) );

		return is_wp_error( $created ) ? 0 : (int) $created['term_id'];
	}

	/**
	 * Finds a resource by slug with a bounded, cached lookup; 0 when there is none.
	 *
	 * @param string $slug Post slug.
	 */
	private function find_resource( string $slug ): int {
		$post = get_page_by_path( $slug, OBJECT, PostType::NAME );

		return $post ? (int) $post->ID : 0;
	}

	/**
	 * Author for seeded posts: the current user; else the first administrator; else the first user
	 * who can write posts (an editor or author on a site without an administrator); else 0, which
	 * leaves the posts without an author.
	 */
	private function author_id(): int {
		$current = get_current_user_id();

		if ( $current > 0 ) {
			return $current;
		}

		foreach ( array( array( 'role' => 'administrator' ), array( 'capability' => 'edit_posts' ) ) as $who ) {
			$users = get_users(
				$who + array(
					'number'  => 1,
					'orderby' => 'ID',
					'order'   => 'ASC',
					'fields'  => 'ID',
				)
			);

			if ( ! empty( $users ) ) {
				return (int) $users[0];
			}
		}

		return 0;
	}

	/**
	 * Placeholder body copy in block markup.
	 *
	 * @param string $title Resource title, echoed in the opening line.
	 */
	private function body( string $title ): string {
		return implode(
			"\n\n",
			array(
				'<!-- wp:paragraph -->',
				'<p>' . esc_html( $title ) . ' is sample content created by the Resource Hub seeder. Everything in it is invented so the library has something to list, filter, and relate while the real content is written.</p>',
				'<!-- /wp:paragraph -->',
				'<!-- wp:paragraph -->',
				'<p>Replace this body with the resource itself, or leave it as a short landing page and point the source URL at where the resource actually lives.</p>',
				'<!-- /wp:paragraph -->',
			)
		);
	}
}
