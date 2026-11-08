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
// development-only one until STAYS_BEHIND names it. A reference in the
// theme's PHP to its own or the theme's directory that the scan cannot
// resolve to a path fails too, naming its file and line, unless UNRESOLVED
// names it with the reason what it reaches is already covered.

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

// The names through which PHP code can reach a file in the theme, in any
// case, as PHP reads magic constants and function names. Every one
// in a shipped PHP file's code must be read by runtimePaths, below, or be
// named in UNRESOLVED; anything else fails, so a path this test cannot read
// is never skipped. `get_parent_theme_file_*` and the `_directory_uri` forms
// are matched too, though no recognised form reads them, so they fail until
// one does.
const REFERENCE = /\b(?:__DIR__|__FILE__|get_(?:stylesheet|template)_directory(?:_uri)?|get_(?:parent_)?theme_file_(?:path|uri))\b/gi;

// References runtimePaths cannot resolve to one path, each named by its file
// and the code it starts, with the reason the file it reaches is already in
// the loads below. An entry no reference uses fails, as STAYS_BEHIND's do.
const UNRESOLVED = [
	// The URL of each stylesheet in build/assets.php's `styles`: copies of
	// the contract package's files, which the build script's ASSETS lists
	// and the runtime test below adds to the loads one by one.
	{ file: 'functions.php', code: "get_theme_file_uri( 'build/' . $file )" },
];

/**
 * A PHP file's source in two views the same length as it, line breaks kept:
 * `bare`, with its comments blanked, and `code`, with its single-quoted
 * strings' contents and its inline HTML blanked too. A single-quoted string
 * cannot run code, so a name inside one is not a reference; a double-quoted
 * one can interpolate, so its contents stay in `code`. A heredoc or an
 * unterminated string or comment throws, so nothing is read past one.
 *
 * @param {string} file   The PHP file's path, for the error.
 * @param {string} source Its source.
 * @return {{bare: string, code: string}} The two views.
 */
function lexPhp( file, source ) {
	const bare = source.split( '' );
	const code = source.split( '' );
	const blank = ( views, from, to ) => {
		for ( let k = from; k < to; k++ ) {
			for ( const view of views ) {
				view[ k ] = view[ k ] === '\n' ? '\n' : ' ';
			}
		}
	};
	const fail = ( at, what ) => {
		throw new Error( `${ file }:${ lineAt( source, at ) }: ${ what }` );
	};
	let i = 0;
	while ( i < source.length ) {
		// Inline HTML, up to the next opening tag.
		const open = /<\?(?:php\b|=)/g;
		open.lastIndex = i;
		const tag = open.exec( source );
		const html = tag ? tag.index : source.length;
		blank( [ code ], i, html );
		i = tag ? html + tag[ 0 ].length : html;
		while ( i < source.length ) {
			const rest = source.slice( i, i + 3 );
			if ( rest.startsWith( '?>' ) ) {
				i += 2;
				break;
			} else if ( rest[ 0 ] === "'" || rest[ 0 ] === '"' ) {
				let end = i + 1;
				while ( end < source.length && source[ end ] !== rest[ 0 ] ) {
					end += source[ end ] === '\\' ? 2 : 1;
				}
				if ( end >= source.length ) {
					fail( i, 'an unterminated string' );
				}
				if ( rest[ 0 ] === "'" ) {
					blank( [ code ], i + 1, end );
				}
				i = end + 1;
			} else if ( rest.startsWith( '/*' ) ) {
				const end = source.indexOf( '*/', i + 2 );
				if ( end === -1 ) {
					fail( i, 'an unterminated comment' );
				}
				blank( [ bare, code ], i, end + 2 );
				i = end + 2;
			} else if ( rest.startsWith( '//' ) || ( rest[ 0 ] === '#' && rest[ 1 ] !== '[' ) ) {
				// A line comment ends at the line's end or at a closing tag.
				const match = /\n|\?>/.exec( source.slice( i ) );
				const end = match ? i + match.index : source.length;
				blank( [ bare, code ], i, end );
				i = end;
			} else if ( rest === '<<<' ) {
				fail( i, 'a heredoc or nowdoc, which this test cannot read' );
			} else {
				i++;
			}
		}
	}
	return { bare: bare.join( '' ), code: code.join( '' ) };
}

const lineAt = ( source, at ) => source.slice( 0, at ).split( '\n' ).length;

// The forms runtimePaths resolves, in a file's comment-free source. Each
// path is one single-quoted literal with nothing concatenated before or
// after the expression and no `dirname(` around it, since either would
// change the path the literal names. They match in any case, as REFERENCE
// does. `name` is the reference's own text, so
// its offset says which reference the form resolves.
const FROM_DIR = /(?<!(?:\.|dirname\s*\()\s*)(?:dirname\(\s*(?<name>__DIR__)\s*(?:,\s*(?<levels>\d+)\s*)?\)|(?<name2>__DIR__))\s*\.\s*'(?<path>\/[^'\\]+)'(?!\s*\.)/dgi;
const FROM_THEME = /(?<!\.\s*)(?<name>get_theme_file_(?:uri|path))\(\s*'(?<path>[^'\\]+)'\s*\)(?!\s*\.)/dgi;

