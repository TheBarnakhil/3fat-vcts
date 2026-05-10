/**
 * Seeds the first platform admin account. Safe to re-run: it upserts by email.
 *
 *   pnpm db:seed:platform
 *
 * Override defaults with:
 *   PLATFORM_ADMIN_EMAIL=...
 *   PLATFORM_ADMIN_NAME=...
 *   PLATFORM_ADMIN_PASSWORD=...
 */
import { eq } from "drizzle-orm";

import { pool } from "@/db/client";
import { platformUsers } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { hashPassword } from "@/lib/auth/password";

const email = (process.env.PLATFORM_ADMIN_EMAIL ?? "platform@3fat.test").toLowerCase();
const name = process.env.PLATFORM_ADMIN_NAME ?? "Platform Admin";
const password = process.env.PLATFORM_ADMIN_PASSWORD ?? "Passw0rd!";

async function main() {
	const passwordHash = await hashPassword(password);

	await withoutTenant(async (tx) => {
		const existing = await tx
			.select({ id: platformUsers.id })
			.from(platformUsers)
			.where(eq(platformUsers.email, email))
			.limit(1);

		if (existing[0]) {
			await tx
				.update(platformUsers)
				.set({ name, passwordHash, isActive: true, updatedAt: new Date() })
				.where(eq(platformUsers.id, existing[0].id));
			console.log(`  [ok] refreshed platform admin ${email}`);
			return;
		}

		await tx.insert(platformUsers).values({
			email,
			name,
			passwordHash,
			isActive: true,
		});
		console.log(`  [ok] created platform admin ${email}`);
	});

	console.log("\nDone. Platform login:");
	console.log(`  /platform/login  ${email} / ${password}`);
}

main()
	.catch((err) => {
		console.error(err);
		process.exit(1);
	})
	.finally(async () => {
		await pool.end();
	});
