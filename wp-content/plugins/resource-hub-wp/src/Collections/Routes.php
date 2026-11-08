<?php
/**
 * The front end's collection URLs on the CMS: topic and type-within-topic listings, and their pages.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Collections;

use ResourceHub\ContentModel\Taxonomies;

/**
 * Rewrite rules for the listing paths core does not write itself (ADR 0024; `packages/ui/README.md`,
 * "Public URL shape").
 *
 * The post type's permalink structure, `resources/%resource_type%/%resource%`, already gives the CMS
 * the library (`/resources/`, with `/resources/page/{n}/`), the single resource and, through core's
 * directory walk of that structure, the type collection, `/resources/{type}/`. Three listing paths the
 * front end answers have no rule of core's, and the `resource-meta` block links to two of them:
 *
 * - `/resources/topic/{topic}/`, one topic, with `/resources/topic/{topic}/page/{n}/`;
 * - `/resources/{type}/topic/{topic}/`, one type within one topic, with its `/page/{n}/`;
 * - `/resources/{type}/page/{n}/`, a later page of a type collection. Core writes a rule for it from the
 *   directory walk, but that rule sits below the single resource's, whose pattern
 *   `resources/([^/]+)/([^/]+)(?:/([0-9]+))?/?$` matches the same path first and asks for a resource
 *   named `page` at page `n`, which no one has, so without a rule above it the path was a 404.
 *
 * Each rule is added at the top of the rules, ahead of core's: the walk's attachment rules match any
 * three segments under `resources/` (`resources/[^/]+/[^/]+/([^/]+)/?$`) and would otherwise take the
 * type-within-topic path for an attachment named after the topic. The rules map to the taxonomies' own
 * query vars (`resource_type`, `resource_topic`) and core's `paged`, so a request lands on the same main
 * query core builds for its own term links (`/resource-type/{type}/`, `/resource-topic/{topic}/`), with
 * the collection templates, the per-page count and the lead from {@see CollectionQuery} all applying,
 * and the lockdown answering an anonymous visitor with its 404 as for every theme page (ADR 0031).
 *
 * The URL rules both sides share hold here without a check: `topic` and `page` are never type slugs
 * (`ReservedTypeSlugs`), so `/resources/topic/…` cannot be a type collection and `/resources/page/…` is
 * always the library's pagination, which core's archive rule takes before any of these; a slug the front
 * end's router would misread never reaches a stored slug (`SlugEscapes`). A path whose type segment is
 * `topic` or `page` with nothing after it, `/resources/topic/`, reaches core's type rule and names no
 * term, a 404 on both sites. Every pattern ends in `/?$`, as core's do: the request's trailing slash is
 * the public form, and the lockdown never redirects a missing one for an anonymous visitor.
 *
 * No flush here: `Plugin::activate()` deletes the stored rules, and the deploy runs `wp rewrite flush`
 * (`docs/runbooks/deploy.md`), so a site picks these up with the release that brings them.
 */
final class Routes {
	/**
	 * The pagination segment, core's `$wp_rewrite->pagination_base` default, which the front end's paths use too.
	 */
	public const PAGE = 'page';

	/**
	 * Hooks the rules onto `init`, after the post type and the taxonomies have registered theirs.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'add_rules' ), 20 );
	}

	/**
	 * Adds the five rules at the top of the rewrite rules.
	 */
	public function add_rules(): void {
		foreach ( self::rules() as $pattern => $query ) {
			add_rewrite_rule( $pattern, $query, 'top' );
		}
	}

	/**
	 * The rules: each pattern with the query it rewrites to, in the order they are added.
	 *
	 * @return array<string, string>
	 */
	public static function rules(): array {
		$type  = 'index.php?' . Taxonomies::TYPE . '=$matches[1]';
		$topic = 'index.php?' . Taxonomies::TOPIC . '=$matches[1]';
		$both  = 'index.php?' . Taxonomies::TYPE . '=$matches[1]&' . Taxonomies::TOPIC . '=$matches[2]';
		$paged = '/' . self::PAGE . '/([0-9]{1,})/?$';

		return array(
			'resources/topic/([^/]+)/?$'               => $topic,
			'resources/topic/([^/]+)' . $paged         => $topic . '&paged=$matches[2]',
			'resources/([^/]+)/topic/([^/]+)/?$'       => $both,
			'resources/([^/]+)/topic/([^/]+)' . $paged => $both . '&paged=$matches[3]',
			'resources/([^/]+)' . $paged               => $type . '&paged=$matches[2]',
		);
	}
}
