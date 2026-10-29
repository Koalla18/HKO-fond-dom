CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_stage" text,
	"to_stage" text,
	"text" text,
	"author_type" text DEFAULT 'system' NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"kind" text NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"title" text NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"contact_id" uuid,
	"request_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"assignee_id" uuid,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "applications_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_events_app_idx" ON "application_events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "application_events_created_idx" ON "application_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "applications_stage_created_idx" ON "applications" USING btree ("stage","created_at");--> statement-breakpoint
CREATE INDEX "applications_kind_stage_idx" ON "applications" USING btree ("kind","stage");--> statement-breakpoint
CREATE INDEX "applications_request_idx" ON "applications" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "applications_contact_idx" ON "applications" USING btree ("contact_id");