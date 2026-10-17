# Awesome Generative AI catalog imported into Manus Remix

This directory vendors the source files from [steven2358/awesome-generative-ai](https://github.com/steven2358/awesome-generative-ai) as a reference catalog.

## What this adds

- A curated index of generative-AI tools and resources across text, coding, agents, image, video, audio, and learning.
- The upstream discoveries and archive lists.
- Upstream contribution, citation, license, and link-check workflow files, kept under the vendor directory so they do not replace Manus Remix's own GitHub workflows.

## Integration boundary

The upstream repository is a Markdown catalog, not an installable application or agent runtime. Its entries link to separate third-party projects; those projects' source code and licenses are not bundled by this import. No app dependencies, runtime code, routes, or UI files are changed by this catalog import.

## Upstream source

- Repository: https://github.com/steven2358/awesome-generative-ai
- Imported from the upstream `main` branch.
- The upstream catalog's `LICENSE` file is included. Check each linked project's own license before separately integrating it.
- Start with `vendor/awesome-generative-ai/README.md`; discoveries are in `DISCOVERIES.md`, historical entries in `ARCHIVE.md`.
