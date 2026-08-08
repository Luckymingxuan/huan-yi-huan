<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project source of truth

Before changing product behavior, layout, visual direction, data semantics, or scope, read `docs/PRODUCT.md` in full.

- Keep the product to one core page unless the product baseline is explicitly changed.
- Preserve the mobile-first, same-experience-on-PC approach.
- Keep shadcn/ui Luma with Base UI as the UI foundation.
- Record new product decisions, requirements, and limitations in `docs/PRODUCT.md` before implementing them.
