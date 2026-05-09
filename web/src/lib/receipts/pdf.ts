import {
	degrees,
	PDFDocument,
	StandardFonts,
	rgb,
	type PDFFont,
	type PDFImage,
	type PDFPage,
} from "pdf-lib";
import QRCode from "qrcode";

/**
 * Lightweight, dependency-only-on-pdf-lib receipt generator. Phase 8
 * adds optional photo + signature + Static-Map thumbnail + QR-code
 * embeds; everything stays optional so a receipt without any
 * attachments still renders the same minimal layout we shipped in
 * Phase 3.
 */

export interface ReceiptAttachments {
	/** JPEG / PNG bytes of the customer-side proof photo (optional). */
	photo?: { bytes: Uint8Array; mime: "image/jpeg" | "image/png" } | null;
	/** PNG bytes of the customer's signature (optional). */
	signature?: { bytes: Uint8Array; mime: "image/png" } | null;
	/** PNG bytes of a Static-Map thumbnail centered on the GPS pin. */
	mapThumbnail?: { bytes: Uint8Array; mime: "image/png" } | null;
	/** Tenant logo (PNG / JPEG). Stamped into the header next to legalName. */
	logo?: { bytes: Uint8Array; mime: "image/png" | "image/jpeg" } | null;
}

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
	attachments?: ReceiptAttachments;
	/** If set, embeds a QR code that points here in the bottom-right corner. */
	verifyUrl?: string;
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

	const attachments = input.attachments ?? {};

	async function embedImage(
		entry: { bytes: Uint8Array; mime: string } | null | undefined,
	) {
		if (!entry) return null;
		try {
			if (entry.mime === "image/png") return await pdf.embedPng(entry.bytes);
			return await pdf.embedJpg(entry.bytes);
		} catch {
			return null;
		}
	}

	const logoImage = await embedImage(attachments.logo);
	const photoImage = await embedImage(attachments.photo);
	const signatureImage = await embedImage(attachments.signature);
	const mapImage = await embedImage(attachments.mapThumbnail);

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

	let textX = MARGIN;
	if (logoImage) {
		const logoSize = 36;
		const scale = logoImage.scale(logoSize / Math.max(logoImage.width, logoImage.height));
		page.drawImage(logoImage, {
			x: MARGIN,
			y: y - 36,
			width: scale.width,
			height: scale.height,
		});
		textX = MARGIN + scale.width + 12;
	}

	page.drawText(input.tenant.legalName, {
		x: textX,
		y: y - 24,
		size: 18,
		font: bold,
		color: ink,
	});
	if (input.tenant.address) {
		page.drawText(input.tenant.address, {
			x: textX,
			y: y - 42,
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
			x: textX,
			y: y - 56,
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

	// --- Attachments band: photo + signature + map -------------------------
	if (photoImage || signatureImage || mapImage) {
		y -= 28;
		const slotW = (PAGE_WIDTH - MARGIN * 2 - 24) / 3;
		const slotH = 130;
		const slotY = y - slotH;

		drawAttachmentSlot(
			page,
			MARGIN,
			slotY,
			slotW,
			slotH,
			"PHOTO",
			photoImage,
			labelOpts,
		);
		drawAttachmentSlot(
			page,
			MARGIN + slotW + 12,
			slotY,
			slotW,
			slotH,
			"SIGNATURE",
			signatureImage,
			labelOpts,
		);
		drawAttachmentSlot(
			page,
			MARGIN + slotW * 2 + 24,
			slotY,
			slotW,
			slotH,
			"GPS PIN",
			mapImage,
			labelOpts,
		);
		y = slotY - 8;
	}

	// --- QR code (verify link) - bottom-right above the footer rule --------
	if (input.verifyUrl) {
		try {
			const qrPng = await QRCode.toBuffer(input.verifyUrl, {
				errorCorrectionLevel: "M",
				margin: 1,
				width: 220,
				color: { dark: "#0F172A", light: "#FFFFFF" },
			});
			const qrImage = await pdf.embedPng(qrPng);
			const qrSize = 72;
			const qrX = PAGE_WIDTH - MARGIN - qrSize;
			const qrY = MARGIN + 56;
			page.drawImage(qrImage, {
				x: qrX,
				y: qrY,
				width: qrSize,
				height: qrSize,
			});
			page.drawText("Scan to verify online", {
				x: qrX - 100,
				y: qrY + qrSize - 12,
				size: 9,
				font: bold,
				color: ink,
			});
			page.drawText(input.verifyUrl, {
				x: qrX - 200,
				y: qrY + qrSize - 28,
				size: 7,
				font: mono,
				color: muted,
				maxWidth: 200,
			});
		} catch {
			// QR generation should never block receipt rendering. Swallow
			// any pdf-lib / qrcode errors here so the receipt still ships.
		}
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

/**
 * Draws a labelled attachment slot. If `image` is missing we still draw
 * the empty frame + "Not captured" placeholder so the receipt's spatial
 * layout is consistent across collections.
 */
type LabelOpts = {
	size: number;
	font: PDFFont;
	color: ReturnType<typeof rgb>;
};

function drawAttachmentSlot(
	page: PDFPage,
	x: number,
	y: number,
	w: number,
	h: number,
	label: string,
	image: PDFImage | null,
	labelOpts: LabelOpts,
) {
	page.drawRectangle({
		x,
		y,
		width: w,
		height: h,
		color: rgb(0.99, 0.99, 0.99),
		borderColor: rgb(0.86, 0.88, 0.92),
		borderWidth: 0.8,
	});
	page.drawText(label, {
		x: x + 8,
		y: y + h - 14,
		size: labelOpts.size,
		font: labelOpts.font,
		color: labelOpts.color,
	});

	if (image) {
		const padding = 8;
		const imgW = w - padding * 2;
		const imgH = h - padding * 2 - 12;
		const scale = image.scale(
			Math.min(imgW / image.width, imgH / image.height),
		);
		page.drawImage(image, {
			x: x + (w - scale.width) / 2,
			y: y + padding,
			width: scale.width,
			height: scale.height,
		});
	} else {
		page.drawText("Not captured", {
			x: x + 8,
			y: y + h / 2 - 4,
			size: 9,
			font: labelOpts.font,
			color: rgb(0.6, 0.62, 0.66),
		});
	}
}
