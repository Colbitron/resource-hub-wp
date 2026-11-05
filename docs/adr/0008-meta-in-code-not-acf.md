---
status: accepted
date: 2026-11-03
---

# Meta is registered in code with `register_post_meta()`, not with Advanced Custom Fields

The `resource` post type carries two fields beyond the core ones, `summary` and `source_url`. The usual WordPress answer to custom fields is Advanced Custom Fields: a field group built in the admin, stored in the database, exposed over REST with its own `acf` key. We define the fields in PHP with `register_post_meta()`, each with a REST schema, a `sanitize_callback`, and an `auth_callback`, and edit them from a small sidebar panel in the block editor.

The reason is that this is a headless build. Every new field also needs a front-end change (a typed parser, a component that renders it), so "the client adds a field without a developer" is not on offer either way; adding a field is a developer task that touches both the plugin and the front end. Once that is true, the field definition belongs with the rest of the code: versioned, reviewed line by line, tested by PHPUnit, and deployed by CI, with an explicit sanitizer and permission check per field. The contract with the front end puts the fields under the core `meta` key, which is where `register_post_meta()` places them. And a modular plugin that declares its dependencies in Composer should not keep its data model in another plugin's database rows.

## Considered options

- **ACF with Local JSON committed to the repository.** The right call for a traditional theme where a client adds and rearranges fields often, and the mature choice most agencies make; Local JSON keeps field groups in version control and ACF's REST support exposes them. Rejected here because it would add a runtime dependency on a third-party plugin to a build whose whole point is a small, fully reviewed surface, and because the fields would live under `acf` rather than `meta`, which is where the contract puts them.
- **Core custom fields with no code.** Rejected: unregistered meta has no type, no sanitizer, no REST exposure, and no editor UI beyond the legacy custom fields box.

## Consequences

- Each field has a rule in `MetaRules`, stated clause by clause in its docblock, enforced by a sanitizer the owner reads before merge, and tested clause by clause. The only schema-level rule is `maxLength` for `summary`, which rejects longer input over REST with a 400. The URL rule lives only in the sanitizer: on WordPress 7.1, `rest_validate_value_from_schema()` has no `uri` case, so `format: uri` validates nothing and only runs `sanitize_url()` before our sanitizer, which turned scheme-less strings such as `example.com` into `http://` URLs. `source_url` therefore has no `format`.
- Writing a field requires `edit_post` on its post. That is what the `auth_callback` says, and PHPUnit checks it for an editor and a subscriber.
- The editor UI is ours to maintain: a `PluginDocumentSettingPanel` under `editor/`, built by `@wordpress/scripts` alongside the blocks. A new field means a line in `Meta`, a rule in `MetaRules`, a control in the panel, a test, and a change in the front end.
