---
status: accepted
date: 2026-11-03
---

# Meta is registered in code with `register_post_meta()`, not with Advanced Custom Fields

The `resource` post type carries two fields beyond the core ones, `summary` and `source_url`. The usual WordPress answer is Advanced Custom Fields: a field group built in the admin, stored in the database, exposed over REST under its own `acf` key. We define the fields in PHP with `register_post_meta()`, each with a REST schema, a `sanitize_callback` and an `auth_callback`, and edit them from a sidebar panel in the block editor.

The reason is that this is a headless build. Every new field also needs a front-end change (a typed parser, a component), so "the client adds a field without a developer" is not on offer either way. Once adding a field is a developer task that touches both sides, the definition belongs with the rest of the code: versioned, reviewed line by line, tested by PHPUnit and deployed by CI, with an explicit sanitizer and permission check per field. The contract puts the fields under the core `meta` key, which is where `register_post_meta()` places them. And a plugin that declares its dependencies in Composer should not keep its data model in another plugin's database rows.

## Considered options

- **ACF with Local JSON committed.** The mature choice for a traditional theme where a client rearranges fields often. Rejected here: a runtime dependency on a third-party plugin in a build whose point is a small, fully reviewed surface, and fields under `acf` rather than `meta`.
- **Core custom fields with no code.** Rejected: unregistered meta has no type, no sanitizer, no REST exposure and no editor UI beyond the legacy box.

## Consequences

- Each field has a rule in `MetaRules`, enforced by a sanitizer the owner reads before merge and tested clause by clause. Writing a field requires `edit_post` on its post.
- The editor UI is ours to maintain. A new field means a line in `Meta`, a rule in `MetaRules`, a control in the panel, a test, and a change in the front end.
