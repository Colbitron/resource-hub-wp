<?php
/**
 * The theme puts a table block's table in the front end's scroll region.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Theme;

use Dom\HTMLDocument;
use WP_UnitTestCase;

/**
 * Tests `wp-content/themes/resource-hub/inc/table-region.php`.
 *
 * The front end wraps every table its content pass renders in a focusable, labelled region
 * (`tableRegion` in `apps/web/lib/content/render.tsx`), which `packages/ui/prose.css` draws as the
 * table's box; the theme wraps a `core/table` block's table the same way on the pages it renders,
 * so a logged-in preview draws the box the site does. The PHPUnit bootstrap leaves the tests site on
 * core's test theme, so the theme's `functions.php` is not loaded: this test loads the one file that
 * defines the filter, which hooks nothing by itself, and calls it.
 */
final class TableRegionTest extends WP_UnitTestCase {
	/**
	 * Loads the theme's table-region functions.
	 */
	public static function set_up_before_class(): void {
		parent::set_up_before_class();
		require_once WP_CONTENT_DIR . '/themes/resource-hub/inc/table-region.php';
	}

	/**
	 * The table, and only the table, goes in a region with the role, the tab stop and the figure
	 * caption's text as its name; the caption stays outside the scrolling box.
	 */
	public function test_wraps_the_table_in_a_labelled_region(): void {
		$html = resource_hub_theme_table_region( $this->block( '<figcaption class="wp-element-caption">Prices <strong>by plan</strong></figcaption>' ) );

		$this->assertSame(
			'<figure class="wp-block-table"><div class="rh-table-scroll" role="region" tabindex="0" aria-label="Prices by plan"><table class="has-fixed-layout"><thead><tr><th>Plan</th><th>Price</th></tr></thead><tbody><tr><td>Free</td><td>&amp; 0</td></tr></tbody></table></div><figcaption class="wp-element-caption">Prices <strong>by plan</strong></figcaption></figure>',
			$html
		);
	}

	/**
	 * The table's own `<caption>` names the region before the figure's caption does, as on the
	 * front end.
	 */
	public function test_own_caption_comes_first(): void {
		$html = resource_hub_theme_table_region(
			'<figure class="wp-block-table"><table><caption> Own   caption </caption><tbody><tr><td>1</td></tr></tbody></table><figcaption>Figure caption</figcaption></figure>'
		);

		$this->assertSame( 'Own caption', $this->region_attributes( $html )['aria-label'] );
	}

	/**
	 * With no caption, or one with no text, the region is called "Table".
	 */
	public function test_unnamed_table_is_called_table(): void {
		$this->assertSame( 'Table', $this->region_attributes( resource_hub_theme_table_region( $this->block( '' ) ) )['aria-label'] );
		$this->assertSame( 'Table', $this->region_attributes( resource_hub_theme_table_region( $this->block( "<figcaption> \n </figcaption>" ) ) )['aria-label'] );
	}

	/**
	 * A long caption is cut to 150 characters at the last space within them; a first word longer
	 * than that is cut at 150.
	 */
	public function test_long_caption_is_cut_at_a_word(): void {
		$words = str_repeat( 'word ', 40 );
		$label = $this->region_attributes( resource_hub_theme_table_region( $this->block( "<figcaption>{$words}</figcaption>" ) ) )['aria-label'];
		$this->assertSame( rtrim( str_repeat( 'word ', 30 ) ), $label );
		$this->assertLessThanOrEqual( 150, mb_strlen( $label ) );

		$long = str_repeat( 'é', 200 );
		$this->assertSame( str_repeat( 'é', 150 ), $this->region_attributes( resource_hub_theme_table_region( $this->block( "<figcaption>{$long} tail</figcaption>" ) ) )['aria-label'] );
	}

	/**
	 * A caption of nothing but invisible characters names nothing: no-break spaces and U+FEFF are
	 * whitespace, as JavaScript's `\s` counts it, and the zero-width characters are removed.
	 */
	public function test_invisible_caption_is_called_table(): void {
		foreach ( array( "\u{FEFF}", "\u{200B}", "\u{200C}\u{200D}", '&nbsp;&#8203;&nbsp;', "\u{3000}\u{2028}" ) as $caption ) {
			$this->assertSame(
				'Table',
				$this->region_attributes( resource_hub_theme_table_region( $this->block( "<figcaption>{$caption}</figcaption>" ) ) )['aria-label'],
				bin2hex( $caption )
			);
		}
	}

