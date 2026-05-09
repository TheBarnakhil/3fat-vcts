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

/**
 * Phase 8 attachment keys. We deliberately avoid putting the receipt
 * number in the path because the device captures + uploads the photo /
 * signature *before* the server has issued a receipt number (offline
 * queue path). The collection id is the stable handle.
 */
export function photoKey(tenantSlug: string, collectionId: string): string {
	return `t/${tenantSlug}/photos/${collectionId}.jpg`;
}

export function signatureKey(tenantSlug: string, collectionId: string): string {
	return `t/${tenantSlug}/signatures/${collectionId}.png`;
}

export function brandingLogoKey(tenantSlug: string): string {
	return `t/${tenantSlug}/branding/logo.png`;
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

/**
 * Issues a presigned PUT URL the device can use to upload a photo /
 * signature directly to R2 without round-tripping the binary through
 * the Next.js API. We pin Content-Type at sign time so the device
 * cannot smuggle in a wrong-typed object; `Content-Length` is only
 * pinned by the SDK if the caller supplies it (we don't).
 */
export async function presignPutUrl(
	key: string,
	contentType: string,
	ttlSeconds = env.RECEIPT_PRESIGN_TTL_SECONDS,
): Promise<string> {
	return getSignedUrl(
		client(),
		new PutObjectCommand({
			Bucket: env.R2_BUCKET!,
			Key: key,
			ContentType: contentType,
		}),
		{ expiresIn: ttlSeconds, signableHeaders: new Set(["content-type"]) },
	);
}

/**
 * Pulls an object out of R2 as a Buffer. Used by the PDF renderer to
 * embed a photo / signature inline; the verification page also uses
 * it to render the signed thumbnail. Returns `null` if the object is
 * missing rather than throwing - receipts without attachments must
 * still render.
 */
export async function getObjectBytes(key: string): Promise<Buffer | null> {
	try {
		const res = await client().send(
			new GetObjectCommand({ Bucket: env.R2_BUCKET!, Key: key }),
		);
		const body = res.Body;
		if (!body) return null;
		const chunks: Buffer[] = [];
		for await (const chunk of body as AsyncIterable<Uint8Array>) {
			chunks.push(Buffer.from(chunk));
		}
		return Buffer.concat(chunks);
	} catch (err) {
		const status = (err as { $metadata?: { httpStatusCode?: number } })
			?.$metadata?.httpStatusCode;
		if (
			status === 404 ||
			(err && (err as { name?: string }).name === "NoSuchKey")
		) {
			return null;
		}
		throw err;
	}
}
