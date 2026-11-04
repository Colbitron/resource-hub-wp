/**
 * Compiles every contract schema in strict mode and checks every fixture
 * against the schema its file name targets.
 *
 * A fixture is named `<schema>.<case>.json`: everything before the first dot
 * is the schema's file name without `.schema.json`. Fixtures under `valid/`
 * must pass and fixtures under `invalid/` must fail. Every schema that
 * describes a payload (all but `common`) must have at least one of each, so a
 * schema that nothing exercises is itself a failure.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const packageRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const schemasDir = path.join( packageRoot, 'schemas' );
const fixturesDir = path.join( packageRoot, 'fixtures' );

async function readJsonFiles( dir ) {
	const names = ( await readdir( dir ) ).filter( ( name ) => name.endsWith( '.json' ) ).sort();
	return Promise.all(
		names.map( async ( name ) => ( {
			name,
			data: JSON.parse( await readFile( path.join( dir, name ), 'utf8' ) ),
		} ) )
	);
}

const schemaFiles = await readJsonFiles( schemasDir );
const validFixtures = await readJsonFiles( path.join( fixturesDir, 'valid' ) );
const invalidFixtures = await readJsonFiles( path.join( fixturesDir, 'invalid' ) );

const ajv = new Ajv2020( { strict: true, allErrors: true } );
addFormats( ajv );
for ( const { data } of schemaFiles ) {
	ajv.addSchema( data );
}

/** Schema file name without `.schema.json`, keyed to its `$id`. */
const schemaIds = new Map(
	schemaFiles.map( ( { name, data } ) => [ name.replace( /\.schema\.json$/, '' ), data.$id ] )
);

function schemaKeyOf( fixtureName ) {
	return fixtureName.slice( 0, fixtureName.indexOf( '.' ) );
}

function validatorFor( fixtureName ) {
	const key = schemaKeyOf( fixtureName );
	const id = schemaIds.get( key );
	assert.ok( id, `${ fixtureName } names a schema that does not exist: ${ key }` );
	const validate = ajv.getSchema( id );
	assert.ok( validate, `No compiled schema for ${ id }` );
	return validate;
}

describe( 'schemas', () => {
	for ( const { name, data } of schemaFiles ) {
		it( `${ name } compiles in strict mode with a 2020-12 $schema and a $id`, () => {
			assert.equal( data.$schema, 'https://json-schema.org/draft/2020-12/schema' );
			assert.ok( data.$id?.endsWith( `/${ name }` ), `$id must end in the file name: ${ data.$id }` );
			assert.ok( data.description, `${ name } needs a description` );
			assert.ok( ajv.getSchema( data.$id ), `${ name } did not compile` );
		} );
	}

	it( 'every payload schema has a valid and an invalid fixture', () => {
		const covered = ( list ) => new Set( list.map( ( { name } ) => schemaKeyOf( name ) ) );
		const valid = covered( validFixtures );
		const invalid = covered( invalidFixtures );
		for ( const key of schemaIds.keys() ) {
			if ( key === 'common' ) {
				continue;
			}
			assert.ok( valid.has( key ), `${ key } has no valid fixture` );
			assert.ok( invalid.has( key ), `${ key } has no invalid fixture` );
		}
	} );
} );

describe( 'valid fixtures', () => {
	assert.ok( validFixtures.length > 0, 'no valid fixtures found' );
	for ( const { name, data } of validFixtures ) {
		it( `${ name } passes`, () => {
			const validate = validatorFor( name );
			const ok = validate( data );
			assert.ok( ok, ajv.errorsText( validate.errors, { separator: '\n' } ) );
		} );
	}
} );

describe( 'invalid fixtures', () => {
	assert.ok( invalidFixtures.length > 0, 'no invalid fixtures found' );
	for ( const { name, data } of invalidFixtures ) {
		it( `${ name } fails`, () => {
			const validate = validatorFor( name );
			assert.equal( validate( data ), false, `${ name } was accepted but should fail` );
		} );
	}
} );