/**
 * The theme paths a PHP file reaches, relative to the theme: `__DIR__ . '/…'`,
 * relative to the file's directory; `dirname( __DIR__ ) . '/…'` or
 * `dirname( __DIR__, N ) . '/…'`, relative to the directory one or N levels
 * above it, as `inc/theme-control.php` reaches `js/`; and
 * `get_theme_file_uri( '…' )` or `_path`, relative to the theme, a trailing
 * slash standing for any file under that directory. Any other reference to
 * the file's or the theme's directory (REFERENCE) throws, naming the file and
 * line, unless `unresolved` names it; so does a path that leaves the theme.
 *
 * @param {string}                         file       The PHP file's path, relative to the theme.
 * @param {string}                         source     Its source.
 * @param {{file: string, code: string}[]} unresolved References to accept unread (UNRESOLVED).
 * @return {{paths: string[], used: object[]}} The paths, and the entries of `unresolved` used.
 */
function runtimePaths( file, source, unresolved = [] ) {
	const { bare, code } = lexPhp( file, source );
	const paths = [];
	const resolved = new Set();
	for ( const match of bare.matchAll( FROM_DIR ) ) {
		const { name, levels, path } = match.groups;
		const up = name ? Number( levels ?? 1 ) : 0;
		const target = posix.normalize( posix.join( posix.dirname( file ), ...Array( up ).fill( '..' ), path.slice( 1 ) ) );
		if ( target === '..' || target.startsWith( '../' ) ) {
			throw new Error( `${ file }:${ lineAt( source, match.index ) } loads ${ path } from outside the theme` );
		}
		paths.push( target );
		resolved.add( match.indices.groups[ name ? 'name' : 'name2' ][ 0 ] );
	}
	for ( const match of bare.matchAll( FROM_THEME ) ) {
		const { path } = match.groups;
		paths.push( path.endsWith( '/' ) ? `${ path }any` : path );
		resolved.add( match.index );
	}

	const used = [];
	const errors = [];
	for ( const match of code.matchAll( REFERENCE ) ) {
		if ( resolved.has( match.index ) ) {
			continue;
		}
		const entry = unresolved.find( ( item ) => item.file === file && bare.startsWith( item.code, match.index ) );
		if ( entry ) {
			used.push( entry );
			continue;
		}
		const line = lineAt( source, match.index );
		errors.push(
			`${ file }:${ line }: ${ match[ 0 ] } in \`${ source.split( '\n' )[ line - 1 ].trim() }\` is not a path this test can resolve`
		);
	}
	if ( errors.length ) {
		throw new Error(
			`${ errors.join( '\n' ) }\nWrite each as __DIR__ . '/…', dirname( __DIR__[, N] ) . '/…' or get_theme_file_uri|path( '…' ), ` +
				'with one single-quoted literal and nothing concatenated to it, or, if what it reaches is already in the loads, ' +
				'name it in UNRESOLVED with the reason.'
		);
	}
	return { paths, used };
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

// A PHP snippet, opened on its first line so its line numbers stay its own.
const php = ( text ) => `<?php ${ text }`;

test( 'runtimePaths reads __DIR__, dirname( __DIR__ ) and get_theme_file_* paths from where the file sits', () => {
	const source = [
		"require_once __DIR__ . '/inc/a.php';",
		"$file = dirname( __DIR__ ) . '/js/b.js';",
		"$up = dirname(__DIR__, 2) . '/c.css';",
		"$deep = __DIR__ . '/../build/d.php';",
		"$uri = get_theme_file_uri( 'assets/e.css' );",
		"$dir = get_theme_file_path( 'parts/' );",
	].join( '\n' );
	const paths = ( file, text ) => runtimePaths( file, php( text ) ).paths;
	assert.deepEqual( paths( 'functions.php', "require_once __DIR__ . '/inc/a.php';" ), [ 'inc/a.php' ] );
	assert.deepEqual( paths( 'inc/x/theme.php', source ), [ 'inc/x/inc/a.php', 'inc/js/b.js', 'c.css', 'inc/build/d.php', 'assets/e.css', 'parts/any' ] );
	assert.deepEqual( paths( 'inc/theme-control.php', "dirname( __DIR__ ) . '/js/theme-control.js'" ), [ 'js/theme-control.js' ] );
	assert.throws( () => paths( 'functions.php', "dirname( __DIR__ ) . '/x.php'" ), /functions\.php:1 loads \/x\.php from outside the theme/ );
} );

test( 'runtimePaths skips names in comments and single-quoted strings, and reads double-quoted ones', () => {
	const source = [
		'<?php',
		'// __DIR__ in a line comment',
		'# __FILE__ in a hash comment',
		'/* get_stylesheet_directory() in a block comment, with a quote: \' */',
		"$doc = 'a single-quoted __DIR__, and // not a comment';",
		"require __DIR__ . '/inc/a.php'; // __FILE__",
		'?>',
		'<p>__DIR__ in inline HTML</p>',
	].join( '\n' );
	assert.deepEqual( runtimePaths( 'functions.php', '<p>No PHP here, and __DIR__ is text.</p>' ).paths, [] );
	assert.deepEqual( runtimePaths( 'functions.php', source ).paths, [ 'inc/a.php' ] );
	assert.throws( () => runtimePaths( 'functions.php', php( '$x = "{$y} __DIR__";' ) ), /functions\.php:1: __DIR__ in/ );
	assert.throws( () => runtimePaths( 'functions.php', php( "$x = <<<EOT\n__DIR__\nEOT;" ) ), /functions\.php:1: a heredoc/ );
	assert.throws( () => runtimePaths( 'functions.php', php( "$x = 'open" ) ), /unterminated string/ );
} );

test( 'runtimePaths fails on every reference it cannot resolve, naming its file and line', () => {
	const unresolvable = {
		'a double-quoted path': 'require __DIR__ . "/inc/x.php";',
		'a nested dirname': "require dirname( dirname( __DIR__ ) ) . '/x.php';",
		'a dirname around the path': "require dirname( __DIR__ . '/inc/x.php' );",
		'__FILE__': "require dirname( __FILE__ ) . '/inc/x.php';",
		'a concatenated variable': "require __DIR__ . '/inc/' . $name;",
		'a concatenated prefix': "$x = $root . __DIR__ . '/inc/x.php';",
		'get_stylesheet_directory': "require get_stylesheet_directory() . '/inc/x.php';",
		'get_template_directory_uri': "$uri = get_template_directory_uri() . '/x.css';",
		'get_theme_file_uri of a concatenation': "$uri = get_theme_file_uri( 'build/' . $file );",
		'get_theme_file_path with nothing': '$dir = get_theme_file_path();',
		'get_parent_theme_file_path': "require get_parent_theme_file_path( 'x.php' );",
	};
	for ( const [ form, line ] of Object.entries( unresolvable ) ) {
		const source = `<?php\n\n${ line }\n`;
		assert.throws(
			() => runtimePaths( 'inc/z.php', source ),
			( error ) => error.message.startsWith( 'inc/z.php:3: ' ) && error.message.includes( `\`${ line }\` is not a path this test can resolve` ),
			form
		);
	}
	// Every unresolved reference is listed, not only the first.
	assert.throws(
		() => runtimePaths( 'functions.php', php( '$a = __FILE__;\n$b = __FILE__;' ) ),
		( error ) => error.message.includes( 'functions.php:1: ' ) && error.message.includes( 'functions.php:2: ' )
	);
} );

test( 'runtimePaths reads names in any case, as PHP does', () => {
	const source = php( "require __Dir__ . '/inc/a.php';\n$up = DirName( __DIR__ ) . '/js/b.js';\n$uri = Get_Theme_File_Uri( 'assets/e.css' );" );
	assert.deepEqual( runtimePaths( 'inc/x.php', source ).paths, [ 'inc/inc/a.php', 'js/b.js', 'assets/e.css' ] );
	for ( const line of [ 'require __dir__ . "/inc/x.php";', "require GET_STYLESHEET_DIRECTORY() . '/inc/x.php';", "require dirname( __File__ ) . '/x.php';" ] ) {
		assert.throws( () => runtimePaths( 'inc/z.php', php( `\n${ line }` ) ), ( error ) => error.message.startsWith( 'inc/z.php:2: ' ) && error.message.includes( `\`${ line }\`` ), line );
	}
} );

test( 'runtimePaths accepts a reference UNRESOLVED names, in that file only', () => {
	const entry = { file: 'functions.php', code: "get_theme_file_uri( 'build/' . $file )" };
	const source = php( "wp_register_style( $h, get_theme_file_uri( 'build/' . $file ) );" );
	assert.deepEqual( runtimePaths( 'functions.php', source, [ entry ] ), { paths: [], used: [ entry ] } );
	assert.throws( () => runtimePaths( 'inc/a.php', source, [ entry ] ), /inc\/a\.php:1: get_theme_file_uri/ );
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

	// The PHP's own paths (runtimePaths, above), which fails on any
	// reference to the file's or the theme's directory it cannot read.
	const used = new Set();
	for ( const file of tracked.filter( ( name ) => name.endsWith( '.php' ) && shipped( name ) ) ) {
		const result = runtimePaths( file, read( file ), UNRESOLVED );
		result.paths.forEach( ( path ) => loads.add( path ) );
		result.used.forEach( ( entry ) => used.add( entry ) );
	}
	for ( const entry of UNRESOLVED ) {
		assert.ok( used.has( entry ), `UNRESOLVED names \`${ entry.code }\` in ${ entry.file }, which no longer has it` );
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
