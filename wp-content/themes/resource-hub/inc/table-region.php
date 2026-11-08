<?php
/**
 * A table block on the CMS's own pages, in the front end's scroll region.
 *
 * `packages/ui/prose.css` draws a body's table through a wrapper: the hairline box, the sideways
 * scroll inside the column, and the box's edge in place of the last row's rule all hang on
 * `.rh-table-scroll`. The front end adds that wrapper in its content pass (`tableRegion` in
 * `apps/web/lib/content/render.tsx`); core's `core/table` block prints none. So on the theme's
 * pages each `<table>` directly in a table block's `<figure>` is wrapped the same way: a
 * `div.rh-table-scroll` with `role="region"`, `tabindex="0"` (a keyboard can reach and scroll it)
 * and an `aria-label`. Core prints one table in the figure; one an editor added in the code editor
 * is wrapped too, as the front end wraps every table. The table is wrapped, not the figure, so the
 * caption stays outside the scrolling box.
 *
 * The label is the front end's (`tableLabel`): the table's own first `<caption>`, else the figure's
 * first `<figcaption>`, else "Table". A caption's text is the text the front end renders, so what
 * is inside an element its pass drops (`<script>`, `<style>`, form controls, media and the rest of
 * {@see RESOURCE_HUB_THEME_UNRENDERED}) is not read; its whitespace, as JavaScript's `\s` counts it
 * (so U+FEFF and the no-break spaces too), is collapsed to one space and trimmed, and it is cut to
 * {@see RESOURCE_HUB_THEME_TABLE_LABEL_MAX} UTF-16 code units at the last space within them, as a
 * JavaScript string's length counts. One difference, on purpose: the zero-width space, non-joiner
 * and joiner (U+200B to U+200D) are removed too, so a caption of nothing else names the region
 * "Table", where the front end's label keeps them (its card titles drop them).
 *
 * Presentation only, so it lives in the theme, and only on the theme's pages: the filter is added
 * on `template_redirect`, which core fires for a page it renders with a template and never for a
 * REST request, so `content.rendered`, which the front end reads, stays core's markup and the
 * contract does not change (the front end would otherwise receive a wrapper and add its own around
 * the table). Feeds and embeds, which also pass through `template_redirect`, are left alone. Only
 * `core/table` blocks are wrapped: a raw `<table>` in a Custom HTML block or classic content is
 * not, where the front end's pass wraps every table it renders. The markup is parsed with PHP's
 * HTML parser (`Dom\HTMLDocument`, PHP 8.4) and counted with `mbstring`; on a PHP without either,
 * the block is returned as it came.
 *
 * This file only defines functions; `functions.php` hooks them, and the plugin's PHPUnit suite
 * loads this file alone to test them (`tests/phpunit/Theme/TableRegionTest.php`).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The most UTF-16 code units a region's name has, the front end's `MAX_TABLE_LABEL`.
 */
const RESOURCE_HUB_THEME_TABLE_LABEL_MAX = 150;

/**
 * The region's name when the table has no caption with text, the front end's `TABLE_LABEL`.
 */
const RESOURCE_HUB_THEME_TABLE_LABEL = 'Table';

/**
 * Elements whose content the front end's pass never renders, so a caption's label never reads
 * it: its `UNRENDERED_CONTENT`, upper-case as the parser names HTML elements.
 */
const RESOURCE_HUB_THEME_UNRENDERED = array(
	'SCRIPT',
	'STYLE',
	'NOSCRIPT',
	'TEMPLATE',
	'OBJECT',
	'EMBED',
	'APPLET',
	'FRAME',
	'FRAMESET',
	'NOFRAMES',
	'NOEMBED',
	'SVG',
	'MATH',
	'FORM',
	'INPUT',
	'BUTTON',
	'SELECT',
	'OPTION',
	'OPTGROUP',
	'TEXTAREA',
	'DATALIST',
	'OUTPUT',
	'BASE',
	'META',
	'LINK',
	'HEAD',
	'TITLE',
	'CANVAS',
	'DIALOG',
	'SLOT',
	'PORTAL',
	'XMP',
	'PLAINTEXT',
	'LISTING',
	'IFRAME',
	'VIDEO',
	'AUDIO',
);

/**
 * Adds the table filter for the page core is about to render, on `template_redirect`.
 */
function resource_hub_theme_add_table_regions(): void {
	if ( is_feed() || is_embed() ) {
		return;
	}

	add_filter( 'render_block_core/table', 'resource_hub_theme_table_region' );
}

// phpcs:disable WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- PHP's Dom extension names its properties as the DOM specification does (innerHTML, tagName, firstElementChild).

