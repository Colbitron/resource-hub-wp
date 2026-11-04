<?php
/**
 * REST-exposed post meta for `resource`.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\ContentModel;

/**
 * Registers `summary` and `source_url` with `register_post_meta()` (ADR 0008).
 *
 * Both are single, string-typed, and appear under `meta` in the REST response because
 * `show_in_rest` carries a schema. The rules they obey live in {@see MetaRules}.
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
	 * Registers both fields. Hooked to `init`.
	 */
	public function register(): void {
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
						'format'  => 'uri',
						'default' => '',
					),
				),
			)
		);
	}
}
