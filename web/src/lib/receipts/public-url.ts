/**
 * Builds the public verification URL for a receipt. The receipt number
 * already starts with the tenant slug (e.g. `acme/A001/FY26/00042`), so
 * the verify URL is just `/r/{receiptNo}` - no extra prefix needed.
 *
 * Used by the PDF renderer (QR code embed) and the share-sheet hand-off
 * on Android. Defaults to the deployed production origin via
 * `NEXT_PUBLIC_PUBLIC_BASE_URL`; pass an explicit `origin` override
 * (e.g. for tests) when needed.
 */
export function publicReceiptUrl(opts: {
	receiptNo: string;
	origin?: string;
}): string {
	const origin =
		opts.origin ??
		process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ??
		process.env.PUBLIC_BASE_URL ??
		"";
	const receiptPath = opts.receiptNo
		.split("/")
		.map((seg) => encodeURIComponent(seg))
		.join("/");
	const path = `/r/${receiptPath}`;
	if (!origin) return path;
	return `${origin.replace(/\/$/, "")}${path}`;
}
