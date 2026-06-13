import { sql } from "drizzle-orm";
import {
	boolean,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", [
	"super_admin",
	"manager",
	"agent",
	"auditor",
]);

export const paymentMode = pgEnum("payment_mode", [
	"cash",
	"cheque",
	"bank_transfer",
	"upi",
]);

export const syncStatus = pgEnum("sync_status", [
	"pending",
	"synced",
	"error",
]);

// ---------------------------------------------------------------------------
// tenants - the root of multi-tenancy. Every other domain row points here.
// ---------------------------------------------------------------------------

export const tenants = pgTable(
	"tenants",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		slug: text("slug").notNull(),
		name: text("name").notNull(),
		isActive: boolean("is_active").notNull().default(true),
		settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [uniqueIndex("tenants_slug_uq").on(t.slug)],
);

// ---------------------------------------------------------------------------
// users - email is globally unique because we use email-routed login: the
// server looks up the tenant from the email. One person == one tenant.
// ---------------------------------------------------------------------------

export const users = pgTable(
	"users",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		tenantId: uuid("tenant_id")
			.notNull()
			.references(() => tenants.id, { onDelete: "restrict" }),
		email: text("email").notNull(),
		passwordHash: text("password_hash").notNull(),
		name: text("name").notNull(),
		// Human-friendly agent code used in receipt numbers, e.g. "A001"
		agentCode: text("agent_code"),
		role: userRole("role").notNull(),
		territoryId: uuid("territory_id"),
		isActive: boolean("is_active").notNull().default(true),
		lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("users_email_uq").on(t.email),
		uniqueIndex("users_tenant_agent_code_uq").on(t.tenantId, t.agentCode),
		index("users_tenant_role_idx").on(t.tenantId, t.role),
	],
);

// ---------------------------------------------------------------------------
// platform_users - operators of the VCTS platform itself. These users are NOT
// tenant users and must never be treated as tenant `super_admin`s.
// ---------------------------------------------------------------------------

export const platformUsers = pgTable(
	"platform_users",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		email: text("email").notNull(),
		passwordHash: text("password_hash").notNull(),
		name: text("name").notNull(),
		isActive: boolean("is_active").notNull().default(true),
		lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [uniqueIndex("platform_users_email_uq").on(t.email)],
);

// ---------------------------------------------------------------------------
// tenant_signup_requests - self-serve onboarding requests waiting for the
// applicant to prove control of the admin email. Tenant rows are only created
// after token verification, so abandoned signups don't pollute production data.
// ---------------------------------------------------------------------------

export const tenantSignupRequests = pgTable(
	"tenant_signup_requests",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		tenantSlug: text("tenant_slug").notNull(),
		tenantName: text("tenant_name").notNull(),
		adminEmail: text("admin_email").notNull(),
		adminName: text("admin_name").notNull(),
		passwordHash: text("password_hash").notNull(),
		tokenHash: text("token_hash").notNull(),
		settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		verifiedAt: timestamp("verified_at", { withTimezone: true }),
		consumedAt: timestamp("consumed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("tenant_signup_requests_token_hash_uq").on(t.tokenHash),
		index("tenant_signup_requests_slug_idx").on(t.tenantSlug),
		index("tenant_signup_requests_admin_email_idx").on(t.adminEmail),
	],
);

// ---------------------------------------------------------------------------
// customers - outstanding balance is a denormalised running total maintained
// by the collections write path (Phase 3). lat/lng is the registered location
// used for server-side geo-fencing.
// ---------------------------------------------------------------------------

export const customers = pgTable(
	"customers",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		tenantId: uuid("tenant_id")
			.notNull()
			.references(() => tenants.id, { onDelete: "restrict" }),
		code: text("code"),
		name: text("name").notNull(),
		address: text("address"),
		phone: text("phone"),
		email: text("email"),
		category: text("category"),
		lat: doublePrecision("lat").notNull(),
		lng: doublePrecision("lng").notNull(),
		geofenceRadiusM: integer("geofence_radius_m").notNull().default(100),
		outstandingBalance: doublePrecision("outstanding_balance").notNull().default(0),
		creditLimit: doublePrecision("credit_limit"),
		isOverdue: boolean("is_overdue").notNull().default(false),
		assignedAgentId: uuid("assigned_agent_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("customers_tenant_name_idx").on(t.tenantId, t.name),
		index("customers_tenant_agent_idx").on(t.tenantId, t.assignedAgentId),
		uniqueIndex("customers_tenant_code_uq").on(t.tenantId, t.code),
	],
);