	/**
	 * No-break spaces inside a caption collapse with the rest of its whitespace.
	 */
	public function test_no_break_spaces_collapse(): void {
		$this->assertSame(
			'Prices by plan',
			$this->region_attributes( resource_hub_theme_table_region( $this->block( '<figcaption>&nbsp;Prices&nbsp;&nbsp;by &nbsp;plan&nbsp;</figcaption>' ) ) )['aria-label']
		);
	}

	/**
	 * Text the front end never renders is not read: a script, a style, a form control.
	 */
	public function test_unrendered_text_is_not_read(): void {
		$this->assertSame(
			'Prices by plan',
			$this->region_attributes( resource_hub_theme_table_region( $this->block( '<figcaption>Prices<script>alert(1)</script> by<style>p{}</style> <button>Buy</button>plan</figcaption>' ) ) )['aria-label']
		);
	}

	/**
	 * An inline SVG's or MathML's text is not read either, though the parser keeps those elements'
	 * names in lower case; a huge caption is cut as a short one is.
	 */
	public function test_svg_and_math_text_is_not_read(): void {
		$label = fn ( string $caption ): string => $this->region_attributes( resource_hub_theme_table_region( $this->block( "<figcaption>{$caption}</figcaption>" ) ) )['aria-label'];

		$this->assertSame( 'Prices by plan', $label( 'Prices<svg viewBox="0 0 1 1"><title>A chart</title><text>1</text></svg> by plan' ) );
		$this->assertSame( 'Prices by plan', $label( 'Prices <math><mi>x</mi></math>by plan' ) );
		$this->assertSame( rtrim( str_repeat( 'word ', 30 ) ), $label( str_repeat( 'word ', 200000 ) ) );
	}

	/**
	 * The cap counts UTF-16 code units, as the front end's string length does: a character outside
	 * the Basic Multilingual Plane counts two and is never cut in half; a space just past the cap
	 * is a word boundary, as `lastIndexOf( ' ', 150 )` finds it.
	 */
	public function test_cap_counts_utf16_units(): void {
		$label = fn ( string $caption ): string => $this->region_attributes( resource_hub_theme_table_region( $this->block( "<figcaption>{$caption}</figcaption>" ) ) )['aria-label'];

		$this->assertSame( str_repeat( '😀', 75 ), $label( str_repeat( '😀', 100 ) ) );
		$this->assertSame( 'a' . str_repeat( '😀', 74 ), $label( 'a' . str_repeat( '😀', 80 ) ) );
		$this->assertSame( 'ab ' . str_repeat( 'x', 147 ), $label( 'ab ' . str_repeat( 'x', 147 ) . ' tail' ) );
		$this->assertSame( 'Café ' . str_repeat( 'é', 145 ), $label( 'Café ' . str_repeat( 'é', 145 ) ) );
	}

	/**
	 * Every table directly in the figure gets its own region; one nested in a cell does not.
	 */
	public function test_each_table_in_the_figure_is_wrapped(): void {
		$html = resource_hub_theme_table_region(
			'<figure class="wp-block-table"><table><caption>First</caption><tbody><tr><td><table><tbody><tr><td>Inner</td></tr></tbody></table></td></tr></tbody></table><table><tbody><tr><td>2</td></tr></tbody></table><figcaption>Both</figcaption></figure>'
		);

		$document = HTMLDocument::createFromString( '<!DOCTYPE html><html><body>' . $html . '</body></html>', LIBXML_NOERROR );
		$regions  = $document->querySelectorAll( 'figure > div.rh-table-scroll > table' );
		$this->assertCount( 2, $regions );
		$this->assertCount( 2, $document->querySelectorAll( '.rh-table-scroll' ) );
		$labels = array_map( static fn ( $region ): string => (string) $region->getAttribute( 'aria-label' ), iterator_to_array( $document->querySelectorAll( '.rh-table-scroll' ) ) );
		$this->assertSame( array( 'First', 'Both' ), $labels );
	}

