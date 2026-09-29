# Ablix extensions

An extension is a `.ablixext` file: a ZIP with `manifest.json`, `extension.js` and `README.md`
(extra `.js/.json/.md/.txt/.css` files are kept and can be `require()`d).

```json
{ "id": "acme.hello", "name": "Hello", "version": "1.0.0", "description": "...", "author": "Acme",
  "main": "extension.js", "permissions": ["editor"] }
```

`permissions` (optional): `editor` (read/modify the open file), `workspace` (read/write project files),
`network` (fetch/XHR/WebSocket). Users see them before installing; the host enforces them on every call.

## Build one
Extensions panel -> **Develop** -> *Create Extension...* -> edit `extension.js` -> *Package Extension...* -> **Install now** or **Download**.

## Publish to the marketplace
1. Upload the `.ablixext` to the Appwrite Storage bucket and copy its **File ID**.
2. Add a row to the `extensions` table: `name, version, description, category, author, icon, downloads (0), fileId`.
   `icon` may be an image URL or a built-in glyph name (`puzzle-piece`, `bolt`, `code`, `palette`, ...).
3. To ship an update, upload the new file, then change the row's `version` and `fileId`; installed copies show **Update**.
4. Give role **Any** *Read* on the table and the bucket, and add your site's domain as a **Web platform**.
   (Optional: give *Any* *Update* on the table so the download counter can increase.)

## Runtime
Each extension runs in its own Web Worker inside a sandboxed iframe (opaque origin, CSP). It cannot touch the page,
IndexedDB, or (without `network`) the internet, and a runaway loop is stopped by a watchdog.
Tests: `npm run test:ext` (Node, whole flow).
