import bcrypt from "bcryptjs";
import { env } from "../env";

const COST = 12;

/**
 * Pepper + bcrypt. Pepper is a server-side secret mixed into every password
 * before hashing, so a DB leak alone cannot be brute-forced. bcrypt handles
 * per-password salt + cost. If the pepper is ever rotated, every user must
 * reset their password.
 */
export async function hashPassword(plain: string): Promise<string> {
	return bcrypt.hash(plain + env.PASSWORD_PEPPER, COST);
}

export async function verifyPassword(
	plain: string,
	hash: string,
): Promise<boolean> {
	return bcrypt.compare(plain + env.PASSWORD_PEPPER, hash);
}
