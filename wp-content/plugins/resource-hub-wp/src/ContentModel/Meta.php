<?php
/**
 * REST-exposed post meta for `resource`.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\ContentModel;

/**
 * Registers `summary`, `source_url` and `related_picks` with `register_post_meta()` (ADR 0008).
 *
 * All three are single. `summary` and `source_url` are string-typed and appear under `meta` in
 * every REST response because `show_in_rest` is set and the post type supports `custom-fields`;
 * the schema only adds validation. The one schema rule is `summary`'s `maxLength`. `source_url`
 * has no `format`: core treats `format: uri` as a sanitizer, running `sanitize_url()` before
 * ours, which turns scheme-less strings into `http://` URLs.
 *
 * `related_picks` is an array of post IDs, the editor's ordered choice of related resources, which
 * the related route ({@see \ResourceHub\Rest\RelatedRoute}) puts first. Its REST schema has
 * `context: [ 'edit' ]`, so it is sent only on `edit`-context reads, the ones the editor makes
 * with `edit_posts`, and never in the anonymous `view` reads the front end makes: the front end
 * reads the merged list from the related route and the picks stay an editorial detail. Core
 * enforces the context in `rest_filter_response_by_context()` from this schema, so nothing else
 * has to filter the field out.
 *
 * The rules all fields obey live in {@see MetaRules}. One of `related_picks`'s clauses, that a
 * resource is never its own pick, needs the post ID, which core's sanitize callback is not given,
 * so it is applied from the `add_post_metadata` and `update_post_metadata` filters here on every
 * write path (`update_post_meta()`, the REST meta fields, the block editor). The filters run for
 * every meta write on the site, so they act only on a `resource` post's `related_picks`.
 *
 * {@see Meta::register()} does both halves, once, from `init`. The fields alone are registered by
 * {@see Meta::register_fields()}, which the tests call again after core's test case unregisters
 * every meta key, without adding a second copy of the filters.
 */
final class Meta {
	/**
	 * Plain-text summary for cards.
	 */
	public const SUMMARY = 'summary';

	/**
	 * Optional external destination for the resource.
	 */
	public const SOURCE_URL = 'source_url';

	/**
	 * The editor's ordered picks for the related route, as post IDs.
	 */
	public const RELATED_PICKS = 'related_picks';

	/**
	 * Registers the three fields and the filters behind `related_picks`. Hooked to `init`.
	 */
	public function register(): void {
		$this->register_fields();

		add_filter( 'add_post_metadata', array( $this, 'drop_self_on_add' ), 10, 5 );
		add_filter( 'update_post_metadata', array( $this, 'drop_self_on_update' ), 10, 5 );
	}

