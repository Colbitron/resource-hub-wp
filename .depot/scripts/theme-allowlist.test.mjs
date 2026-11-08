// Tests for the deploy's theme sync, the `Sync the theme` step of ci.yml's
// `deploy` job, run by the `scope` job on every pull request
// (`node --test .depot/scripts/theme-allowlist.test.mjs`), and runnable on a
// laptop with Node 24. Plain node:test and git, so the job installs nothing.
//
// The step is an rsync allowlist from wp-content/themes/resource-hub: what it
// does not include never reaches the host. The deploy cannot be trialled
// without deploying, so these hold its filters to the theme as committed:
// every file the theme loads at runtime is included, every tracked file is
// either included or named in STAYS_BEHIND, and the step keeps the shape
// that confines its --delete to the theme's own directory. A new runtime
// file or directory fails here until the step includes it; a new
// development-only one until STAYS_BEHIND names it.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath( new URL( '../..', import.meta.url ) );
const WORKFLOW = fileURLToPath( new URL( '../workflows/ci.yml', import.meta.url ) );
const THEME = 'wp-content/themes/resource-hub';

// The theme's tracked top-level entries that WordPress never reads, so the
// sync leaves them behind: the README, the build's package and script, and
// the font's recorded hash, which only the plugin's PHPUnit suite reads.
// node_modules/ is untracked and excluded by the same final '*'.
const STAYS_BEHIND = [ 'README.md', 'package.json', 'scripts', 'figtree.sha256' ];

// The files WordPress itself reads from a block theme, whatever the theme's
// own code loads: the header, the global settings and styles, the theme's
// PHP, and the one template a block theme must have.
const WORDPRESS_READS = [ 'style.css', 'theme.json', 'functions.php', 'templates/index.html' ];

// The `Sync the theme` step's lines, from its `- name:` to the next step's,
// read as text with no YAML parser, as ci-scope.test.mjs reads the jobs.
function syncStep( text = readFileSync( WORKFLOW, 'utf8' ) ) {
	const lines = text.split( '\n' );
	const start = lines.findIndex( ( line ) => /^ {6}- name: Sync the theme\s*$/.test( line ) );
	assert.notEqual( start, -1, 'ci.yml has no "Sync the theme" step' );
	// The step ends at the next line indented no deeper than its `- name:`,
	// a comment included: everything inside a step is indented further.
	const end = lines.findIndex( ( line, index ) => index > start && /^ {0,6}\S/.test( line ) );
	return lines.slice( start, end === -1 ? undefined : end ).join( '\n' );
}

// The step's rsync filters, in order, as [ kind, pattern ].
function filters( step ) {
	return [ ...step.matchAll( /'--(include|exclude)=([^']*)'/g ) ].map( ( match ) => [ match[ 1 ], match[ 2 ] ] );
}

/**
 * Whether rsync, with these anchored includes and a final `--exclude=*`,
 * sends a path relative to the source. Only the two forms the step uses are
 * read: `/name`, one top-level entry, and `/dir/***`, a directory and
 * everything under it. Any other pattern throws, so a wildcard or an
 * unanchored pattern cannot be added without teaching this to read it.
 *
 * @param {string[]} includes The include patterns.
 * @return {(path: string) => boolean} The matcher.
 */
