import { env } from "@/lib/env";

export function signupVerificationUrl({
	origin,
	token,
}: {
	origin?: string;
	token: string;
}): string {
	const base =
		env.PUBLIC_BASE_URL ??
		env.NEXT_PUBLIC_PUBLIC_BASE_URL ??
		origin ??
		"http://localhost:3000";
	return `${base.replace(/\/$/, "")}/signup/verify?token=${encodeURIComponent(token)}`;
}

export function signupEmailConfigured(): boolean {
	return Boolean(env.RESEND_API_KEY && env.SIGNUP_FROM_EMAIL);
}

export async function sendSignupVerificationEmail({
	to,
	tenantName,
	verifyUrl,
}: {
	to: string;
	tenantName: string;
	verifyUrl: string;
}): Promise<void> {
	if (!env.RESEND_API_KEY || !env.SIGNUP_FROM_EMAIL) {
		console.info("[signup] verification link", { to, tenantName, verifyUrl });
		return;
	}

	const res = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			authorization: `Bearer ${env.RESEND_API_KEY}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			from: env.SIGNUP_FROM_EMAIL,
			to,
			subject: `Verify your VCTS workspace: ${tenantName}`,
			text: [
				`You're creating a VCTS workspace for ${tenantName}.`,
				"",
				"Verify your email to create the workspace:",
				verifyUrl,
				"",
				"This link expires in 24 hours.",
			].join("\n"),
			html: `
				<p>You're creating a VCTS workspace for <strong>${escapeHtml(tenantName)}</strong>.</p>
				<p><a href="${verifyUrl}">Verify your email and create the workspace</a></p>
				<p>This link expires in 24 hours.</p>
			`,
		}),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Failed to send verification email (${res.status}): ${text}`);
	}
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
