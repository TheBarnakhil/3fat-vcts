import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Phase 10 / Track C3 - per-customer ledger PDF.
 *
 * Renders an A4 page (or multiple pages for long ledgers) listing
 * every collection ever recorded for a single customer, with a
 * tenant header, customer block, and tenant audit-trail disclaimer.
 *
 * Reuses pdf-lib (same library that ships the receipt PDF) so we
 * don't pull in another typeset engine. Long ledgers paginate
 * automatically once we run out of room before the bottom margin.
 */

export interface LedgerInput {
	tenant: {
		legalName: string;
		address?: string;
		gstin?: string;
		phone?: string;
	};
	customer: {
		name: string;
		code: string | null;
		address: string | null;
		phone: string | null;
		outstandingBalance: number;
	};
	collections: Array<{
		collectedAt: Date;
		receiptNo: string | null;
		paymentMode: "cash" | "cheque" | "bank_transfer" | "upi";
		amount: number;
		refNo: string | null;
		agentName: string;
		reversed: boolean;
	}>;
	totals: {
		count: number;
		gross: number;
		reversedCount: number;
		reversedAmount: number;
		net: number;
	};
	generatedAt: Date;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const FOOTER_RESERVE = 64;

/**
 * pdf-lib's StandardFonts (Helvetica / HelveticaBold / Courier) all use
 * WinAnsi encoding, which only covers a subset of Unicode. A single
 * out-of-range glyph (an emoji in an agent name, a CJK character in a
 * tenant address, even a curly quote pasted from Word) makes drawText
 * either throw or silently drop content depending on the pdf-lib build,
 * which in production manifests as "blank pages". We strip everything
 * outside the safe WinAnsi range here and replace common typographic
 * variants with their ASCII equivalents so the layout still reads right.
 */
function sanitizeForWinAnsi(input: string | null | undefined): string {
	if (input === null || input === undefined) return "";
	return String(input)
		.replace(/[\u2010-\u2015]/g, "-") // dashes -> hyphen
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'") // single quotes
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"') // double quotes
		.replace(/\u2026/g, "...") // ellipsis
		.replace(/[\u00A0]/g, " ") // nbsp
		.replace(/\u20B9/g, "Rs.") // ₹ rupee sign
		.split("")
		.map((ch) => {
			const code = ch.charCodeAt(0);
			// Printable ASCII + standard WinAnsi extensions.
			if (code >= 0x20 && code <= 0x7e) return ch;
			if (code >= 0xa0 && code <= 0xff) return ch;
			return "?";
		})
		.join("");
}

function formatINR(n: number): string {
	const parts = n.toFixed(2).split(".");
	return `Rs. ${Number(parts[0]).toLocaleString("en-IN")}.${parts[1]}`;
}

function paymentModeLabel(m: LedgerInput["collections"][number]["paymentMode"]): string {
	switch (m) {
		case "cash":
			return "Cash";
		case "cheque":
			return "Cheque";
		case "bank_transfer":
			return "Bank";
		case "upi":
			return "UPI";
	}
}

export interface RenderLedgerResult {
	bytes: Uint8Array;
	pageCount: number;
}

export async function renderLedgerPdfDetailed(
	input: LedgerInput,
): Promise<RenderLedgerResult> {
	const pdf = await PDFDocument.create();
	pdf.setTitle(sanitizeForWinAnsi(`Ledger - ${input.customer.name}`));
	pdf.setAuthor(sanitizeForWinAnsi(input.tenant.legalName));
	pdf.setProducer("VCTS");
	pdf.setCreator("VCTS");
	pdf.setCreationDate(input.generatedAt);

	const reg = await pdf.embedFont(StandardFonts.Helvetica);
	const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
	const mono = await pdf.embedFont(StandardFonts.Courier);

	const ink = rgb(0.07, 0.09, 0.12);
	const muted = rgb(0.42, 0.46, 0.51);
	const accent = rgb(0.13, 0.32, 0.84);
	const danger = rgb(0.86, 0.15, 0.15);
	const ruleColor = rgb(0.85, 0.86, 0.88);

	const cols = layoutColumns();

	// Wrapper that sanitises every string before forwarding to pdf-lib.
	// Any drawText error (still possible for exotic surrogate pairs)
	// is swallowed so a single bad character can't blank the entire PDF.
	function safeDrawText(
		p: ReturnType<PDFDocument["addPage"]>,
		text: string,
		opts: Parameters<ReturnType<PDFDocument["addPage"]>["drawText"]>[1],
	) {
		const sanitized = sanitizeForWinAnsi(text);
		if (!sanitized) return;
		try {
			p.drawText(sanitized, opts);
		} catch {
			// Last-resort fallback - replace with question marks the same
			// length so the layout still occupies the same space.
			try {
				p.drawText("?".repeat(Math.min(sanitized.length, 80)), opts);
			} catch {
				/* give up on this glyph */
			}
		}
	}

	let pageIndex = 0;
	let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
	let y = drawHeader(page);

	for (const row of input.collections) {
		// New page when we'd overflow the footer reserve.
		if (y < MARGIN + FOOTER_RESERVE + 28) {
			drawFooter(page, pageIndex);
			pageIndex += 1;
			page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
			y = drawTableHeader(page, drawSlimHeader(page));
		}
		drawRow(page, row, y);
		y -= 18;
	}

	// Totals band
	if (y < MARGIN + FOOTER_RESERVE + 80) {
		drawFooter(page, pageIndex);
		pageIndex += 1;
		page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
		y = drawSlimHeader(page);
	}
	y = drawTotals(page, y);
	drawFooter(page, pageIndex);

	const bytes = await pdf.save();
	return { bytes, pageCount: pageIndex + 1 };

	// --- inline helpers ----------------------------------------------------

	function layoutColumns() {
		const xDate = MARGIN;
		const xReceipt = MARGIN + 80;
		const xMode = MARGIN + 220;
		const xAgent = MARGIN + 280;
		const xAmount = PAGE_WIDTH - MARGIN - 80;
		return { xDate, xReceipt, xMode, xAgent, xAmount };
	}

	function drawHeader(p: ReturnType<PDFDocument["addPage"]>): number {
		// Accent stripe
		p.drawRectangle({
			x: 0,
			y: PAGE_HEIGHT - MARGIN - 6,
			width: PAGE_WIDTH,
			height: 4,
			color: accent,
		});

		// Tenant block (left)
		safeDrawText(p, input.tenant.legalName, {
			x: MARGIN,
			y: PAGE_HEIGHT - MARGIN - 24,
			size: 18,
			font: bold,
			color: ink,
		});
		if (input.tenant.address) {
			safeDrawText(p, input.tenant.address, {
				x: MARGIN,
				y: PAGE_HEIGHT - MARGIN - 42,
				size: 9,
				font: reg,
				color: muted,
				maxWidth: PAGE_WIDTH / 2 - MARGIN,
			});
		}
		const meta = [
			input.tenant.gstin ? `GSTIN ${input.tenant.gstin}` : null,
			input.tenant.phone ? `Phone ${input.tenant.phone}` : null,
		]
			.filter(Boolean)
			.join("   ");
		if (meta) {
			safeDrawText(p, meta, {
				x: MARGIN,
				y: PAGE_HEIGHT - MARGIN - 56,
				size: 9,
				font: reg,
				color: muted,
			});
		}

		// "LEDGER" + customer block (right)
		safeDrawText(p, "LEDGER", {
			x: PAGE_WIDTH - MARGIN - 96,
			y: PAGE_HEIGHT - MARGIN - 30,
			size: 14,
			font: bold,
			color: muted,
		});
		safeDrawText(p, `Generated ${input.generatedAt.toUTCString().replace("GMT", "UTC")}`, {
			x: PAGE_WIDTH - MARGIN - 220,
			y: PAGE_HEIGHT - MARGIN - 50,
			size: 9,
			font: reg,
			color: muted,
		});

		// Customer band
		const bandY = PAGE_HEIGHT - MARGIN - 90;
		p.drawLine({
			start: { x: MARGIN, y: bandY + 8 },
			end: { x: PAGE_WIDTH - MARGIN, y: bandY + 8 },
			thickness: 0.5,
			color: ruleColor,
		});
		safeDrawText(p, "CUSTOMER", { x: MARGIN, y: bandY - 8, size: 8.5, font: bold, color: muted });
		safeDrawText(p, input.customer.name, {
			x: MARGIN,
			y: bandY - 26,
			size: 14,
			font: bold,
			color: ink,
		});
		const cy0 = bandY - 42;
		const subParts = [
			input.customer.code ? `Code ${input.customer.code}` : null,
			input.customer.phone,
			input.customer.address,
		].filter((s): s is string => Boolean(s));
		safeDrawText(p, subParts.join("   - "), {
			x: MARGIN,
			y: cy0,
			size: 9,
			font: reg,
			color: muted,
			maxWidth: PAGE_WIDTH - MARGIN * 2 - 220,
		});

		// Outstanding balance (right side of customer band)
		safeDrawText(p, "OUTSTANDING", {
			x: PAGE_WIDTH - MARGIN - 200,
			y: bandY - 8,
			size: 8.5,
			font: bold,
			color: muted,
		});
		safeDrawText(p, formatINR(input.customer.outstandingBalance), {
			x: PAGE_WIDTH - MARGIN - 200,
			y: bandY - 30,
			size: 16,
			font: bold,
			color: input.customer.outstandingBalance > 0 ? accent : ink,
		});

		return drawTableHeader(p, bandY - 56);
	}

	function drawSlimHeader(p: ReturnType<PDFDocument["addPage"]>): number {
		p.drawRectangle({
			x: 0,
			y: PAGE_HEIGHT - MARGIN - 6,
			width: PAGE_WIDTH,
			height: 4,
			color: accent,
		});
		safeDrawText(p, `${input.tenant.legalName} - ${input.customer.name}`, {
			x: MARGIN,
			y: PAGE_HEIGHT - MARGIN - 24,
			size: 11,
			font: bold,
			color: ink,
		});
		return PAGE_HEIGHT - MARGIN - 56;
	}

	function drawTableHeader(
		p: ReturnType<PDFDocument["addPage"]>,
		startY: number,
	): number {
		safeDrawText(p, "DATE", { x: cols.xDate, y: startY, size: 8.5, font: bold, color: muted });
		safeDrawText(p, "RECEIPT", { x: cols.xReceipt, y: startY, size: 8.5, font: bold, color: muted });
		safeDrawText(p, "MODE", { x: cols.xMode, y: startY, size: 8.5, font: bold, color: muted });
		safeDrawText(p, "AGENT", { x: cols.xAgent, y: startY, size: 8.5, font: bold, color: muted });
		safeDrawText(p, "AMOUNT", { x: cols.xAmount, y: startY, size: 8.5, font: bold, color: muted });
		const ruleY = startY - 6;
		p.drawLine({
			start: { x: MARGIN, y: ruleY },
			end: { x: PAGE_WIDTH - MARGIN, y: ruleY },
			thickness: 0.5,
			color: ruleColor,
		});
		return ruleY - 16;
	}

	function drawRow(
		p: ReturnType<PDFDocument["addPage"]>,
		row: LedgerInput["collections"][number],
		atY: number,
	): void {
		const dateStr = row.collectedAt.toISOString().slice(0, 10);
		const receipt = row.receiptNo ?? "-";
		const agentName = row.agentName.length > 24
			? row.agentName.slice(0, 23) + "..."
			: row.agentName;
		safeDrawText(p, dateStr, { x: cols.xDate, y: atY, size: 9, font: mono, color: ink });
		safeDrawText(p, receipt, {
			x: cols.xReceipt,
			y: atY,
			size: 9,
			font: mono,
			color: row.reversed ? danger : ink,
			maxWidth: cols.xMode - cols.xReceipt - 8,
		});
		safeDrawText(p, paymentModeLabel(row.paymentMode), {
			x: cols.xMode,
			y: atY,
			size: 9,
			font: reg,
			color: ink,
		});
		safeDrawText(p, agentName, { x: cols.xAgent, y: atY, size: 9, font: reg, color: ink });
		const amt = formatINR(row.amount);
		// Right-align amount: rough width estimate using mono font.
		const w = mono.widthOfTextAtSize(sanitizeForWinAnsi(amt), 9);
		safeDrawText(p, amt, {
			x: PAGE_WIDTH - MARGIN - w,
			y: atY,
			size: 9,
			font: mono,
			color: row.reversed ? danger : ink,
		});
		if (row.reversed) {
			safeDrawText(p, "REV", {
				x: cols.xAmount - 32,
				y: atY,
				size: 8,
				font: bold,
				color: danger,
			});
		}
	}

	function drawTotals(p: ReturnType<PDFDocument["addPage"]>, startY: number): number {
		const y = startY - 16;
		p.drawLine({
			start: { x: MARGIN, y: y + 12 },
			end: { x: PAGE_WIDTH - MARGIN, y: y + 12 },
			thickness: 0.8,
			color: ruleColor,
		});
		const labelOpts = { size: 8.5, font: bold, color: muted } as const;
		const valueOpts = { size: 11, font: bold, color: ink } as const;
		safeDrawText(p, "TOTAL RECEIPTS", { x: MARGIN, y, ...labelOpts });
		safeDrawText(p, `${input.totals.count}`, {
			x: MARGIN,
			y: y - 16,
			size: 14,
			font: bold,
			color: ink,
		});
		safeDrawText(p, "GROSS COLLECTED", { x: MARGIN + 140, y, ...labelOpts });
		safeDrawText(p, formatINR(input.totals.gross), {
			x: MARGIN + 140,
			y: y - 16,
			...valueOpts,
		});
		safeDrawText(p, "REVERSED", { x: MARGIN + 320, y, ...labelOpts });
		safeDrawText(
			p,
			`${input.totals.reversedCount} - ${formatINR(input.totals.reversedAmount)}`,
			{
				x: MARGIN + 320,
				y: y - 16,
				size: 11,
				font: bold,
				color: input.totals.reversedCount > 0 ? danger : ink,
			},
		);
		safeDrawText(p, "NET", { x: PAGE_WIDTH - MARGIN - 100, y, ...labelOpts });
		safeDrawText(p, formatINR(input.totals.net), {
			x: PAGE_WIDTH - MARGIN - 100,
			y: y - 16,
			size: 14,
			font: bold,
			color: accent,
		});
		return y - 36;
	}

	function drawFooter(
		p: ReturnType<PDFDocument["addPage"]>,
		pageIdx: number,
	): void {
		const footerY = MARGIN + 20;
		p.drawLine({
			start: { x: MARGIN, y: footerY + 16 },
			end: { x: PAGE_WIDTH - MARGIN, y: footerY + 16 },
			thickness: 0.5,
			color: ruleColor,
		});
		safeDrawText(
			p,
			"Computer-generated ledger. Each collection is signed into the tenant's audit chain.",
			{
				x: MARGIN,
				y: footerY,
				size: 8,
				font: reg,
				color: muted,
				maxWidth: PAGE_WIDTH - MARGIN * 2 - 80,
			},
		);
		safeDrawText(p, `Page ${pageIdx + 1}`, {
			x: PAGE_WIDTH - MARGIN - 48,
			y: footerY,
			size: 8,
			font: bold,
			color: muted,
		});
	}
}

/**
 * Public entry point - renders the PDF and returns just the bytes.
 * Backwards compatible with the original Track C3 signature.
 */
export async function renderLedgerPdf(input: LedgerInput): Promise<Uint8Array> {
	const result = await renderLedgerPdfDetailed(input);
	return result.bytes;
}
