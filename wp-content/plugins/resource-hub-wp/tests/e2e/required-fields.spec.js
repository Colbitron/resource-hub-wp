/**
 * Required fields in the resource editor: a resource that lacks a title, a
 * type, a topic or a summary says so in one persistent notice and in its
 * panels, cannot be published or updated until it has them, and still saves
 * as a draft. The server's half of the rule is PHPUnit's
 * (RequiredFieldsTest); this covers what the editor shows and locks, and
 * runs axe over what the plugin renders: the notice, its panel states and
 * controls, and the pre-publish checklist.
 */
const { default: AxeBuilder } = require( '@axe-core/playwright' );
const { test, expect } = require( './fixtures' );

const SUMMARY = 'An e2e summary.';

// Every WCAG 2.0 to 2.2 A and AA rule axe has (axe has no `wcag22a` tag).
const WCAG_TAGS = [ 'wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa' ];

const ALL_MISSING =
	'This resource needs a title, a type, a topic and a summary before it can be published. Drafts can still be saved.';

test.describe( 'Required fields', () => {
	let type;
	let topic;
	const createdIds = [];

	test.beforeAll( async ( { requestUtils } ) => {
		const stamp = Date.now();
		type = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resource_type',
			data: { name: `E2E type ${ stamp }`, slug: `e2e-type-${ stamp }` },
		} );
		topic = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resource_topic',
			data: {
				name: `E2E topic ${ stamp }`,
				slug: `e2e-topic-${ stamp }`,
			},
		} );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		for ( const id of createdIds ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/resources/${ id }`,
				params: { force: true },
			} );
		}

		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/resource_type/${ type.id }`,
			params: { force: true },
		} );
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/resource_topic/${ topic.id }`,
			params: { force: true },
		} );
	} );

	const topBar = ( page ) =>
		page.getByRole( 'region', { name: 'Editor top bar' } );
	const publishRegion = ( page ) =>
		page.getByRole( 'region', { name: 'Editor publish' } );
	const settings = ( page ) =>
		page.getByRole( 'region', { name: 'Editor settings' } );

	// The plugin's notice, in the editor's own notice list (not the
	// screen-reader copy of it).
	const notice = ( page ) =>
		page
			.getByRole( 'region', { name: 'Editor content' } )
			.locator( '.components-notice' )
			.filter( { hasText: 'This resource needs' } );

	// Opens a document-settings panel by its title if it is collapsed.
	const openPanel = async ( page, name ) => {
		const toggle = settings( page ).getByRole( 'button', {
			name,
			exact: true,
		} );
		await expect( toggle ).toBeVisible();

		if ( ( await toggle.getAttribute( 'aria-expanded' ) ) !== 'true' ) {
			await toggle.click();
		}
	};

	// Edits the post through the store, for the fields whose controls are
	// core's (the topic) or beside the point of a test.
	const editPost = ( page, edits ) =>
		page.evaluate(
			( changes ) =>
				window.wp.data.dispatch( 'core/editor' ).editPost( changes ),
			edits
		);

	// Remembers the open post for the clean-up, and returns its ID.
	const trackCurrentPost = async ( page ) => {
		const id = await page.evaluate( () =>
			window.wp.data.select( 'core/editor' ).getCurrentPostId()
		);
		createdIds.push( id );
		return id;
	};

	const isSavingLocked = ( page ) =>
		page.evaluate( () =>
			window.wp.data.select( 'core/editor' ).isPostSavingLocked()
		);

	test( 'a new resource names everything it lacks, in the notice and in the panels, and follows each edit', async ( {
		admin,
		editor,
		page,
	} ) => {
		await admin.createNewPost( { postType: 'resource' } );
		await trackCurrentPost( page );

		await expect( notice( page ) ).toContainText( ALL_MISSING );
		await expect(
			notice( page ).getByRole( 'button', {
				name: 'Dismiss this notice',
			} )
		).toHaveCount( 0 );
		for ( const action of [
			'Add a title',
			'Choose a type',
			'Add a topic',
			'Write a summary',
		] ) {
			await expect(
				notice( page ).getByRole( 'button', { name: action } )
			).toBeVisible();
		}

		await editor.openDocumentSettingsSidebar();
		await openPanel( page, 'Types' );
		await expect(
			settings( page ).getByText( 'Required. A resource needs one type.' )
		).toBeVisible();
		await openPanel( page, 'Topics' );
		await expect(
			settings( page ).getByText(
				'Required. A resource needs at least one topic.'
			)
		).toBeVisible();
		await openPanel( page, 'Resource details' );
		await expect(
			settings( page ).getByText(
				'Required. A resource needs a summary.'
			)
		).toBeVisible();

		// Typing a title takes it off the list at once; blanks do not count.
		const title = editor.canvas.getByRole( 'textbox', {
			name: 'Add title',
		} );
		await title.fill( '   ' );
		await expect( notice( page ) ).toContainText( ALL_MISSING );
		await title.fill( 'E2E required fields' );
		await expect( notice( page ) ).toContainText(
			'This resource needs a type, a topic and a summary before it can be published.'
		);

		// Choosing the type clears the Types panel's state and the list again.
		await page.getByRole( 'radio', { name: type.name } ).check();
		await expect(
			settings( page ).getByText( 'Required. A resource needs one type.' )
		).toHaveCount( 0 );
		await expect( notice( page ) ).toContainText(
			'This resource needs a topic and a summary before it can be published.'
		);
	} );

	test( 'publishing waits until every field is set, the checklist says which, and a draft saves at any time', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		await admin.createNewPost( {
			postType: 'resource',
			title: `E2E required ${ Date.now() }`,
		} );
		const postId = await trackCurrentPost( page );

		// A draft saves while three fields are missing.
		await editor.saveDraft();
		const draft = await requestUtils.rest( {
			path: `/wp/v2/resources/${ postId }`,
			params: { context: 'edit' },
		} );
		expect( draft.status ).toBe( 'draft' );

		// The pre-publish sidebar opens with its Publish button off and the
		// checklist open, naming the three; Cancel lifts the lock.
		await topBar( page )
			.getByRole( 'button', { name: 'Publish', exact: true } )
			.click();
		const publishButton = publishRegion( page ).getByRole( 'button', {
			name: 'Publish',
			exact: true,
		} );
		await expect( publishButton ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( await isSavingLocked( page ) ).toBe( true );

		const checklist = publishRegion( page ).getByRole( 'button', {
			name: /^Required fields:/,
		} );
		await expect( checklist ).toContainText( '3 missing' );
		await expect( checklist ).toHaveAttribute( 'aria-expanded', 'true' );
		await expect(
			publishRegion( page ).getByText( 'Title: set', { exact: true } )
		).toBeVisible();
		for ( const item of [
			'Type: missing',
			'Topic: missing',
			'Summary: missing',
		] ) {
			await expect(
				publishRegion( page ).getByText( item, { exact: true } )
			).toBeVisible();
		}

		await publishRegion( page )
			.getByRole( 'button', { name: 'Cancel' } )
			.click();
		expect( await isSavingLocked( page ) ).toBe( false );

		// Fill the three: the type and the summary in the plugin's panels, the
		// topic through the store (its control is core's).
		await editor.openDocumentSettingsSidebar();
		await openPanel( page, 'Types' );
		await page.getByRole( 'radio', { name: type.name } ).check();
		await editPost( page, { resource_topic: [ topic.id ] } );
		await openPanel( page, 'Resource details' );
		await page.getByLabel( 'Summary' ).fill( SUMMARY );

		await expect( notice( page ) ).toHaveCount( 0 );
		await expect(
			settings( page ).getByText(
				'Required. A resource needs a summary.'
			)
		).toHaveCount( 0 );

		// Now the checklist is complete and closed, and publishing goes through.
		await topBar( page )
			.getByRole( 'button', { name: 'Publish', exact: true } )
			.click();
		await expect( checklist ).toContainText( 'complete' );
		await expect( checklist ).toHaveAttribute( 'aria-expanded', 'false' );
		await expect( publishButton ).not.toHaveAttribute(
			'aria-disabled',
			'true'
		);
		await publishButton.click();
		await page
			.getByRole( 'button', { name: 'Dismiss this notice' } )
			.filter( { hasText: 'published' } )
			.waitFor();

		const published = await requestUtils.rest( {
			path: `/wp/v2/resources/${ postId }`,
			params: { context: 'edit' },
		} );
		expect( published.status ).toBe( 'publish' );
		expect( published.resource_type ).toEqual( [ type.id ] );
		expect( published.resource_topic ).toEqual( [ topic.id ] );
		expect( published.meta.summary ).toBe( SUMMARY );
	} );

	test( 'a published resource cannot be updated while it lacks a topic, and can again once it has one', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const stamp = Date.now();
		const resource = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resources',
			data: {
				title: `E2E published ${ stamp }`,
				slug: `e2e-published-${ stamp }`,
				status: 'publish',
				resource_type: [ type.id ],
				resource_topic: [ topic.id ],
				meta: { summary: SUMMARY },
			},
		} );
		createdIds.push( resource.id );

		await admin.editPost( resource.id );
		await expect( notice( page ) ).toHaveCount( 0 );

		const updateButton = topBar( page ).locator(
			'.editor-post-publish-button__button'
		);

		await editPost( page, { resource_topic: [] } );
		await expect( notice( page ) ).toContainText(
			'This resource needs a topic before it can be updated. The published version stays as it is until then.'
		);
		await expect( updateButton ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( await isSavingLocked( page ) ).toBe( true );

		await editPost( page, { resource_topic: [ topic.id ] } );
		await expect( notice( page ) ).toHaveCount( 0 );
		expect( await isSavingLocked( page ) ).toBe( false );
	} );

	test( "the notice's actions move focus to the control that fills the field", async ( {
		admin,
		editor,
		page,
	} ) => {
		await admin.createNewPost( { postType: 'resource' } );
		await trackCurrentPost( page );

		await notice( page )
			.getByRole( 'button', { name: 'Write a summary' } )
			.click();
		await expect( page.getByLabel( 'Summary' ) ).toBeFocused();

		await notice( page )
			.getByRole( 'button', { name: 'Choose a type' } )
			.click();
		await expect(
			settings( page ).locator( '.resource-hub-type-radio input:focus' )
		).toHaveCount( 1 );

		await notice( page )
			.getByRole( 'button', { name: 'Add a title' } )
			.click();
		await expect(
			editor.canvas.getByRole( 'textbox', { name: 'Add title' } )
		).toBeFocused();
	} );

	test( 'the sidebar, the notice and the checklist have no WCAG A or AA violations', async ( {
		admin,
		editor,
		page,
	} ) => {
		await admin.createNewPost( {
			postType: 'resource',
			title: `E2E axe ${ Date.now() }`,
		} );
		await trackCurrentPost( page );
		await editor.openDocumentSettingsSidebar();
		await openPanel( page, 'Types' );
		await openPanel( page, 'Topics' );
		await openPanel( page, 'Resource details' );

		// What this plugin renders in the sidebar and above the canvas: the
		// notices, the Types panel's radio buttons, the Topics panel's wrapper
		// and the summary field. Core's own sidebar chrome is left out, because
		// it is not the plugin's to fix (its "Template options" button fails
		// axe's label-content-name-mismatch on its own).
		const sidebar = await new AxeBuilder( { page } )
			.include( '.components-notice' )
			.include( '.resource-hub-type-radio' )
			.include( '.resource-hub-topic-selector' )
			.include( '.resource-hub-summary' )
			.withTags( WCAG_TAGS )
			.analyze();
		expect( violations( sidebar ) ).toEqual( [] );

		await topBar( page )
			.getByRole( 'button', { name: 'Publish', exact: true } )
			.click();
		await expect(
			publishRegion( page ).getByRole( 'button', {
				name: /^Required fields:/,
			} )
		).toBeVisible();

		const prePublish = await new AxeBuilder( { page } )
			.include( '.resource-hub-required-fields' )
			.withTags( WCAG_TAGS )
			.analyze();
		expect( violations( prePublish ) ).toEqual( [] );
	} );
} );

/**
 * axe's violations reduced to what a reader of a failure needs.
 *
 * @param {Object} results What `analyze()` returned.
 * @return {Array<{rule: string, help: string, nodes: string[]}>} The violations; `[]` is a pass.
 */
function violations( results ) {
	return results.violations.map( ( violation ) => ( {
		rule: violation.id,
		help: violation.help,
		nodes: violation.nodes
			.slice( 0, 5 )
			.map( ( node ) => node.target.join( ' ' ) ),
	} ) );
}
