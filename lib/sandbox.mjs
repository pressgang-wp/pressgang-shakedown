/**
 * Sandbox engine: a throwaway WordPress with an isolated SQLite database —
 * WP's answer to Laravel's in-memory RefreshDatabase testing.
 *
 * Assembly (all in a temp dir, deleted after the run):
 *  - WordPress core, themes, plugins and mu-plugins are SYMLINKED read-only
 *    from the real project — the sandbox runs your actual code;
 *  - wp-config.php, the uploads dir, and the SQLite database are the
 *    sandbox's own — the real site's MySQL and uploads are never touched;
 *  - the SQLite Database Integration plugin (cached under ~/.cache) provides
 *    the db.php drop-in;
 *  - `wp core install` creates a fresh site, the project's child theme is
 *    activated, permalinks set, and `wp server` serves it on a local port.
 *
 * Nothing persists: fixtures, uploads, options — all evaporate with the
 * temp dir. This is the only shakedown engine allowed to write to a
 * database, because the database is disposable by construction.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir, homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const SQLITE_PLUGIN_ZIP = 'https://downloads.wordpress.org/plugin/sqlite-database-integration.latest-stable.zip';

/**
 * Download (once) and cache the SQLite Database Integration plugin.
 *
 * @returns {string} Path to the cached plugin directory.
 */
function ensureSqlitePlugin() {
  const cache = join(homedir(), '.cache', 'pressgang-shakedown');
  const pluginDir = join(cache, 'sqlite-database-integration');

  if (!existsSync(pluginDir)) {
    mkdirSync(cache, { recursive: true });
    const zip = join(cache, 'sqlite.zip');
    execFileSync('curl', ['-sL', '-o', zip, SQLITE_PLUGIN_ZIP]);
    execFileSync('unzip', ['-oq', zip, '-d', cache]);
    rmSync(zip);
  }

  return pluginDir;
}

/**
 * Symlink an entry from the real project into the sandbox.
 */
function link(from, to) {
  if (existsSync(from) && !existsSync(to)) {
    symlinkSync(from, to);
  }
}

/**
 * Assemble the sandbox filesystem: linked code, owned state.
 *
 * Plugins are strictly allowlisted. The sandbox's job is testing the theme's
 * rendering, not the site's plugin stack — security/caching/SEO plugins add
 * nondeterministic noise (we caught one force-HTTPS-redirecting while
 * nominally inactive). What isn't allowlisted isn't even symlinked in.
 *
 * @param {string} sitePath Real project's WordPress root (contains wp-config.php).
 * @param {array<string>} pluginAllowlist Plugin directory names to make available.
 * @returns {string} Sandbox root path.
 */
