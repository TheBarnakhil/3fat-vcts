import { requireAuth, requireRole } from "@/lib/auth/context";
import { fetchLiveAgentLocations } from "@/lib/agents/live-locations";
import { toResponse } from "@/lib/errors";

export const runtime = "nodejs";
// Vercel default Pro maxDuration is 60s. We close the stream a few
// seconds before that so we exit cleanly rather than getting killed.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Phase 10 / Track C2 - SSE channel that pushes the latest agent
 * fixes to manager+ surfaces (the `/map` page). Each cycle:
 *
 * - emits one `snapshot` event carrying the freshest known location
 *   for every agent who logged a fix in the last 30 minutes,
 * - sleeps `INTERVAL_MS`,
 * - emits a `heartbeat` ping so proxies don't idle the connection,
 * - closes around `MAX_RUNTIME_MS` so it stays well below Vercel's
 *   `maxDuration`. The client's EventSource auto-reconnects.
 *
 * Auth: `requireAuth` accepts both the `vcts_access` httpOnly cookie
 * (web admin path) and the `Authorization: Bearer <jwt>` header
 * (preserved for non-cookie clients), so EventSource works without
 * any custom polyfill - the browser ships the cookie automatically.
 *
 * Role: manager / super_admin / auditor only. Agents would just see
 * themselves and their peers, which is a needless data exposure.
 */
const INTERVAL_MS = 5_000;
// Close ~10s before Vercel kills the function so the final flush has
// room to land before the runtime tears the response down.
const MAX_RUNTIME_MS = 50_000;

export async function GET() {
	try {
		const auth = await requireAuth();
		requireRole(auth, "manager", "super_admin", "auditor");

		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				const writeEvent = (event: string, data: unknown) => {
					controller.enqueue(
						encoder.encode(
							`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
						),
					);
				};
				const writeRetry = (ms: number) => {
					controller.enqueue(encoder.encode(`retry: ${ms}\n\n`));
				};

				try {
					// 5 second client-side reconnect floor; EventSource will
					// honour it after the server closes.
					writeRetry(5_000);

					const start = Date.now();
					let lastSig = "";
					while (Date.now() - start < MAX_RUNTIME_MS) {
						const fixes = await fetchLiveAgentLocations(auth.tid, {
							sinceMinutes: 30,
						});
						// Cheap diff so we don't re-emit identical snapshots
						// every tick - the client only needs the latest. We
						// always emit at least the first one and a closing
						// heartbeat for connection health.
						const sig = signature(fixes);
						if (sig !== lastSig) {
							writeEvent("snapshot", { fixes, ts: Date.now() });
							lastSig = sig;
						} else {
							writeEvent("heartbeat", { ts: Date.now() });
						}
						await sleep(INTERVAL_MS);
					}
					controller.close();
				} catch (err) {
					try {
						writeEvent("error", {
							message:
								err instanceof Error ? err.message : "stream error",
						});
					} catch {
						// already closed
					}
					controller.close();
				}
			},
		});

		return new Response(stream, {
			status: 200,
			headers: {
				"Content-Type": "text/event-stream; charset=utf-8",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				// Disables proxy buffering on Vercel + nginx-style PaaSes
				// so events flush immediately instead of after EOF.
				"X-Accel-Buffering": "no",
			},
		});
	} catch (err) {
		return toResponse(err);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function signature(
	fixes: Array<{ agentId: string; loggedAt: string; lat: number; lng: number }>,
): string {
	if (fixes.length === 0) return "0";
	return fixes
		.map((f) => `${f.agentId}@${f.loggedAt}:${f.lat.toFixed(6)},${f.lng.toFixed(6)}`)
		.sort()
		.join("|");
}