// ---------------------------------------------------------------------------
// collections - the immutable ledger. No UPDATE to financial fields, ever.
// Reversals are new rows in collection_reversals.
// Idempotency: (tenant_id, client_uuid) is unique.
// ---------------------------------------------------------------------------

export const collections = pgTable(
	"collections",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		tenantId: uuid("tenant_id")
			.notNull()
			.references(() => tenants.id, { onDelete: "restrict" }),
		clientUuid: uuid("client_uuid").notNull(),
		customerId: uuid("customer_id")
			.notNull()
			.references(() => customers.id, { onDelete: "restrict" }),
		agentId: uuid("agent_id")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		amount: doublePrecision("amount").notNull(),
		paymentMode: paymentMode("payment_mode").notNull(),
		refNo: text("ref_no"),
		chequeDate: timestamp("cheque_date", { withTimezone: false, mode: "date" }),
		remarks: text("remarks"),
		collectionLat: doublePrecision("collection_lat").notNull(),
		collectionLng: doublePrecision("collection_lng").notNull(),
		gpsAccuracyM: doublePrecision("gps_accuracy_m"),
		collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
		receiptNo: text("receipt_no").notNull(),
		photoUrl: text("photo_url"),
		signatureUrl: text("signature_url"),
		supervisorReview: boolean("supervisor_review").notNull().default(false),
		syncStatus: syncStatus("sync_status").notNull().default("synced"),
		deviceId: text("device_id"),
		// Outstanding balance the agent's device believed the customer had at
		// the moment they hit "Submit". Filled in by the offline sync push
		// (Phase 6); compared against the *current* server-side balance to
		// detect drift > 10% which triggers a supervisor_reviews row.
		lastKnownOutstanding: doublePrecision("last_known_outstanding"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("collections_tenant_client_uuid_uq").on(t.tenantId, t.clientUuid),
		uniqueIndex("collections_tenant_receipt_no_uq").on(t.tenantId, t.receiptNo),
		index("collections_tenant_agent_collected_idx").on(
			t.tenantId,
			t.agentId,
			t.collectedAt,
		),
		index("collections_tenant_customer_collected_idx").on(
			t.tenantId,
			t.customerId,
			t.collectedAt,
		),
	],
);

// ---------------------------------------------------------------------------
// collection_reversals - creates the opposite-sign ledger entry; original
// collection row is preserved untouched.
// ---------------------------------------------------------------------------

export const collectionReversals = pgTable(
	"collection_reversals",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		tenantId: uuid("tenant_id")
			.notNull()
			.references(() => tenants.id, { onDelete: "restrict" }),
		originalCollectionId: uuid("original_collection_id")
			.notNull()
			.references(() => collections.id, { onDelete: "restrict" }),
		amount: doublePrecision("amount").notNull(),
		reason: text("reason").notNull(),
		authorisedBy: uuid("authorised_by")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		reversedAt: timestamp("reversed_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("reversals_tenant_original_idx").on(t.tenantId, t.originalCollectionId),
	],
);

// ---------------------------------------------------------------------------
// receipt_counters - per-tenant, per-agent, per-fiscal-year sequence used
// to generate receipt numbers like "acme/A001/FY26/00042".
// ---------------------------------------------------------------------------

export const receiptCounters = pgTable(
	"receipt_counters",
	{
		tenantId: uuid("tenant_id")
			.notNull()
			.references(() => tenants.id, { onDelete: "restrict" }),
		agentId: uuid("agent_id")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		fiscalYear: integer("fiscal_year").notNull(),
		nextSeq: integer("next_seq").notNull().default(1),
	},
	(t) => [
		uniqueIndex("receipt_counters_pk").on(t.tenantId, t.agentId, t.fiscalYear),
	],
);

