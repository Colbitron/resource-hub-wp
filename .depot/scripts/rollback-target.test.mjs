// Tests for rollback-target.mjs, run by the `scope` job on every pull
// request (`node --test .depot/scripts/rollback-target.test.mjs`), and
// runnable on a laptop with Node 24 and git. Plain node:test, so the job
// installs nothing. A rollback dispatch cannot be trialled without
// deploying, so these, and one `depot ci run` of a throwaway workflow
// (run recorded in docs/runbooks/deploy.md, "Rolling back"), are its proof.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { decide, git, isSha, main } from './rollback-target.mjs';

const SCRIPT = fileURLToPath( new URL( './rollback-target.mjs', import.meta.url ) );
const WORKFLOW = fileURLToPath( new URL( '../workflows/ci.yml', import.meta.url ) );
const REPO_ROOT = fileURLToPath( new URL( '../../', import.meta.url ) );

// A history to ask about: main is A, B, C, D, with B the deploy job's floor
// and D its head, and S a commit on a branch off C that was never on main.
//
//   A -- B -- C -- D   (main)
//              \
//               S      (side)
function history() {
	const dir = mkdtempSync( join( tmpdir(), 'rollback-target-' ) );
	const run = ( ...args ) => execFileSync( 'git', [ '-C', dir, ...args ], { stdio: 'pipe', encoding: 'utf8' } ).trim();
	const env = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
	const commit = ( name ) => {
		writeFileSync( join( dir, name ), `${ name }\n` );
		execFileSync( 'git', [ '-C', dir, 'add', name ], { stdio: 'pipe' } );
		execFileSync( 'git', [ '-C', dir, 'commit', '-q', '-m', name ], { stdio: 'pipe', env: { ...process.env, ...env } } );
		return run( 'rev-parse', 'HEAD' );
	};
	run( 'init', '-q', '-b', 'main' );
	const A = commit( 'A' );
	const B = commit( 'B' );
	const C = commit( 'C' );
	const D = commit( 'D' );
	run( 'checkout', '-q', '-b', 'side', C );
	const S = commit( 'S' );
	run( 'checkout', '-q', 'main' );
	const askGit = ( args ) => git( [ '-C', dir, ...args ] );
	return { dir, A, B, C, D, S, askGit, run, drop: () => rmSync( dir, { recursive: true, force: true } ) };
}

const dispatch = ( h, rollbackSha, fields = {} ) => ( {
	event: 'workflow_dispatch',
	ref: 'refs/heads/main',
	mainSha: h.D,
	rollbackSha,
	floor: h.B,
	...fields,
} );

test( 'a full SHA in lower case is the one shape accepted', () => {
	assert.equal( isSha( 'a'.repeat( 40 ) ), true );
	assert.equal( isSha( '0123456789abcdef0123456789abcdef01234567' ), true );
	for ( const bad of [ 'A'.repeat( 40 ), 'a'.repeat( 39 ), 'a'.repeat( 41 ), 'abc1234', 'main', 'v1.0.0', 'HEAD', '', ' ' + 'a'.repeat( 40 ), 'a'.repeat( 40 ) + '\n', 'g'.repeat( 40 ), null, undefined, 42, [ 'a'.repeat( 40 ) ] ] ) {
		assert.equal( isSha( bad ), false, JSON.stringify( bad ) );
	}
} );

test( 'no rollback_sha is not a rollback, on a dispatch or any other event', () => {
	const h = history();
	try {
		for ( const event of [ 'workflow_dispatch', 'push', 'api', 'pull_request' ] ) {
			for ( const rollbackSha of [ '', undefined, null ] ) {
				const verdict = decide( dispatch( h, rollbackSha, { event } ), h.askGit );
				assert.equal( verdict.ok, true, `${ event } ${ String( rollbackSha ) }` );
				assert.equal( verdict.sha, null );
				assert.match( verdict.message, /^Not a rollback: no rollback_sha was given/ );
			}
		}
	} finally {
		h.drop();
	}
} );

