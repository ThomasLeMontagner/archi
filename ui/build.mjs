import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
const out = new URL("../src/archi/static/", import.meta.url);
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  minify: true,
  outfile: new URL("app.js", out).pathname,
  format: "esm",
  target: ["es2022"],
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "linked",
});
for (const file of ["index.html", "favicon.svg"]) {
  await copyFile(new URL(file, import.meta.url), new URL(file, out));
}
console.log("Built packaged explorer assets.");