function assemble(sitePath, pluginAllowlist = [], pathMap = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'shakedown-sandbox-'));

  // Subdirectory installs (core in /wp under a parent docroot, as Herd/Valet
  // "wp in subfolder" setups use): mirror the real layout so root-relative
  // asset URLs (/assets/…) resolve. The parent's entries are linked in and
  // the core assembly lands under the same subdirectory name.
  const parent = dirname(sitePath);
  const parentIndex = join(parent, 'index.php');
  const subdir = existsSync(parentIndex) && readFileSync(parentIndex, 'utf8').includes('wp-blog-header')
    ? basename(sitePath)
    : null;

  let docroot = tmp;
  let root = tmp;

  if (subdir) {
    for (const entry of readdirSync(parent)) {
      if (entry === basename(sitePath) || entry.startsWith('.')) {
        continue;
      }
      const from = join(parent, entry);
      if (entry.endsWith('.php')) {
        cpSync(from, join(tmp, entry));
      } else {
        link(from, join(tmp, entry));
      }
    }

    root = join(tmp, subdir);
    mkdirSync(root);
  }

  // Site-specific docroot mappings the real web server provides via rewrites
  // (e.g. BHP serves /assets from patterns/public/assets). Configured per
  // target: sandbox.map = { "assets": "patterns/public/assets" }, paths
  // relative to the real docroot.
  const realDocroot = subdir ? parent : sitePath;
  for (const [urlPath, realRelative] of Object.entries(pathMap)) {
    link(join(realDocroot, realRelative), join(docroot, urlPath));
  }

  // Core: directories are linked read-only, but root-level PHP entry files
  // (index.php, wp-load.php, wp-settings.php…) are COPIED. PHP resolves
  // __DIR__ through symlinks to the real path, so a symlinked wp-load.php
  // sets ABSPATH to the real install and loads the REAL wp-config.php —
  // real database, real plugin stack. Copying keeps ABSPATH inside the
  // sandbox; this is the isolation boundary, not an optimisation.
  for (const entry of readdirSync(sitePath)) {
    if (entry === 'wp-config.php' || entry === 'wp-content' || entry.startsWith('.')) {
      continue;
    }

    const from = join(sitePath, entry);

    if (entry.endsWith('.php')) {
      cpSync(from, join(root, entry));
    } else {
      link(from, join(root, entry));
    }
  }

  // wp-content: own directory; code linked, state owned.
  const content = join(root, 'wp-content');
  mkdirSync(join(content, 'uploads'), { recursive: true });
  mkdirSync(join(root, 'database'));

  for (const dir of ['themes', 'languages']) {
    link(join(sitePath, 'wp-content', dir), join(content, dir));
  }

  // mu-plugins: a real directory with entries linked individually, so the
  // sandbox can add its own helpers without touching the project's dir.
  mkdirSync(join(content, 'mu-plugins'), { recursive: true });
  const realMuPlugins = join(sitePath, 'wp-content', 'mu-plugins');
  if (existsSync(realMuPlugins)) {
    for (const entry of readdirSync(realMuPlugins)) {
      if (!entry.startsWith('.')) {
        link(join(realMuPlugins, entry), join(content, 'mu-plugins', entry));
      }
    }
  }

  // Plugins: allowlist only.
  mkdirSync(join(content, 'plugins'), { recursive: true });
  const realPlugins = join(sitePath, 'wp-content', 'plugins');
  for (const plugin of pluginAllowlist) {
    const from = join(realPlugins, plugin);
    if (existsSync(from)) {
      link(from, join(content, 'plugins', plugin));
    } else {
      console.warn(`⚠ sandbox: allowlisted plugin "${plugin}" not found in ${realPlugins}`);
    }
  }

  // Isolation witness: answers /?shakedown_whoami=1 with the paths this
  // WordPress is actually running from, so boot can PROVE the sandbox is
  // decoupled before any test traffic flows.
  writeFileSync(join(content, 'mu-plugins', 'aa-shakedown-sandbox.php'), `<?php
/**
 * Shakedown sandbox witness (sandbox-only; never installed on real sites).
 */
if ( isset( $_GET['shakedown_whoami'] ) ) {
\theader( 'Content-Type: application/json' );
\techo json_encode( [
\t\t'abspath' => ABSPATH,
\t\t'content_dir' => WP_CONTENT_DIR,
\t\t'sqlite' => defined( 'DB_DIR' ) ? DB_DIR : null,
\t] );
\texit;
}
`);

  // SQLite integration: plugin dir + the db.php drop-in built from its template.
  const sqlite = ensureSqlitePlugin();
  cpSync(sqlite, join(content, 'plugins', 'sqlite-database-integration'), { recursive: true });

  const dropIn = readFileSync(join(sqlite, 'db.copy'), 'utf8')
    .replaceAll('{SQLITE_IMPLEMENTATION_FOLDER_PATH}', join(content, 'plugins', 'sqlite-database-integration'))
    .replaceAll('{SQLITE_MAIN_FILE}', join(content, 'plugins', 'sqlite-database-integration', 'load.php'));
  writeFileSync(join(content, 'db.php'), dropIn);

  return { docroot, root, subdir };
}

/**
 * Write the sandbox's own wp-config.php.
 */
function writeConfig(root, url, subdir = null) {
  const siteUrl = subdir ? `${url}/${subdir}` : url;
  writeFileSync(join(root, 'wp-config.php'), `<?php
// Shakedown sandbox — disposable. The real site's configuration is never read.
define( 'DB_NAME', 'shakedown' );
define( 'DB_USER', '' );
define( 'DB_PASSWORD', '' );
define( 'DB_HOST', '' );
define( 'DB_DIR', __DIR__ . '/database' );
define( 'DB_FILE', '.ht.sqlite' );
define( 'WP_CONTENT_DIR', __DIR__ . '/wp-content' );
define( 'WP_CONTENT_URL', '${siteUrl}/wp-content' );
define( 'WP_HOME', '${url}' );
define( 'WP_SITEURL', '${siteUrl}' );
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', __DIR__ . '/debug.log' );
define( 'WP_DEBUG_DISPLAY', false );
define( 'WP_ENVIRONMENT_TYPE', 'local' );
define( 'DISABLE_WP_CRON', true );
define( 'AUTH_KEY', 'shakedown' );
define( 'SECURE_AUTH_KEY', 'shakedown' );
define( 'LOGGED_IN_KEY', 'shakedown' );
define( 'NONCE_KEY', 'shakedown' );
define( 'AUTH_SALT', 'shakedown' );
define( 'SECURE_AUTH_SALT', 'shakedown' );
define( 'LOGGED_IN_SALT', 'shakedown' );
define( 'NONCE_SALT', 'shakedown' );
$table_prefix = 'wp_';
if ( ! defined( 'ABSPATH' ) ) {
\tdefine( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
`);
}

/**
 * Run WP-CLI against the sandbox.
 */
