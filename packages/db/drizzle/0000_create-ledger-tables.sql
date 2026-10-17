CREATE TABLE "email_recipients" (
	"email_id" text NOT NULL,
	"address_hash" text NOT NULL,
	"address_masked" text NOT NULL,
	"status" text,
	"status_at" timestamp with time zone,
	"bounce_type" text,
	"bounce_sub_type" text,
	"sticky_signal" text,
	"sticky_signal_at" timestamp with time zone,
	"sticky_signal_svix_id" text,
	"soft_signal" text,
	"soft_signal_at" timestamp with time zone,
	"soft_signal_svix_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_recipients_pkey" PRIMARY KEY("email_id","address_hash"),
	CONSTRAINT "email_recipients_status_check" CHECK ("email_recipients"."status" in ('scheduled', 'sent', 'delivery_delayed', 'delivered', 'complained', 'suppressed', 'failed', 'bounced')),
	CONSTRAINT "email_recipients_sticky_signal_check" CHECK ("email_recipients"."sticky_signal" in ('hard_bounced', 'suppressed', 'complained')),
	CONSTRAINT "email_recipients_soft_signal_check" CHECK ("email_recipients"."soft_signal" in ('delivered', 'bounced'))
);
--> statement-breakpoint
CREATE TABLE "email_state" (
	"email_id" text NOT NULL,
	"status" text,
	"from_masked" text,
	"subject_masked" text,
	"open_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"first_opened_at" timestamp with time zone,
	"first_clicked_at" timestamp with time zone,
	"last_event_at" timestamp with time zone NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_state_pkey" PRIMARY KEY("email_id"),
	CONSTRAINT "email_state_status_check" CHECK ("email_state"."status" in ('scheduled', 'sent', 'delivery_delayed', 'delivered', 'complained', 'suppressed', 'failed', 'bounced'))
);
--> statement-breakpoint
CREATE TABLE "recipient_state" (
	"address_hash" text NOT NULL,
	"address_masked" text NOT NULL,
	"deliverability" text NOT NULL,
	"since" timestamp with time zone,
	"cause_email_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipient_state_pkey" PRIMARY KEY("address_hash"),
	CONSTRAINT "recipient_state_deliverability_check" CHECK ("recipient_state"."deliverability" in ('ok', 'soft_bouncing', 'hard_bounced', 'complained', 'suppressed'))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"svix_id" text NOT NULL,
	"type" text,
	"event_created_at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"email_id" text,
	"to_hashes" text[],
	"source" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "webhook_events_pkey" PRIMARY KEY("svix_id"),
	CONSTRAINT "webhook_events_source_check" CHECK ("webhook_events"."source" in ('live', 'simulated'))
);
--> statement-breakpoint
CREATE INDEX "email_recipients_address_hash_idx" ON "email_recipients" USING btree ("address_hash");--> statement-breakpoint
CREATE INDEX "webhook_events_email_id_event_created_at_idx" ON "webhook_events" USING btree ("email_id","event_created_at");