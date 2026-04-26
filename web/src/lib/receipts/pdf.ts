import { degrees, PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Lightweight, dependency-only-on-pdf-lib receipt generator. We deliberately
 * keep this server-friendly (no node-canvas, no headless Chromium) because
 * Vercel's serverless runtime is sensitive to large native deps and Phase 3
 * receipts only need to look professional, not glossy. Phase 8 will swap in
 * embedded photos + signatures + Static Map thumbnails on top of the same
 * scaffold.
 */

export interface ReceiptInput {
	tenant: {
		legalName: string;
		address?: string;
		gstin?: string;
		phone?: string;
	};
	receiptNo: string;
	collectedAt: Date;
	customer: {
		name: string;
		code: string | null;
		address: string | null;
		phone: string | null;
	};
	agent: {
		name: string;
		agentCode: string | null;
	};
	amount: number;
	paymentMode: "cash" | "cheque" | "bank_transfer" | "upi";
	refNo?: string | null;
	chequeDate?: Date | null;
	remarks?: string | null;
	location: {
		lat: number;
		lng: number;
		accuracyM?: number | null;
	};
	reversed?: boolean;
}

const PAGE_WIDTH = 595.28; // A4 portrait, in points
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;

// Indian numerals with thousands separators - matches the on-screen format.
function formatINR(n: number): string {
	const parts = n.toFixed(2).split(".");
	const lakhFormatted = Number(parts[0]).toLocaleString("en-IN");
	return `Rs. ${lakhFormatted}.${parts[1]}`;
}

function paymentModeLabel(m: ReceiptInput["paymentMode"]): string {
	switch (m) {
		case "cash":
			return "Cash";
		case "cheque":
			return "Cheque";
		case "bank_transfer":
			return "Bank transfer";
		case "upi":
			return "UPI";
	}
}

export async function renderReceiptPdf(input: ReceiptInput): Promise<Uint8Array> {
	const pdf = await PDFDocument.create();
	pdf.setTitle(`Receipt ${input.receiptNo}`);
	pdf.setAuthor(input.tenant.legalName);
	pdf.setProducer("VCTS");
	pdf.setCreator("VCTS");
	pdf.setCreationDate(input.collectedAt);

	const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
	const reg = await pdf.embedFont(StandardFonts.Helvetica);
	const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
	const mono = await pdf.embedFont(StandardFonts.Courier);

	const ink = rgb(0.07, 0.09, 0.12); // slate-900-ish
	const muted = rgb(0.42, 0.46, 0.51); // slate-500
	const accent = rgb(0.13, 0.32, 0.84); // indigo-600 (works in both themes)
	const danger = rgb(0.86, 0.15, 0.15);

	let y = PAGE_HEIGHT - MARGIN;

	// --- Header band: tenant + receipt no ----------------------------------
	page.drawRectangle({
		x: 0,
		y: y - 6,
		width: PAGE_WIDTH,
		height: 4,
		color: accent,
	});

	page.drawText(input.tenant.legalName, {
		x: MARGIN,
		y: y - 30,
		size: 18,
		font: bold,
		color: ink,
	});
	if (input.tenant.address) {
		page.drawText(input.tenant.address, {
			x: MARGIN,
			y: y - 48,
			size: 9,
			font: reg,
			color: muted,
		});
	}
	const tenantMeta = [
		input.tenant.gstin ? `GSTIN ${input.tenant.gstin}` : null,
		input.tenant.phone ? `Phone ${input.tenant.phone}` : null,
	]
		.filter(Boolean)
		.join("   ");
	if (tenantMeta) {
		page.drawText(tenantMeta, {
			x: MARGIN,
			y: y - 62,
			size: 9,
			font: reg,
			color: muted,
		});
	}

	page.drawText("RECEIPT", {
		x: PAGE_WIDTH - MARGIN - 96,
		y: y - 30,
		size: 14,
		font: bold,
		color: muted,
	});
	page.drawText(input.receiptNo, {
		x: PAGE_WIDTH - MARGIN - 220,
		y: y - 50,
		size: 12,
		font: mono,
		color: ink,
	});
	page.drawText(input.collectedAt.toUTCString().replace("GMT", "UTC"), {
		x: PAGE_WIDTH - MARGIN - 220,
		y: y - 64,
		size: 9,
		font: reg,
		color: muted,
	});

	if (input.reversed) {
		page.drawText("REVERSED", {
			x: PAGE_WIDTH / 2 - 80,
			y: PAGE_HEIGHT / 2 - 20,
			size: 60,
			font: bold,
			color: danger,
			opacity: 0.18,
			rotate: degrees(-25),
		});
	}

	y = PAGE_HEIGHT - MARGIN - 100;
	page.drawLine({
		start: { x: MARGIN, y },
		end: { x: PAGE_WIDTH - MARGIN, y },
		thickness: 0.5,
		color: rgb(0.85, 0.86, 0.88),
	});

	// --- Two-column block: bill to + collected by --------------------------
	y -= 22;
	const colW = (PAGE_WIDTH - MARGIN * 2) / 2;
	const labelOpts = { size: 8.5, font: bold, color: muted } as const;
	const valueOpts = { size: 11, font: reg, color: ink } as const;

	page.drawText("RECEIVED FROM", { x: MARGIN, y, ...labelOpts });
	page.drawText(input.customer.name, {
		x: MARGIN,
		y: y - 16,
		...valueOpts,
	});
	let cy = y - 30;
	if (input.customer.code) {
		page.drawText(`Code ${input.customer.code}`, {
			x: MARGIN,
			y: cy,
			size: 9,
			font: mono,
			color: muted,
		});
		cy -= 12;
	}
	if (input.customer.address) {
		page.drawText(input.customer.address, {
			x: MARGIN,
			y: cy,
			size: 9,
			font: reg,
			color: muted,
			maxWidth: colW - 8,
		});
		cy -= 12;
	}
	if (input.customer.phone) {
		page.drawText(input.customer.phone, {
			x: MARGIN,
			y: cy,
			size: 9,
			font: reg,
			color: muted,
		});
	}

	const rx = MARGIN + colW + 8;
	page.drawText("COLLECTED BY", { x: rx, y, ...labelOpts });
	page.drawText(input.agent.name, {
		x: rx,
		y: y - 16,
		...valueOpts,
	});
	if (input.agent.agentCode) {
		page.drawText(`Agent ${input.agent.agentCode}`, {
			x: rx,
			y: y - 30,
			size: 9,
			font: mono,
			color: muted,
		});
	}

	// --- Amount band -------------------------------------------------------
	y -= 90;
	page.drawRectangle({
		x: MARGIN,
		y: y - 8,
		width: PAGE_WIDTH - MARGIN * 2,
		height: 56,
		color: rgb(0.96, 0.97, 1),
		borderColor: rgb(0.88, 0.9, 0.95),
		borderWidth: 1,
	});
	page.drawText("AMOUNT RECEIVED", {
		x: MARGIN + 16,
		y: y + 28,
		...labelOpts,
	});
	page.drawText(formatINR(input.amount), {
		x: MARGIN + 16,
		y: y + 6,
		size: 22,
		font: bold,
		color: accent,
	});

	const modeText = paymentModeLabel(input.paymentMode);
	page.drawText("MODE", {
		x: PAGE_WIDTH - MARGIN - 160,
		y: y + 28,
		...labelOpts,
	});
	page.drawText(modeText, {
		x: PAGE_WIDTH - MARGIN - 160,
		y: y + 8,
		size: 14,
		font: bold,
		color: ink,
	});
	if (input.refNo) {
		page.drawText(`Ref ${input.refNo}`, {
			x: PAGE_WIDTH - MARGIN - 160,
			y: y - 6,
			size: 9,
			font: mono,
			color: muted,
		});
	}

	// --- Meta: GPS, cheque date, remarks -----------------------------------
	y -= 36;
	const lines: Array<[string, string]> = [];
	lines.push([
		"GPS",
		`${input.location.lat.toFixed(6)}, ${input.location.lng.toFixed(6)}` +
			(input.location.accuracyM != null
				? `   (+/- ${input.location.accuracyM.toFixed(0)} m)`
				: ""),
	]);
	if (input.chequeDate) {
		lines.push(["Cheque date", input.chequeDate.toISOString().slice(0, 10)]);
	}
	if (input.remarks) lines.push(["Remarks", input.remarks]);

	for (const [label, value] of lines) {
		y -= 18;
		page.drawText(label.toUpperCase(), { x: MARGIN, y, ...labelOpts });
		page.drawText(value, {
			x: MARGIN + 90,
			y,
			size: 10,
			font: reg,
			color: ink,
			maxWidth: PAGE_WIDTH - MARGIN * 2 - 90,
		});
	}

	// --- Footer ------------------------------------------------------------
	const footerY = MARGIN + 24;
	page.drawLine({
		start: { x: MARGIN, y: footerY + 24 },
		end: { x: PAGE_WIDTH - MARGIN, y: footerY + 24 },
		thickness: 0.5,
		color: rgb(0.85, 0.86, 0.88),
	});
	page.drawText(
		"This is a computer-generated receipt. The collection record is signed into the tenant's audit chain.",
		{
			x: MARGIN,
			y: footerY,
			size: 8,
			font: reg,
			color: muted,
			maxWidth: PAGE_WIDTH - MARGIN * 2,
		},
	);
	page.drawText("VCTS", {
		x: PAGE_WIDTH - MARGIN - 32,
		y: footerY,
		size: 9,
		font: bold,
		color: muted,
	});

	return await pdf.save();
}
