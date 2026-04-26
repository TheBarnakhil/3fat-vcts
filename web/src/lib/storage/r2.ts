import {
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env";

/**
 * Cloudflare R2 client (S3-compatible) wrapped in a small, intent-named
 * surface that the rest of the code uses. R2 is feature-flagged: if any of
 * the four core env vars are missing, `r2Enabled()` returns false and the
 * receipt route falls back to streaming the freshly generated PDF.
 *
 * Bucket layout (locked here so other phases stay consistent):
 *   t/{tenantSlug}/receipts/{receiptNoPath}.pdf
 *   t/{tenantSlug}/photos/{collectionId}.jpg     (Phase 8)
 *   t/{tenantSlug}/signatures/{collectionId}.png (Phase 8)
 *
 * `receiptNo` contains forward slashes (acme/A001/FY26/00042). We keep them
 * because S3 prefix listings will then naturally group by agent + FY.
 */

let memo: { client: S3Client } | null = null;

export function r2Enabled(): boolean {
	return Boolean(
		env.R2_ACCOUNT_ID &&
			env.R2_ACCESS_KEY_ID &&
			env.R2_SECRET_ACCESS_KEY &&
			env.R2_BUCKET,
	);
}

function client(): S3Client {
	if (memo) return memo.client;
	if (!r2Enabled()) {
		throw new Error("R2 is not configured; check r2Enabled() before calling.");
	}
	memo = {
		client: new S3Client({
			region: "auto",
			endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
			credentials: {
				accessKeyId: env.R2_ACCESS_KEY_ID!,
				secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
			},
		}),
	};
	return memo.client;
}

export function receiptKey(tenantSlug: string, receiptNo: string): string {
	return `t/${tenantSlug}/receipts/${receiptNo}.pdf`;
}

export async function objectExists(key: string): Promise<boolean> {
	try {
		await client().send(
			new HeadObjectCommand({ Bucket: env.R2_BUCKET!, Key: key }),
		);
		return true;
	} catch (err) {
		if (
			err &&
			typeof err === "object" &&
			"name" in err &&
			(err as { name: string }).name === "NotFound"
		) {
			return false;
		}
		// 404 is also returned via $metadata.httpStatusCode for some SDK paths
		const status = (err as { $metadata?: { httpStatusCode?: number } })
			?.$metadata?.httpStatusCode;
		if (status === 404) return false;
		throw err;
	}
}

export async function putObject(
	key: string,
	body: Uint8Array | Buffer,
	contentType: string,
): Promise<void> {
	await client().send(
		new PutObjectCommand({
			Bucket: env.R2_BUCKET!,
			Key: key,
			Body: body,
			ContentType: contentType,
		}),
	);
}

export async function presignGetUrl(
	key: string,
	ttlSeconds = env.RECEIPT_PRESIGN_TTL_SECONDS,
): Promise<string> {
	return getSignedUrl(
		client(),
		new GetObjectCommand({ Bucket: env.R2_BUCKET!, Key: key }),
		{ expiresIn: ttlSeconds },
	);
}
