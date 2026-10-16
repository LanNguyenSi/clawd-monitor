# Self-hosted fonts (next/font/local)

Fonts are vendored here and loaded through `next/font/local` in
`src/app/layout.tsx`. A build must never reach the network for fonts, so do not
add a `next/font/google` import. The `build` job in `.github/workflows/ci.yml`
has a **font guard** step that fails when `next/font/google` appears in any
`.ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.cts` file, and when grep itself errors.

## Why one `@font-face` per subset

`next/font/local` cannot attach a `unicode-range` to an individual `src` file, so
each subset is declared with its own `localFont` call in `src/app/layout.tsx`.
Every call sets `font-family: "Inter"` through `declarations`, so `next/font`
keeps a single family name and the browser selects the face by `unicode-range`.
The preloaded `latin` call also gets a size-adjusted `Inter Fallback` face
(`adjustFontFallback` default); the other subsets set `adjustFontFallback: false`
so no extra fallback faces are emitted. Only `latin` is `preload`ed. This mirrors
what `next/font/google` produced for this app (one face per subset, latin
preloaded), so the font family stack, the glyphs and the subsets are unchanged.
The fallback metrics used during the swap are now computed from the vendored
file, so they differ slightly from the values the Google loader used.

## Why every subset, even though only `latin` is preloaded

`clawd-monitor` renders agent and service names, log lines and user messages, so
the glyphs that appear are not known ahead of time. `next/font/google` emitted
all seven Inter subsets, and dropping the non-latin ones would make non-Latin
text fall back to a system font, so every subset the package ships is vendored.
Only `latin` is preloaded because it is the one used on first paint.

## Files

Package: `@fontsource-variable/inter` **5.3.0** (SIL Open Font License 1.1).
Every `.woff2` below is the `wght-normal` (variable weight, normal style) build,
`font-weight: 100 900`, copied verbatim from the package's `files/` directory.

| File in this directory                       | npm package                       | version | Subset       |
| -------------------------------------------- | --------------------------------- | ------- | ------------ |
| `inter-latin-wght-normal.woff2`              | `@fontsource-variable/inter`      | 5.3.0   | latin        |
| `inter-latin-ext-wght-normal.woff2`          | `@fontsource-variable/inter`      | 5.3.0   | latin-ext    |
| `inter-cyrillic-wght-normal.woff2`           | `@fontsource-variable/inter`      | 5.3.0   | cyrillic     |
| `inter-cyrillic-ext-wght-normal.woff2`       | `@fontsource-variable/inter`      | 5.3.0   | cyrillic-ext |
| `inter-greek-wght-normal.woff2`              | `@fontsource-variable/inter`      | 5.3.0   | greek        |
| `inter-greek-ext-wght-normal.woff2`          | `@fontsource-variable/inter`      | 5.3.0   | greek-ext    |
| `inter-vietnamese-wght-normal.woff2`         | `@fontsource-variable/inter`      | 5.3.0   | vietnamese   |
| `OFL-Inter.txt`                              | `@fontsource-variable/inter`      | 5.3.0   | license (`LICENSE` from the package) |

The `unicode-range` values in `src/app/layout.tsx` are taken from the package's
`unicode.json` (equivalently the `@font-face` rules in its `wght.css`).

## How to update a font

`@fontsource-variable/inter` is **not** a dependency; it is only used to obtain
the files, so this adds nothing to `package.json` or the lockfile.

1. From the repository root, fetch and unpack the package into a throwaway dir:

   ```sh
   mkdir -p .scratch
   npm pack @fontsource-variable/inter --pack-destination .scratch
   tar -xzf .scratch/fontsource-variable-inter-*.tgz -C .scratch
   ```

2. Copy the variable-weight, normal-style files over the ones here (keep the
   existing filenames; copy the package's `LICENSE` to `OFL-Inter.txt`):

   ```sh
   for s in latin latin-ext cyrillic cyrillic-ext greek greek-ext vietnamese; do
     cp ".scratch/package/files/inter-${s}-wght-normal.woff2" src/fonts/
   done
   cp .scratch/package/LICENSE src/fonts/OFL-Inter.txt
   ```

3. Refresh the `unicode-range` values in `src/app/layout.tsx` from the new
   `.scratch/package/unicode.json` if they changed, and update the version
   column in the table above.

4. Confirm each file is still a WOFF2 and that a build passes with no network:

   ```sh
   file src/fonts/*.woff2                 # must say "Web Open Font Format (Version 2)"
   rm -rf .scratch
   HTTPS_PROXY=http://127.0.0.1:9 npm run build   # must pass with a dead proxy
   ```