// ---------------------------------------------------------------------------
// location_logs - periodic GPS fix from each agent. Append-only, heavy table.
//
// Phase 7 adds:
//   - `client_uuid` so the batch endpoint can dedupe a retried push without
//     a separate dedup table; (tenant, agent, client_uuid) is unique.
//   - `source` so we can distinguish auto-collected fixes from manual ones
//     (e.g. the GPS pin captured at collection time).
// ---------------------------------------------------------------------------

export const locationLogs = pgTable(
	"location_logs",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		tenantId: uuid("tenant_id")
			.notNull()
			.references(() => tenants.id, { onDelete: "restrict" }),
		agentId: uuid("agent_id")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		clientUuid: uuid("client_uuid"),
		lat: doublePrecision("lat").notNull(),
		lng: doublePrecision("lng").notNull(),
		accuracyM: doublePrecision("accuracy_m"),
		batteryPct: integer("battery_pct"),
		// Where the fix came from on the device. Free-form so additional
		// sources (e.g. "passive", "fused") don't need a migration. Today:
		//   "tracker"     - periodic foreground-service fix
		//   "collection"  - one-shot GPS captured at collection submit time
		source: text("source").notNull().default("tracker"),
		loggedAt: timestamp("logged_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("location_logs_tenant_agent_logged_idx").on(
			t.tenantId,
			t.agentId,
			t.loggedAt,
		),
		uniqueIndex("location_logs_tenant_agent_client_uuid_uq").on(
			t.tenantId,
			t.agentId,
			t.clientUuid,
		),
	],
);

// ---------------------------------------------------------------------------
// customer_visits - sustained-presence visit rows derived by the cron worker
// from `location_logs`. One row per (agent, customer, contiguous fence
// presence window). dwell_seconds is the inclusive presence duration.
//
// We keep visits as a separate, derived table (not a view) so the manager
// dashboard (Phase 9) can render it cheaply and we can mark a visit as
// "validated" once a manager has signed off on a collection that happened
// during that window.
// ---------------------------------------------------------------------------

export const customerVisits = pgTable(
	"customer_visits",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		tenantId: uuid("tenant_id")
			.notNull()
			.references(() => tenants.id, { onDelete: "restrict" }),
		customerId: uuid("customer_id")
			.notNull()
			.references(() => customers.id, { onDelete: "restrict" }),
		agentId: uuid("agent_id")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
		endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
		dwellSeconds: integer("dwell_seconds").notNull(),
		// "location_logs" - reconstructed from sustained presence (3+ min)
		// "collection"    - synthesised from a successful collection write
		source: text("source").notNull().default("location_logs"),
		// Linked collection if this visit overlaps with a collection write.
		// Nullable because most agent visits are scouting / payment-attempt
		// rather than a closed collection.
		collectionId: uuid("collection_id").references(() => collections.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("customer_visits_tenant_agent_customer_started_uq").on(
			t.tenantId,
			t.agentId,
			t.customerId,
			t.startedAt,
		),
		index("customer_visits_tenant_agent_started_idx").on(
			t.tenantId,
			t.agentId,
			t.startedAt,
		),
		index("customer_visits_tenant_customer_started_idx").on(
			t.tenantId,
			t.customerId,
			t.startedAt,
		),
	],
);

// ---------------------------------------------------------------------------
// audit_trail - append-only, HMAC-chained log of every privileged action.
// prev_hmac + this_hmac let us detect any tampering with history.
// ---------------------------------------------------------------------------

export const auditTrail = pgTable(
	"audit_trail",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		tenantId: uuid("tenant_id")
			.notNull()
			.references(() => tenants.id, { onDelete: "restrict" }),
		seq: integer("seq").notNull(),
		actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
		action: text("action").notNull(),
		entityType: text("entity_type").notNull(),
		entityId: text("entity_id"),
		beforeJson: jsonb("before_json"),
		afterJson: jsonb("after_json"),
		ip: text("ip"),
		deviceId: text("device_id"),
		userAgent: text("user_agent"),
		prevHmac: text("prev_hmac"),
		hmac: text("hmac").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("audit_tenant_seq_uq").on(t.tenantId, t.seq),
		index("audit_tenant_entity_idx").on(t.tenantId, t.entityType, t.entityId),
		index("audit_tenant_actor_idx").on(t.tenantId, t.actorId),
	],
);