	/**
	 * Registers the three fields only.
	 */
	public function register_fields(): void {
		register_post_meta(
			PostType::NAME,
			self::SUMMARY,
			array(
				'type'              => 'string',
				'description'       => __( 'Plain-text summary shown on cards.', 'resource-hub' ),
				'single'            => true,
				'default'           => '',
				'sanitize_callback' => array( MetaRules::class, 'sanitize_summary' ),
				'auth_callback'     => array( MetaRules::class, 'can_edit_post' ),
				'show_in_rest'      => array(
					'schema' => array(
						'type'      => 'string',
						'maxLength' => MetaRules::SUMMARY_MAX_LENGTH,
						'default'   => '',
					),
				),
			)
		);

		register_post_meta(
			PostType::NAME,
			self::SOURCE_URL,
			array(
				'type'              => 'string',
				'description'       => __( 'Where the resource lives if not here; http or https only.', 'resource-hub' ),
				'single'            => true,
				'default'           => '',
				'sanitize_callback' => array( MetaRules::class, 'sanitize_source_url' ),
				'auth_callback'     => array( MetaRules::class, 'can_edit_post' ),
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => 'string',
						'default' => '',
					),
				),
			)
		);

		register_post_meta(
			PostType::NAME,
			self::RELATED_PICKS,
			array(
				'type'              => 'array',
				'description'       => __( 'Post IDs of the resources an editor chose as related, in display order; the related route puts them first.', 'resource-hub' ),
				'single'            => true,
				'default'           => array(),
				'sanitize_callback' => array( MetaRules::class, 'sanitize_related_picks' ),
				'auth_callback'     => array( MetaRules::class, 'can_edit_post' ),
				'show_in_rest'      => array(
					'schema' => array(
						'type'     => 'array',
						'items'    => array(
							'type'    => 'integer',
							'minimum' => 1,
						),
						'maxItems' => MetaRules::RELATED_PICKS_MAX,
						'default'  => array(),
						'context'  => array( 'edit' ),
					),
				),
			)
		);
	}

	/**
	 * `add_post_metadata`: writes a `related_picks` list that names its own post again without it.
	 *
	 * Core fires the filter after the sanitize callback. When an earlier filter already answered
	 * (`$check` is not null), when the post is not a `resource`, when the key is not
	 * `related_picks`, or when the list does not hold the post's ID, the write proceeds untouched
	 * (`$check` is returned as is). Otherwise the write is redone through `add_metadata()` with the
	 * ID removed; that call passes through this filter again, finds nothing to remove, and
	 * completes, so the result is the second write's. The `$check` guard is what makes that safe:
	 * once this method has answered, any later filter on the hook that does the same, such as a
	 * second copy of this one if `register()` ever ran twice, sees a result and leaves it alone,
	 * instead of redoing a unique write that now fails.
	 *
	 * @param mixed  $check      Whether an earlier filter short-circuited the write; null to proceed.
	 * @param int    $object_id  The post.
	 * @param string $meta_key   Meta key being written.
	 * @param mixed  $meta_value The sanitized value.
	 * @param bool   $unique     Whether the key must not already exist.
	 * @return mixed `$check`, or the redone write's result.
	 */
	public function drop_self_on_add( mixed $check, int $object_id, string $meta_key, mixed $meta_value, bool $unique ): mixed {
		if ( null !== $check || ! self::names_itself( $meta_key, $meta_value, $object_id ) ) {
			return $check;
		}

		return add_metadata( 'post', $object_id, $meta_key, MetaRules::without_self( $meta_value, $object_id ), $unique );
	}

	/**
	 * `update_post_metadata`: the same for an update. See {@see Meta::drop_self_on_add()}.
	 *
	 * One difference: when no `$prev_value` is given and the list without the ID is the one value
	 * stored already, the write reports success instead of being redone. `update_metadata()`
	 * answers an unchanged value with `false`, which core's REST meta fields turn into a 500, and
	 * the editor saving `[ 5, self ]` over a stored `[ 5 ]` has changed nothing. The test is core's
	 * own, from `update_metadata()`: it applies only when `$prev_value` is empty and exactly one row
	 * exists. With a `$prev_value`, the write is redone with it and core decides, as it would have.
	 *
	 * @param mixed  $check      Whether an earlier filter short-circuited the write; null to proceed.
	 * @param int    $object_id  The post.
	 * @param string $meta_key   Meta key being written.
	 * @param mixed  $meta_value The sanitized value.
	 * @param mixed  $prev_value The previous value to replace, or an empty string for any.
	 * @return mixed `$check`, or the redone write's result.
	 */
	public function drop_self_on_update( mixed $check, int $object_id, string $meta_key, mixed $meta_value, mixed $prev_value ): mixed {
		if ( null !== $check || ! self::names_itself( $meta_key, $meta_value, $object_id ) ) {
			return $check;
		}

		$picks = MetaRules::without_self( $meta_value, $object_id );

		// Core's unchanged-value test from update_metadata(), answered with success instead of `false`.
		if ( empty( $prev_value ) && array( $picks ) === get_metadata_raw( 'post', $object_id, $meta_key, false ) ) {
			return true;
		}

		return update_metadata( 'post', $object_id, $meta_key, $picks, $prev_value );
	}

	/**
	 * Whether a write is a `resource`'s `related_picks` list that holds the post's own ID. The post
	 * type is checked first: another post type may use the same key for its own purpose, and its
	 * values are not ours to change.
	 *
	 * @param string $meta_key   Meta key being written.
	 * @param mixed  $meta_value The sanitized value.
	 * @param int    $object_id  The post.
	 */
	private static function names_itself( string $meta_key, mixed $meta_value, int $object_id ): bool {
		if ( PostType::NAME !== get_post_type( $object_id ) ) {
			return false;
		}

		return self::RELATED_PICKS === $meta_key && is_array( $meta_value ) && in_array( $object_id, $meta_value, true );
	}
}
