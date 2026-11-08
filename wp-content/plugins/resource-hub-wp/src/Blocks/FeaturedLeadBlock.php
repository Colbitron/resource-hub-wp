<?php
/**
 * The `resource-hub/featured-lead` block: its registration and its server render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use ResourceHub\Collections\Lead;

/**
 * The library's lead section, as the front end's `ListingPage` renders it above the list, for the CMS theme's library template.
 *
 * On the first page of the unfiltered library the front end shows the newest featured resource large,
 * under a "Featured" heading, and nowhere else (`packages/ui/DESIGN.md`, "The lead";
 * `apps/web/components/ListingSections.tsx`, `FeaturedSection`). This block renders that section from
 * the lead {@see Lead} picks for the main query, through `ResourceCardMarkup::lead()`, whose docblock has
 * the markup and the image's rules, and nothing at all on every other page or when there is no lead:
 * there is never an empty slot. {@see \ResourceHub\Collections\CollectionQuery} takes the same lead out
 * of the rows under it and heads them "Latest".
 *
 * - **The title** is the plain-text title, or "Untitled resource" when that is empty, as the front end's
 *   `cardTitle()` gives it; the lead's title is an `h3` under the section's `h2`.
 * - **No wrapper.** The output is the section, `<div class="rh-listing__lead">` with its heading and the
 *   `<article class="rh-lead">`, with no block wrapper attributes, so it is the front end's markup exactly.
 * - **Styles.** `block.json` lists the shared `resource-hub-tokens` and `resource-hub-card` handles (the
 *   lead's meta line and topics are the row's parts) and `resource-hub-lead`, the package's `lead.css`,
 *   which the CMS theme registers from its build; the section's heading is `listing.css`'s, which the
 *   collection head brings.
 *
 * The contract's lead fixtures (`packages/ui/fixtures/markup/{case}.lead.html`) hold this block and the
 * front end's `FeaturedSection` to the same HTML (`MarkupParityTest`).
 *
 * Registered from `build/featured-lead/`, so without a build the block is not registered.
 */
final class FeaturedLeadBlock {
	/**
	 * The block name, as in `block.json`.
	 */
	public const NAME = 'resource-hub/featured-lead';

	/**
	 * The section's heading, the front end's text.
	 */
	public const HEADING = 'Featured';

	/**
	 * Hooks the registration onto `init`.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	/**
	 * Registers the block from `build/featured-lead/`, when the build exists.
	 */
	public function register_block(): void {
		$dir = dirname( __DIR__, 2 ) . '/build/featured-lead';

		if ( ! is_readable( $dir . '/block.json' ) ) {
			return;
		}

		register_block_type( $dir, array( 'render_callback' => array( $this, 'render' ) ) );
	}

	/**
	 * Renders the library's lead section, or nothing.
	 */
	public function render(): string {
		$lead = Lead::current();
		$type = null === $lead ? null : ResourceCardMarkup::type( $lead );

		if ( null === $lead || null === $type ) {
			return '';
		}

		$title = ResourceCardMarkup::title( $lead ) ?? ResourceCardMarkup::UNTITLED;

		return '<div class="rh-listing__lead">'
			. '<h2 class="rh-listing__section">' . ResourceCardMarkup::text_html( self::HEADING ) . '</h2>'
			. ResourceCardMarkup::lead( $lead, $title, $type, 'h3' )
			. '</div>';
	}
}
