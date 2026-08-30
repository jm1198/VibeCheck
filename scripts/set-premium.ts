/**
 * VibeCheck admin CLI — manually designate a venue's plan (base | premium).
 *
 * This is the intended tool for the owner (you) to flip a venue between the
 * base and premium tiers WITHOUT touching code or the database by hand.
 * Payment is collected out-of-band (e.g. QuickBooks) — this CLI only flips
 * the plan flag; it does not charge anything.
 *
 * Usage (from /home/team/shared/site):
 *   bun run set-premium list                    # list all venues + their plan
 *   bun run set-premium <venueId> premium       # set venue to premium
 *   bun run set-premium <venueId> base          # set venue back to base
 *   bun run set-premium <venueId>               # show current plan
 *
 * Examples:
 *   bun run set-premium list
 *   bun run set-premium 3 premium
 *   bun run set-premium 3 base
 */
import { getDb } from "../db.ts";

function fail(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  console.error(`Usage:\n  bun run set-premium list\n  bun run set-premium <venueId> premium|base\n  bun run set-premium <venueId>\n`);
  process.exit(1);
}

const db = getDb();

function listVenues(): void {
  const rows = db
    .prepare("SELECT id, name, location, plan FROM venues ORDER BY id ASC")
    .all() as { id: number; name: string; location: string; plan: string }[];

  console.log("");
  console.log("┌────┬────────────────────────────────────────┬─────────┐");
  console.log("│ ID │ Name                                   │ Plan    │");
  console.log("├────┼────────────────────────────────────────┼─────────┤");
  for (const v of rows) {
    const name = (v.name.length > 38 ? v.name.slice(0, 37) + "…" : v.name).padEnd(38);
    const plan = v.plan.toUpperCase().padEnd(7);
    console.log(`│ ${String(v.id).padEnd(2)} │ ${name} │ ${plan} │`);
  }
  console.log("└────┴────────────────────────────────────────┴─────────┘");
  console.log(`\n${rows.length} venue(s).`);
}

function showVenue(venueId: number): void {
  const v = db
    .prepare("SELECT id, name, plan FROM venues WHERE id = ?")
    .get(venueId) as { id: number; name: string; plan: string } | undefined;
  if (!v) fail(`Venue ${venueId} not found — run \`bun run set-premium list\` to see valid IDs.`);
  console.log(`\nVenue #${v.id} "${v.name}" is on the ${v.plan.toUpperCase()} plan.\n`);
}

function setVenue(venueId: number, plan: string): void {
  if (plan !== "premium" && plan !== "base") {
    fail(`Invalid plan "${plan}" — use "premium" or "base".`);
  }
  const v = db
    .prepare("SELECT id, name FROM venues WHERE id = ?")
    .get(venueId) as { id: number; name: string } | undefined;
  if (!v) fail(`Venue ${venueId} not found — run \`bun run set-premium list\` to see valid IDs.`);

  db.prepare("UPDATE venues SET plan = ?, updated_at = datetime('now') WHERE id = ?").run(plan, venueId);
  console.log(`\n✅ Venue #${v.id} "${v.name}" is now on the ${plan.toUpperCase()} plan.\n`);

  if (plan === "premium") {
    console.log("   Analytics is now unlocked for this venue in its dashboard.");
  } else {
    console.log("   Analytics is now locked — the dashboard will show the Premium upgrade prompt.");
  }
  console.log("");
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "list" || args[0] === "ls") {
  listVenues();
} else {
  const venueId = parseInt(args[0], 10);
  if (isNaN(venueId)) fail(`"${args[0]}" is not a valid venue ID.`);
  if (args.length === 1) {
    showVenue(venueId);
  } else {
    setVenue(venueId, args[1].toLowerCase());
  }
}
