// Tests for ci-scope.mjs, run by the `scope` job before it classifies
// (`node --test .depot/scripts/ci-scope.test.mjs`), and runnable on a
// laptop with Node 24 and git. Plain node:test, so the job installs nothing.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { changedPaths, main, pullRequestFilePaths, scopeOf, sidesOf } from './ci-scope.mjs';

const EVERYTHING = { plugin: true, web: true };

test( 'each path selects the sides it can affect', () => {
	const cases = {
		'wp-content/plugins/resource-hub-wp/src/Rest/ResolveRoute.php': [ 'plugin' ],
		'wp-content/plugins/resource-hub-wp/README.md': [ 'plugin' ],
		'wp-content/themes/resource-hub/theme.json': [ 'plugin' ],
		'apps/web/app/page.tsx': [ 'web' ],
		'apps/web/lighthouserc.cjs': [ 'web' ],
		'apps/web/e2e/README.md': [ 'web' ],
		'apps/web/CLAUDE.md': [ 'web' ],
		'.wp-env.json': [ 'plugin', 'web' ],
		'packages/ui/schemas/resource.schema.json': [ 'plugin', 'web' ],
		'packages/ui/DESIGN.md': [ 'plugin', 'web' ],
		'package.json': [ 'plugin', 'web' ],
		'pnpm-lock.yaml': [ 'plugin', 'web' ],
		'pnpm-workspace.yaml': [ 'plugin', 'web' ],
		'.depot/workflows/ci.yml': [ 'plugin', 'web' ],
		'.depot/actions/setup-js/action.yml': [ 'plugin', 'web' ],
		'.depot/scripts/ci-scope.mjs': [ 'plugin', 'web' ],
		'.gitignore': [ 'plugin', 'web' ],
		'.npmrc': [ 'plugin', 'web' ],
		'scripts/new-thing.sh': [ 'plugin', 'web' ],
		'docs/adr/0053-ci-runs-on-depot-ci.md': [],
		'docs/runbooks/deploy.md': [],
		'.claude/rules/adr.md': [],
		'.github/workflows/adr-approval.yml': [],
		'.depot/workflows/preview-lighthouse.yml': [ 'plugin', 'web' ],
		'tools/featured-images/generate.mts': [],
		'README.md': [],
		'CLAUDE.md': [],
	};
	for ( const [ path, sides ] of Object.entries( cases ) ) {
		assert.deepEqual( [ ...sidesOf( path ) ], sides, path );
	}
} );

test( 'a lookalike prefix is not a side', () => {
	// Only the exact top-level directory counts.
	assert.deepEqual( [ ...sidesOf( 'wp-content-old/x.php' ) ], [ 'plugin', 'web' ] );
	assert.deepEqual( [ ...sidesOf( 'apps.md' ) ], [] );
	assert.deepEqual( [ ...sidesOf( 'docs' ) ], [ 'plugin', 'web' ] );
	assert.deepEqual( [ ...sidesOf( 'nested/README.md' ) ], [ 'plugin', 'web' ] );
} );

test( 'a plugin-only change skips the front end', () => {
	assert.deepEqual(
		scopeOf( [ 'wp-content/plugins/resource-hub-wp/src/Plugin.php', 'docs/architecture/revalidation.md' ] ),
		{ plugin: true, web: false }
	);
} );

test( 'a front-end-only change skips the gate', () => {
	assert.deepEqual( scopeOf( [ 'apps/web/app/page.tsx' ] ), { plugin: false, web: true } );
	assert.deepEqual( scopeOf( [ 'apps/web/README.md' ] ), { plugin: false, web: true } );
	assert.deepEqual( scopeOf( [ 'apps/web/lighthouserc.cjs' ] ), { plugin: false, web: true } );
} );

test( 'a shared path runs everything', () => {
	assert.deepEqual( scopeOf( [ 'apps/web/README.md', 'packages/ui/card.css' ] ), EVERYTHING );
	assert.deepEqual( scopeOf( [ 'wp-content/plugins/resource-hub-wp/src/Plugin.php', 'pnpm-lock.yaml' ] ), EVERYTHING );
	assert.deepEqual( scopeOf( [ '.wp-env.json' ] ), EVERYTHING );
} );

test( 'a change to inert paths only runs nothing', () => {
	assert.deepEqual( scopeOf( [ 'docs/adr/0053-ci-runs-on-depot-ci.md', 'README.md' ] ), { plugin: false, web: false } );
	assert.deepEqual( scopeOf( [] ), { plugin: false, web: false } );
} );

