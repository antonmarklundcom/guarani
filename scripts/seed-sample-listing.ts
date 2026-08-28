/**
 * Seeds one sample listing so every later step has realistic input.
 * Idempotent: safe to re-run.
 *
 * SAMPLE, NOT REAL. Plan §7 asks for a handful of genuine listing records from
 * propia or entered by hand; nobody in a build session can supply those. The
 * figures below are chosen to line up exactly with the three jopara sentences
 * the plan uses for its go/no-go gate (§9) — Barrio San Vicente, three rooms,
 * two bathrooms, 120 m², Gs. 850.000.000 — so generated output can be compared
 * against sentences that were written by hand rather than by this pipeline.
 *
 * Delete this project before showing anything to a client.
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { listings, projects } from "@/db/schema";

const TITLE = "[sample] Casa en Barrio San Vicente";

async function main(): Promise<void> {
  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.title, TITLE))
    .limit(1);

  if (existing[0]) {
    console.log(`Sample listing already present as project ${existing[0].id}.`);
    return;
  }

  const [project] = await db
    .insert(projects)
    .values({ kind: "listing", title: TITLE, status: "active" });

  await db.insert(listings).values({
    projectId: project.insertId,
    address: "Avenida Mariscal López 1234",
    neighborhood: "Barrio San Vicente",
    city: "Asunción",
    price: "850000000.00",
    currency: "PYG",
    rooms: 3,
    bathrooms: 2,
    areaM2: "120.00",
    features: ["garaje", "jardín"],
    status: "available",
  });

  console.log(`Sample listing seeded as project ${project.insertId}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
