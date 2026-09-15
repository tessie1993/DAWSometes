/**
 * Production bundle for DAWSome.
 *
 * The app needs no build step to run: `npm start` serves the repository and the
 * browser loads `src/main.js` and its imports directly. This config is the
 * optional second path — it bundles the same sources into `dist/` as one
 * hashed, minified script for deploying to a static host.
 *
 * What lands in `dist/`:
 *
 *   index.html          the shell from the repository root, with the unbundled
 *                       entry tag swapped for the generated bundle tag
 *   dawsome.<hash>.js   every module reachable from src/main.js
 *   devices.json        fetched at run time by DevicesModule
 *   preset-bank.json    fetched at run time by DevicesModule
 *   styles/app.css      linked by the shell
 *
 * Tone.js is deliberately left out of the bundle. The app reads it as the
 * `globalThis.Tone` global and never imports it, so the CDN tag in the shell
 * keeps loading it, and the blocking tag runs before the deferred bundle.
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import HtmlWebpackPlugin from "html-webpack-plugin";

/** Repository root: this file sits at the top of it. */
const ROOT = dirname(fileURLToPath(import.meta.url));

/** The shell markup both the served app and the bundle are built from. */
const SHELL = "index.html";

/**
 * The tag that loads the unbundled sources. It is what makes `npm start` work
 * without a build, and it is removed from the bundled shell so the generated
 * bundle tag does not load the application a second time.
 */
const UNBUNDLED_ENTRY = '<script type="module" src="src/main.js"></script>';

/**
 * Files the page requests at run time rather than importing, so webpack never
 * sees them. They are copied beside the bundle under the same relative paths
 * the shell and `DevicesModule` ask for.
 */
const RUNTIME_ASSETS = ["devices.json", "preset-bank.json", "styles/app.css"];

/**
 * Emits files that no module imports, keeping them in the compilation (so
 * `output.clean`, the stats output and watch mode all cover them) instead of
 * copying them behind webpack's back.
 */
class EmitRuntimeAssetsPlugin {
  #files;

  /**
   * @param {string[]} files Paths relative to the repository root; also the
   *   paths the files are emitted at.
   */
  constructor(files) {
    this.#files = files;
  }

  /**
   * @param {import("webpack").Compiler} compiler
   */
  apply(compiler) {
    const name = EmitRuntimeAssetsPlugin.name;
    const { RawSource } = compiler.webpack.sources;
    const { PROCESS_ASSETS_STAGE_ADDITIONAL } = compiler.webpack.Compilation;

    compiler.hooks.thisCompilation.tap(name, (compilation) => {
      compilation.hooks.processAssets.tapPromise(
        { name, stage: PROCESS_ASSETS_STAGE_ADDITIONAL },
        async () => {
          for (const file of this.#files) {
            const from = resolve(ROOT, file);
            // Rebuild when the source changes under `webpack --watch`.
            compilation.fileDependencies.add(from);
            compilation.emitAsset(file, new RawSource(await readFile(from)));
          }
        },
      );
    });
  }
}

/**
 * The shell markup with the unbundled entry tag removed.
 *
 * Reading the real `index.html` keeps one copy of the markup: an element added
 * to the page is in the bundle without touching this file. A missing entry tag
 * means the shell changed in a way this config cannot interpret, so it fails
 * loudly rather than emitting a page that loads nothing.
 *
 * @returns {string} Template markup for html-webpack-plugin.
 */
function bundledShell() {
  const html = readFileSync(resolve(ROOT, SHELL), "utf8");
  if (!html.includes(UNBUNDLED_ENTRY)) {
    throw new Error(
      `${SHELL} no longer contains ${UNBUNDLED_ENTRY}. ` +
        "Update UNBUNDLED_ENTRY in webpack.config.js to match the shell.",
    );
  }
  return html.replace(UNBUNDLED_ENTRY, "");
}

/**
 * @param {Record<string, unknown>} _env Unused; the mode is the only switch.
 * @param {{ mode?: string }} argv Parsed CLI arguments.
 * @returns {import("webpack").Configuration}
 */
export default (_env, argv = {}) => {
  const production = argv.mode !== "development";

  return {
    // Set here as well as on the CLI so a bare `npx webpack` does not warn.
    mode: production ? "production" : "development",
    // Resolves the "browserslist" field in package.json, which records the
    // browsers the sources already require. Without it webpack assumes an
    // older baseline and warns about the top-level await in src/main.js.
    target: "browserslist",
    entry: { dawsome: resolve(ROOT, "src", "main.js") },
    output: {
      path: resolve(ROOT, "dist"),
      filename: production ? "[name].[contenthash].js" : "[name].js",
      // Assets are fetched relative to the page, so the bundle can be served
      // from any subdirectory.
      publicPath: "",
      clean: true,
    },
    // Real sources in the debugger; the map is a separate file, never inlined.
    devtool: production ? "source-map" : "eval-source-map",
    performance: {
      // The bundle is one app, not a library: a single chunk is the point.
      hints: production ? "warning" : false,
    },
    plugins: [
      new HtmlWebpackPlugin({
        templateContent: bundledShell,
        // After the Tone.js tag at the end of <body>, preserving the order the
        // unbundled shell loads them in.
        inject: "body",
        scriptLoading: "defer",
        // Skip the plugin's own minifier: webpack's production minimizer
        // already shrinks the emitted HTML, so this would be a second pass.
        minify: false,
      }),
      new EmitRuntimeAssetsPlugin(RUNTIME_ASSETS),
    ],
  };
};