	/**
	 * A caption's quotes and markup reach the attribute as text, escaped.
	 */
	public function test_label_is_escaped_text(): void {
		$html = resource_hub_theme_table_region( $this->block( '<figcaption>"Q&amp;A" &lt;b&gt;</figcaption>' ) );

		$this->assertStringContainsString( 'aria-label="&quot;Q&amp;A&quot; <b>"', $html );
		$this->assertSame( '"Q&A" <b>', $this->region_attributes( $html )['aria-label'] );
	}

	/**
	 * Markup that is not one figure around a table is returned as it came.
	 */
	public function test_other_shapes_are_left_alone(): void {
		foreach ( array(
			'',
			'<p>No table here.</p>',
			'<figure class="wp-block-table"></figure>',
			'<table><tbody><tr><td>1</td></tr></tbody></table>',
			'<figure><figcaption>No table</figcaption></figure><table></table>',
		) as $html ) {
			$this->assertSame( $html, resource_hub_theme_table_region( $html ), $html );
		}
	}

	/**
	 * Through the block renderer, once the filter is on, a table block comes out wrapped.
	 */
	public function test_rendered_table_block_is_wrapped(): void {
		add_filter( 'render_block_core/table', 'resource_hub_theme_table_region' );

		$html = do_blocks( "<!-- wp:table -->\n" . $this->block( '' ) . "\n<!-- /wp:table -->" );

		$this->assertSame( 1, substr_count( $html, 'class="rh-table-scroll"' ) );
	}

	/**
	 * Loading the file hooks nothing, so REST's `content.rendered`, which the front end reads, stays
	 * core's markup; the theme adds the filter on `template_redirect`, for a page core renders, and
	 * not for a feed or an embed. Logged in, as the lockdown answers an anonymous feed with its 404.
	 */
	public function test_filter_is_added_only_for_a_rendered_page(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		remove_all_filters( 'render_block_core/table' );
		$this->assertFalse( has_filter( 'render_block_core/table', 'resource_hub_theme_table_region' ) );

		$page = self::factory()->post->create( array( 'post_type' => 'page' ) );

		foreach ( array( get_feed_link(), get_post_embed_url( $page ) ) as $url ) {
			$this->go_to( $url );
			$this->assertTrue( is_feed() || is_embed(), $url );
			resource_hub_theme_add_table_regions();
			$this->assertFalse( has_filter( 'render_block_core/table', 'resource_hub_theme_table_region' ), $url );
		}

		$this->go_to( get_permalink( $page ) );
		resource_hub_theme_add_table_regions();
		$this->assertSame( 10, has_filter( 'render_block_core/table', 'resource_hub_theme_table_region' ) );
	}

	/**
	 * A table block's markup as core saves it, with `$caption` after the table.
	 *
	 * @param string $caption The figure caption's HTML, or none.
	 */
	private function block( string $caption ): string {
		return '<figure class="wp-block-table"><table class="has-fixed-layout"><thead><tr><th>Plan</th><th>Price</th></tr></thead><tbody><tr><td>Free</td><td>&amp; 0</td></tr></tbody></table>' . $caption . '</figure>';
	}

	/**
	 * The region's attributes, read back with the HTML parser, after checking it holds the table.
	 *
	 * @param string $html The filtered block.
	 * @return array<string, string>
	 */
	private function region_attributes( string $html ): array {
		$document = HTMLDocument::createFromString( '<!DOCTYPE html><html><body>' . $html . '</body></html>', LIBXML_NOERROR );
		$region   = $document->querySelector( 'figure > div.rh-table-scroll' );
		$this->assertNotNull( $region, $html );
		$this->assertNotNull( $document->querySelector( 'figure > div.rh-table-scroll > table' ), $html );

		$attributes = array();
		foreach ( array( 'role', 'tabindex', 'aria-label' ) as $name ) {
			$attributes[ $name ] = (string) $region->getAttribute( $name );
		}
		$this->assertSame( 'region', $attributes['role'] );
		$this->assertSame( '0', $attributes['tabindex'] );

		return $attributes;
	}
}
