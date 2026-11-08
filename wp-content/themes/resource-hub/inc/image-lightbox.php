<?php
/**
 * No image lightbox on the CMS's own pages, as on the front end.
 *
 * An editor can set an image block to "Expand on click", which core renders as a lightbox: a
 * trigger button in the figure, an overlay with a second copy of the image, and a script module.
 * The front end shows none of it: its content pass drops `<button>` and runs no script, so the
 * image is just the image. The theme's pages also leave core's image block stylesheet out, so that
 * a figure and its caption are drawn by `prose.css` alone (`functions.php`), and that stylesheet is
 * what hides the overlay; without it a lightbox would print its overlay into the page. So on the
 * theme's pages each image block renders with its lightbox off, the image the front end shows.
 *
 * Like the table region, only on pages core renders with a template: the filter is added on
 * `template_redirect`, so REST's `content.rendered` and the editor are untouched, and an editor who
 * set the lightbox keeps it in the block's attributes. Feeds and embeds are left alone.
 *
 * This file only defines functions; `functions.php` hooks them, and the plugin's PHPUnit suite
 * loads this file alone to test them (`tests/phpunit/Theme/ImageLightboxTest.php`).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Adds the lightbox filter for the page core is about to render, on `template_redirect`.
 */
function resource_hub_theme_add_lightbox_off(): void {
	if ( is_feed() || is_embed() ) {
		return;
	}

	add_filter( 'render_block_data', 'resource_hub_theme_lightbox_off' );
}

/**
 * An image block's parsed data with its lightbox off, whatever the block or the global settings
 * say; core reads the block's own `lightbox` attribute before the global setting.
 *
 * @param array<string, mixed> $parsed_block A block, as parsed.
 * @return array<string, mixed> The block, its lightbox off when it is an image.
 */
function resource_hub_theme_lightbox_off( array $parsed_block ): array {
	if ( 'core/image' === ( $parsed_block['blockName'] ?? null ) ) {
		$parsed_block['attrs']['lightbox'] = array( 'enabled' => false );
	}

	return $parsed_block;
}
