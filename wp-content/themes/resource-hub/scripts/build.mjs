/**
 * Builds the theme's runtime assets into `build/`, from the contract package.
 *
 * The host never sees the pnpm workspace: the deploy ships built output only,
 * and `theme.json` resolves `file:./` relative to the theme. So every file the
 * theme loads from `@colbitron/resource-hub-ui` is copied here, byte for byte,
 * with no minifying or rewriting, so the CMS draws with exactly the values the
 * front end does (`packages/ui/DESIGN.md`, "Consumers and loading").
 *
 * `ASSETS` below is the theme's one list of them: what is copied, and, for a
 * stylesheet, the handle `functions.php` registers it under and the handles
 * it loads after. The build writes that list into `build/assets.php`, with
 * each copy's SHA-256, and nothing else keeps a copy of it: `functions.php`
 * registers every stylesheet from the manifest and takes its version from
 * the hash, so a changed file gets a new URL, and the plugin's PHPUnit suite
 * (`tests/phpunit/Theme/ThemeAssetsTest.php`) holds every copy to the
 * package's file, the font to the hash committed in `figtree.sha256`, and
 * every handle `functions.php` enqueues to a stylesheet in the manifest. The
 * package's other component stylesheets are added here when a template
 * renders their markup (`README.md`, "Not built yet").
 *
 * `build/` is emptied first, so a file dropped from this list does not linger,
 * and it is gitignored.
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire( import.meta.url );
const theme = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'..'
);
const out = path.join( theme, 'build' );

/**
 * Every file copied from the package, at the same path under `build/` as
 * under the package; a stylesheet with its handle and the handles it loads
 * after.
 *
 * @type {Array<{file: string, handle?: string, deps?: string[]}>}
 */
const ASSETS = [
	// The `--rh-` custom properties. The handle is shared with the plugin's
	// related-resources block, which lists it in its `block.json`; the theme
	// registers it first (`functions.php`).
	{ file: 'tokens.css', handle: 'resource-hub-tokens', deps: [] },
	// The size-adjusted faces `--rh-font-sans` lists after Figtree.
	{
		file: 'fonts/figtree-fallback.css',
		handle: 'resource-hub-figtree-fallback',
		deps: [],
	},
	// Figtree, which `theme.json` registers, with its licence beside it, as
	// the SIL Open Font License requires of a copy.
	{ file: 'fonts/figtree-latin-wght-normal.woff2' },
	{ file: 'fonts/LICENSE-Figtree.txt' },
	// The lockup the header part renders.
	{
		file: 'brand.css',
		handle: 'resource-hub-brand',
		deps: [ 'resource-hub-tokens' ],
	},
	// The document and the landmarks' layout every template sits in.
	{
		file: 'base.css',
		handle: 'resource-hub-base',
		deps: [ 'resource-hub-tokens', 'resource-hub-figtree-fallback' ],
	},
	{
		file: 'shell.css',
		handle: 'resource-hub-shell',
		deps: [ 'resource-hub-base' ],
	},
	// The article `page.html`, `singular.html` and `index.html` render.
	{
		file: 'prose.css',
		handle: 'resource-hub-prose',
		deps: [ 'resource-hub-base' ],
	},
	{
		file: 'page.css',
		handle: 'resource-hub-page',
		deps: [ 'resource-hub-base' ],
	},
	// The welcome `home.html` renders, beside `page.css`.
	{
		file: 'welcome.css',
		handle: 'resource-hub-welcome',
		deps: [ 'resource-hub-page' ],
	},
	// The 404's column.
	{
		file: 'not-found.css',
		handle: 'resource-hub-not-found',
		deps: [ 'resource-hub-base' ],
	},
];

/**
 * A string as a single-quoted PHP literal.
 *
 * @param {string} value The string.
 * @return {string} The literal.
 */
const php = ( value ) => `'${ value.replace( /[\\']/g, '\\$&' ) }'`;

await rm( out, { recursive: true, force: true } );

const copies = [];
for ( const { file } of ASSETS ) {
	const destination = path.join( out, file );
	await mkdir( path.dirname( destination ), { recursive: true } );
	await copyFile(
		require.resolve( `@colbitron/resource-hub-ui/${ file }` ),
		destination
	);
	const hash = createHash( 'sha256' )
		.update( await readFile( destination ) )
		.digest( 'hex' );
	copies.push( `\t\t${ php( file ) } => ${ php( hash ) },` );
}

const styles = ASSETS.filter( ( asset ) => asset.handle ).map(
	( { file, handle, deps } ) =>
		`\t\t${ php( handle ) } => array( ${ php( file ) }, array(${
			deps.length > 0 ? ` ${ deps.map( php ).join( ', ' ) } ` : ''
		}) ),`
);

await writeFile(
	path.join( out, 'assets.php' ),
	[
		'<?php',
		'// Written by scripts/build.mjs from its ASSETS: each copy in build/ with its SHA-256, and each',
		"// stylesheet's handle with its file and the handles it loads after. Do not edit.",
		'return array(',
		"\t'copies' => array(",
		...copies,
		'\t),',
		"\t'styles' => array(",
		...styles,
		'\t),',
		');',
		'',
	].join( '\n' )
);

process.stdout.write(
	`Built ${ ASSETS.length } theme assets into ${ path.relative( process.cwd(), out ) || '.' }.\n`
);