function shippedBy( includes ) {
	const exact = [];
	const trees = [];
	for ( const pattern of includes ) {
		let match;
		if ( ( match = pattern.match( /^\/([^/*?[\]]+)$/ ) ) ) {
			exact.push( match[ 1 ] );
		} else if ( ( match = pattern.match( /^\/([^/*?[\]]+)\/\*\*\*$/ ) ) ) {
			trees.push( match[ 1 ] );
		} else {
			throw new Error( `cannot read the include ${ JSON.stringify( pattern ) }` );
		}
	}
	return ( path ) => exact.includes( path ) || trees.some( ( tree ) => path === tree || path.startsWith( `${ tree }/` ) );
}

function trackedFiles() {
	return execFileSync( 'git', [ 'ls-files', '-z', '--', THEME ], { cwd: REPO, encoding: 'utf8' } )
		.split( '\0' )
		.filter( Boolean )
		.map( ( file ) => posix.relative( THEME, file ) );
}

/**
 * The theme paths a PHP file builds from its own directory: `__DIR__ . '/…'`,
 * relative to the file's directory, and `dirname( __DIR__ ) . '/…'` or
 * `dirname( __DIR__, N ) . '/…'`, relative to the directory one or N levels
 * above it, as `inc/theme-control.php` reaches `js/`. A path that leaves the
 * theme throws.
 *
 * @param {string} file   The PHP file's path, relative to the theme.
 * @param {string} source Its source.
 * @return {string[]} The paths, relative to the theme.
 */
function dirPaths( file, source ) {
	const paths = [];
	for ( const [ , base, levels, path ] of source.matchAll( /(dirname\(\s*__DIR__\s*(?:,\s*(\d+)\s*)?\)|__DIR__)\s*\.\s*'(\/[^']+)'/g ) ) {
		const up = base.startsWith( 'dirname' ) ? Number( levels ?? 1 ) : 0;
		const resolved = posix.normalize( posix.join( posix.dirname( file ), ...Array( up ).fill( '..' ), path.slice( 1 ) ) );
		if ( resolved === '..' || resolved.startsWith( '../' ) ) {
			throw new Error( `${ file } loads ${ path } from outside the theme` );
		}
		paths.push( resolved );
	}
	return paths;
}

const read = ( file ) => readFileSync( `${ REPO }/${ THEME }/${ file }`, 'utf8' );
const shipped = shippedBy( filters( syncStep() ).filter( ( [ kind ] ) => kind === 'include' ).map( ( [ , pattern ] ) => pattern ) );

test( 'shippedBy reads anchored files and trees, and refuses anything else', () => {
	const match = shippedBy( [ '/style.css', '/inc/***' ] );
	assert.ok( match( 'style.css' ) );
	assert.ok( match( 'inc' ) );
	assert.ok( match( 'inc/a.php' ) );
	assert.ok( match( 'inc/deep/b.php' ) );
	assert.ok( ! match( 'templates/style.css' ), 'an anchored file is top-level only' );
	assert.ok( ! match( 'include.php' ), 'a tree is its directory, not a prefix of a name' );
	assert.ok( ! match( 'README.md' ) );
	for ( const bad of [ 'style.css', '/inc/**', '/inc/', '/*.css', '/inc/*.php', 'inc/***' ] ) {
		assert.throws( () => shippedBy( [ bad ] ), /cannot read the include/, bad );
	}
} );

test( 'dirPaths reads __DIR__ and dirname( __DIR__ ) paths from where the file sits', () => {
	const source = [
		"require_once __DIR__ . '/inc/a.php';",
		"$file = dirname( __DIR__ ) . '/js/b.js';",
		"$up = dirname(__DIR__, 2) . '/c.css';",
		"$deep = __DIR__ . '/../build/d.php';",
	].join( '\n' );
	assert.deepEqual( dirPaths( 'functions.php', "require_once __DIR__ . '/inc/a.php';" ), [ 'inc/a.php' ] );
	assert.deepEqual( dirPaths( 'inc/x/theme.php', source ), [ 'inc/x/inc/a.php', 'inc/js/b.js', 'c.css', 'inc/build/d.php' ] );
	assert.deepEqual( dirPaths( 'inc/theme-control.php', "dirname( __DIR__ ) . '/js/theme-control.js'" ), [ 'js/theme-control.js' ] );
	assert.throws( () => dirPaths( 'functions.php', "dirname( __DIR__ ) . '/x.php'" ), /outside the theme/ );
} );

test( 'syncStep reads one step and stops at the next', () => {
	const text = [
		'    steps:',
		'      - name: Sync the plugin',
		"          '--include=/vendor/***' \\",
		'',
		"      # a comment above the next step, '--include=/c'",
		'      - name: Sync the theme',
		'        working-directory: x',
		'        run: |',
		"          rsync '--include=/a' '--exclude=*' ./ x",
		'',
		'      # the next step',
		'      - name: Activate the plugin',
		"          '--include=/b' \\",
	].join( '\n' );
	assert.deepEqual( filters( syncStep( text ) ), [ [ 'include', '/a' ], [ 'exclude', '*' ] ] );
} );

test( 'the theme sync is an allowlist from the theme directory into THEME_DIR alone', () => {
	const step = syncStep();
	const all = filters( step );
	assert.ok( all.length > 1, 'the step has no filters' );
	assert.deepEqual( all.at( -1 ), [ 'exclude', '*' ], "the last filter is --exclude='*'" );
	for ( const [ kind, pattern ] of all.slice( 0, -1 ) ) {
		assert.equal( kind, 'include', `only includes come before the final exclude (got --${ kind }=${ pattern })` );
	}
	assert.match( step, new RegExp( `^ {8}working-directory: ${ THEME }\\s*$`, 'm' ), 'the source is the theme directory' );
	assert.match( step, /\.\/ "deploy:\$THEME_DIR\/"\s*$/m, 'the source is ./ and the target THEME_DIR' );
	assert.match( step, /--delete-delay/ );
	assert.match( step, /--delay-updates/ );
	assert.doesNotMatch( step, /--delete-excluded|--delete-before|--delete-during|--delete-after|--del\b|--delete\s/, 'only --delete-delay deletes, and never what the allowlist excludes' );

	// THEME_DIR is built from the checked WordPress root with a fixed suffix.
	assert.match(
		readFileSync( WORKFLOW, 'utf8' ),
		/^ {10}echo "THEME_DIR=\$wp_root\/wp-content\/themes\/resource-hub" >> "\$GITHUB_ENV"$/m,
		'THEME_DIR is the checked root plus wp-content/themes/resource-hub'
	);
} );

test( 'every tracked theme file is either shipped or stays behind by name', () => {
	const files = trackedFiles();
	assert.ok( files.includes( 'functions.php' ), `git lists no theme files under ${ THEME }` );
	for ( const file of files ) {
		const behind = STAYS_BEHIND.includes( file.split( '/' )[ 0 ] );
		assert.notEqual(
			shipped( file ),
			behind,
			behind
				? `${ file } is in STAYS_BEHIND but the theme sync ships it`
				: `${ file } is neither shipped by the theme sync in ci.yml nor named in STAYS_BEHIND: include it if WordPress loads it, or name it here if it stays behind`
		);
	}
	for ( const name of STAYS_BEHIND ) {
		assert.ok( files.some( ( file ) => file.split( '/' )[ 0 ] === name ), `STAYS_BEHIND names ${ name }, which the theme no longer has` );
	}
	assert.ok( ! shipped( 'node_modules/@colbitron/resource-hub-ui/tokens.css' ), 'node_modules/ stays behind' );
} );

test( 'every file WordPress and the theme load at runtime is shipped', () => {
	const tracked = trackedFiles();
	const loads = new Set( WORDPRESS_READS );

	// The PHP's own paths: those built from `__DIR__` (dirPaths, above), and
	// `get_theme_file_uri( '…' )` or `_path`, relative to the theme, a
	// trailing slash standing for any file under that directory.
	for ( const file of tracked.filter( ( name ) => name.endsWith( '.php' ) && shipped( name ) ) ) {
		const source = read( file );
		for ( const path of dirPaths( file, source ) ) {
			loads.add( path );
		}
		for ( const [ , path ] of source.matchAll( /get_theme_file_(?:uri|path)\(\s*'([^']+)'/g ) ) {
			loads.add( path.endsWith( '/' ) ? `${ path }any` : path );
		}
	}

	// theme.json's `file:./` sources and its template parts.
	const json = JSON.parse( read( 'theme.json' ) );
	const strings = ( value ) => {
		if ( typeof value === 'string' ) {
			return [ value ];
		}
		return value && typeof value === 'object' ? Object.values( value ).flatMap( strings ) : [];
	};
	for ( const value of strings( json ) ) {
		if ( value.startsWith( 'file:./' ) ) {
			loads.add( value.slice( 'file:./'.length ) );
		}
	}
	for ( const { name } of json.templateParts ?? [] ) {
		loads.add( `parts/${ name }.html` );
	}

	// Every template and part, and the parts they include by slug.
	for ( const file of tracked.filter( ( name ) => /^(templates|parts)\/[^/]+\.html$/.test( name ) ) ) {
		loads.add( file );
		for ( const [ , attributes ] of read( file ).matchAll( /<!-- wp:template-part (\{.*?\}) \/?-->/g ) ) {
			const { slug, theme } = JSON.parse( attributes );
			if ( ! theme || theme === 'resource-hub' ) {
				loads.add( `parts/${ slug }.html` );
			}
		}
	}

	// What the build writes into build/: its manifest, and each copy in the
	// build script's ASSETS.
	loads.add( 'build/assets.php' );
	const assets = [ ...read( 'scripts/build.mjs' ).matchAll( /\bfile: '([^']+)'/g ) ].map( ( [ , file ] ) => file );
	assert.ok( assets.includes( 'tokens.css' ), 'the build script lists no tokens.css' );
	for ( const file of assets ) {
		loads.add( `build/${ file }` );
	}

	for ( const path of loads ) {
		assert.ok( shipped( path ), `the theme loads ${ path } at runtime, but the theme sync in ci.yml does not ship it` );
		if ( ! path.startsWith( 'build/' ) ) {
			assert.ok( tracked.includes( path ), `the theme loads ${ path }, which is not a tracked file` );
		}
	}
} );