test( 'an ancestor of main at or after the floor is accepted', () => {
	const h = history();
	try {
		for ( const target of [ h.B, h.C ] ) {
			const verdict = decide( dispatch( h, target ), h.askGit );
			assert.equal( verdict.ok, true, target );
			assert.equal( verdict.sha, target );
			assert.match( verdict.message, /^Rolling back: [0-9a-f]{40} is on main, at or after the deploy job's floor/ );
		}
		// Main's own head is idempotent and allowed: the first real dispatch's proof.
		assert.equal( decide( dispatch( h, h.D ), h.askGit ).sha, h.D );
	} finally {
		h.drop();
	}
} );

test( 'a commit that was never on main is refused', () => {
	const h = history();
	try {
		const verdict = decide( dispatch( h, h.S ), h.askGit );
		assert.equal( verdict.ok, false );
		assert.equal( verdict.sha, null );
		assert.match( verdict.message, /is not an ancestor of main's head [0-9a-f]{40}: only a commit that has been on main can be deployed\. Nothing was deployed\.$/ );
	} finally {
		h.drop();
	}
} );

test( 'a commit from before the floor is refused by name', () => {
	const h = history();
	try {
		const verdict = decide( dispatch( h, h.A ), h.askGit );
		assert.equal( verdict.ok, false );
		assert.match( verdict.message, new RegExp( `^rollback_sha ${ h.A } predates the deploy job's floor ${ h.B }` ) );
		assert.match( verdict.message, /a revert pull request can \(docs\/runbooks\/deploy\.md, "Rolling back"\)\. Nothing was deployed\.$/ );
	} finally {
		h.drop();
	}
} );

test( 'a SHA git does not know is refused before any ancestry question', () => {
	const h = history();
	try {
		const verdict = decide( dispatch( h, 'f'.repeat( 40 ) ), h.askGit );
		assert.equal( verdict.ok, false );
		assert.match( verdict.message, /is not a commit in main's history\. Nothing was deployed\.$/ );
	} finally {
		h.drop();
	}
} );

test( 'a short SHA, upper case, a ref name and shell metacharacters are refused unresolved, and git is never asked', () => {
	const h = history();
	try {
		const asked = [];
		const spy = ( args ) => {
			asked.push( args );
			return h.askGit( args );
		};
		const inputs = [
			h.C.slice( 0, 7 ),
			h.C.slice( 0, 12 ),
			'0123456789ABCDEF0123456789ABCDEF01234567',
			'0123456789abcdef0123456789abcdef0123456A',
			'main',
			'HEAD',
			'HEAD~1',
			'origin/main',
			'v1.2.3',
			`${ h.C } `,
			` ${ h.C }`,
			`${ h.C }\n`,
			'$(touch /tmp/pwned)',
			'`id`',
			`${ h.C }; rm -rf /`,
			`${ h.C.slice( 0, 30 ) }; echo hi`,
			'--upload-pack=touch /tmp/x',
			'-',
			'--',
			'../../etc/passwd',
			'refs/tags/x',
			'::error::x',
		];
		for ( const input of inputs ) {
			const verdict = decide( dispatch( h, input ), spy );
			assert.equal( verdict.ok, false, JSON.stringify( input ) );
			assert.equal( verdict.sha, null, JSON.stringify( input ) );
			assert.match( verdict.message, /^rollback_sha .* is not a full 40-character lower-case SHA; a short SHA, a branch, a tag or upper case is refused, never resolved\. Nothing was deployed\.$/, JSON.stringify( input ) );
		}
		assert.deepEqual( asked, [], 'git was asked about an input that failed the shape check' );
	} finally {
		h.drop();
	}
} );

test( 'a rollback_sha off a dispatch on main is refused, whatever it names', () => {
	const h = history();
	try {
		for ( const event of [ 'push', 'pull_request', 'api', 'schedule', '', undefined ] ) {
			const verdict = decide( dispatch( h, h.C, { event } ), h.askGit );
			assert.equal( verdict.ok, false, String( event ) );
			assert.match( verdict.message, /^A rollback_sha was given on event .*, but a rollback is a workflow_dispatch; nothing else may carry one\. Nothing was deployed\.$/, String( event ) );
		}
		for ( const ref of [ 'refs/heads/feature', 'refs/tags/v1', 'refs/pull/1/merge', 'main', '', undefined ] ) {
			const verdict = decide( dispatch( h, h.C, { ref } ), h.askGit );
			assert.equal( verdict.ok, false, String( ref ) );
			assert.match( verdict.message, /^A rollback_sha was given on ref .*, but a rollback is dispatched on refs\/heads\/main only\. Nothing was deployed\.$/, String( ref ) );
		}
	} finally {
		h.drop();
	}
} );

test( "the run's own SHA and the floor must be full SHAs too", () => {
	const h = history();
	try {
		for ( const mainSha of [ '', undefined, h.D.slice( 0, 7 ), h.D.toUpperCase(), 'main' ] ) {
			const verdict = decide( dispatch( h, h.C, { mainSha } ), h.askGit );
			assert.equal( verdict.ok, false, String( mainSha ) );
			assert.match( verdict.message, /^MAIN_SHA .* is not a full 40-character lower-case SHA/, String( mainSha ) );
		}
		for ( const floor of [ '', undefined, h.B.slice( 0, 7 ), h.B.toUpperCase(), 'cb22fd9a' ] ) {
			const verdict = decide( dispatch( h, h.C, { floor } ), h.askGit );
			assert.equal( verdict.ok, false, String( floor ) );
			assert.match( verdict.message, /^ROLLBACK_FLOOR .* is not a full 40-character lower-case SHA; set it in ci\.yml/, String( floor ) );
		}
	} finally {
		h.drop();
	}
} );

test( 'a checkout that is not at the dispatched commit is refused', () => {
	const h = history();
	try {
		// The checkout is at D; the run claims to be at C.
		const verdict = decide( dispatch( h, h.B, { mainSha: h.C } ), h.askGit );
		assert.equal( verdict.ok, false );
		assert.match( verdict.message, new RegExp( `^The checkout's HEAD is "${ h.D }", not the commit this run was dispatched on, ${ h.C }\\.` ) );
	} finally {
		h.drop();
	}
} );

test( 'a shallow checkout is refused, even for a true ancestor', () => {
	const h = history();
	const dir = mkdtempSync( join( tmpdir(), 'rollback-target-shallow-' ) );
	try {
		execFileSync( 'git', [ 'clone', '-q', '--depth', '1', '--branch', 'main', `file://${ h.dir }`, join( dir, 'clone' ) ], { stdio: 'pipe' } );
		const askShallow = ( args ) => git( [ '-C', join( dir, 'clone' ), ...args ] );
		assert.equal( askShallow( [ 'rev-parse', '--is-shallow-repository' ] ).stdout.trim(), 'true' );
		const verdict = decide( dispatch( h, h.C ), askShallow );
		assert.equal( verdict.ok, false );
		assert.match( verdict.message, /^The checkout is shallow, so ancestry cannot be decided: the rollback steps check out main with fetch-depth 0\. Nothing was deployed\.$/ );
	} finally {
		rmSync( dir, { recursive: true, force: true } );
		h.drop();
	}
} );

test( 'git that cannot answer is a refusal, never a pass', () => {
	const h = history();
	try {
		const cases = [
			[ () => ( { status: 0, stdout: 'maybe\n' } ), /^git could not say whether the checkout is shallow/ ],
			[ () => ( { status: 128, stdout: '' } ), /^git could not answer: git rev-parse --is-shallow-repository exited 128\./ ],
			[ () => ( { status: 2, stdout: '' } ), /^git could not answer: git rev-parse --is-shallow-repository exited 2\./ ],
			[ () => null, /^git could not answer: git rev-parse gave no usable answer\./ ],
			[ () => ( { status: 'ok', stdout: '' } ), /^git could not answer: git rev-parse gave no usable answer\./ ],
			[ () => { throw new Error( 'spawn git ENOENT' ); }, /^git could not answer: spawn git ENOENT\./ ],
			// A merge-base exit that is neither yes nor no.
			[ ( args ) => ( args[ 0 ] === 'merge-base' ? { status: 128, stdout: '' } : h.askGit( args ) ), /^git could not answer: git merge-base --is-ancestor [0-9a-f]{40} [0-9a-f]{40} exited 128\./ ],
		];
		for ( const [ fake, expected ] of cases ) {
			const verdict = decide( dispatch( h, h.C ), fake );
			assert.equal( verdict.ok, false, String( fake ) );
			assert.equal( verdict.sha, null, String( fake ) );
			assert.match( verdict.message, expected, String( fake ) );
			assert.match( verdict.message, /Nothing was deployed\.$/, String( fake ) );
		}
	} finally {
		h.drop();
	}
} );

// The script as the two jobs run it: inputs through env only, one line
// out, the exit code the step reads, and the target handed on through
// $GITHUB_OUTPUT alone, so the step that detaches the checkout can only
// ever read a SHA this script accepted. Also through a symlinked directory
// and a symlinked file, since a main() that never ran would exit 0, a pass.
test( 'the script exits 1 with an ::error::, or 0 writing sha= only for a rollback, through symlinks too', () => {
	const h = history();
	const dir = mkdtempSync( join( tmpdir(), 'rollback-target-script-' ) );
	try {
		const output = join( dir, 'output' );
		symlinkSync( dirname( SCRIPT ), join( dir, 'scripts' ), 'dir' );
		symlinkSync( SCRIPT, join( dir, 'rollback-target.mjs' ), 'file' );
		const base = { EVENT_NAME: 'workflow_dispatch', REF: 'refs/heads/main', MAIN_SHA: h.D, ROLLBACK_FLOOR: h.B, GITHUB_OUTPUT: output };
		const run = ( path, env ) => {
			writeFileSync( output, '' );
			try {
				return { status: 0, stdout: execFileSync( process.execPath, [ path ], { cwd: h.dir, env: { PATH: process.env.PATH, ...env }, stdio: 'pipe', encoding: 'utf8' } ), output: readFileSync( output, 'utf8' ) };
			} catch ( error ) {
				return { status: error.status, stdout: error.stdout, output: readFileSync( output, 'utf8' ) };
			}
		};
		for ( const path of [ SCRIPT, join( dir, 'scripts', 'rollback-target.mjs' ), join( dir, 'rollback-target.mjs' ) ] ) {
			const rollback = run( path, { ...base, ROLLBACK_SHA: h.C } );
			assert.equal( rollback.status, 0, path );
			assert.match( rollback.stdout, /^Rolling back: /, path );
			assert.equal( rollback.output, `sha=${ h.C }\n`, path );

			const plain = run( path, { ...base, ROLLBACK_SHA: '' } );
			assert.equal( plain.status, 0, path );
			assert.match( plain.stdout, /^Not a rollback: /, path );
			assert.equal( plain.output, '', path );

			const unset = run( path, base );
			assert.equal( unset.status, 0, path );
			assert.equal( unset.output, '', path );

			const refused = run( path, { ...base, ROLLBACK_SHA: h.S } );
			assert.equal( refused.status, 1, path );
			assert.match( refused.stdout, /^::error::rollback_sha [0-9a-f]{40} is not an ancestor of main's head/, path );
			assert.equal( refused.output, '', path );
		}
		// The listed shapes, each refused with nothing written.
		for ( const sha of [ h.C.slice( 0, 7 ), '0123456789ABCDEF0123456789ABCDEF01234567', '$(touch /tmp/pwned)', `${ h.C }; echo hi`, h.A, 'f'.repeat( 40 ) ] ) {
			const refused = run( SCRIPT, { ...base, ROLLBACK_SHA: sha } );
			assert.equal( refused.status, 1, sha );
			assert.match( refused.stdout, /^::error::/, sha );
			assert.equal( refused.output, '', sha );
		}
		// A SHA on a push, as a plain dispatch's env would never carry one.
		const push = run( SCRIPT, { ...base, EVENT_NAME: 'push', ROLLBACK_SHA: h.C } );
		assert.equal( push.status, 1 );
		assert.match( push.stdout, /^::error::A rollback_sha was given on event "push"/ );
		assert.equal( push.output, '' );
		// Without GITHUB_OUTPUT the target cannot be handed on, so a rollback fails.
		const { GITHUB_OUTPUT, ...noOutput } = base;
		writeFileSync( output, '' );
		let status = 0;
		let stdout = '';
		try {
			stdout = execFileSync( process.execPath, [ SCRIPT ], { cwd: h.dir, env: { PATH: process.env.PATH, ...noOutput, ROLLBACK_SHA: h.C }, stdio: 'pipe', encoding: 'utf8' } );
		} catch ( error ) {
			status = error.status;
			stdout = error.stdout;
		}
		assert.equal( status, 1 );
		assert.match( stdout, /::error::GITHUB_OUTPUT is not set/ );
	} finally {
		rmSync( dir, { recursive: true, force: true } );
		h.drop();
	}
} );

test( 'a value from the dispatch cannot start a workflow command', () => {
	const h = history();
	try {
		const out = [];
		const log = console.log;
		console.log = ( line ) => out.push( line );
		try {
			assert.equal( main( { EVENT_NAME: 'workflow_dispatch', REF: 'refs/heads/main', MAIN_SHA: h.D, ROLLBACK_FLOOR: h.B, ROLLBACK_SHA: `${ h.C }\n::add-mask::x%0A\r::warning::y` } ), 1 );
		} finally {
			console.log = log;
		}
		assert.equal( out.length, 1 );
		assert.doesNotMatch( out[ 0 ], /\n|\r/ );
		assert.doesNotMatch( out[ 0 ], /%0A::/ );
		assert.match( out[ 0 ], /^::error::rollback_sha / );
	} finally {
		h.drop();
	}
} );

// entry-point.mjs's own cases are in ci-result.test.mjs; this is the wiring.
test( 'the script fails when it cannot tell it was run as the script', () => {
	const run = ( preload ) => {
		try {
			execFileSync( process.execPath, [ '--import', `data:text/javascript,${ encodeURIComponent( preload ) }`, SCRIPT ], {
				env: { PATH: process.env.PATH, EVENT_NAME: 'push' },
				stdio: 'pipe',
				encoding: 'utf8',
			} );
			return { status: 0, stdout: '' };
		} catch ( error ) {
			return { status: error.status, stdout: error.stdout };
		}
	};
	for ( const preload of [ `process.argv[1] = ${ JSON.stringify( join( tmpdir(), 'rollback-target-gone', 'rollback-target.mjs' ) ) };`, 'process.argv.splice( 1 );' ] ) {
		const failed = run( preload );
		assert.equal( failed.status, 1, preload );
		assert.equal( failed.stdout, '::error::rollback-target.mjs could not tell whether it was run as the script, so it fails rather than pass without checking. Nothing was deployed.\n', preload );
	}
} );

// ci.yml, read as text with no YAML parser, so the scope job installs
// nothing: the input, the floor, and the two jobs' steps that read them.
test( 'ci.yml declares the input and wires the check into the gate and the deploy, and admits no tag', () => {
	const text = readFileSync( WORKFLOW, 'utf8' );
	const code = text.split( '\n' ).filter( ( line ) => ! /^\s*#/.test( line ) ).join( '\n' );

	assert.match( code, /^  workflow_dispatch:\n    inputs:\n      rollback_sha:\n/m, 'workflow_dispatch declares rollback_sha' );
	assert.match( code, /^        required: false$/m );
	assert.match( code, /^        default: ''$/m );
	assert.match( code, /^        type: string$/m );

	const floor = ( code.match( /^  ROLLBACK_FLOOR: ([^\n]*)$/m ) ?? [] )[ 1 ];
	assert.ok( floor, 'the workflow env sets ROLLBACK_FLOOR' );
	assert.equal( isSha( floor ), true, `ROLLBACK_FLOOR ${ JSON.stringify( floor ) } is a full lower-case SHA` );
	assert.match( code, /^  ROLLBACK_SHA: \$\{\{ inputs\.rollback_sha \}\}$/m, 'the workflow env carries the input as ROLLBACK_SHA' );

	// When the history is here, the floor is a commit on it.
	const shallow = git( [ '-C', REPO_ROOT, 'rev-parse', '--is-shallow-repository' ] );
	if ( shallow.status === 0 && shallow.stdout.trim() === 'false' ) {
		assert.equal( git( [ '-C', REPO_ROOT, 'cat-file', '-e', `${ floor }^{commit}` ] ).status, 0, `ROLLBACK_FLOOR ${ floor } is a commit in this repository` );
		assert.equal( git( [ '-C', REPO_ROOT, 'merge-base', '--is-ancestor', floor, 'HEAD' ] ).status, 0, `ROLLBACK_FLOOR ${ floor } is an ancestor of HEAD` );
	}

	// The same four steps in both jobs: a full checkout for a rollback, a
	// plain one otherwise, the check, and the detach from its output alone.
	const steps = [
		/- name: Check out main's history, for a rollback\n        if: env\.ROLLBACK_SHA != ''\n        uses: actions\/checkout@v7\n        with:\n(?:          [^\n]*\n)*?          fetch-depth: 0\n/,
		/- name: Check out\n        if: env\.ROLLBACK_SHA == ''\n        uses: actions\/checkout@v7\n/,
		/- name: Check the rollback target\n        id: rollback\n        env:\n          EVENT_NAME: \$\{\{ github\.event_name \}\}\n          REF: \$\{\{ github\.ref \}\}\n          MAIN_SHA: \$\{\{ github\.sha \}\}\n        run: node \.depot\/scripts\/rollback-target\.mjs\n/,
		/- name: Check out the rollback target\n        if: steps\.rollback\.outputs\.sha != ''\n        env:\n          TARGET: \$\{\{ steps\.rollback\.outputs\.sha \}\}\n        run: \|\n          git checkout --detach "\$TARGET"\n/,
		// And, read from the input rather than the step output, HEAD must be the target before anything builds.
		/- name: Check the checkout is the rollback target\n        if: env\.ROLLBACK_SHA != ''\n        run: \|\n          head=\$\(git rev-parse HEAD\)\n          if \[ "\$head" != "\$ROLLBACK_SHA" \]; then\n            echo "::error::[^\n]*"\n            exit 1\n          fi\n/,
	];
	for ( const step of steps ) {
		const matches = code.match( new RegExp( step.source, 'g' ) ) ?? [];
		assert.equal( matches.length, 2, `${ step.source.split( '\\n' )[ 0 ] } appears once in the gate and once in the deploy` );
	}
	assert.doesNotMatch( code, /(?<!ROLLBACK_SHA: \$\{\{ )inputs\.rollback_sha\b(?! (==|!=) '')/, 'the input is read as ROLLBACK_SHA from env and compared to the empty string in conditions, never passed into a script' );

	// No tag anywhere: a tag dispatch never ran on Depot and is outside the
	// secrets' scope. The comments may say so; nothing may admit one.
	assert.doesNotMatch( text, /refs\/tags/ );
	assert.doesNotMatch( code, /startsWith\(\s*github\.ref/ );
	assert.doesNotMatch( text, /\btag dispatch\b|how a rollback (deploys|is redeployed)/ );
} );
