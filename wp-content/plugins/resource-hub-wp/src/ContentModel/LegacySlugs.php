<?php
/**
 * Finds and repairs slugs still stored with an escape the front end's router decodes (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\ContentModel;

use WP_Error;
use WP_Post;
use WP_Query;
use WP_Term;

/**
 * {@see SlugEscapes} decodes a slug when its post or term is saved. A slug stored before that rule,
 * or kept by a path that never saves (a cron publish of a scheduled resource writes only the
 * status), stays escaped until something saves it. This lists every `resource` post and every
 * `resource_topic`, `resource_type` and `resource_flag` term whose stored slug has such an escape,
 * with the slug a save would give it and anything already holding that slug, and can save each one
 * through core, so `_wp_old_slug`, core's uniqueness rules and revalidation all apply as on any
 * save. It prints nothing; `wp resource-hub decode-slugs` wraps it.
 *
 * A row is `object` (`resource` or the taxonomy), `id`, `status` (the post status; '' for a term),
 * `slug` (as stored), `decoded` (what a save starts from; '' when it decodes to nothing and core
 * generates the slug from the title or name), `collision` (what already holds `decoded`, and what
 * the save does about it; '' for nothing) and `blocked` (true when the save would be refused).
 * Only a term can be blocked: core's `wp_update_term()` refuses a slug another term in the
 * taxonomy has, so the editor must type a new slug; for a post, core's uniqueness check resolves
 * any collision with a suffix.
 */
final class LegacySlugs {
	/**
	 * Resources read per query.
	 */
	public const PAGE_SIZE = 100;

	/**
	 * Every row to repair: resources by ascending ID, then terms by taxonomy and ascending ID.
	 *
	 * @return array<int, array{object: string, id: int, status: string, slug: string, decoded: string, collision: string, blocked: bool}>
	 */
	public function scan(): array {
		return array_merge( $this->scan_posts(), $this->scan_terms() );
	}

	/**
	 * Saves every row that is not blocked through core, in scan order, and reports each.
	 *
	 * Each row gains `result` (`decoded`, `skipped` for a blocked row, which is not saved, or
	 * `failed`), `stored` (the slug stored afterwards) and `message` (why it was skipped or failed;
	 * '' when decoded). A row the dry run did not see blocked can still fail, when an earlier row in
	 * this run took its decoded slug.
	 *
	 * @return array<int, array{object: string, id: int, status: string, slug: string, decoded: string, collision: string, blocked: bool, result: string, stored: string, message: string}>
	 */
	public function apply(): array {
		$results = array();

		foreach ( $this->scan() as $row ) {
			$results[] = $row + $this->save( $row );
		}

		return $results;
	}

	/**
	 * Saves one row and reads back what core stored.
	 *
	 * @param array{object: string, id: int, status: string, slug: string, decoded: string, collision: string, blocked: bool} $row The row.
	 * @return array{result: string, stored: string, message: string}
	 */
	private function save( array $row ): array {
		if ( $row['blocked'] ) {
			return self::outcome( 'skipped', $row['slug'], $row['collision'] );
		}

		$is_post = PostType::NAME === $row['object'];

		// The stored slug is passed back as given, so the save hooks decode it as they would an edit.
		$saved = $is_post
			? wp_update_post(
				array(
					'ID'        => $row['id'],
					'post_name' => $row['slug'],
				),
				true
			)
			: wp_update_term( $row['id'], $row['object'], array( 'slug' => $row['slug'] ) );

		$stored = $is_post ? self::post_slug( $row['id'] ) : self::term_slug( $row['id'], $row['object'] );

		if ( $saved instanceof WP_Error ) {
			return self::outcome( 'failed', $stored, $saved->get_error_message() );
		}

		if ( SlugEscapes::has_router_escape( $stored ) ) {
			return self::outcome( 'failed', $stored, 'Saved, but the slug is still stored with the escape.' );
		}

		return self::outcome( 'decoded', $stored, '' );
	}

