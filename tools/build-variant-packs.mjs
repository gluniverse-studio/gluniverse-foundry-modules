/**
 * Compile the Level Ground and Breath and Blood compendium packs from their
 * JSON sources (packs/_source/<pack>.json) into the LevelDB folders Foundry
 * reads (packs/<pack>/).
 *
 *   node tools/build-variant-packs.mjs [--foundry=<path to Foundry's resources/app>]
 *
 * The sources are the truth; the LevelDB folders are committed because Foundry
 * consumes them directly (there is no build step at load time). Re-run this
 * after editing a source, with the Foundry server stopped (it holds the pack's
 * LOCK while a world that loaded the module is running).
 *
 * LevelDB is written with the `classic-level` package that ships inside every
 * Foundry install, so the repo itself keeps no dependencies.
 */
import { createRequire } from "node:module";
import { readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PACKS = ["level-ground", "breath-and-blood"];
const arg = process.argv.find((a) => a.startsWith("--foundry="))?.slice("--foundry=".length);
const appDir = resolve(arg ?? process.env.FOUNDRY_APP ?? join(homedir(), "foundryvtt/resources/app"));
const require = createRequire(join(appDir, "package.json"));
const { ClassicLevel } = require("classic-level");

const STATS = { coreVersion: "14.370", systemId: "pf2e", systemVersion: "8.7.0", createdTime: null, modifiedTime: null, lastModifiedBy: null };
const PUBLICATION = { "level-ground": "Level Ground", "breath-and-blood": "Breath and Blood" };

/** Fill the fields every pf2e item document carries, so nothing is left to a migration. */
function complete(doc, pack) {
  if (!/^[A-Za-z0-9]{16}$/.test(doc._id)) throw new Error(`${pack}: bad _id ${doc._id}`);
  const system = {
    rules: [],
    publication: { title: PUBLICATION[pack], license: "OGL", remaster: true },
    _migration: { version: 0.961, previous: null },
    ...doc.system,
  };
  return { folder: null, sort: 0, flags: {}, ownership: { default: 0 }, effects: [], ...doc, system, _stats: { ...STATS, compendiumSource: null, duplicateSource: null, exportSource: null } };
}

for (const pack of PACKS) {
  const docs = JSON.parse(readFileSync(join(ROOT, "packs/_source", `${pack}.json`), "utf8")).map((d) => complete(d, pack));
  const ids = new Set();
  for (const d of docs) {
    if (ids.has(d._id)) throw new Error(`${pack}: duplicate _id ${d._id}`);
    ids.add(d._id);
  }
  const dir = join(ROOT, "packs", pack);
  rmSync(dir, { recursive: true, force: true });
  const db = new ClassicLevel(dir, { valueEncoding: "json" });
  await db.clear();
  await db.batch(docs.map((d) => ({ type: "put", key: `!items!${d._id}`, value: d })));
  await db.compactRange("\x00", "\xff");
  await db.close();
  console.log(`${pack}: ${docs.length} items -> packs/${pack}`);
}
