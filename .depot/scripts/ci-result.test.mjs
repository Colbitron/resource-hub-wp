// Tests for ci-result.mjs, run by the `scope` job with ci-scope's
// (`node --test .depot/scripts/ci-scope.test.mjs .depot/scripts/ci-result.test.mjs`),
// so a broken verdict fails scope and therefore CI result itself. Plain
// node:test, as there. `depot ci run` reports event `api`, so these are
// where a pull request's skips are tried before a real pull request.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { JOBS, main, verdicts } from './ci-result.mjs';

const SCRIPT = fileURLToPath( new URL( './ci-result.mjs', import.meta.url ) );

const ALL_PASSED = { SCOPE: 'success', GATE: 'success', WEB_CHECKS: 'success', WEB_E2E: 'success', WEB_SCREENSHOTS: 'success' };

const pr = ( fields ) => ( { EVENT_NAME: 'pull_request', SCOPE_PLUGIN: 'true', SCOPE_WEB: 'true', ...ALL_PASSED, ...fields } );

const failing = ( env ) => verdicts( env ).filter( ( row ) => row.problem !== null ).map( ( row ) => row.job );

test( 'every job succeeding passes, on every event', () => {
	for ( const event of [ 'pull_request', 'push', 'workflow_dispatch', 'api' ] ) {
		assert.deepEqual( failing( { EVENT_NAME: event, ...ALL_PASSED } ), [], event );
	}
} );

test( 'one failed or cancelled job fails', () => {
	assert.deepEqual( failing( pr( { WEB_CHECKS: 'failure' } ) ), [ 'web-checks' ] );
	assert.deepEqual( failing( pr( { GATE: 'cancelled' } ) ), [ 'gate' ] );
	assert.deepEqual( failing( { EVENT_NAME: 'push', ...ALL_PASSED, WEB_E2E: 'failure' } ), [ 'web-e2e' ] );
} );

test( 'scope must succeed, whatever the rest did', () => {
	const skippedBehind = { GATE: 'skipped', WEB_CHECKS: 'skipped', WEB_E2E: 'skipped', WEB_SCREENSHOTS: 'skipped' };
	for ( const scope of [ 'failure', 'cancelled', 'skipped', '' ] ) {
		// Scope's outputs are empty when it failed; the skips behind it fail too.
		assert.deepEqual( failing( pr( { SCOPE: scope, SCOPE_PLUGIN: '', SCOPE_WEB: '', ...skippedBehind } ) ), [ 'scope', ...Object.keys( JOBS ) ], scope );
		// Even with outputs that would allow the skips, a scope that did not succeed fails.
		assert.deepEqual( failing( pr( { SCOPE: scope, SCOPE_PLUGIN: 'false', SCOPE_WEB: 'false', ...skippedBehind } ) ), [ 'scope' ], scope );
	}
} );

test( 'on a pull request a job may be skipped only when scope says its side is not reached', () => {
	// A front-end-only change: the gate is skipped.
	assert.deepEqual( failing( pr( { SCOPE_PLUGIN: 'false', GATE: 'skipped' } ) ), [] );
	// A plugin-only change: the three web jobs are skipped.
	assert.deepEqual( failing( pr( { SCOPE_WEB: 'false', WEB_CHECKS: 'skipped', WEB_E2E: 'skipped', WEB_SCREENSHOTS: 'skipped' } ) ), [] );
	// Inert paths only: everything is skipped.
	assert.deepEqual( failing( pr( { SCOPE_PLUGIN: 'false', SCOPE_WEB: 'false', GATE: 'skipped', WEB_CHECKS: 'skipped', WEB_E2E: 'skipped', WEB_SCREENSHOTS: 'skipped' } ) ), [] );
	// A side that is not reached but whose job ran anyway is fine.
	assert.deepEqual( failing( pr( { SCOPE_PLUGIN: 'false' } ) ), [] );
} );

test( 'an unexpected skip on a pull request fails', () => {
	// Scope said the side is reached.
	assert.deepEqual( failing( pr( { GATE: 'skipped' } ) ), [ 'gate' ] );
	assert.deepEqual( failing( pr( { WEB_E2E: 'skipped' } ) ), [ 'web-e2e' ] );
	// The other side's output does not excuse it.
	assert.deepEqual( failing( pr( { SCOPE_PLUGIN: 'false', WEB_CHECKS: 'skipped' } ) ), [ 'web-checks' ] );
	assert.deepEqual( failing( pr( { SCOPE_WEB: 'false', GATE: 'skipped' } ) ), [ 'gate' ] );
	// An unset or unexpected output is not 'false'.
	for ( const output of [ '', 'False', '0', 'no', undefined ] ) {
		assert.deepEqual( failing( pr( { SCOPE_PLUGIN: output, GATE: 'skipped' } ) ), [ 'gate' ], String( output ) );
	}
} );

test( 'off a pull request every job must succeed, skipped or not', () => {
	for ( const event of [ 'push', 'workflow_dispatch', 'api', '', undefined ] ) {
		// Scope's outputs are not read off a pull request, even when they say 'false'.
		const env = { EVENT_NAME: event, SCOPE_PLUGIN: 'false', SCOPE_WEB: 'false', ...ALL_PASSED, GATE: 'skipped' };
		assert.deepEqual( failing( env ), [ 'gate' ], String( event ) );
	}
} );

test( 'a missing or unexpected result fails', () => {
	const { GATE, ...withoutGate } = ALL_PASSED;
	assert.deepEqual( failing( { EVENT_NAME: 'pull_request', SCOPE_PLUGIN: 'true', SCOPE_WEB: 'true', ...withoutGate } ), [ 'gate' ] );
	assert.deepEqual( failing( pr( { WEB_SCREENSHOTS: '' } ) ), [ 'web-screenshots' ] );
	assert.deepEqual( failing( pr( { WEB_SCREENSHOTS: 'neutral' } ) ), [ 'web-screenshots' ] );
	assert.deepEqual( failing( {} ), [ 'scope', ...Object.keys( JOBS ) ] );
} );

test( 'main prints, summarises and returns the verdict', () => {
	const dir = mkdtempSync( join( tmpdir(), 'ci-result-' ) );
	try {
		const summary = join( dir, 'summary.md' );
		assert.equal( main( { ...pr( { SCOPE_PLUGIN: 'false', GATE: 'skipped' } ), GITHUB_STEP_SUMMARY: summary } ), true );
		assert.match( readFileSync( summary, 'utf8' ), /### CI passed[\s\S]*\| gate \| skipped \| passes \|/ );
		assert.equal( main( { ...pr( { GATE: 'skipped' } ), GITHUB_STEP_SUMMARY: summary } ), false );
		assert.match( readFileSync( summary, 'utf8' ), /### CI failed[\s\S]*\| gate \| skipped \| skipped, though scope's plugin output is "true"/ );
	} finally {
		rmSync( dir, { recursive: true, force: true } );
	}
} );

test( 'the script exits 1 on a problem and 0 without', () => {
	const run = ( env ) => {
		try {
			execFileSync( process.execPath, [ SCRIPT ], { env: { PATH: process.env.PATH, ...env }, stdio: 'pipe', encoding: 'utf8' } );
			return 0;
		} catch ( error ) {
			assert.match( error.stdout, /^::error::/m );
			return error.status;
		}
	};
	assert.equal( run( pr( {} ) ), 0 );
	assert.equal( run( pr( { WEB_CHECKS: 'failure' } ) ), 1 );
	assert.equal( run( { EVENT_NAME: 'api', ...ALL_PASSED, GATE: 'skipped' } ), 1 );
} );
