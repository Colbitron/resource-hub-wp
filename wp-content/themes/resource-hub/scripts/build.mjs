/**
 * Builds the theme's runtime assets into `build/`, from the contract package.
 *
 * The host never sees the pnpm workspace: the deploy ships built output only,
 * and `theme.json` resolves `file:./` relative to the theme. So every file the
 * theme loads from `@colbitron/resource-hub-ui` is copied here, byte for byte,
 * with no minifying or rewriting, so the CMS draws with exactly the values the
 * front end does (`packages/ui/DESIGN.md`, "Consumers and loading"):
 *
 * - `tokens.css`, the `--rh-` custom properties;
 * - `brand.css`, the lockup the header part renders;
 * - `fonts/figtree-latin-wght-normal.woff2`, which `theme.json` registers as
 *   Figtree, with `fonts/LICENSE-Figtree.txt` beside it, as the SIL Open Font
 *   License requires of a copy;
 * - `fonts/figtree-fallback.css`, the size-adjusted fallback faces
 *   `--rh-font-sans` lists after Figtree.
 *
 * It also writes `build/assets.php`, which returns each copy's SHA-256 keyed
 * by its path under `build/`: `functions.php` takes the stylesheets' versions
 * from it, so a changed file gets a new URL, and the plugin's PHPUnit suite
 * (`tests/phpunit/Theme/ThemeAssetsTest.php`) holds every copy to the package's
 * file and the font to the hash committed in `figtree.sha256`.
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

/** Each copy's path under `build/`, and the package export it is copied from. */
const ASSETS = {
	'tokens.css': '@colbitron/resource-hub-ui/tokens.css',
	'brand.css': '@colbitron/resource-hub-ui/brand.css',
	'fonts/figtree-latin-wght-normal.woff2':
		'@colbitron/resource-hub-ui/fonts/figtree-latin-wght-normal.woff2',
	'fonts/LICENSE-Figtree.txt':
		'@colbitron/resource-hub-ui/fonts/LICENSE-Figtree.txt',
	'fonts/figtree-fallback.css':
		'@colbitron/resource-hub-ui/fonts/figtree-fallback.css',
};

await rm( out, { recursive: true, force: true } );

const hashes = {};
for ( const [ target, specifier ] of Object.entries( ASSETS ) ) {
	const destination = path.join( out, target );
	await mkdir( path.dirname( destination ), { recursive: true } );
	await copyFile( require.resolve( specifier ), destination );
	hashes[ target ] = createHash( 'sha256' )
		.update( await readFile( destination ) )
		.digest( 'hex' );
}

const rows = Object.entries( hashes )
	.map( ( [ target, hash ] ) => `\t'${ target }' => '${ hash }',` )
	.join( '\n' );
await writeFile(
	path.join( out, 'assets.php' ),
	`<?php\n// Written by scripts/build.mjs: the SHA-256 of each file in build/. Do not edit.\nreturn array(\n${ rows }\n);\n`
);

process.stdout.write(
	`Built ${ Object.keys( hashes ).length } theme assets into ${ path.relative( process.cwd(), out ) || '.' }.\n`
);
