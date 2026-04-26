/**
 * Indian fiscal year: April 1 -> March 31. A `collectedAt` of e.g.
 * 2026-02-10 belongs to FY25 (the year that started in April 2025);
 * 2026-04-10 belongs to FY26.
 *
 * We return the two-digit year (the one starting in April) so receipt
 * numbers stay short: `acme/A001/FY26/00001`.
 */
export function fiscalYearForDate(d: Date): { fyStart: number; label: string } {
	const y = d.getUTCFullYear();
	const m = d.getUTCMonth(); // 0-indexed (0 = Jan)
	const fyStart = m >= 3 ? y : y - 1; // Apr (m=3) onwards = current year
	const yy = fyStart % 100;
	return { fyStart, label: `FY${yy.toString().padStart(2, "0")}` };
}

/**
 * `acme/A001/FY26/00042` - tenant slug, agent code, FY label, zero-padded
 * sequence. Pre-validated input is required (no slashes inside the slug or
 * the agent code) - callers must feed sanitised values.
 */
export function formatReceiptNo(input: {
	tenantSlug: string;
	agentCode: string;
	fyLabel: string;
	seq: number;
}): string {
	const seqStr = input.seq.toString().padStart(5, "0");
	return `${input.tenantSlug}/${input.agentCode}/${input.fyLabel}/${seqStr}`;
}
