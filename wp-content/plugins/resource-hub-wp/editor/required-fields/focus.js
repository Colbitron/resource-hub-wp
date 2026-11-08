/**
 * Moves focus to the control that fills a missing field.
 *
 * The title lives in the editor canvas, which is an iframe when the editor
 * iframes it (`iframe[name="editor-canvas"]`) and the document otherwise. The
 * other three live in the document settings sidebar, in panels that may be
 * closed: the Types panel (core's taxonomy panel, with the plugin's radio
 * buttons), the Topics panel (core's) and the Resource details panel (the
 * plugin's). Each is opened through the editor's own actions, and the control
 * is focused once React has rendered it, which is why the lookup retries for
 * a moment instead of assuming the element exists. The pre-publish sidebar is
 * a panel over the settings sidebar, so it is closed first: a control under
 * it would take focus out of sight. Closing it also lifts the editor's lock
 * on a draft (`index.js`).
 */
import { dispatch, select } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';

// The post editor's own store, named rather than imported: `@wordpress/edit-post`
// is the one editor that loads this script, it is not a build dependency of
// the plugin, and the editor has no public action of its own for this.
const EDIT_POST_STORE = 'core/edit-post';
const DOCUMENT_SIDEBAR = 'edit-post/document';

// The editor's panel names: core's taxonomy panels, and the plugin's
// `PluginDocumentSettingPanel` as `{pluginName}/{panelName}`.
const PANELS = {
	type: 'taxonomy-panel-resource_type',
	topic: 'taxonomy-panel-resource_topic',
	summary: 'resource-hub-resource-details/resource-details',
};

// Where each sidebar control is, once its panel is open.
const CONTROLS = {
	type: '.resource-hub-type-radio input:checked, .resource-hub-type-radio input',
	topic: '.resource-hub-topic-selector input',
	summary: '.resource-hub-summary textarea',
};

const RETRY_MS = 50;
const RETRIES = 20;

/**
 * The post title in the editor canvas, or null while it is not rendered.
 *
 * @return {HTMLElement|null} The title's editable element.
 */
export function findTitle() {
	const canvas = document.querySelector( 'iframe[name="editor-canvas"]' );
	const root = canvas?.contentDocument ?? document;

	return root.querySelector( '.editor-post-title__input' );
}

/**
 * Focuses the first element the finder returns, retrying for about a second
 * while it is not rendered yet.
 *
 * @param {() => (HTMLElement|null)} find    Finds the element.
 * @param {number}                   retries Attempts left.
 */
function focusWhenPresent( find, retries = RETRIES ) {
	const element = find();

	if ( element ) {
		element.scrollIntoView?.( { block: 'center' } );
		element.focus();
		return;
	}

	if ( retries > 0 ) {
		window.setTimeout(
			() => focusWhenPresent( find, retries - 1 ),
			RETRY_MS
		);
	}
}

/**
 * Opens the document settings sidebar and one of its panels.
 *
 * @param {string} panel The editor's name for the panel.
 */
function openPanel( panel ) {
	dispatch( EDIT_POST_STORE )?.openGeneralSidebar?.( DOCUMENT_SIDEBAR );

	if ( ! select( editorStore ).isEditorPanelOpened( panel ) ) {
		dispatch( editorStore ).toggleEditorPanelOpened( panel );
	}
}

/**
 * Focuses the control for a field.
 *
 * @param {string} key `title`, `type`, `topic` or `summary`.
 */
export function focusField( key ) {
	if ( select( editorStore ).isPublishSidebarOpened() ) {
		dispatch( editorStore ).closePublishSidebar();
	}

	if ( key === 'title' ) {
		focusWhenPresent( findTitle );
		return;
	}

	if ( ! PANELS[ key ] ) {
		return;
	}

	openPanel( PANELS[ key ] );
	focusWhenPresent( () => document.querySelector( CONTROLS[ key ] ) );
}
