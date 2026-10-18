CREATE TABLE "api_tokens" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "api_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"bootstrap" boolean DEFAULT false NOT NULL,
	"scope" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_pkey" PRIMARY KEY("id"),
	CONSTRAINT "api_tokens_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "api_tokens_scope_check" CHECK ("api_tokens"."scope" in ('read', 'operate'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_bootstrap_key" ON "api_tokens" USING btree ("bootstrap") WHERE "api_tokens"."bootstrap";