/**
 * A rendered `core/table` block with each table in the figure inside a scroll region.
 *
 * The block's markup is a `<figure>` holding the `<table>` and, optionally, a `<figcaption>`.
 * Anything else (an empty block, or HTML an editor changed into another shape in the code editor)
 * is returned unchanged, and so is everything on a PHP without the HTML parser or `mbstring`.
 *
 * @param string $block_content The block's rendered HTML.
 * @return string The HTML with a region around each table.
 */
function resource_hub_theme_table_region( string $block_content ): string {
	if ( false === stripos( $block_content, '<table' ) || ! class_exists( Dom\HTMLDocument::class ) || ! function_exists( 'mb_str_split' ) ) {
		return $block_content;
	}

	$document = Dom\HTMLDocument::createFromString( '<!DOCTYPE html><html><body></body></html>', LIBXML_NOERROR );
	$body     = $document->body;
	if ( null === $body ) {
		return $block_content;
	}
	$body->innerHTML = $block_content;

	$figure = resource_hub_theme_only_child( $body, 'FIGURE' );
	if ( null === $figure ) {
		return $block_content;
	}

	$tables = array();
	for ( $child = $figure->firstElementChild; null !== $child; $child = $child->nextElementSibling ) {
		if ( 'TABLE' === $child->tagName ) {
			$tables[] = $child;
		}
	}
	if ( array() === $tables ) {
		return $block_content;
	}

	foreach ( $tables as $table ) {
		$region = $document->createElement( 'div' );
		$region->setAttribute( 'class', 'rh-table-scroll' );
		$region->setAttribute( 'role', 'region' );
		$region->setAttribute( 'tabindex', '0' );
		$region->setAttribute( 'aria-label', resource_hub_theme_table_label( $table, $figure ) );
		$table->before( $region );
		$region->append( $table );
	}

	return $body->innerHTML;
}

/**
 * The region's name: the table's first `<caption>`, else the figure's first `<figcaption>`, else
 * "Table", the order the front end reads them in.
 *
 * @param Dom\Element $table  A table in the block's figure.
 * @param Dom\Element $figure The figure around it.
 */
function resource_hub_theme_table_label( Dom\Element $table, Dom\Element $figure ): string {
	foreach ( array( array( $table, 'CAPTION' ), array( $figure, 'FIGCAPTION' ) ) as list( $holder, $name ) ) {
		$caption = resource_hub_theme_first_child( $holder, $name );
		$label   = null === $caption ? '' : resource_hub_theme_label_text( resource_hub_theme_rendered_text( $caption ) );
		if ( '' !== $label ) {
			return $label;
		}
	}

	return RESOURCE_HUB_THEME_TABLE_LABEL;
}

/**
 * The text inside `$node` that the front end renders: every text node, except inside an element in
 * {@see RESOURCE_HUB_THEME_UNRENDERED}.
 *
 * @param Dom\Node $node The caption, or an element inside it.
 */
function resource_hub_theme_rendered_text( Dom\Node $node ): string {
	$text = '';
	foreach ( $node->childNodes as $child ) {
		if ( $child instanceof Dom\Text ) {
			$text .= $child->data;
		} elseif ( $child instanceof Dom\Element && ! in_array( $child->tagName, RESOURCE_HUB_THEME_UNRENDERED, true ) ) {
			$text .= resource_hub_theme_rendered_text( $child );
		}
	}

	return $text;
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

// phpcs:enable WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase

/**
 * A caption's text as a label: zero-width characters removed, whitespace as JavaScript's `\s`
 * counts it collapsed to one space and trimmed, and cut to the cap in UTF-16 code units at the
 * last space within them, or at the cap when the first word is longer, never inside a character.
 *
 * @param string $text The caption's rendered text.
 */
function resource_hub_theme_label_text( string $text ): string {
	$text = (string) preg_replace( '/[\x{200B}-\x{200D}]/u', '', $text );
	$text = trim( (string) preg_replace( '/[\s\p{Z}\x{FEFF}]+/u', ' ', $text ), ' ' );

	$units = 0;
	$cut   = '';
	foreach ( mb_str_split( $text ) as $character ) {
		$width = mb_ord( $character ) > 0xFFFF ? 2 : 1;
		if ( $units + $width > RESOURCE_HUB_THEME_TABLE_LABEL_MAX ) {
			// Too long. The front end cuts at the last space at or before the cap's index, which
			// includes a space right after the last whole character, else at the cap itself.
			$space = ' ' === $character ? mb_strlen( $cut ) : mb_strrpos( $cut, ' ' );
			return false !== $space && $space > 0 ? mb_substr( $cut, 0, $space ) : $cut;
		}
		$units += $width;
		$cut   .= $character;
	}

	return $text;
}
