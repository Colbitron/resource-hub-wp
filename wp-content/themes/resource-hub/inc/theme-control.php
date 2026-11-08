<?php
/**
 * The System / Light / Dark control on the CMS's own pages.
 *
 * The front end's footer ends with a control that lets a reader override the system colour scheme
 * (`packages/ui/DESIGN.md`, "Theme and colour scheme"): three native radios in `fieldset.rh-theme`,
 * the choice kept in the browser's `localStorage` and applied as `data-theme` on `<html>`, which
 * `base.css` maps to `color-scheme`. The owner chose full parity for logged-in previews, so the
 * theme's footer part (`parts/footer.html`) holds the same markup, in a Custom HTML block, and the
 * contract's markup fixture `theme-control.html` holds it to the front end's `ThemeFieldset`
 * (`packages/ui/README.md`, "Markup fixtures").
 *
 * The behaviour is the theme's own script, `js/theme-control.js`, since the package shares no
 * JavaScript. This file prints that file inline in `<head>`, on `wp_head` before core prints a
 * stylesheet, so the stored choice is applied as the browser parses the head and never flashes the
 * other scheme, the way the front end's head script does; the same file then wires the radios once
 * the DOM is parsed. Inline, through `wp_print_inline_script_tag()`, so a Content Security Policy
 * added later can hash it (the script is a fixed file) and a nonce plugin can add its attribute
 * through `wp_inline_script_attributes`; the front end has no CSP today either. A `<noscript>` style
 * follows it, removing the control's slot from the footer where script is off, as the front end's
 * root layout does: without script the control can never show, and its slot would be an empty gap.
 *
 * The 404 is the one template without the control. It is the page every anonymous visitor gets
 * (the plugin's lockdown, ADR 0031), and the only one, so it ships no script to them: `functions.php`
 * loads no `theme-toggle.css` there and hides the slot with the same rule the `<noscript>` carries.
 * The footer part is one file, so the markup is still in the 404's HTML, hidden; a logged-in user
 * who reaches a real 404 follows the system preference on that page alone. The editor canvas gets
 * none of this either: `wp_head` does not run in the iframed canvas, which keeps core's styles and
 * follows the system preference through the tokens (the theme's README, "The theme control").
 *
 * This file only defines functions; `functions.php` hooks them, and the plugin's PHPUnit suite
 * loads this file alone to test them (`tests/phpunit/Theme/ThemeControlTest.php`).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The rule that removes the control's slot from the footer, so the footer is laid out as if it had
 * no control: the front end's `THEME_NOSCRIPT_STYLE` rule (`apps/web/lib/theme.ts`). Printed in a
 * `<noscript>` on every page with the control, and as an inline style on the 404, which has none.
 */
const RESOURCE_HUB_THEME_NO_CONTROL = '.rh-footer__theme{display:none}';

/**
 * The `id` of the inline script tag, so a page or a test can find it.
 */
const RESOURCE_HUB_THEME_CONTROL_SCRIPT_ID = 'resource-hub-theme-control-js';

/**
 * Whether the page core is rendering has the control: every template but the 404.
 */
function resource_hub_theme_has_control(): bool {
	return ! is_404();
}

/**
 * The theme's script, `js/theme-control.js`, as printed inline; an empty string when the file
 * cannot be read, so the page renders without the control's behaviour rather than with a broken tag.
 *
 * Read from the theme's own directory, not through `get_theme_file_path()`, so the file is the
 * theme's whatever theme is active when this is called (the PHPUnit suite loads this file alone).
 * A per-request read of a small file in the theme, as core reads a block theme's templates.
 */
function resource_hub_theme_control_script(): string {
	$script = file_get_contents( dirname( __DIR__ ) . '/js/theme-control.js' );

	return is_string( $script ) ? $script : '';
}

/**
 * Prints the control's script inline, and the `<noscript>` style that removes the control's slot
 * where script is off, on `wp_head`, on every page with the control.
 *
 * Hooked at priority 1 in `functions.php`: core prints the stylesheets at 8, so the script, whose
 * first statement sets `data-theme`, runs before the browser has even requested the CSS.
 */
function resource_hub_theme_print_control_script(): void {
	if ( ! resource_hub_theme_has_control() ) {
		return;
	}

	$script = resource_hub_theme_control_script();
	if ( '' === $script ) {
		return;
	}

	wp_print_inline_script_tag( $script, array( 'id' => RESOURCE_HUB_THEME_CONTROL_SCRIPT_ID ) );
	echo '<noscript><style>' . RESOURCE_HUB_THEME_NO_CONTROL . '</style></noscript>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- A fixed style rule from this file's constant, built from no input, inside markup written here.
}
