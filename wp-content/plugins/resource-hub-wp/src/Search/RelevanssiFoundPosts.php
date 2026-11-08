<?php
/**
 * Keeps Relevanssi's match count on the queries it answers.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Search;

use WeakMap;
use WP_Query;

/**
 * Puts Relevanssi's count back into `found_posts` after core overwrites it.
 *
 * Relevanssi answers a search through `posts_pre_query` and sets `found_posts` and
 * `max_num_pages` from every match (4.28.8, `lib/search.php:619`). For a query with
 * `fields => ids`, which is how the search route will query, core then calls
 * `WP_Query::set_found_posts()` anyway (WordPress 7.1, `wp-includes/class-wp-query.php:3327`), and
 * with a `LIMIT` that runs `SELECT FOUND_ROWS()`. Nothing used `SQL_CALC_FOUND_ROWS`, so MySQL
 * answers with the row count of the last `SELECT` that ran, which is whatever query Relevanssi or
 * the post cache happened to run last: on a cold cache, a one-row `SELECT * FROM wp_posts WHERE
 * ID = …`, so a search with sixteen matches reported one. Relevanssi registers no `found_posts`
 * filter to protect its count. A query for full posts is not affected, because core skips
 * `set_found_posts()` there when a filter has supplied the posts.
 *
 * So each query Relevanssi answers is recorded with its match count on `relevanssi_hits_filter`,
 * which Relevanssi applies to the final match list of every search it runs (`lib/search.php:613`)
 * and nowhere else, at the last priority so the count is the one Relevanssi assigns. Core's
 * `found_posts` filter then returns that count for those queries; core derives `max_num_pages`
 * from it straight after. Every other query is left alone. The record is a `WeakMap` keyed by the
 * query object, so it goes when the query does and never matches a later query.
 */
final class RelevanssiFoundPosts {
	/**
	 * Match counts by the query Relevanssi answered.
	 *
	 * @var WeakMap<WP_Query, int>
	 */
	private WeakMap $counts;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->counts = new WeakMap();
	}

	/**
	 * Hooks the two filters.
	 */
	public function register(): void {
		add_filter( 'relevanssi_hits_filter', array( $this, 'record' ), PHP_INT_MAX, 2 );
		add_filter( 'found_posts', array( $this, 'restore' ), PHP_INT_MAX, 2 );
	}

	/**
	 * Records how many posts Relevanssi matched for a query. Hooked to `relevanssi_hits_filter`;
	 * passes the matches through unchanged.
	 *
	 * @param mixed $data  Relevanssi's `array( matches, search words )`.
	 * @param mixed $query The query being answered.
	 * @return mixed The same data.
	 */
	public function record( $data, $query = null ) {
		if ( $query instanceof WP_Query && is_array( $data ) && isset( $data[0] ) && is_array( $data[0] ) ) {
			$this->counts[ $query ] = count( $data[0] );
		}

		return $data;
	}

	/**
	 * Returns Relevanssi's count for a query it answered, and core's count for any other. Hooked
	 * to `found_posts`.
	 *
	 * @param mixed $found_posts The count core read.
	 * @param mixed $query       The query.
	 * @return mixed The count to keep.
	 */
	public function restore( $found_posts, $query = null ) {
		if ( $query instanceof WP_Query && isset( $this->counts[ $query ] ) ) {
			return $this->counts[ $query ];
		}

		return $found_posts;
	}
}