function wp(root, args) {
  return execFileSync('wp', [...args, `--path=${root}`], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}

/**
 * Boot a sandbox for a target: assemble, install, activate, serve.
 *
 * @param {{sitePath: string}} target Resolved shakedown target (real project).
 * @param {{port?: number, theme?: string}} options
 * @returns {{baseUrl: string, root: string, stop: () => void}}
 */
export async function bootSandbox(target, options = {}) {
  // An OS-assigned ephemeral port: fixed defaults collide with stale
  // servers from crashed runs, which then answer for a deleted sandbox.
  const port = options.port ?? (await freePort());
  const url = `http://127.0.0.1:${port}`;

  const allowlist = options.plugins ?? target.sandbox?.plugins ?? [];
  const { docroot, root, subdir } = assemble(target.sitePath, allowlist, target.sandbox?.map ?? {});
  writeConfig(root, url, subdir);

  wp(root, [
    'core', 'install',
    `--url=${url}`,
    '--title=Shakedown Sandbox',
    '--admin_user=shakedown',
    '--admin_password=shakedown',
    '--admin_email=sandbox@shakedown.test',
    '--skip-email',
  ]);

  const theme = options.theme ?? detectChildTheme(target.sitePath);
  if (theme) {
    wp(root, ['theme', 'activate', theme]);
  }

  for (const plugin of allowlist) {
    if (existsSync(join(root, 'wp-content', 'plugins', plugin))) {
      wp(root, ['plugin', 'activate', plugin]);
    }
  }

  wp(root, ['rewrite', 'structure', '/%postname%/', '--hard']);

  const server = spawn('wp', ['server', `--host=127.0.0.1`, `--port=${port}`, `--docroot=${docroot}`, `--path=${root}`], {
    stdio: 'ignore',
    detached: false,
  });

  waitForServer(url);
  assertIsolated(url, docroot, server);

  return {
    baseUrl: url,
    root,
    theme,
    stop() {
      server.kill();
      rmSync(docroot, { recursive: true, force: true });
    },
  };
}

/**
 * Seed ACF state fixtures (populated + minimal per field group) inside a
 * booted sandbox, via Muster. Only ever called for sandboxes — the isolation
 * witness has already proven the database is throwaway before seeding runs.
 *
 * @param {{root: string, theme: string|null}} sandbox
 * @param {string} musterAutoload Path to Muster's vendor/autoload.php.
 * @param {number} seed Determinism seed.
 * @returns {array<{url: string, kind: string, expect: number}>} State routes.
 */
export function seedAcfStates(sandbox, musterAutoload, seed = 42) {
  const acfJsonDir = join(sandbox.root, 'wp-content', 'themes', sandbox.theme ?? '', 'acf-json');

  if (!sandbox.theme || !existsSync(acfJsonDir)) {
    return [];
  }

  const script = join(dirname(dirname(new URL(import.meta.url).pathname)), 'bin', 'seed-states.php');
  const out = execFileSync(
    'wp',
    ['eval-file', script, musterAutoload, acfJsonDir, String(seed), `--path=${sandbox.root}`],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );

  const start = out.indexOf('{');
  if (start === -1) {
    throw new Error(`seed-states produced no JSON:\n${out.trim().slice(0, 500)}`);
  }

  return JSON.parse(out.slice(start)).routes;
}

/**
 * Prove the served WordPress runs from the sandbox before any test traffic:
 * ABSPATH and WP_CONTENT_DIR must point into the temp dir and the database
 * must be the sandbox SQLite. If not, kill everything — a sandbox that can
 * reach the real site's config/database must never be tested against.
 *
 * @param {string} url
 * @param {string} root
 * @param {import('node:child_process').ChildProcess} server
 */
function assertIsolated(url, root, server) {
  let who = {};

  try {
    who = JSON.parse(execFileSync('curl', ['-s', `${url}/?shakedown_whoami=1`], { encoding: 'utf8' }));
  } catch {
    // fall through to the failure below
  }

  // PHP reports realpaths; on macOS the temp dir arrives via the /var →
  // /private/var symlink, so compare against the resolved root.
  const real = realpathSync(root);
  const inside = (p) => typeof p === 'string' && (p.startsWith(root) || p.startsWith(real));

  if (!inside(who.content_dir) || !inside(who.sqlite)) {
    server.kill();
    rmSync(root, { recursive: true, force: true });
    throw new Error(
      `sandbox isolation check FAILED (got ${JSON.stringify(who)}) — refusing to run tests against a non-isolated WordPress.`
    );
  }
}

/**
 * Ask the OS for a free ephemeral port.
 *
 * @returns {Promise<number>}
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/**
 * The project's child theme: the theme directory whose style.css declares a
 * Template (parent), preferring one matching a known PressGang parent.
 *
 * @param {string} sitePath
 * @returns {string|null}
 */
function detectChildTheme(sitePath) {
  const themes = join(sitePath, 'wp-content', 'themes');
  if (!existsSync(themes)) return null;

  for (const dir of readdirSync(themes)) {
    const css = join(themes, dir, 'style.css');
    if (existsSync(css) && /^[\s*]*Template:\s*pressgang/m.test(readFileSync(css, 'utf8'))) {
      return dir;
    }
  }

  return null;
}

/**
 * Poll until the sandbox answers (or fail after ~15s).
 */
function waitForServer(url, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      execFileSync('curl', ['-s', '-o', '/dev/null', '--max-time', '2', url]);
      return;
    } catch {
      execFileSync('sleep', ['0.5']);
    }
  }

  throw new Error(`Sandbox did not answer at ${url}`);
}
