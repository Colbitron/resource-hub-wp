<?php
/**
 * The `resource-hub/collection-empty` block: its registration and its server render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use ResourceHub\Collections\Collection;
use ResourceHub\Collections\Lead;

/**
 * A collection page's empty state, as the front end's `ListingPage` renders it, for a `core/query-no-results` in the CMS theme's collection templates.
 *
 * When a collection lists nothing the front end shows one sentence in `rh-listing__empty`, and a way
 * out on a filtered page (`packages/ui/DESIGN.md`, "The collection pages"): "No resources match this
 * type and topic yet." for a type within a topic, "No resources here yet." otherwise, and under it
 * "Show all resources", a link to the library, when a type or a topic is selected. The sentence
 * depends on the request, which core's no-results block cannot read, so this block writes it from the
 * main query ({@see Collection}). It renders nothing when the request is not a collection, and nothing
 * on a page with a lead: the front end never says a page is empty beside its lead, and on the CMS the
 * no-results block can render there when the lead was the page's only resource
 * ({@see \ResourceHub\Collections\CollectionQuery} takes the lead's row out of the list).
 *
 * The front end's third sentence, "The resources on this page can't be shown.", is for resources its
 * reader schema refused, which has no counterpart on the CMS.
 *
 * - **No wrapper.** The output is the `<div class="rh-listing__empty">` alone, with no block wrapper
 *   attributes, so it is the front end's markup exactly.
 * - **Styles.** `block.json` lists the shared `resource-hub-tokens` handle alone; the empty state's rules are
 *   the package's `listing.css`, which the CMS theme enqueues on its collection templates (see
 *   {@see CollectionHeadBlock} for why the block names no theme handle).
 *
 * Registered from `build/collection-empty/`, so without a build the block is not registered.
 */
final class CollectionEmptyBlock {
	/**
	 * The block name, as in `block.json`.
	 */
	public const NAME = 'resource-hub/collection-empty';

	/**
	 * Hooks the registration onto `init`.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	/**
	 * Registers the block from `build/collection-empty/`, when the build exists.
	 */
	public function register_block(): void {
		$dir = dirname( __DIR__, 2 ) . '/build/collection-empty';

		if ( ! is_readable( $dir . '/block.json' ) ) {
			return;
		}

		register_block_type( $dir, array( 'render_callback' => array( $this, 'render' ) ) );
	}

	/**
	 * Renders the current collection's empty state, or nothing.
	 */
	public function render(): string {
		$collection = Collection::current();

		if ( null === $collection || null !== Lead::for( $collection ) ) {
			return '';
		}

		return self::empty_state( $collection );
	}

	/**
	 * The empty state for `$collection`.
	 *
	 * @param Collection $collection The collection.
	 */
	public static function empty_state( Collection $collection ): string {
		$filtered = null !== $collection->type || null !== $collection->topic;
		$sentence = null !== $collection->type && null !== $collection->topic ? 'No resources match this type and topic yet.' : 'No resources here yet.';

		$html = '<div class="rh-listing__empty"><p>' . ResourceCardMarkup::text_html( $sentence ) . '</p>';

		if ( $filtered ) {
			$html .= '<p><a href="' . esc_url( ResourceCardMarkup::listing_url( null, null ) ) . '">Show all resources</a></p>';
		}

		return $html . '</div>';
	}
}