	/**
	 * The resources to repair, every status but `auto-draft` and `inherit`.
	 *
	 * @return array<int, array{object: string, id: int, status: string, slug: string, decoded: string, collision: string, blocked: bool}>
	 */
	private function scan_posts(): array {
		$statuses = array_values( array_diff( array_keys( get_post_stati() ), array( 'auto-draft', 'inherit' ) ) );
		$rows     = array();
		$seen     = array();
		$page     = 1;

		do {
			$query = new WP_Query(
				array(
					'post_type'              => PostType::NAME,
					'post_status'            => $statuses,
					'orderby'                => 'ID',
					'order'                  => 'ASC',
					'posts_per_page'         => self::PAGE_SIZE,
					'paged'                  => $page,
					'no_found_rows'          => true,
					'ignore_sticky_posts'    => true,
					'update_post_meta_cache' => false,
					'update_post_term_cache' => false,
				)
			);

			foreach ( $query->posts as $post ) {
				if ( ! $post instanceof WP_Post || ! SlugEscapes::has_router_escape( $post->post_name ) ) {
					continue;
				}

				$decoded = SlugEscapes::decode_stored( $post->post_name );
				$rows[]  = self::row( PostType::NAME, $post->ID, $post->post_status, $post->post_name, $decoded, self::post_collision( $post, $decoded, $seen ), false );

				if ( '' !== $decoded ) {
					$seen[ $decoded ] ??= $post->ID;
				}
			}

			$fetched = count( $query->posts );
			++$page;
		} while ( self::PAGE_SIZE === $fetched );

		return $rows;
	}

	/**
	 * The terms to repair, in the three taxonomies.
	 *
	 * @return array<int, array{object: string, id: int, status: string, slug: string, decoded: string, collision: string, blocked: bool}>
	 */
	private function scan_terms(): array {
		$rows = array();

		foreach ( SlugEscapes::TAXONOMIES as $taxonomy ) {
			$terms = get_terms(
				array(
					'taxonomy'   => $taxonomy,
					'hide_empty' => false,
					'orderby'    => 'term_id',
					'order'      => 'ASC',
				)
			);

			if ( ! is_array( $terms ) ) {
				continue;
			}

			$seen = array();

			foreach ( $terms as $term ) {
				if ( ! $term instanceof WP_Term || ! SlugEscapes::has_router_escape( $term->slug ) ) {
					continue;
				}

				$decoded   = SlugEscapes::decode_stored( $term->slug );
				$collision = self::term_collision( $term, $decoded, $seen );
				$rows[]    = self::row( $taxonomy, $term->term_id, '', $term->slug, $decoded, $collision, '' !== $collision );

				if ( '' !== $decoded ) {
					$seen[ $decoded ] ??= $term->term_id;
				}
			}
		}

		return $rows;
	}

	/**
	 * What already holds a resource's decoded slug, and what the save does about it.
	 *
	 * @param WP_Post            $post    The resource.
	 * @param string             $decoded Its decoded slug.
	 * @param array<string, int> $seen    Decoded slugs of earlier rows, to the row's ID.
	 */
	private static function post_collision( WP_Post $post, string $decoded, array $seen ): string {
		if ( '' === $decoded ) {
			return '';
		}

		$holder = self::post_holding( $decoded, $post->ID );
		$draft  = in_array( $post->post_status, array( 'draft', 'pending' ), true );

		if ( null === $holder ) {
			return isset( $seen[ $decoded ] ) && ! $draft
				? sprintf( 'resource #%d decodes to it too; this save gets a suffix', $seen[ $decoded ] )
				: '';
		}

		$held = sprintf( 'resource #%d (%s) has it', $holder->ID, $holder->post_status );

		if ( $draft ) {
			return $held . '; a draft keeps it until it is published, then gets a suffix';
		}

		if ( 'trash' === $holder->post_status && 'trash' !== $post->post_status ) {
			return $held . '; the save renames that one ' . $decoded . '__trashed';
		}

		return $held . '; the save gives this one a suffix';
	}