test( 'unreadable paths run everything', () => {
	assert.deepEqual( scopeOf( null ), EVERYTHING );
} );

// A throwaway repository with a base, a branch and the merge of the branch
// into the base, as GitHub builds refs/pull/N/merge.
function repoWith( branchFiles, { rename } = {} ) {
	const dir = mkdtempSync( join( tmpdir(), 'ci-scope-' ) );
	const run = ( ...args ) => execFileSync( 'git', [ '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args ], { cwd: dir, encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'pipe' ] } ).trim();
	const write = ( path, text ) => {
		mkdirSync( join( dir, dirname( path ) ), { recursive: true } );
		writeFileSync( join( dir, path ), text );
	};
	run( 'init', '-q', '-b', 'main' );
	write( 'wp-content/plugins/p/a.php', 'base\n' );
	write( 'apps/web/page.tsx', 'base\n' );
	write( 'docs/a.md', 'base\n' );
	run( 'add', '-A' );
	run( 'commit', '-q', '-m', 'base' );
	run( 'checkout', '-q', '-b', 'feature' );
	for ( const [ path, text ] of Object.entries( branchFiles ) ) {
		write( path, text );
	}
	if ( rename ) {
		run( 'mv', ...rename );
	}
	run( 'add', '-A' );
	run( 'commit', '-q', '-m', 'feature' );
	const head = run( 'rev-parse', 'HEAD' );
	run( 'checkout', '-q', 'main' );
	// main moves on after the branch point, as it does under an open pull request.
	write( 'packages/ui/main-moved.css', 'main moved\n' );
	run( 'add', '-A' );
	run( 'commit', '-q', '-m', 'main moved' );
	run( 'merge', '-q', '--no-ff', '--no-edit', 'feature' );
	return { dir, head, run, cleanup: () => rmSync( dir, { recursive: true, force: true } ) };
}

test( 'changedPaths reads the merge commit against its base, not main\'s own changes', () => {
	const repo = repoWith( { 'wp-content/plugins/p/a.php': 'changed\n', 'docs/a.md': 'changed\n' } );
	try {
		const { paths } = changedPaths( { cwd: repo.dir, expectHead: repo.head } );
		assert.deepEqual( paths.sort(), [ 'docs/a.md', 'wp-content/plugins/p/a.php' ] );
		assert.deepEqual( scopeOf( paths ), { plugin: true, web: false } );
	} finally {
		repo.cleanup();
	}
} );

test( 'a rename counts as its old path and its new one', () => {
	const repo = repoWith( {}, { rename: [ 'apps/web/page.tsx', 'docs/page.tsx' ] } );
	try {
		const { paths } = changedPaths( { cwd: repo.dir, expectHead: repo.head } );
		assert.deepEqual( paths.sort(), [ 'apps/web/page.tsx', 'docs/page.tsx' ] );
		assert.equal( scopeOf( paths ).web, true );
	} finally {
		repo.cleanup();
	}
} );

test( 'HEAD that is not a two-parent merge of the expected head, or no head given, runs everything', () => {
	const repo = repoWith( { 'wp-content/plugins/p/a.php': 'changed\n' } );
	try {
		// main's own HEAD is often a merge commit; without the head to check, it is not trusted.
		const noHead = changedPaths( { cwd: repo.dir } );
		assert.equal( noHead.paths, null );
		assert.match( noHead.reason, /no pull request head SHA/ );

		const wrongHead = changedPaths( { cwd: repo.dir, expectHead: '0'.repeat( 40 ) } );
		assert.equal( wrongHead.paths, null );
		assert.match( wrongHead.reason, /not the pull request's head/ );

		repo.run( 'checkout', '-q', 'HEAD^2' );
		const single = changedPaths( { cwd: repo.dir, expectHead: repo.head } );
		assert.equal( single.paths, null );
		assert.match( single.reason, /1 parent/ );
	} finally {
		repo.cleanup();
	}
	const notRepo = mkdtempSync( join( tmpdir(), 'ci-scope-none-' ) );
	try {
		assert.equal( changedPaths( { cwd: notRepo, expectHead: '0'.repeat( 40 ) } ).paths, null );
	} finally {
		rmSync( notRepo, { recursive: true, force: true } );
	}
} );

test( 'main writes the outputs and the summary', () => {
	const dir = mkdtempSync( join( tmpdir(), 'ci-scope-main-' ) );
	try {
		const list = join( dir, 'paths.txt' );
		const output = join( dir, 'output' );
		const summary = join( dir, 'summary' );
		writeFileSync( list, 'apps/web/app/page.tsx\n\n  docs/a.md  \n' );
		const log = console.log;
		console.log = () => {};
		try {
			main( [ '--paths-file', list ], { GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary } );
		} finally {
			console.log = log;
		}
		assert.equal( readFileSync( output, 'utf8' ), 'plugin=false\nweb=true\n' );
		assert.match( readFileSync( summary, 'utf8' ), /\| plugin \| skipped \|/ );
	} finally {
		rmSync( dir, { recursive: true, force: true } );
	}
} );

const SCRIPT = fileURLToPath( new URL( './ci-scope.mjs', import.meta.url ) );
const WORKFLOW = fileURLToPath( new URL( '../workflows/ci.yml', import.meta.url ) );
const PREVIEW_WORKFLOW = fileURLToPath( new URL( '../workflows/preview-lighthouse.yml', import.meta.url ) );

test( 'changedPaths reads a --depth 2 clone of the merge commit, as the scope job checks it out', () => {
	const repo = repoWith( { 'apps/web/page.tsx': 'changed\n' } );
	const clone = mkdtempSync( join( tmpdir(), 'ci-scope-clone-' ) );
	try {
		// file:// so git honours --depth; HEAD of main is the merge commit.
		execFileSync( 'git', [ 'clone', '-q', '--depth', '2', '--branch', 'main', `file://${ repo.dir }`, clone ], { stdio: 'ignore' } );
		assert.equal( execFileSync( 'git', [ 'rev-parse', '--is-shallow-repository' ], { cwd: clone, encoding: 'utf8' } ).trim(), 'true' );
		const { paths } = changedPaths( { cwd: clone, expectHead: repo.head } );
		assert.deepEqual( paths, [ 'apps/web/page.tsx' ] );
		assert.deepEqual( scopeOf( paths ), { plugin: false, web: true } );
	} finally {
		repo.cleanup();
		rmSync( clone, { recursive: true, force: true } );
	}
} );

test( 'a missing parent, or a base git cannot diff, runs everything', () => {
	const repo = repoWith( { 'wp-content/plugins/p/a.php': 'changed\n' } );
	const clone = mkdtempSync( join( tmpdir(), 'ci-scope-clone-' ) );
	try {
		// A --depth 1 clone has the merge commit without its parents.
		execFileSync( 'git', [ 'clone', '-q', '--depth', '1', '--branch', 'main', `file://${ repo.dir }`, clone ], { stdio: 'ignore' } );
		const shallow = changedPaths( { cwd: clone, expectHead: repo.head } );
		assert.equal( shallow.paths, null );
		assert.match( shallow.reason, /0 parent/ );

		// The base commit is there, so the head check passes, but its tree is
		// gone (only the base's tree holds main-moved.css), so the diff fails.
		const tree = repo.run( 'rev-parse', 'HEAD^1^{tree}' );
		unlinkSync( join( repo.dir, '.git', 'objects', tree.slice( 0, 2 ), tree.slice( 2 ) ) );
		const result = changedPaths( { cwd: repo.dir, expectHead: repo.head } );
		assert.equal( result.paths, null );
		assert.match( result.reason, /git diff failed/ );
		assert.deepEqual( scopeOf( result.paths ), EVERYTHING );
	} finally {
		repo.cleanup();
		rmSync( clone, { recursive: true, force: true } );
	}
} );

test( 'the script reads --expect-head from its arguments', () => {
	const repo = repoWith( { 'wp-content/plugins/p/a.php': 'changed\n' } );
	try {
		const output = join( repo.dir, '.git', 'output' );
		const run = ( ...args ) => {
			writeFileSync( output, '' );
			execFileSync( process.execPath, [ SCRIPT, ...args ], { cwd: repo.dir, env: { PATH: process.env.PATH, GITHUB_OUTPUT: output }, stdio: 'ignore' } );
			return readFileSync( output, 'utf8' );
		};
		assert.equal( run( '--expect-head', repo.head ), 'plugin=true\nweb=false\n' );
		// No value after the flag, or no flag: no head to check, so everything runs.
		assert.equal( run( '--expect-head' ), 'plugin=true\nweb=true\n' );
		assert.equal( run(), 'plugin=true\nweb=true\n' );
	} finally {
		repo.cleanup();
	}
} );

// Preview Lighthouse classifies from the pull request files API, not a diff.
test( 'pullRequestFilePaths reads the files API, renames at both ends', () => {
	const files = [
		{ filename: 'wp-content/plugins/resource-hub-wp/src/Plugin.php', status: 'modified' },
		{ filename: 'docs/page.tsx', previous_filename: 'apps/web/page.tsx', status: 'renamed' },
	];
	const { paths } = pullRequestFilePaths( files, 2 );
	assert.deepEqual( paths, [ 'wp-content/plugins/resource-hub-wp/src/Plugin.php', 'apps/web/page.tsx', 'docs/page.tsx' ] );
	assert.deepEqual( scopeOf( paths ), EVERYTHING );
	// The count arrives as text from the shell.
	assert.deepEqual( pullRequestFilePaths( files, '2' ).paths, paths );
} );

test( 'a plugin-only or docs-only pull request does not reach the front end', () => {
	const plugin = pullRequestFilePaths( [ { filename: 'wp-content/plugins/resource-hub-wp/src/Plugin.php' }, { filename: 'docs/runbooks/deploy.md' } ], 2 );
	assert.equal( scopeOf( plugin.paths ).web, false );
	const docs = pullRequestFilePaths( [ { filename: 'docs/adr/0053-ci-runs-on-depot-ci.md' }, { filename: 'README.md' } ], 2 );
	assert.deepEqual( scopeOf( docs.paths ), { plugin: false, web: false } );
	assert.equal( scopeOf( pullRequestFilePaths( [ { filename: 'apps/web/app/page.tsx' } ], 1 ).paths ).web, true );
	assert.equal( scopeOf( pullRequestFilePaths( [ { filename: 'packages/ui/card.css' } ], 1 ).paths ).web, true );
} );

test( 'an incomplete or unreadable files list reaches every side', () => {
	const one = [ { filename: 'docs/a.md' } ];
	for ( const [ files, count, reason ] of [
		[ one, 2, /listed 1 of 2/ ], // the API's 3,000-file cap, or a page lost
		[ one, '', /not a whole number/ ],
		[ one, undefined, /not a whole number/ ],
		[ one, 'two', /not a whole number/ ],
		[ one, 1.5, /not a whole number/ ],
		[ one, -1, /not a whole number/ ],
		[ [], 0, /no changed files/ ], // an empty list proves nothing
		[ [], '0', /no changed files/ ],
		[ one, 0, /no changed files/ ],
		[ { filename: 'docs/a.md' }, 1, /not an array/ ],
		[ [ { path: 'docs/a.md' } ], 1, /not an array/ ],
		[ [ null ], 1, /not an array/ ],
	] ) {
		const result = pullRequestFilePaths( files, count );
		assert.equal( result.paths, null, JSON.stringify( [ files, count ] ) );
		assert.match( result.reason, reason );
		assert.deepEqual( scopeOf( result.paths ), EVERYTHING );
	}
} );

test( 'the script reads --pr-files and --changed-files, and fails safe', () => {
	const dir = mkdtempSync( join( tmpdir(), 'ci-scope-pr-' ) );
	try {
		const output = join( dir, 'output' );
		const summary = join( dir, 'summary' );
		const run = ( ...args ) => {
			writeFileSync( output, '' );
			writeFileSync( summary, '' );
			execFileSync( process.execPath, [ SCRIPT, ...args ], { cwd: dir, env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }, stdio: 'ignore' } );
			return readFileSync( output, 'utf8' );
		};
		const files = join( dir, 'files.json' );
		writeFileSync( files, JSON.stringify( [ { filename: 'wp-content/plugins/p/a.php' }, { filename: 'docs/a.md' } ] ) );
		assert.equal( run( '--pr-files', files, '--changed-files', '2' ), 'plugin=true\nweb=false\n' );
		assert.match( readFileSync( summary, 'utf8' ), /### Sides this pull request reaches[\s\S]*\| web \| not reached \|/ );
		// Fewer listed than changed, no count, no such file, a file that is not JSON, no file named.
		assert.equal( run( '--pr-files', files, '--changed-files', '3' ), 'plugin=true\nweb=true\n' );
		assert.match( readFileSync( summary, 'utf8' ), /Every side: the files API listed 2 of 3/ );
		assert.equal( run( '--pr-files', files ), 'plugin=true\nweb=true\n' );
		writeFileSync( join( dir, 'empty.json' ), '[]' );
		assert.equal( run( '--pr-files', join( dir, 'empty.json' ), '--changed-files', '0' ), 'plugin=true\nweb=true\n' );
		assert.match( readFileSync( summary, 'utf8' ), /Every side: the pull request reports no changed files/ );
		assert.equal( run( '--pr-files', join( dir, 'missing.json' ), '--changed-files', '2' ), 'plugin=true\nweb=true\n' );
		writeFileSync( join( dir, 'garbled.json' ), '[{"filename":' );
		assert.equal( run( '--pr-files', join( dir, 'garbled.json' ), '--changed-files', '1' ), 'plugin=true\nweb=true\n' );
		assert.equal( run( '--pr-files' ), 'plugin=true\nweb=true\n' );
	} finally {
		rmSync( dir, { recursive: true, force: true } );
	}
} );

// ci.yml's conditions, read as text: every job a pull request can skip is
// skipped only on a pull request, and neither deploy reads scope's outputs,
// so nothing here can skip a job on main.
test( 'ci.yml scopes jobs only on a pull request, and never the deploys', () => {
	const jobs = {};
	let name = null;
	for ( const line of readFileSync( WORKFLOW, 'utf8' ).split( '\n' ) ) {
		const job = line.match( /^ {2}([a-z][a-z0-9-]*):\s*$/ );
		if ( job ) {
			name = job[ 1 ];
			jobs[ name ] = '';
		} else if ( name && ! /^\s*#/.test( line ) ) {
			jobs[ name ] += line + '\n';
		}
	}
	const ifOf = ( job ) => ( jobs[ job ].match( /^ {4}if: (.*)$/m ) ?? [] )[ 1 ] ?? '';
	for ( const job of [ 'gate', 'web-checks', 'web-e2e', 'web-screenshots' ] ) {
		assert.match( ifOf( job ), /^github\.event_name != 'pull_request' \|\| needs\.scope\.outputs\.(plugin|web) == 'true'$/, job );
	}
	assert.equal( ifOf( 'web-lighthouse' ), "github.event_name != 'pull_request'" );
	assert.match( ifOf( 'web-lighthouse-medians' ), /needs\.scope\.result == 'success' && github\.event_name != 'pull_request'/ );
	for ( const job of [ 'deploy', 'deploy-web' ] ) {
		assert.ok( jobs[ job ], job );
		assert.doesNotMatch( jobs[ job ], /needs\.scope\.outputs/, job );
	}
	for ( const [ job, body ] of Object.entries( jobs ) ) {
		if ( ! [ 'scope', 'deploy', 'deploy-web', 'web-lighthouse-medians' ].includes( job ) && /needs\.scope\.outputs/.test( body ) ) {
			assert.match( ifOf( job ), /^github\.event_name != 'pull_request' \|\|/, job );
		}
	}
} );

// preview-lighthouse.yml, read as text: it measures only when this script
// says the pull request reaches the front end, which unknown paths do, and
// it never uploads the raw runs, which carry the bypass header.
test( 'preview-lighthouse.yml measures only what the scope rules reach', () => {
	const text = readFileSync( PREVIEW_WORKFLOW, 'utf8' ).split( '\n' ).filter( ( line ) => ! /^\s*#/.test( line ) ).join( '\n' );
	assert.match( text, /^ {6}measure: \$\{\{ steps\.decide\.outputs\.web \}\}$/m );
	assert.match( text, /node \.depot\/scripts\/ci-scope\.mjs --pr-files "\$files" --changed-files "\$changed"/ );
	// The pull request is this repository's, the count is the deployed
	// commit's, and the bypass header goes only to a vercel.app preview.
	assert.match( text, /\.head\.sha == \$sha and \.head\.repo\.full_name == \$repo/ );
	assert.match( text, /jq -r '\.head\.sha'\)" != "\$SHA" \]/ );
	assert.match( text, /\[\[ "\$PREVIEW_URL" =~ \^https:\/\/\[A-Za-z0-9-\]\+\\\.vercel\\\.app\$ \]\]/ );
	const measure = text.slice( text.indexOf( '\n  measure:\n' ) );
	assert.match( measure, /^ {4}if: needs\.pr\.outputs\.measure == 'true'$/m );
	assert.doesNotMatch( measure, /\.lighthouseci/ );
	assert.match( measure, /path: apps\/web\/lighthouse-preview-results\/$/m );
	assert.match( measure, /e2e\/preview-lighthouse\.mts/ );
} );
