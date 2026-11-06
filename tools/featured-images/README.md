# Featured images for the seeded resources

Two scripts for issue #6: one renders an abstract featured image per resource in the seeder's catalogue, the other sets them as featured images on a WordPress site. The PNGs land in `artifacts/featured-images/` (gitignored) and are never committed; re-running the generator reproduces them exactly.

## Generate

```sh
pnpm images:generate            # writes artifacts/featured-images/<slug>.png and contact-sheet.png
```

`generate.mts` reads the slugs and types from `wp-content/plugins/resource-hub-wp/src/Seed/Seeder.php` and fails if a type has no accent in its table (or the table names a type the seeder no longer has), so the two cannot drift apart silently. It renders an HTML template with the headless Chromium that `apps/web`'s Playwright already installs (`pnpm exec playwright install chromium` in `apps/web` if it is missing), resolved from there so this tool adds no dependency. `contact-sheet.png` shows every image at its full frame, in the 16:9 card crop and in the centre-square crop, for approval.

## Import

```sh
pnpm images:import local                                    # the wp-env of this checkout
pnpm images:import local --force                            # replace images that are already set

pnpm images:import host --ssh user@host --wp-path /path/to/wordpress
RH_SSH_TARGET=user@host RH_WP_PATH=/path/to/wordpress pnpm images:import host
```

For each `<slug>.png` the script finds the published `resource` with that slug, skips it when it already has a featured image (unless `--force`, which sets a new attachment and leaves the old one in the library), and otherwise runs `wp media import --post_id=<id> --featured_image --alt="" --title="<resource title>"`. A slug with no published resource is reported and the run exits non-zero. Both targets stage the files in a temporary directory beside WordPress and remove it afterwards: `local` copies into the directory wp-env bind-mounts as `/var/www/html` (no change to `.wp-env.json`) and runs the worker through `wp-env run cli`; `host` copies over `scp` into `mktemp -d`, runs the worker over `ssh` with the host's `wp` (`RH_WP_BIN` names it when it is not on `PATH`), and deletes the directory. The SSH target and WordPress path are arguments or environment variables, never in the repository.

## Decisions

- **2400×1260**: twice the 1200×630 Open Graph frame (1.91:1) and under WordPress's 2560 px big-image threshold, so there is no `-scaled` copy; each PNG is around 50 KB, far under the 1 MB target and the 5 MB ceiling.
- **Crops**: the composition's weight stays in the centre square, so the 16:9 `object-fit: cover` card crop (about 3.5% off each side) and a square messaging preview (the centre 1260×1260) both keep the panel and its motif whole.
- **No text**: the images are abstract, in the language of the owner's LinkedIn post cards (paper, soft palette orbs, the five-dot row, the warm panel, the lemon squiggle), with the resource type's accent dominating: article mint, ebook grape, webinar coral, podcast lemon, case study cobalt, the same mapping as the front end's `lib/type-accents.ts`.
- **Empty alt text**: the image is decorative next to the resource's printed title, so the import sets `--alt=""` and the REST payload's `alt_text` is `""`.
- **Seeded randomness**: layout and motif variation come from a PRNG seeded with the slug, so every run gives byte-identical files and resources of one type look related without being identical.