// ---------------------------------------------------------------------------
// supervisor_reviews - rows raised by the offline sync engine when something
// about a replayed collection needs a human eye (balance drift, late replay,
// repeated fence violations). The Phase 9 web admin will surface these; for
// now the table just exists so Phase 6 can write into it.
// ---------------------------------------------------------------------------

export const supervisorReviews = pgTable(
	"supervisor_reviews",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		tenantId: uuid("tenant_id")
			.notNull()
			.references(() => tenants.id, { onDelete: "restrict" }),
		collectionId: uuid("collection_id")
			.notNull()
			.references(() => collections.id, { onDelete: "restrict" }),
		// Free-form code so we can extend without a migration. Today:
		//   "balance_drift" - >10% delta between client + server outstanding
		//   "stale_replay"  - collection was queued > N days before sync
		reason: text("reason").notNull(),
		payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		resolvedBy: uuid("resolved_by").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("supervisor_reviews_tenant_created_idx").on(t.tenantId, t.createdAt),
		index("supervisor_reviews_tenant_collection_idx").on(
			t.tenantId,
			t.collectionId,
		),
	],
);

// ---------------------------------------------------------------------------
// sync_queue - server-side mirror of the Android queue, useful for diagnosing
// stuck submissions. Populated in Phase 6.
// ---------------------------------------------------------------------------

export const syncQueue = pgTable(
	"sync_queue",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		tenantId: uuid("tenant_id")
			.notNull()
			.references(() => tenants.id, { onDelete: "restrict" }),
		agentId: uuid("agent_id")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		payloadType: text("payload_type").notNull(),
		payloadJson: jsonb("payload_json").notNull(),
		attempts: integer("attempts").notNull().default(0),
		lastError: text("last_error"),
		syncedAt: timestamp("synced_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("sync_queue_tenant_agent_idx").on(t.tenantId, t.agentId),
	],
);

// ---------------------------------------------------------------------------
// refresh_tokens - server-side tracking of refresh tokens so we can revoke
// on logout / password change without waiting for expiry.
// ---------------------------------------------------------------------------

export const refreshTokens = pgTable(
	"refresh_tokens",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		tenantId: uuid("tenant_id")
			.notNull()
			.references(() => tenants.id, { onDelete: "restrict" }),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		tokenHash: text("token_hash").notNull(),
		deviceId: text("device_id"),
		// Phase 10 (Track B): SHA-256 hex of the device's stable install UUID.
		// Set when the client passes `installId` at login; used at refresh time
		// to reject token replay from a different device. Nullable so refresh
		// rows created before Track B keep working until they expire / rotate.
		deviceFingerprint: text("device_fingerprint"),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("refresh_tokens_hash_uq").on(t.tokenHash),
		index("refresh_tokens_user_idx").on(t.userId),
	],
);

// collection_integrations - per-tenant Collection Integration config.
export const collectionIntegrationMode = pgEnum("collection_integration_mode", [
	"webview",
	"offline",
]);

export const collectionIntegrations = pgTable("collection_integrations", {
	tenantId: uuid("tenant_id")
		.primaryKey()
		.references(() => tenants.id, { onDelete: "cascade" }),
	mode: collectionIntegrationMode("mode").notNull(),
	webviewUrl: text("webview_url"),
	jsonSchema: jsonb("json_schema"),
	uiSchema: jsonb("ui_schema"),
	directusCollection: text("directus_collection"),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Type exports for use in app code
// ---------------------------------------------------------------------------

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
export type SupervisorReview = typeof supervisorReviews.$inferSelect;
export type NewSupervisorReview = typeof supervisorReviews.$inferInsert;
export type LocationLog = typeof locationLogs.$inferSelect;
export type NewLocationLog = typeof locationLogs.$inferInsert;
export type CustomerVisit = typeof customerVisits.$inferSelect;
export type NewCustomerVisit = typeof customerVisits.$inferInsert;
export type UserRole = (typeof userRole.enumValues)[number];
