/**
 * "Resource details" sidebar panel for the block editor.
 *
 * Edits the `summary`, `source_url` and `related_picks` meta fields through the
 * post entity, so they save with the post and go through the sanitizers and
 * auth callback the plugin registered with `register_post_meta()`. The picks
 * control is in `related-picks.js`. PHP enqueues this script only
 * on the editor for the `resource` post type; the post-type check below is a
 * second guard for any editor that loads it anyway. The summary is required
 * once the resource is public: the panel says so in words above the field
 * while it is blank (`RequiredState`, from the required-fields plugin), and
 * the `resource-hub-summary` class is how that plugin's notice finds the
 * field to focus. The field carries `aria-required` and is described by that
 * state (`useRequiredAttributes`).
 */
import { registerPlugin } from '@wordpress/plugins';
import {
	PluginDocumentSettingPanel,
	store as editorStore,
} from '@wordpress/editor';
import { useEntityProp } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { TextareaControl, TextControl } from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';

import {
	RequiredState,
	useRequiredAttributes,
} from '../required-fields/required-state';
// The Types panel's radio buttons ship in this bundle, the one script PHP
// loads on the resource editor.
import '../resource-type';
import RelatedPicks from './related-picks';

const POST_TYPE = 'resource';

// Mirrors MetaRules::SUMMARY_MAX_LENGTH and the REST schema's maxLength.
const SUMMARY_MAX_LENGTH = 300;

// One empty list for a resource with no picks yet, so the control gets the
// same array on every render.
const NO_PICKS = [];

function ResourceDetailsPanel() {
	const postType = useSelect(
		( select ) => select( editorStore ).getCurrentPostType(),
		[]
	);
	const [ meta, setMeta ] = useEntityProp( 'postType', postType, 'meta' );
	const summaryRef = useRequiredAttributes( 'summary', 'textarea' );

	if ( postType !== POST_TYPE || ! meta ) {
		return null;
	}

	const summary = meta.summary ?? '';
	const sourceUrl = meta.source_url ?? '';
	// `length` counts UTF-16 units and PHP counts code points, so the editor is
	// stricter by at most one per astral character (emoji); that is acceptable.
	const remaining = SUMMARY_MAX_LENGTH - summary.length;

	return (
		<PluginDocumentSettingPanel
			name="resource-details"
			title={ __( 'Resource details', 'resource-hub' ) }
		>
			<RequiredState field="summary" />
			<div ref={ summaryRef }>
				<TextareaControl
					__nextHasNoMarginBottom
					className="resource-hub-summary"
					label={ __( 'Summary', 'resource-hub' ) }
					help={ sprintf(
						/* translators: 1: maximum length in characters, 2: characters left. */
						_n(
							'Plain text for cards, up to %1$d characters. %2$d character left.',
							'Plain text for cards, up to %1$d characters. %2$d characters left.',
							remaining,
							'resource-hub'
						),
						SUMMARY_MAX_LENGTH,
						remaining
					) }
					value={ summary }
					maxLength={ SUMMARY_MAX_LENGTH }
					rows={ 4 }
					onChange={ ( value ) =>
						setMeta( { ...meta, summary: value } )
					}
				/>
			</div>
			<TextControl
				__next40pxDefaultSize
				__nextHasNoMarginBottom
				type="url"
				label={ __( 'Source URL', 'resource-hub' ) }
				help={ __(
					'Optional. Where the resource lives if not here; http or https only.',
					'resource-hub'
				) }
				placeholder="https://"
				value={ sourceUrl }
				onChange={ ( value ) =>
					setMeta( { ...meta, source_url: value } )
				}
			/>
			<RelatedPicks
				picks={ meta.related_picks ?? NO_PICKS }
				onChange={ ( picks ) =>
					setMeta( { ...meta, related_picks: picks } )
				}
			/>
		</PluginDocumentSettingPanel>
	);
}

registerPlugin( 'resource-hub-resource-details', {
	render: ResourceDetailsPanel,
} );
