---
status: accepted
date: 2026-11-04
---

# The block lists the newest resources in a chosen topic, which is required and stored as a term ID

The scaffolded block had a free-text `topic` and a `count` up to 12, while the related route caps at 10. The block has one job: show the newest `count` published resources in topic X, excluding the current post, with no picks. A topic is required. It is stored as the term's integer ID, chosen from a `SelectControl`, and the render callback resolves the term's current slug into `data-topic`, alongside the ID in `data-topic-id` and the current post's ID in `data-exclude` ([ADR 0026](0026-block-renders-a-marker-with-a-fallback.md)), so a renamed topic keeps working. With no topic the block renders nothing and the editor shows a "Choose a topic" placeholder; if the term has been deleted it also renders nothing and the editor warns.

`count` is 1 to 10, default 3, matching the related route, and clamped in PHP as well as in the editor. The heading is always an `<h2>`, default "More on {Topic name}", with an editable `heading` attribute. The block works on any post type, and its name, `resource-hub/related-resources`, is unchanged.

## Considered options

- **A free-text topic slug**, as scaffolded. Rejected: a slug typed by hand breaks when the topic is renamed, while an ID survives the rename and the render resolves the current slug.

## Consequences

- `heading` is a contract addition: the front end reads it from the marker it swaps ([ADR 0026](0026-block-renders-a-marker-with-a-fallback.md)).
- `block.json` changes `topic` from a string to an integer, adds `heading`, and caps `count` at 10.
- Picks and topic fill for the resource being read stay the related route's job ([ADR 0020](0020-related-is-picks-then-newest-in-topic.md)); the block is an editor's "more on this topic" list placed in the body.
