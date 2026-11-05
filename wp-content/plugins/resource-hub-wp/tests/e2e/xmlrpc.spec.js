/**
 * XML-RPC is off (ADR 0044): over HTTP, the server offers nothing but the
 * three `system.*` methods core's IXR server always adds, and a pingback is a
 * fault.
 */
const { test, expect } = require( './fixtures' );

/**
 * Builds an XML-RPC method call with string parameters.
 *
 * @param {string}   method Method name.
 * @param {string[]} params String parameters.
 * @return {string} The request body.
 */
function call( method, params = [] ) {
	const values = params
		.map(
			( value ) =>
				`<param><value><string>${ value }</string></value></param>`
		)
		.join( '' );

	return `<?xml version="1.0"?><methodCall><methodName>${ method }</methodName><params>${ values }</params></methodCall>`;
}

test.describe( 'XML-RPC', () => {
	test( 'lists no methods beyond the system ones', async ( { request } ) => {
		const response = await request.post( '/xmlrpc.php', {
			headers: { 'Content-Type': 'text/xml' },
			data: call( 'system.listMethods' ),
		} );

		expect( response.ok() ).toBe( true );

		const body = await response.text();
		const methods = [
			...body.matchAll( /<string>([^<]*)<\/string>/g ),
		].map( ( match ) => match[ 1 ] );

		// The parse found the list: core's own system methods are still in it.
		expect( methods ).toContain( 'system.listMethods' );
		expect( methods ).not.toContain( 'pingback.ping' );
		expect(
			methods.filter( ( name ) => ! name.startsWith( 'system.' ) )
		).toEqual( [] );
	} );

	test( 'answers a pingback with a fault', async ( { request } ) => {
		const response = await request.post( '/xmlrpc.php', {
			headers: { 'Content-Type': 'text/xml' },
			data: call( 'pingback.ping', [
				'https://example.com/a-source/',
				'https://example.com/a-target/',
			] ),
		} );

		const body = await response.text();

		expect( body ).toContain( '<name>faultCode</name>' );
		expect( body ).toContain( '-32601' );
	} );
} );
