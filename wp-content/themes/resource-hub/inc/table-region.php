<?php
/**
 * A table block on the CMS's own pages, in the front end's scroll region.
 *
 * `packages/ui/prose.css` draws a body's table through a wrapper: the hairline box, the sideways
 * scroll inside the column, and the box's edge in place of the last row's rule all hang on
 * `.rh-table-scroll`. The front end adds that wrapper in its content pass (`tableRegion` in
 * `apps/web/lib/content/render.tsx`); core's `core/table` block prints none. So on the theme's
 * pages each table block's `<table>` is wrapped the same way: a `div.rh-table-scroll` with
 * `role="region"`, `tabindex="0"` (a keyboard can reach and scroll it) and an `aria-label` from the
 * table's own `<caption>`, else the block's `<figcaption>`, else "Table", whitespace collapsed and
 * cut to {@see RESOURCE_HUB_THEME_TABLE_LABEL_MAX} characters at a word, as the front end names it.
 * The table inside the block's `<figure>` is wrapped, not the figure, so the caption stays outside
 * the scrolling box.
 *
 * Presentation only, so it lives in the theme, and only on the theme's pages: the filter is added
 * on `template_redirect`, which core fires for a page it renders with a template and never for a
 * REST request, so `content.rendered`, which the front end reads, stays core's markup and the
 * contract does not change (the front end would otherwise receive a wrapper and add its own around
 * the table). Feeds and embeds, which also pass through `template_redirect`, are left alone. Only
 * `core/table` blocks are wrapped: a raw `<table>` in a Custom HTML block or classic content is
 * not, where the front end's pass wraps every table it renders.
 *
 * This file only defines functions; `functions.php` hooks them, and the plugin's PHPUnit suite
 * loads this file alone to test them (`tests/phpunit/Theme/TableRegionTest.php`).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

// phpcs:disable WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- PHP's Dom extension names its properties as the DOM specification does (innerHTML, tagName, firstElementChild).

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The most characters a region's name has, the front end's `MAX_TABLE_LABEL`.
 */
const RESOURCE_HUB_THEME_TABLE_LABEL_MAX = 150;

/**
 * The region's name when the table has no caption with text, the front end's `TABLE_LABEL`.
 */
const RESOURCE_HUB_THEME_TABLE_LABEL = 'Table';

/**
 * Adds the table filter for the page core is about to render, on `template_redirect`.
 */
function resource_hub_theme_add_table_regions(): void {
	if ( is_feed() || is_embed() ) {
		return;
	}

	add_filter( 'render_block_core/table', 'resource_hub_theme_table_region' );
}

/**
 * A rendered `core/table` block with its table inside the scroll region.
 *
 * The block's markup is a `<figure>` holding the `<table>` and, optionally, a `<figcaption>`.
 * Anything else (an empty block, or HTML an editor changed into another shape in the code editor)
 * is returned unchanged.
 *
 * @param string $block_content The block's rendered HTML.
 * @return string The HTML with the region around the table.
 */
function resource_hub_theme_table_region( string $block_content ): string {
	if ( false === stripos( $block_content, '<table' ) ) {
		return $block_content;
	}

	$document = Dom\HTMLDocument::createFromString( '<!DOCTYPE html><html><body></body></html>', LIBXML_NOERROR );
	$body     = $document->body;
	if ( null === $body ) {
		return $block_content;
	}
	$body->innerHTML = $block_content;

	$figure = resource_hub_theme_only_child( $body, 'FIGURE' );
	$table  = null === $figure ? null : resource_hub_theme_first_child( $figure, 'TABLE' );
	if ( null === $figure || null === $table ) {
		return $block_content;
	}

	$region = $document->createElement( 'div' );
	$region->setAttribute( 'class', 'rh-table-scroll' );
	$region->setAttribute( 'role', 'region' );
	$region->setAttribute( 'tabindex', '0' );
	$region->setAttribute( 'aria-label', resource_hub_theme_table_label( $table, $figure ) );
	$table->before( $region );
	$region->append( $table );

	return $body->innerHTML;
}

/**
 * The region's name: the table's first `<caption>`, else the figure's first `<figcaption>`, else
 * "Table", the order the front end reads them in.
 *
 * @param Dom\Element $table  The block's table.
 * @param Dom\Element $figure The figure around it.
 */
function resource_hub_theme_table_label( Dom\Element $table, Dom\Element $figure ): string {
	foreach ( array( array( $table, 'CAPTION' ), array( $figure, 'FIGCAPTION' ) ) as list( $holder, $name ) ) {
		$caption = resource_hub_theme_first_child( $holder, $name );
		$label   = null === $caption ? '' : resource_hub_theme_label_text( (string) $caption->textContent );
		if ( '' !== $label ) {
			return $label;
		}
	}

	return RESOURCE_HUB_THEME_TABLE_LABEL;
}

/**
 * A caption's text as a label: whitespace collapsed, trimmed, and cut to the cap at the last space
 * within it, or at the cap when the first word is longer.
 *
 * @param string $text The caption's text content.
 */
function resource_hub_theme_label_text( string $text ): string {
	$text = trim( (string) preg_replace( '/\s+/u', ' ', $text ) );
	if ( mb_strlen( $text ) <= RESOURCE_HUB_THEME_TABLE_LABEL_MAX ) {
		return $text;
	}

	$cut   = mb_substr( $text, 0, RESOURCE_HUB_THEME_TABLE_LABEL_MAX + 1 );
	$space = mb_strrpos( $cut, ' ' );

	return false !== $space && $space > 0 ? mb_substr( $cut, 0, $space ) : mb_substr( $text, 0, RESOURCE_HUB_THEME_TABLE_LABEL_MAX );
}

/**
 * The first child element of `$element` with the tag name `$name`, or null.
 *
 * @param Dom\Element $element The element whose children are read.
 * @param string      $name    An upper-case HTML tag name.
 */
function resource_hub_theme_first_child( Dom\Element $element, string $name ): ?Dom\Element {
	for ( $child = $element->firstElementChild; null !== $child; $child = $child->nextElementSibling ) {
		if ( $name === $child->tagName ) {
			return $child;
		}
	}

	return null;
}

/**
 * The one child element of `$element`, when it has exactly one and it is a `$name`, or null.
 *
 * @param Dom\Element $element The element whose children are read.
 * @param string      $name    An upper-case HTML tag name.
 */
function resource_hub_theme_only_child( Dom\Element $element, string $name ): ?Dom\Element {
	$child = $element->firstElementChild;

	return null !== $child && 1 === $element->childElementCount && $name === $child->tagName ? $child : null;
}