	/**
	 * What already holds a term's decoded slug in its taxonomy: a term, or an earlier row that will
	 * take it in the same run. Either refuses the save.
	 *
	 * @param WP_Term            $term    The term.
	 * @param string             $decoded Its decoded slug.
	 * @param array<string, int> $seen    Decoded slugs of earlier rows in the taxonomy, to the row's ID.
	 */
	private static function term_collision( WP_Term $term, string $decoded, array $seen ): string {
		if ( '' === $decoded ) {
			return '';
		}

		$holder = get_term_by( 'slug', $decoded, $term->taxonomy );

		if ( $holder instanceof WP_Term && $holder->term_id !== $term->term_id ) {
			return sprintf( 'term #%d has it; type a new slug for this one', $holder->term_id );
		}

		if ( isset( $seen[ $decoded ] ) ) {
			return sprintf( 'term #%d decodes to it too; type a new slug for this one', $seen[ $decoded ] );
		}

		return '';
	}

	/**
	 * Another resource, in any status, whose stored slug is exactly this one.
	 *
	 * @param string $slug    The slug.
	 * @param int    $exclude The resource asking.
	 */
	private static function post_holding( string $slug, int $exclude ): ?WP_Post {
		$query = new WP_Query(
			array(
				'post_type'              => PostType::NAME,
				'post_status'            => array_keys( get_post_stati() ),
				'name'                   => $slug,
				'orderby'                => 'ID',
				'order'                  => 'ASC',
				'posts_per_page'         => 2,
				'no_found_rows'          => true,
				'ignore_sticky_posts'    => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
			)
		);

		foreach ( $query->posts as $post ) {
			if ( $post instanceof WP_Post && $post->ID !== $exclude && $post->post_name === $slug ) {
				return $post;
			}
		}

		return null;
	}

	/**
	 * A post's stored slug, read past the cache.
	 *
	 * @param int $post_id Post ID.
	 */
	private static function post_slug( int $post_id ): string {
		clean_post_cache( $post_id );
		$post = get_post( $post_id );

		return $post instanceof WP_Post ? $post->post_name : '';
	}

	/**
	 * A term's stored slug, read past the cache.
	 *
	 * @param int    $term_id  Term ID.
	 * @param string $taxonomy Taxonomy.
	 */
	private static function term_slug( int $term_id, string $taxonomy ): string {
		clean_term_cache( $term_id, $taxonomy );
		$term = get_term( $term_id, $taxonomy );

		return $term instanceof WP_Term ? $term->slug : '';
	}

	/**
	 * One row.
	 *
	 * @param string $kind      `resource` or the taxonomy.
	 * @param int    $id        Post or term ID.
	 * @param string $status    Post status, or ''.
	 * @param string $slug      Stored slug.
	 * @param string $decoded   Decoded slug.
	 * @param string $collision What holds the decoded slug, or ''.
	 * @param bool   $blocked   Whether the save would be refused.
	 * @return array{object: string, id: int, status: string, slug: string, decoded: string, collision: string, blocked: bool}
	 */
	private static function row( string $kind, int $id, string $status, string $slug, string $decoded, string $collision, bool $blocked ): array {
		return array(
			'object'    => $kind,
			'id'        => $id,
			'status'    => $status,
			'slug'      => $slug,
			'decoded'   => $decoded,
			'collision' => $collision,
			'blocked'   => $blocked,
		);
	}

	/**
	 * What happened to one row.
	 *
	 * @param string $result  `decoded`, `skipped` or `failed`.
	 * @param string $stored  The slug stored afterwards.
	 * @param string $message Why, or ''.
	 * @return array{result: string, stored: string, message: string}
	 */
	private static function outcome( string $result, string $stored, string $message ): array {
		return array(
			'result'  => $result,
			'stored'  => $stored,
			'message' => $message,
		);
	}
}
