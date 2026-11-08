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

import { changedPaths, main, scopeOf, sidesOf } from './ci-scope.mjs';

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
		'.github/workflows/preview-lighthouse.yml': [],
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
