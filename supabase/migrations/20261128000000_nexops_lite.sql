-- NEXOPS 라이트 스키마 (자동 생성: NEXOPS 스키마 정보 + 마이그레이션 함수)
-- Supabase SQL Editor에 통째로 붙여 넣고 Run. 여러 번 돌려도 안전하게 IF NOT EXISTS로 만든다.
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public."ad_campaigns" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "campaign_id" text,
  "campaign_name" text,
  "ad_type" text default 'cpc',
  "product_id" uuid,
  "ad_date" date not null,
  "impressions" integer default 0,
  "clicks" integer default 0,
  "conversions" integer default 0,
  "budget" numeric,
  "spent_amount" numeric not null,
  "billable_amount" numeric,
  "vat_amount" numeric default 0,
  "roas" numeric,
  "source" text default 'manual',
  "import_batch_id" uuid,
  "notes" text,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  "business_id" uuid,
  primary key ("id")
);
alter table public."ad_campaigns" enable row level security;
create unique index if not exists "uq_ad_batch_campaign_date" on public."ad_campaigns" (import_batch_id, campaign_id, ad_date) WHERE import_batch_id IS NOT NULL AND campaign_id IS NOT NULL;

create table if not exists public."ad_setting_change" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid not null,
  "campaign_id" text not null,
  "setting_key" text not null,
  "setting_value" numeric not null,
  "setting_unit" text not null,
  "origin" text not null,
  "effective_on" date not null,
  "effective_precision" text not null,
  "first_observed_at" timestamptz,
  "effective_at" timestamptz,
  "note" text,
  "idempotency_key" text not null,
  "created_at" timestamptz default now(),
  primary key ("id")
);
alter table public."ad_setting_change" enable row level security;

create table if not exists public."ai_usage_log" (
  "id" uuid default gen_random_uuid() not null,
  "agent" text,
  "model" text not null,
  "input_tokens" integer default 0 not null,
  "output_tokens" integer default 0 not null,
  "cost_usd" numeric default 0 not null,
  "month_key" text not null,
  "created_at" timestamptz default now(),
  "run_id" uuid,
  "user_id" text,
  "business_id" uuid,
  "stage" text,
  "success" boolean,
  "duration_ms" integer,
  "attempts" integer,
  "cost_pool" text,
  primary key ("id")
);
alter table public."ai_usage_log" enable row level security;

create table if not exists public."auto_import_receipts" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid not null,
  "import_kind" text not null,
  "import_date" date not null,
  "hash_basis" text not null,
  "content_sha256" text not null,
  "batch_id" uuid not null,
  "file_name" text not null,
  "row_count" integer not null,
  "status" text default 'processing' not null,
  "response" jsonb,
  "indeterminate_stage" text,
  "claimed_at" timestamptz default clock_timestamp() not null,
  "completed_at" timestamptz,
  "indeterminate_at" timestamptz,
  primary key ("id")
);
alter table public."auto_import_receipts" enable row level security;

create table if not exists public."business_settings" (
  "business_id" uuid not null,
  "user_id" text not null,
  "default_commission_rate" numeric default 0.108 not null,
  "default_return_rate" numeric default 0.08 not null,
  "inventory_alert_threshold_days" integer default 14 not null,
  "inventory_notifications_enabled" boolean default true not null,
  "import_column_mappings" jsonb default '{}'::jsonb not null,
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null,
  "default_fulfillment_fee" integer,
  "fulfillment_fee_waived_until" date,
  primary key ("business_id")
);
alter table public."business_settings" enable row level security;
create unique index if not exists "lite_uq_business_settings_business_id" on public."business_settings" ("business_id");

create table if not exists public."businesses" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_name" varchar not null,
  "business_number" varchar,
  "representative" varchar,
  "business_type" varchar,
  "business_category" varchar,
  "address" text,
  "is_default" boolean default false not null,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  "coupang_vendor_id" text,
  primary key ("id")
);
alter table public."businesses" enable row level security;
create unique index if not exists "uniq_businesses_user_vendor" on public."businesses" (user_id, coupang_vendor_id) WHERE coupang_vendor_id IS NOT NULL;

create table if not exists public."coupang_imports" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "import_type" text not null,
  "file_name" text not null,
  "file_size" integer,
  "row_count" integer default 0,
  "success_count" integer default 0,
  "error_count" integer default 0,
  "status" text default 'pending',
  "error_message" text,
  "summary" jsonb,
  "created_at" timestamptz default now(),
  "completed_at" timestamptz,
  "business_id" uuid,
  primary key ("id")
);
alter table public."coupang_imports" enable row level security;

create table if not exists public."coupang_settlement_reports" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid,
  "vendor_id" text not null,
  "settlement_group_key" text not null,
  "settlement_cycle" text,
  "settlement_ratio" numeric,
  "final_settlement_amount" numeric,
  "settlement_date" timestamptz,
  "period_start" timestamptz,
  "period_end" timestamptz,
  "total_sales_amount" numeric,
  "total_refunded_amount" numeric,
  "total_take_rate_amount_with_vat" numeric,
  "total_seller_discount" numeric,
  "total_ad_sales_deduction_amount" numeric,
  "total_fulfillment_fee_deduction_amount" numeric,
  "total_warehousing_fee_deduction_amount" numeric,
  "total_storage_fee_deduction_amount" numeric,
  "total_subscription_fee_deduction_amount" numeric,
  "total_business_insights_deduction_amount" numeric,
  "total_final_cfs_fee_deduction_amount" numeric,
  "total_cfs_inventory_compensation_amount" numeric,
  "detail_json" jsonb,
  "collected_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  primary key ("id")
);
alter table public."coupang_settlement_reports" enable row level security;

create table if not exists public."coupang_wallet_events" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid,
  "vendor_id" text not null,
  "wallet_event_id" text not null,
  "wallet_event_type" text,
  "payment_date" timestamptz,
  "amount" numeric,
  "collected_at" timestamptz default now(),
  primary key ("id")
);
alter table public."coupang_wallet_events" enable row level security;

create table if not exists public."expense_vendors" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid,
  "name" text not null,
  "business_number" text,
  "contact" text,
  "default_category" text,
  "default_payment_method" text,
  "is_active" boolean default true not null,
  "notes" text,
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null,
  primary key ("id")
);
alter table public."expense_vendors" enable row level security;

create table if not exists public."expenses" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "expense_date" date not null,
  "category" text not null,
  "description" text,
  "amount" numeric not null,
  "vat_amount" numeric default 0,
  "payment_method" text default 'card',
  "receipt_url" text,
  "notes" text,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  "business_id" uuid,
  "receipt_path" text,
  "vendor_id" uuid,
  primary key ("id")
);
alter table public."expenses" enable row level security;

create table if not exists public."focus_ad_daily" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid not null,
  "campaign_id" text not null,
  "metric_date" date not null,
  "ad_attributed_units" integer,
  "ad_attributed_sales" numeric,
  "ad_attributed_orders" integer,
  "delivered_ad_cost" numeric,
  "impressions" integer,
  "clicks" integer,
  "platform_roas" numeric,
  "first_observed_at" timestamptz not null,
  "last_observed_at" timestamptz not null,
  "extractor_version" text default 'v1' not null,
  "source" text default 'adcenter_tablemetric' not null,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  primary key ("id")
);
alter table public."focus_ad_daily" enable row level security;

create table if not exists public."focus_campaign_catalog" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid not null,
  "campaign_id" text not null,
  "name" text,
  "goal_type" text,
  "objective" text,
  "is_active" boolean,
  "is_auto_product_selection" boolean default false not null,
  "budget" numeric,
  "roas_target" numeric,
  "created_at_source" timestamptz,
  "harvested_at" timestamptz default now() not null,
  "updated_at" timestamptz default now(),
  primary key ("id")
);
alter table public."focus_campaign_catalog" enable row level security;

create table if not exists public."focus_daily_note" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid not null,
  "coupang_exposure_id" text not null,
  "metric_date" date not null,
  "note" text not null,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  primary key ("id")
);
alter table public."focus_daily_note" enable row level security;

create table if not exists public."focus_product_status_events" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid not null,
  "focus_product_id" uuid not null,
  "status" text not null,
  "effective_at" timestamptz default now() not null,
  "note" text,
  "idempotency_key" text not null,
  "created_at" timestamptz default now(),
  primary key ("id")
);
alter table public."focus_product_status_events" enable row level security;
create unique index if not exists "lite_uq_focus_product_status_events_business_id_focus_produc" on public."focus_product_status_events" ("business_id", "focus_product_id", "idempotency_key");

create table if not exists public."focus_products" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid not null,
  "product_id" uuid,
  "coupang_exposure_id" text not null,
  "campaign_id" text not null,
  "label" text,
  "is_active" boolean default true not null,
  "valid_from" date default CURRENT_DATE not null,
  "valid_to" date,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  primary key ("id")
);
alter table public."focus_products" enable row level security;
create unique index if not exists "lite_uq_focus_products_business_id_coupang_exposure_id_campa" on public."focus_products" ("business_id", "coupang_exposure_id", "campaign_id", "valid_from");

create table if not exists public."focus_rank_daily" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid not null,
  "target_id" uuid not null,
  "metric_date" date not null,
  "rank" integer,
  "page" integer,
  "position_in_page" integer,
  "page_size" integer,
  "found" boolean,
  "scan_depth" integer,
  "source" text not null,
  "source_ranking_item_id" uuid,
  "observed_at" timestamptz default now() not null,
  "updated_at" timestamptz default now(),
  primary key ("id")
);
alter table public."focus_rank_daily" enable row level security;
create unique index if not exists "lite_uq_focus_rank_daily_business_id_target_id_metric_date_s" on public."focus_rank_daily" ("business_id", "target_id", "metric_date", "source");

create table if not exists public."focus_rank_targets" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid not null,
  "focus_product_id" uuid not null,
  "vendor_item_id" text not null,
  "option_label" text,
  "keyword" text not null,
  "is_active" boolean default true not null,
  "valid_from" date default CURRENT_DATE not null,
  "valid_to" date,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  primary key ("id")
);
alter table public."focus_rank_targets" enable row level security;

create table if not exists public."inventory" (
  "id" uuid default extensions.uuid_generate_v4() not null,
  "product_id" uuid not null,
  "current_stock" integer default 0,
  "safety_stock" integer default 0,
  "reorder_point" integer default 0,
  "avg_daily_sales" numeric default 0,
  "last_inbound_at" timestamptz,
  "updated_at" timestamptz default now(),
  "coupang_stock" integer,
  "storage_fee_monthly" numeric,
  "depletion_date" date,
  "reorder_date" date,
  "health_grade" text,
  "last_health_sync" timestamptz,
  primary key ("id")
);
alter table public."inventory" enable row level security;
create unique index if not exists "lite_uq_inventory_product_id" on public."inventory" ("product_id");

create table if not exists public."inventory_health_history" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid,
  "product_id" uuid not null,
  "sku" text,
  "coupang_stock" integer default 0 not null,
  "storage_fee_monthly" numeric default 0,
  "depletion_date" date,
  "health_grade" text,
  "import_batch_id" uuid,
  "snapshot_date" date default CURRENT_DATE not null,
  "created_at" timestamptz default now(),
  primary key ("id")
);
alter table public."inventory_health_history" enable row level security;

create table if not exists public."inventory_movements" (
  "id" uuid default gen_random_uuid() not null,
  "inventory_id" uuid not null,
  "product_id" uuid not null,
  "movement_type" varchar not null,
  "quantity" integer not null,
  "reference_no" varchar,
  "unit_cost" numeric,
  "notes" text,
  "movement_date" date default CURRENT_DATE not null,
  "created_at" timestamptz default now(),
  primary key ("id")
);
alter table public."inventory_movements" enable row level security;
create unique index if not exists "uq_inventory_movements_coupang_api_sale" on public."inventory_movements" (reference_no) WHERE reference_no LIKE 'API-SALE-%';
create unique index if not exists "uq_inventory_movements_manual_sale" on public."inventory_movements" (reference_no) WHERE movement_type = 'outbound'
    AND reference_no LIKE 'SALE-%';

create table if not exists public."inventory_state" (
  "product_id" uuid not null,
  "qty" numeric default 0 not null,
  "total_value" numeric default 0 not null,
  "avg_cost_krw" numeric default 0 not null,
  "updated_at" timestamptz default now() not null,
  primary key ("product_id")
);
alter table public."inventory_state" enable row level security;
create unique index if not exists "lite_uq_inventory_state_product_id" on public."inventory_state" ("product_id");

create table if not exists public."keyword_rankings" (
  "id" uuid default gen_random_uuid() not null,
  "keyword" text not null,
  "collected_at" timestamptz default now() not null,
  "product_count" integer default 0 not null,
  "source" text default 'coupang_search' not null,
  "created_at" timestamptz default now(),
  "clusters" jsonb,
  "clusters_analyzed_at" timestamptz,
  "user_id" text,
  "rank_sales_analysis" jsonb,
  "rank_sales_analyzed_at" timestamptz,
  "ad_products" jsonb,
  "search_context" text,
  primary key ("id")
);
alter table public."keyword_rankings" enable row level security;

create table if not exists public."manual_inventory_operation_receipts" (
  "operation_id" uuid not null,
  "user_id" text not null,
  "business_id" uuid not null,
  "request_fingerprint" text not null,
  "result" jsonb,
  "created_at" timestamptz default now() not null,
  primary key ("operation_id")
);
alter table public."manual_inventory_operation_receipts" enable row level security;

create table if not exists public."owner_api_tokens" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "token_hash" text not null,
  "label" text default 'Desktop Assistant' not null,
  "created_at" timestamptz default now() not null,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  primary key ("id")
);
alter table public."owner_api_tokens" enable row level security;

create table if not exists public."product_costs" (
  "id" uuid default extensions.uuid_generate_v4() not null,
  "product_id" uuid not null,
  "supplier_id" uuid,
  "unit_cost" integer default 0,
  "selling_price" integer not null,
  "fulfillment_fee" integer default 0,
  "fulfillment_vat" integer default 0,
  "commission_rate" numeric not null,
  "commission_amount" integer default 0,
  "commission_vat" integer default 0,
  "vat" integer default 0,
  "margin" integer default 0,
  "margin_rate" numeric default 0,
  "min_roas" numeric default 0,
  "return_rate" numeric default 0.08,
  "return_pickup_fee" integer default 0,
  "return_pickup_vat" integer default 0,
  "return_restock_fee" integer default 0,
  "return_restock_vat" integer default 0,
  "sim_quantity" integer default 100,
  "total_revenue" integer default 0,
  "total_cost" integer default 0,
  "total_fulfillment" integer default 0,
  "total_commission" integer default 0,
  "total_return_cost" integer default 0,
  "total_vat" integer default 0,
  "total_margin" integer default 0,
  "total_margin_rate" numeric default 0,
  "total_min_roas" numeric default 0,
  "option_name" varchar,
  "quantity_per_set" integer default 1,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  "source_context" jsonb,
  "approved_at" timestamptz,
  primary key ("id")
);
alter table public."product_costs" enable row level security;

create table if not exists public."product_name_history" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid,
  "product_id" uuid not null,
  "product_name_record_id" uuid,
  "previous_name" text,
  "new_name" text not null,
  "source" text not null,
  "wing_applied_at" timestamptz,
  "created_at" timestamptz default now(),
  primary key ("id")
);
alter table public."product_name_history" enable row level security;

create table if not exists public."product_names" (
  "id" uuid default extensions.uuid_generate_v4() not null,
  "product_id" uuid,
  "user_id" text not null,
  "brand_name" varchar not null,
  "core_keyword" varchar not null,
  "market_size" varchar default 'small' not null,
  "target_keyword" varchar,
  "sub_keywords" jsonb,
  "screenshots" jsonb,
  "keyword_analysis" jsonb,
  "generated_names" jsonb,
  "selected_name" varchar,
  "search_tags" jsonb,
  "excluded_keywords" jsonb,
  "product_attributes" jsonb,
  "status" varchar default 'draft',
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  "platform" text default 'coupang' not null,
  primary key ("id")
);
alter table public."product_names" enable row level security;

create table if not exists public."product_price_history" (
  "id" uuid default gen_random_uuid() not null,
  "product_id" uuid not null,
  "field_name" text not null,
  "value" numeric not null,
  "effective_date" date not null,
  "created_at" timestamptz default now(),
  primary key ("id")
);
alter table public."product_price_history" enable row level security;

create table if not exists public."products" (
  "id" uuid default extensions.uuid_generate_v4() not null,
  "seq" integer,
  "sku" varchar,
  "keyword" varchar,
  "product_name" varchar,
  "category_path" varchar,
  "search_tags" text[],
  "commission_rate" numeric,
  "sale_type" varchar default '로켓그로스',
  "status" varchar default 'draft',
  "rating" numeric,
  "coupang_product_url" text,
  "options" jsonb,
  "notes" text,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  "purpose" varchar default 'sourcing' not null,
  "user_id" text,
  "weekly_avg_sales" numeric,
  "inventory_weeks" numeric,
  "lead_time_weeks" numeric default 2,
  "purchase_required" integer,
  "item_winner" boolean default false,
  "barcode" text,
  "coupang_option_id" text,
  "coupang_product_id" text,
  "coupang_display_name" text,
  "vendor_product_id" text,
  "option_name" text,
  "condition_value" text,
  "return_resale_info" text,
  "coupang_exposure_id" text,
  "fulfillment_fee_default" numeric,
  "unit_cost_default" numeric,
  "seller_discount_coupon" numeric default 0,
  "business_id" uuid,
  "is_refurbished" boolean default false,
  "product_grade" varchar,
  "parent_product_id" uuid,
  "coupang_sku_id" varchar,
  "sales_status" varchar default 'active',
  "fulfillment_fee_benefit_until" date,
  "source_watchlist_id" uuid,
  "content_handoff" jsonb,
  "pack_qty" integer,
  "season_key" text,
  "autofill_meta" jsonb default '{}'::jsonb not null,
  "stock_role" text,
  "stock_key" text,
  primary key ("id")
);
alter table public."products" enable row level security;
create unique index if not exists "uniq_products_user_seq" on public."products" (user_id, seq) WHERE seq IS NOT NULL;
create unique index if not exists "uniq_products_user_sku" on public."products" (user_id, sku) WHERE sku IS NOT NULL;
create unique index if not exists "uq_products_business_coupang_option" on public."products" (business_id, coupang_option_id) WHERE purpose = 'product' AND coupang_option_id IS NOT NULL;

create table if not exists public."purchase_import_receipts" (
  "import_batch_id" uuid not null,
  "actor_user_id" text not null,
  "business_id" uuid not null,
  "idempotency_key" text not null,
  "request_payload" jsonb default '{}'::jsonb not null,
  "purchase_ids" uuid[] default '{}' not null,
  "inserted_count" integer,
  "response" jsonb,
  "created_at" timestamptz default now() not null,
  primary key ("import_batch_id")
);
alter table public."purchase_import_receipts" enable row level security;

create table if not exists public."purchase_inventory_effect_receipts" (
  "movement_id" uuid not null,
  "purchase_id" uuid not null,
  "operation_id" uuid not null,
  "product_id" uuid not null,
  "inventory_id" uuid not null,
  "effect" text not null,
  "quantity" integer not null,
  "unit_cost_krw" numeric not null,
  "resulting_stock" numeric not null,
  "resulting_qty" numeric not null,
  "resulting_value" numeric not null,
  "resulting_avg" numeric not null,
  "created_at" timestamptz default clock_timestamp() not null,
  primary key ("movement_id")
);
alter table public."purchase_inventory_effect_receipts" enable row level security;

create table if not exists public."purchase_mutation_receipts" (
  "operation_id" uuid not null,
  "actor_user_id" text not null,
  "business_id" uuid not null,
  "purchase_id" uuid not null,
  "action" text not null,
  "request_payload" jsonb default '{}'::jsonb not null,
  "response" jsonb,
  "created_at" timestamptz default now() not null,
  primary key ("operation_id")
);
alter table public."purchase_mutation_receipts" enable row level security;

create table if not exists public."purchases" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "supplier_id" uuid,
  "product_id" uuid,
  "po_number" text,
  "order_date" date not null,
  "arrival_date" date,
  "quantity" integer not null,
  "unit_price" numeric not null,
  "currency" text default 'KRW',
  "exchange_rate" numeric default 1,
  "shipping_cost" numeric default 0,
  "total_amount_krw" numeric not null,
  "payment_status" text default 'unpaid',
  "payment_date" date,
  "status" text default 'ordered',
  "notes" text,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  "additional_cost" numeric default 0,
  "domestic_shipping" numeric default 0,
  "unit_cost_krw" numeric,
  "product_name_memo" text,
  "business_id" uuid,
  "payment1_product_krw" numeric default 0,
  "payment1_vat" numeric default 0,
  "payment1_total" numeric default 0,
  "payment1_date" date,
  "payment1_status" text default 'unpaid',
  "inspection_fee" numeric default 0,
  "labeling_fee" numeric default 0,
  "packaging_fee" numeric default 0,
  "customs_doc_fee" numeric default 0,
  "agency_fee" numeric default 0,
  "payment2_total" numeric default 0,
  "payment2_date" date,
  "payment2_status" text default 'unpaid',
  "customs_duty" numeric default 0,
  "customs_vat" numeric default 0,
  "payment3_total" numeric default 0,
  "payment3_date" date,
  "payment3_status" text default 'unpaid',
  "lead_time_weeks" integer,
  "expected_arrival_date" date,
  "payment2_vat" numeric default 0,
  "order_account_business_id" uuid,
  primary key ("id")
);
alter table public."purchases" enable row level security;

create table if not exists public."registration_editor_data" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "pdp_job_id" uuid not null,
  "sections_data" jsonb default '{}'::jsonb not null,
  "layout_assignments" jsonb default '{}'::jsonb not null,
  "updated_at" timestamptz default now(),
  primary key ("id")
);
alter table public."registration_editor_data" enable row level security;
create unique index if not exists "lite_uq_registration_editor_data_pdp_job_id" on public."registration_editor_data" ("pdp_job_id");

create table if not exists public."registration_pdp_jobs" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid,
  "draft_id" uuid,
  "spec_sheet" jsonb default '{}'::jsonb not null,
  "source_images" jsonb default '{}'::jsonb not null,
  "image_model" text default 'gpt-image-2' not null,
  "image_quality" text default 'high' not null,
  "mode" text default 'pro' not null,
  "analysis" jsonb,
  "research_result" jsonb,
  "design_prompts" jsonb,
  "section_plan" jsonb,
  "copy_sections" jsonb,
  "section_images" jsonb,
  "final_html" text,
  "current_step" text default 'pending' not null,
  "progress" integer default 0 not null,
  "error" text,
  "cost_usd" numeric default 0,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  "generation_track" text default 'standard' not null,
  "corpus_version" text,
  "cost_pool" text,
  primary key ("id")
);
alter table public."registration_pdp_jobs" enable row level security;

create table if not exists public."registration_thumbnail_jobs" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid,
  "draft_id" uuid,
  "source_images" jsonb default '{}'::jsonb not null,
  "product_name" text,
  "category_hint" text,
  "image_model" text default 'gpt-image-2' not null,
  "image_quality" text default 'medium' not null,
  "vision_analysis" jsonb,
  "cuts" jsonb,
  "selected_cut" text,
  "status" text default 'pending' not null,
  "progress" integer default 0 not null,
  "error" text,
  "cost_usd" numeric default 0,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  primary key ("id")
);
alter table public."registration_thumbnail_jobs" enable row level security;

create table if not exists public."safe_sales_gap_backfill_receipts" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid not null,
  "import_date" date not null,
  "hash_basis" text default 'xlsx_raw_bytes_v1' not null,
  "content_sha256" text not null,
  "import_batch_id" uuid not null,
  "file_name" text not null,
  "file_size" integer not null,
  "row_count" integer not null,
  "mode" text default 'insert_only_gap_backfill' not null,
  "derived_state" text default 'not_applied' not null,
  "created_at" timestamptz default clock_timestamp() not null,
  primary key ("id")
);
alter table public."safe_sales_gap_backfill_receipts" enable row level security;

create table if not exists public."sales_transactions" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "product_id" uuid,
  "option_id" text,
  "order_number" text,
  "order_date" date not null,
  "order_quantity" integer default 1 not null,
  "selling_price" numeric not null,
  "total_amount" numeric not null,
  "unit_cost" numeric,
  "shipping_fee" numeric default 0,
  "commission_amount" numeric,
  "exchange_rate" numeric,
  "status" text default 'confirmed',
  "source" text default 'manual',
  "import_batch_id" uuid,
  "notes" text,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  "product_type" text,
  "category" text,
  "option_name" text,
  "item_winner_rate" numeric,
  "gross_amount" numeric,
  "gross_quantity" integer,
  "cancel_amount" numeric default 0,
  "cancel_quantity" integer default 0,
  "coupon_discount" numeric default 0,
  "commission_rate" numeric,
  "commission_fee" numeric default 0,
  "commission_vat" numeric default 0,
  "settlement_amount" numeric,
  "fulfillment_fee" numeric default 0,
  "fulfillment_vat" numeric default 0,
  "payout_amount" numeric,
  "vat" numeric default 0,
  "margin" numeric,
  "business_id" uuid,
  "coupon_allocated" numeric,
  primary key ("id")
);
alter table public."sales_transactions" enable row level security;
create unique index if not exists "uq_sales_tx_batch_order" on public."sales_transactions" (import_batch_id, order_number) WHERE import_batch_id IS NOT NULL AND order_number IS NOT NULL;
create unique index if not exists "uq_sales_tx_coupang_api_order" on public."sales_transactions" (business_id, order_number) WHERE source = 'coupang_api' AND order_number IS NOT NULL;

create table if not exists public."settlements" (
  "id" uuid default extensions.uuid_generate_v4() not null,
  "product_id" uuid not null,
  "period_start" date not null,
  "period_end" date not null,
  "sales_quantity" integer default 0,
  "total_revenue" integer default 0,
  "total_cost" integer default 0,
  "total_fulfillment" integer default 0,
  "total_fulfillment_vat" integer default 0,
  "total_commission" integer default 0,
  "total_commission_vat" integer default 0,
  "total_return_pickup" integer default 0,
  "total_return_restock" integer default 0,
  "total_vat" integer default 0,
  "total_margin" integer default 0,
  "total_margin_rate" numeric default 0,
  "ad_cost" integer default 0,
  "net_profit" integer,
  "verified" boolean default false,
  "created_at" timestamptz default now(),
  "user_id" text,
  "settlement_type" text default 'period',
  "source" text default 'manual',
  "import_batch_id" uuid,
  "business_id" uuid,
  "aggregation_key" text,
  primary key ("id")
);
alter table public."settlements" enable row level security;
create unique index if not exists "lite_uq_settlements_aggregation_key" on public."settlements" ("aggregation_key");
create unique index if not exists "uq_settlements_aggregation_key" on public."settlements" (aggregation_key);

create table if not exists public."sourcing_registration_drafts" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" text not null,
  "business_id" uuid,
  "keyword" text,
  "sourcing_product_id" uuid,
  "form" jsonb default '{}'::jsonb not null,
  "status" text default 'draft' not null,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  primary key ("id")
);
alter table public."sourcing_registration_drafts" enable row level security;
create unique index if not exists "uniq_reg_draft_sourcing_product" on public."sourcing_registration_drafts" (user_id, sourcing_product_id) WHERE sourcing_product_id IS NOT NULL;

create table if not exists public."suppliers" (
  "id" uuid default extensions.uuid_generate_v4() not null,
  "name" varchar not null,
  "source_type" varchar not null,
  "url" text,
  "moq" integer,
  "lead_time_days" integer,
  "payment_terms" varchar,
  "notes" text,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  "contact_name" varchar,
  "contact_info" varchar,
  "negotiated_price" numeric,
  "shipping_fee" numeric,
  "currency" varchar default 'KRW',
  "screenshots" jsonb,
  "rating" integer,
  "is_active" boolean default true,
  "user_id" text,
  "supplier_kind" text,
  "auto_source" text,
  "default_order_account_business_id" uuid,
  primary key ("id")
);
alter table public."suppliers" enable row level security;

-- 함수 (NEXOPS 마이그레이션의 마지막 정의 그대로)
-- from 20260725090000_atomic_manual_inventory_movements.sql
CREATE OR REPLACE FUNCTION public.apply_manual_inventory_movement(
  p_operation_id UUID,
  p_user_id TEXT,
  p_business_id UUID,
  p_inventory_id UUID,
  p_product_id UUID,
  p_movement_type TEXT,
  p_quantity INTEGER,
  p_unit_cost NUMERIC DEFAULT NULL,
  p_reference_no TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_movement_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_stock INTEGER;
  v_next_stock INTEGER;
  v_product_default_cost NUMERIC := 0;
  v_state_qty NUMERIC := 0;
  v_state_value NUMERIC := 0;
  v_state_avg_cost NUMERIC := 0;
  v_base_value NUMERIC := 0;
  v_effective_cost NUMERIC := 0;
  v_next_state_value NUMERIC := 0;
  v_next_state_avg NUMERIC := 0;
  v_movement_quantity INTEGER;
  v_movement public.inventory_movements%ROWTYPE;
  v_receipt_user_id TEXT;
  v_receipt_business_id UUID;
  v_receipt_fingerprint TEXT;
  v_receipt_result JSONB;
  v_request_fingerprint TEXT;
  v_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_SERVICE_ROLE_ONLY';
  END IF;
  IF p_operation_id IS NULL OR p_user_id IS NULL OR btrim(p_user_id) = '' OR p_business_id IS NULL
     OR p_inventory_id IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_INVALID_SCOPE';
  END IF;
  IF p_movement_type NOT IN ('inbound', 'outbound', 'adjustment') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_INVALID_TYPE';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 OR p_quantity > 2147483647
     OR (p_movement_type IN ('inbound', 'outbound') AND p_quantity = 0) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_INVALID_QUANTITY';
  END IF;
  IF p_unit_cost IS NOT NULL AND (p_unit_cost < 0 OR p_unit_cost > 9999999999.99) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_INVALID_UNIT_COST';
  END IF;
  IF length(COALESCE(p_reference_no, '')) > 100 OR length(COALESCE(p_notes, '')) > 2000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_INVALID_TEXT_LENGTH';
  END IF;

  -- 같은 operation_id는 응답 유실·네트워크 재시도에도 한 번만 반영한다. 동시 INSERT
  -- 충돌은 선행 트랜잭션 종료까지 대기하므로 완료 결과를 그대로 재사용할 수 있다.
  v_request_fingerprint := md5(jsonb_build_object(
    'inventory_id', p_inventory_id,
    'product_id', p_product_id,
    'movement_type', p_movement_type,
    'quantity', p_quantity,
    'unit_cost', p_unit_cost,
    'reference_no', p_reference_no,
    'notes', p_notes,
    'movement_date', p_movement_date
  )::TEXT);

  INSERT INTO public.manual_inventory_operation_receipts (
    operation_id, user_id, business_id, request_fingerprint
  )
  VALUES (p_operation_id, p_user_id, p_business_id, v_request_fingerprint)
  ON CONFLICT (operation_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT receipt.user_id, receipt.business_id, receipt.request_fingerprint, receipt.result
      INTO v_receipt_user_id, v_receipt_business_id, v_receipt_fingerprint, v_receipt_result
      FROM public.manual_inventory_operation_receipts AS receipt
     WHERE receipt.operation_id = p_operation_id
     FOR UPDATE;

    IF NOT FOUND OR v_receipt_user_id <> p_user_id OR v_receipt_business_id <> p_business_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_OPERATION_SCOPE_MISMATCH';
    END IF;
    IF v_receipt_fingerprint <> v_request_fingerprint THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_OPERATION_PAYLOAD_MISMATCH';
    END IF;
    IF v_receipt_result IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_OPERATION_INCOMPLETE';
    END IF;
    RETURN v_receipt_result;
  END IF;

  -- inventory.id와 product.id의 결합, 상품 소유자와 선택 사업장을 한 쿼리로 검증한다.
  -- inventory 행 잠금이 동시 출고의 재고 부족 검사를 직렬화한다.
  SELECT COALESCE(i.current_stock, 0)::INTEGER,
         COALESCE(p.unit_cost_default, 0)
    INTO v_current_stock, v_product_default_cost
    FROM public.products AS p
    JOIN public.inventory AS i
      ON i.id = p_inventory_id
     AND i.product_id = p.id
   WHERE p.id = p_product_id
     AND p.user_id = p_user_id
     AND p.business_id = p_business_id
   FOR UPDATE OF i;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_SCOPE_MISMATCH';
  END IF;

  -- 이력 INSERT 전에 부족을 검사한다. 예외는 함수 전체 트랜잭션을 롤백한다.
  IF p_movement_type = 'outbound' AND v_current_stock < p_quantity THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format('NXINV_STOCK_SHORTAGE:%s:%s', v_current_stock, p_quantity);
  END IF;

  IF p_movement_type = 'inbound' THEN
    IF v_current_stock > 2147483647 - p_quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_INVALID_QUANTITY';
    END IF;
    v_next_stock := v_current_stock + p_quantity;
    v_movement_quantity := p_quantity;
  ELSIF p_movement_type = 'outbound' THEN
    v_next_stock := v_current_stock - p_quantity;
    v_movement_quantity := -p_quantity;
  ELSE
    v_next_stock := p_quantity;
    v_movement_quantity := p_quantity - v_current_stock;
    IF v_movement_quantity = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_NO_CHANGE';
    END IF;
  END IF;

  SELECT s.qty, s.total_value, s.avg_cost_krw
    INTO v_state_qty, v_state_value, v_state_avg_cost
    FROM public.inventory_state AS s
   WHERE s.product_id = p_product_id
   FOR UPDATE;

  IF NOT FOUND THEN
    v_state_qty := v_current_stock;
    IF v_current_stock > 0 AND v_next_stock > 0 AND COALESCE(v_product_default_cost, 0) <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_BASE_COST_REQUIRED';
    END IF;
    -- 기존 수량은 상품 기본 원가로, 이번 신규 입고분만 p_unit_cost로 평가한다.
    v_state_avg_cost := CASE
      WHEN v_current_stock > 0 THEN COALESCE(NULLIF(v_product_default_cost, 0), 0)
      ELSE COALESCE(NULLIF(p_unit_cost, 0), NULLIF(v_product_default_cost, 0), 0)
    END;
    v_state_value := v_state_qty * v_state_avg_cost;
  ELSIF v_state_qty <> v_current_stock THEN
    -- 기존 두 재고 상태가 어긋나면 수동 이동 직전의 operational stock에 회계 수량을 맞춘다.
    v_state_value := v_current_stock * v_state_avg_cost;
    v_state_qty := v_current_stock;
  END IF;

  IF v_current_stock > 0 AND v_next_stock > 0 AND COALESCE(v_state_avg_cost, 0) <= 0 THEN
    IF COALESCE(v_product_default_cost, 0) <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_BASE_COST_REQUIRED';
    END IF;
    v_state_avg_cost := v_product_default_cost;
    v_state_value := v_current_stock * v_state_avg_cost;
  END IF;

  v_base_value := COALESCE(v_state_value, v_state_qty * v_state_avg_cost, 0);
  IF p_movement_type = 'inbound' THEN
    v_effective_cost := COALESCE(
      NULLIF(p_unit_cost, 0),
      NULLIF(v_state_avg_cost, 0),
      NULLIF(v_product_default_cost, 0),
      0
    );
    v_next_state_value := v_base_value + (p_quantity * v_effective_cost);
    v_next_state_avg := CASE
      WHEN v_next_stock > 0 THEN round(v_next_state_value / v_next_stock, 4)
      ELSE 0
    END;
  ELSIF p_movement_type = 'outbound' THEN
    v_effective_cost := COALESCE(NULLIF(v_state_avg_cost, 0), NULLIF(v_product_default_cost, 0), 0);
    v_next_state_value := GREATEST(v_base_value - (p_quantity * v_effective_cost), 0);
    v_next_state_avg := CASE
      WHEN v_next_stock > 0 THEN round(v_next_state_value / v_next_stock, 4)
      ELSE 0
    END;
  ELSE
    v_effective_cost := COALESCE(NULLIF(v_state_avg_cost, 0), NULLIF(v_product_default_cost, 0), 0);
    v_next_state_value := v_next_stock * v_effective_cost;
    -- 조정은 절대 수량만 바꾸며 0개가 되어도 다음 입고를 위해 기존 평균단가를 보존한다.
    v_next_state_avg := v_effective_cost;
  END IF;

  -- 양수 재고가 오가는데 기준 원가가 없으면 0원 COGS/재고가액을 만들지 않는다.
  IF (v_current_stock > 0 OR v_next_stock > 0) AND COALESCE(v_effective_cost, 0) <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_BASE_COST_REQUIRED';
  END IF;

  UPDATE public.inventory
     SET current_stock = v_next_stock,
         last_inbound_at = CASE WHEN p_movement_type = 'inbound' THEN NOW() ELSE last_inbound_at END,
         updated_at = NOW()
   WHERE id = p_inventory_id
     AND product_id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_INVENTORY_UPDATE_FAILED';
  END IF;

  INSERT INTO public.inventory_state (product_id, qty, total_value, avg_cost_krw, updated_at)
  VALUES (
    p_product_id,
    v_next_stock,
    round(v_next_state_value, 2),
    v_next_state_avg,
    NOW()
  )
  ON CONFLICT (product_id) DO UPDATE
    SET qty = EXCLUDED.qty,
        total_value = EXCLUDED.total_value,
        avg_cost_krw = EXCLUDED.avg_cost_krw,
        updated_at = EXCLUDED.updated_at;

  INSERT INTO public.inventory_movements (
    inventory_id,
    product_id,
    movement_type,
    quantity,
    reference_no,
    unit_cost,
    notes,
    movement_date
  )
  VALUES (
    p_inventory_id,
    p_product_id,
    p_movement_type,
    v_movement_quantity,
    NULLIF(btrim(p_reference_no), ''),
    v_effective_cost,
    CASE
      WHEN p_movement_type = 'adjustment'
        THEN '[NEXOPS:DELTA]' || chr(10) || COALESCE(p_notes, '')
      ELSE NULLIF(btrim(p_notes), '')
    END,
    p_movement_date
  )
  RETURNING * INTO v_movement;

  v_result := jsonb_build_object(
    'movement', to_jsonb(v_movement),
    'updatedStock', v_next_stock
  );
  UPDATE public.manual_inventory_operation_receipts
     SET result = v_result
   WHERE operation_id = p_operation_id
     AND user_id = p_user_id
     AND business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXINV_RECEIPT_UPDATE_FAILED';
  END IF;
  RETURN v_result;
END;
$$;

-- from 20260819120000_bulk_coupon_net_base_recalc.sql
CREATE OR REPLACE FUNCTION public.apply_owned_bulk_coupon_atomic(
  p_actor_user_id TEXT,
  p_business_id UUID,
  p_product_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_per_unit_coupon NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_rate NUMERIC;
  v_matched INTEGER := 0;
  v_updated INTEGER := 0;
  v_history_rows INTEGER := 0;
  v_settlement_expected INTEGER := 0;
  v_settlement_rows INTEGER := 0;
  v_termination_date DATE;
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = ''
     OR p_business_id IS NULL OR p_product_id IS NULL
     OR p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date
     OR p_per_unit_coupon IS NULL OR p_per_unit_coupon < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXCUPON_INVALID_REQUEST';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
     WHERE id = p_business_id AND user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXCUPON_SCOPE_MISMATCH';
  END IF;

  -- 상품 잠금은 같은 상품의 가격 이력 갱신과 쿠폰 일괄 적용을 직렬화한다.
  SELECT * INTO v_product
    FROM public.products
   WHERE id = p_product_id
     AND user_id = p_actor_user_id
     AND business_id = p_business_id
     AND purpose = 'product'
   FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXCUPON_SCOPE_MISMATCH';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXCUPON_NOT_FOUND';
  END IF;

  v_rate := COALESCE(v_product.commission_rate, 0);

  -- 현재 대상 행을 잠가 한 행씩 갱신하던 기존 부분 성공 가능성을 제거한다.
  PERFORM 1
    FROM public.sales_transactions
   WHERE user_id = p_actor_user_id
     AND business_id = p_business_id
     AND product_id = p_product_id
     AND order_date BETWEEN p_start_date AND p_end_date
   FOR UPDATE;

  SELECT COUNT(*), COUNT(DISTINCT order_date)
    INTO v_matched, v_settlement_expected
    FROM public.sales_transactions
   WHERE user_id = p_actor_user_id
     AND business_id = p_business_id
     AND product_id = p_product_id
     AND order_date BETWEEN p_start_date AND p_end_date;

  WITH recalc AS (
    SELECT
      sale.id,
      derived.new_coupon,
      CASE WHEN derived.commission_derived
           THEN ROUND(derived.new_net * v_rate)
           ELSE derived.old_comm END AS new_comm,
      CASE WHEN derived.commission_derived
                AND ABS(derived.old_comm_vat - ROUND(derived.old_comm * 0.1)) <= 1
           THEN ROUND(ROUND(derived.new_net * v_rate) * 0.1)
           ELSE derived.old_comm_vat END AS new_comm_vat,
      CASE WHEN derived.sales_vat_derived
           THEN CASE WHEN derived.new_net > 0 THEN FLOOR(derived.new_net / 11) ELSE 0 END
           ELSE derived.old_vat END AS new_vat,
      derived.total,
      derived.cost_total,
      derived.ful_total
    FROM public.sales_transactions AS sale
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(sale.total_amount, 0) AS total,
        COALESCE(sale.unit_cost, 0) * COALESCE(sale.order_quantity, 0) AS cost_total,
        COALESCE(sale.fulfillment_fee, 0) + COALESCE(sale.fulfillment_vat, 0) AS ful_total,
        COALESCE(sale.commission_fee, 0) AS old_comm,
        COALESCE(sale.commission_vat, 0) AS old_comm_vat,
        COALESCE(sale.vat, 0) AS old_vat,
        GREATEST(0, COALESCE(sale.total_amount, 0) - COALESCE(sale.coupon_discount, 0)) AS old_net,
        p_per_unit_coupon * ABS(COALESCE(sale.order_quantity, 0)) AS new_coupon,
        GREATEST(0, COALESCE(sale.total_amount, 0)
          - p_per_unit_coupon * ABS(COALESCE(sale.order_quantity, 0))) AS new_net,
        (v_rate > 0 AND (
          ABS(COALESCE(sale.commission_fee, 0) - ROUND(COALESCE(sale.total_amount, 0) * v_rate)) <= 1
          OR ABS(COALESCE(sale.commission_fee, 0)
              - ROUND(GREATEST(0, COALESCE(sale.total_amount, 0) - COALESCE(sale.coupon_discount, 0)) * v_rate)) <= 1
        )) AS commission_derived,
        (COALESCE(sale.total_amount, 0) > 0 AND (
          ABS(COALESCE(sale.vat, 0) - FLOOR(COALESCE(sale.total_amount, 0) / 11)) <= 1
          OR ABS(COALESCE(sale.vat, 0)
              - FLOOR(GREATEST(0, COALESCE(sale.total_amount, 0) - COALESCE(sale.coupon_discount, 0)) / 11)) <= 1
        )) AS sales_vat_derived
    ) AS derived
    WHERE sale.user_id = p_actor_user_id
      AND sale.business_id = p_business_id
      AND sale.product_id = p_product_id
      AND sale.order_date BETWEEN p_start_date AND p_end_date
  )
  UPDATE public.sales_transactions AS sale
     SET coupon_discount = recalc.new_coupon,
         commission_fee = recalc.new_comm,
         commission_vat = recalc.new_comm_vat,
         vat = recalc.new_vat,
         margin = recalc.total - recalc.cost_total - recalc.new_comm - recalc.new_comm_vat
                  - recalc.ful_total - recalc.new_coupon - recalc.new_vat,
         updated_at = clock_timestamp()
    FROM recalc
   WHERE sale.id = recalc.id
     AND (
       sale.coupon_discount IS DISTINCT FROM recalc.new_coupon
       OR sale.commission_fee IS DISTINCT FROM recalc.new_comm
       OR sale.commission_vat IS DISTINCT FROM recalc.new_comm_vat
       OR sale.vat IS DISTINCT FROM recalc.new_vat
       OR sale.margin IS DISTINCT FROM (
         recalc.total - recalc.cost_total - recalc.new_comm - recalc.new_comm_vat
         - recalc.ful_total - recalc.new_coupon - recalc.new_vat
       )
     );
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  v_termination_date := p_end_date + 1;

  UPDATE public.product_price_history
     SET value = p_per_unit_coupon
   WHERE product_id = p_product_id
     AND field_name = 'seller_discount_coupon'
     AND effective_date = p_start_date;
  GET DIAGNOSTICS v_history_rows = ROW_COUNT;
  IF v_history_rows = 0 THEN
    INSERT INTO public.product_price_history (product_id, field_name, value, effective_date)
    VALUES (p_product_id, 'seller_discount_coupon', p_per_unit_coupon, p_start_date);
  END IF;

  UPDATE public.product_price_history
     SET value = 0
   WHERE product_id = p_product_id
     AND field_name = 'seller_discount_coupon'
     AND effective_date = v_termination_date;
  GET DIAGNOSTICS v_history_rows = ROW_COUNT;
  IF v_history_rows = 0 THEN
    INSERT INTO public.product_price_history (product_id, field_name, value, effective_date)
    VALUES (p_product_id, 'seller_discount_coupon', 0, v_termination_date);
  END IF;

  -- 쿠폰으로 바뀐 margin을 SSOT로 자동 일일 정산까지 같은 트랜잭션에서 재생성한다.
  INSERT INTO public.settlements (
    aggregation_key, user_id, business_id, product_id, period_start, period_end,
    sales_quantity, total_revenue, total_cost, total_fulfillment,
    total_fulfillment_vat, total_commission, total_commission_vat,
    total_return_pickup, total_return_restock, total_vat, total_margin,
    total_margin_rate, ad_cost, settlement_type, source, import_batch_id, verified
  )
  SELECT
    concat('daily:', sale.user_id, ':', sale.business_id::TEXT, ':', sale.product_id::TEXT, ':', sale.order_date::TEXT),
    sale.user_id,
    sale.business_id,
    sale.product_id,
    sale.order_date,
    sale.order_date,
    SUM(COALESCE(sale.order_quantity, 0)),
    ROUND(SUM(COALESCE(sale.total_amount, 0)), 2),
    ROUND(SUM(ABS(COALESCE(sale.order_quantity, 0)) * COALESCE(sale.unit_cost, 0)), 2),
    ROUND(SUM(COALESCE(sale.fulfillment_fee, 0)), 2),
    ROUND(SUM(COALESCE(sale.fulfillment_vat, 0)), 2),
    ROUND(SUM(COALESCE(sale.commission_fee, 0)), 2),
    ROUND(SUM(COALESCE(sale.commission_vat, 0)), 2),
    0,
    0,
    ROUND(SUM(COALESCE(sale.vat, 0)), 2),
    ROUND(SUM(COALESCE(sale.margin, 0)), 2),
    CASE
      WHEN SUM(COALESCE(sale.total_amount, 0)) = 0 THEN 0
      ELSE SUM(COALESCE(sale.margin, 0)) / SUM(COALESCE(sale.total_amount, 0))
    END,
    0,
    'daily',
    'auto',
    (
      ARRAY_AGG(sale.import_batch_id ORDER BY sale.created_at DESC, sale.id DESC)
        FILTER (WHERE sale.import_batch_id IS NOT NULL)
    )[1],
    FALSE
  FROM public.sales_transactions AS sale
  WHERE sale.user_id = p_actor_user_id
    AND sale.business_id = p_business_id
    AND sale.product_id = p_product_id
    AND sale.order_date BETWEEN p_start_date AND p_end_date
  GROUP BY sale.user_id, sale.business_id, sale.product_id, sale.order_date
  ON CONFLICT (aggregation_key) DO UPDATE SET
    sales_quantity = EXCLUDED.sales_quantity,
    total_revenue = EXCLUDED.total_revenue,
    total_cost = EXCLUDED.total_cost,
    total_fulfillment = EXCLUDED.total_fulfillment,
    total_fulfillment_vat = EXCLUDED.total_fulfillment_vat,
    total_commission = EXCLUDED.total_commission,
    total_commission_vat = EXCLUDED.total_commission_vat,
    total_return_pickup = EXCLUDED.total_return_pickup,
    total_return_restock = EXCLUDED.total_return_restock,
    total_vat = EXCLUDED.total_vat,
    total_margin = EXCLUDED.total_margin,
    total_margin_rate = EXCLUDED.total_margin_rate,
    import_batch_id = EXCLUDED.import_batch_id,
    verified = FALSE
  WHERE settlements.user_id = EXCLUDED.user_id
    AND settlements.business_id = EXCLUDED.business_id
    AND settlements.product_id = EXCLUDED.product_id
    AND settlements.period_start = EXCLUDED.period_start
    AND settlements.period_end = EXCLUDED.period_end
    AND settlements.settlement_type = 'daily'
    AND settlements.source = 'auto';
  GET DIAGNOSTICS v_settlement_rows = ROW_COUNT;

  IF v_settlement_rows <> v_settlement_expected THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXCUPON_SETTLEMENT_SCOPE_MISMATCH';
  END IF;

  RETURN jsonb_build_object(
    'matched', v_matched,
    'updated', v_updated,
    'settlementsRefreshed', v_settlement_rows,
    'historyEffectiveFrom', p_start_date,
    'historyEffectiveUntil', v_termination_date
  );
END;
$$;

-- from 20260725120000_purchase_inventory_atomic.sql
CREATE OR REPLACE FUNCTION public.apply_purchase_inventory_effect_atomic(
  p_actor_user_id TEXT,
  p_business_id UUID,
  p_purchase_id UUID,
  p_operation_id UUID,
  p_product_id UUID,
  p_quantity INTEGER,
  p_unit_cost_krw NUMERIC,
  p_effect TEXT,
  p_effective_date DATE,
  p_po_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inventory_ids UUID[];
  v_inventory_stocks NUMERIC[];
  v_inventory_count INTEGER := 0;
  v_inventory_id UUID;
  v_current_stock NUMERIC := 0;
  v_state_qty NUMERIC;
  v_state_value NUMERIC;
  v_state_avg NUMERIC;
  v_state_found BOOLEAN := FALSE;
  v_next_stock NUMERIC;
  v_next_qty NUMERIC;
  v_next_value NUMERIC;
  v_next_avg NUMERIC;
  v_movement_id UUID;
  v_reference TEXT;
  v_original_inbound_id UUID;
  v_original_inbound_at TIMESTAMPTZ;
  v_original_inbound_quantity INTEGER;
  v_original_inbound_cost NUMERIC;
  v_original_effect_receipt public.purchase_inventory_effect_receipts%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' OR p_business_id IS NULL
     OR p_purchase_id IS NULL OR p_operation_id IS NULL OR p_product_id IS NULL
     OR p_quantity IS NULL OR p_quantity <= 0 OR p_unit_cost_krw IS NULL OR p_unit_cost_krw <= 0
     OR p_effect NOT IN ('inbound', 'reversal') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_INVALID_INVENTORY_EFFECT';
  END IF;

  -- 상품 행 잠금은 동일 상품의 inventory 미존재 생성 경쟁을 직렬화한다.
  PERFORM 1
    FROM public.products AS p
   WHERE p.id = p_product_id
     AND p.user_id = p_actor_user_id
     AND p.business_id = p_business_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_PRODUCT_SCOPE_MISMATCH';
  END IF;

  -- product_id에 구조적 UNIQUE가 없으므로 모든 후보를 잠그고 2개 이상이면 임의 선택하지 않는다.
  SELECT array_agg(locked.id ORDER BY locked.id),
         array_agg(COALESCE(locked.current_stock, 0) ORDER BY locked.id)
    INTO v_inventory_ids, v_inventory_stocks
    FROM (
      SELECT i.id, i.current_stock
        FROM public.inventory AS i
       WHERE i.product_id = p_product_id
       FOR UPDATE
    ) AS locked;

  v_inventory_count := COALESCE(cardinality(v_inventory_ids), 0);
  IF v_inventory_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_DUPLICATE_INVENTORY';
  END IF;

  IF v_inventory_count = 1 THEN
    v_inventory_id := v_inventory_ids[1];
    v_current_stock := v_inventory_stocks[1];
  ELSIF p_effect = 'inbound' THEN
    INSERT INTO public.inventory (product_id, current_stock, last_inbound_at, updated_at)
    VALUES (p_product_id, 0, NULL, NOW())
    RETURNING id, COALESCE(current_stock, 0) INTO v_inventory_id, v_current_stock;

    -- UNIQUE 제약이 없는 레거시 테이블에서 비협조적 동시 INSERT가 끼어든 경우도 실패 폐쇄한다.
    SELECT COUNT(*) INTO v_inventory_count
      FROM public.inventory
     WHERE product_id = p_product_id;
    IF v_inventory_count <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_DUPLICATE_INVENTORY';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_INVENTORY_MISSING';
  END IF;

  SELECT s.qty, s.total_value, s.avg_cost_krw
    INTO v_state_qty, v_state_value, v_state_avg
    FROM public.inventory_state AS s
   WHERE s.product_id = p_product_id
   FOR UPDATE;
  v_state_found := FOUND;

  IF NOT v_state_found THEN
    IF v_current_stock <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_INVENTORY_STATE_MISMATCH';
    END IF;
    v_state_qty := 0;
    v_state_value := 0;
    v_state_avg := 0;
  ELSIF v_state_qty IS DISTINCT FROM v_current_stock THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_INVENTORY_STATE_MISMATCH';
  END IF;

  IF p_effect = 'inbound' THEN
    v_next_stock := v_current_stock + p_quantity;
    v_next_qty := v_state_qty + p_quantity;
    v_next_value := round(v_state_value + (p_quantity * p_unit_cost_krw), 2);
    v_reference := format('PURCHASE-%s-%s-IN', p_purchase_id, p_operation_id);
  ELSE
    -- 이동평균 장부는 과거 입고만 떼어 역산할 수 없다. 이 매입 입고 뒤에 판매·조정·다른
    -- 입고가 하나라도 있으면 원래 단가를 빼는 순간 COGS/잔존 재고가액이 왜곡되므로 실패 폐쇄한다.
    SELECT movement.id, movement.created_at, movement.quantity, movement.unit_cost
      INTO v_original_inbound_id, v_original_inbound_at, v_original_inbound_quantity, v_original_inbound_cost
      FROM public.inventory_movements AS movement
     WHERE movement.product_id = p_product_id
       AND movement.movement_type = 'inbound'
       AND movement.reference_no LIKE 'PURCHASE-' || p_purchase_id::TEXT || '-%-IN'
     ORDER BY movement.created_at DESC, movement.id DESC
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND
       OR v_original_inbound_quantity IS DISTINCT FROM p_quantity
       OR v_original_inbound_cost IS DISTINCT FROM p_unit_cost_krw THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_REVERSAL_HISTORY_MISMATCH';
    END IF;
    SELECT * INTO v_original_effect_receipt
      FROM public.purchase_inventory_effect_receipts AS effect_receipt
     WHERE effect_receipt.movement_id = v_original_inbound_id
       AND effect_receipt.purchase_id = p_purchase_id
       AND effect_receipt.product_id = p_product_id
       AND effect_receipt.inventory_id = v_inventory_id
       AND effect_receipt.effect = 'inbound'
     FOR UPDATE;
    IF NOT FOUND
       OR v_original_effect_receipt.quantity IS DISTINCT FROM p_quantity
       OR v_original_effect_receipt.unit_cost_krw IS DISTINCT FROM p_unit_cost_krw
       OR v_original_effect_receipt.resulting_stock IS DISTINCT FROM v_current_stock
       OR v_original_effect_receipt.resulting_qty IS DISTINCT FROM v_state_qty
       OR v_original_effect_receipt.resulting_value IS DISTINCT FROM v_state_value
       OR v_original_effect_receipt.resulting_avg IS DISTINCT FROM v_state_avg THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_REVERSAL_SNAPSHOT_MISMATCH';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM public.inventory_movements AS later_movement
       WHERE later_movement.product_id = p_product_id
         AND later_movement.id <> v_original_inbound_id
         -- NOW() is transaction-stable: 같은 원자 Import의 여러 입고는 created_at이 같을 수 있다.
         -- 동일 시각의 실제 후속 여부는 resulting snapshot 비교가 판정하고, 더 늦은 트랜잭션만 여기서 차단한다.
         AND later_movement.created_at > v_original_inbound_at
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_REVERSAL_HAS_LATER_MOVEMENTS';
    END IF;

    IF v_current_stock < p_quantity OR v_state_qty < p_quantity
       OR v_state_value < round(p_quantity * p_unit_cost_krw, 2) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_INVENTORY_SHORTAGE';
    END IF;
    v_next_stock := v_current_stock - p_quantity;
    v_next_qty := v_state_qty - p_quantity;
    v_next_value := round(v_state_value - (p_quantity * p_unit_cost_krw), 2);
    v_reference := format('PURCHASE-%s-%s-REV', p_purchase_id, p_operation_id);
  END IF;

  v_next_avg := CASE WHEN v_next_qty > 0 THEN round(v_next_value / v_next_qty, 4) ELSE 0 END;

  UPDATE public.inventory
     SET current_stock = v_next_stock,
         last_inbound_at = CASE WHEN p_effect = 'inbound' THEN NOW() ELSE last_inbound_at END,
         updated_at = NOW()
   WHERE id = v_inventory_id
     AND product_id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_INVENTORY_UPDATE_FAILED';
  END IF;

  INSERT INTO public.inventory_state (product_id, qty, total_value, avg_cost_krw, updated_at)
  VALUES (p_product_id, v_next_qty, v_next_value, v_next_avg, NOW())
  ON CONFLICT (product_id) DO UPDATE
    SET qty = EXCLUDED.qty,
        total_value = EXCLUDED.total_value,
        avg_cost_krw = EXCLUDED.avg_cost_krw,
        updated_at = EXCLUDED.updated_at;

  INSERT INTO public.inventory_movements (
    inventory_id, product_id, movement_type, quantity, reference_no,
    unit_cost, notes, movement_date
  )
  VALUES (
    v_inventory_id,
    p_product_id,
    CASE WHEN p_effect = 'inbound' THEN 'inbound' ELSE 'adjustment' END,
    CASE WHEN p_effect = 'inbound' THEN p_quantity ELSE -p_quantity END,
    v_reference,
    p_unit_cost_krw,
    CASE
      WHEN p_effect = 'inbound' THEN format('매입 입고%s', CASE WHEN p_po_number IS NULL THEN '' ELSE ' (' || p_po_number || ')' END)
      ELSE format('매입 입고 역전환%s', CASE WHEN p_po_number IS NULL THEN '' ELSE ' (' || p_po_number || ')' END)
    END,
    p_effective_date
  )
  RETURNING id INTO v_movement_id;

  INSERT INTO public.purchase_inventory_effect_receipts (
    movement_id, purchase_id, operation_id, product_id, inventory_id, effect,
    quantity, unit_cost_krw, resulting_stock, resulting_qty, resulting_value, resulting_avg
  ) VALUES (
    v_movement_id, p_purchase_id, p_operation_id, p_product_id, v_inventory_id, p_effect,
    p_quantity, p_unit_cost_krw, v_next_stock, v_next_qty, v_next_value, v_next_avg
  );

  RETURN jsonb_build_object(
    'movementId', v_movement_id,
    'inventory', jsonb_build_object(
      'productId', p_product_id,
      'inventoryId', v_inventory_id,
      'currentStock', v_next_stock,
      'qty', v_next_qty,
      'totalValue', v_next_value,
      'avgCostKrw', v_next_avg
    )
  );
END;
$$;

-- from 20260725170000_auto_import_receipts.sql
CREATE OR REPLACE FUNCTION public.claim_auto_import_receipt(
  p_user_id TEXT,
  p_business_id UUID,
  p_import_kind TEXT,
  p_import_date DATE,
  p_hash_basis TEXT,
  p_content_sha256 TEXT,
  p_batch_id UUID,
  p_file_name TEXT,
  p_row_count INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_receipt public.auto_import_receipts%ROWTYPE;
  v_claimed BOOLEAN := FALSE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXAUTO_IMPORT_SERVICE_ROLE_ONLY';
  END IF;
  IF p_user_id IS NULL OR btrim(p_user_id) = ''
     OR p_business_id IS NULL
     OR p_import_kind IS NULL
     OR p_import_kind NOT IN ('inventory_health', 'sales', 'ad_billing')
     OR p_import_date IS NULL
     OR p_hash_basis IS NULL
     OR p_hash_basis NOT IN ('xlsx_raw_bytes_v1', 'ad_rows_canonical_json_v1')
     OR p_content_sha256 IS NULL
     OR p_content_sha256 !~ '^[a-f0-9]{64}$'
     OR p_batch_id IS NULL
     OR p_file_name IS NULL OR btrim(p_file_name) = ''
     OR p_row_count IS NULL OR p_row_count < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXAUTO_IMPORT_INVALID_CLAIM';
  END IF;
  IF (p_import_kind = 'ad_billing') IS DISTINCT FROM (p_hash_basis = 'ad_rows_canonical_json_v1') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXAUTO_IMPORT_HASH_BASIS_MISMATCH';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.businesses
     WHERE id = p_business_id
       AND user_id = btrim(p_user_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXAUTO_IMPORT_BUSINESS_SCOPE_MISMATCH';
  END IF;

  INSERT INTO public.auto_import_receipts (
    user_id,
    business_id,
    import_kind,
    import_date,
    hash_basis,
    content_sha256,
    batch_id,
    file_name,
    row_count
  )
  VALUES (
    btrim(p_user_id),
    p_business_id,
    p_import_kind,
    p_import_date,
    p_hash_basis,
    p_content_sha256,
    p_batch_id,
    p_file_name,
    p_row_count
  )
  ON CONFLICT (
    user_id,
    business_id,
    import_kind,
    import_date,
    hash_basis,
    content_sha256
  ) DO NOTHING
  RETURNING * INTO v_receipt;

  IF FOUND THEN
    v_claimed := TRUE;
  ELSE
    SELECT *
      INTO v_receipt
      FROM public.auto_import_receipts
     WHERE user_id = btrim(p_user_id)
       AND business_id = p_business_id
       AND import_kind = p_import_kind
       AND import_date = p_import_date
       AND hash_basis = p_hash_basis
       AND content_sha256 = p_content_sha256;
  END IF;

  IF v_receipt.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXAUTO_IMPORT_CLAIM_NOT_FOUND';
  END IF;

  RETURN jsonb_build_object(
    'receiptId', v_receipt.id,
    'claimed', v_claimed,
    'status', v_receipt.status,
    'batchId', v_receipt.batch_id,
    'response', v_receipt.response
  );
END;
$$;

-- from 20260725140000_business_mutation_atomic.sql
CREATE OR REPLACE FUNCTION public.create_owned_business_atomic(
  p_actor_user_id TEXT,
  p_fields JSONB,
  p_make_default BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_saved public.businesses%ROWTYPE;
  v_is_default BOOLEAN;
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = ''
     OR p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object'
     OR NULLIF(btrim(p_fields->>'business_name'), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXBUS_INVALID_REQUEST';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_object_keys(p_fields) AS supplied(key)
     WHERE NOT (supplied.key = ANY (ARRAY[
       'business_name', 'business_number', 'representative',
       'business_type', 'business_category', 'address'
     ]))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXBUS_INVALID_REQUEST';
  END IF;

  -- 동일 사용자의 첫 사업자 판정과 기본값 전환 경합을 직렬화한다.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_user_id, 0));
  v_is_default := p_make_default OR NOT EXISTS (
    SELECT 1 FROM public.businesses
     WHERE user_id = p_actor_user_id
       AND is_default = TRUE
  );

  IF v_is_default THEN
    UPDATE public.businesses
       SET is_default = FALSE,
           updated_at = clock_timestamp()
     WHERE user_id = p_actor_user_id
       AND is_default = TRUE;
  END IF;

  INSERT INTO public.businesses (
    user_id, business_name, business_number, representative,
    business_type, business_category, address, is_default
  ) VALUES (
    p_actor_user_id,
    btrim(p_fields->>'business_name'),
    NULLIF(btrim(p_fields->>'business_number'), ''),
    NULLIF(btrim(p_fields->>'representative'), ''),
    NULLIF(btrim(p_fields->>'business_type'), ''),
    NULLIF(btrim(p_fields->>'business_category'), ''),
    NULLIF(btrim(p_fields->>'address'), ''),
    v_is_default
  )
  RETURNING * INTO v_saved;

  RETURN to_jsonb(v_saved);
END;
$$;

-- from 20260725140000_business_mutation_atomic.sql
CREATE OR REPLACE FUNCTION public.delete_owned_empty_business_atomic(
  p_actor_user_id TEXT,
  p_business_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current public.businesses%ROWTYPE;
  v_dependency RECORD;
  v_has_rows BOOLEAN;
  v_dependencies TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' OR p_business_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXBUS_INVALID_REQUEST';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_user_id, 0));
  -- 참조 INSERT의 FK key-share 잠금과 충돌하도록 사업자 행을 먼저 잠근다.
  SELECT * INTO v_current
    FROM public.businesses
   WHERE id = p_business_id
     AND user_id = p_actor_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.businesses WHERE id = p_business_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXBUS_SCOPE_MISMATCH';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXBUS_NOT_FOUND';
  END IF;

  -- 신규 테이블이 추가되어도 business_id 열이 있으면 자동으로 삭제 차단 대상이 된다.
  -- business_settings는 사업장에 종속된 순수 설정이므로 기존 FK의 CASCADE 정리를 허용한다.
  FOR v_dependency IN
    SELECT DISTINCT columns.table_schema, columns.table_name
      FROM information_schema.columns AS columns
      JOIN information_schema.tables AS tables
        ON tables.table_schema = columns.table_schema
       AND tables.table_name = columns.table_name
     WHERE columns.table_schema = 'public'
       AND columns.column_name = 'business_id'
       AND tables.table_type = 'BASE TABLE'
       AND columns.table_name <> 'business_settings'
     ORDER BY columns.table_name
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE business_id = $1)',
      v_dependency.table_schema,
      v_dependency.table_name
    ) INTO v_has_rows USING p_business_id;
    IF v_has_rows THEN
      v_dependencies := array_append(v_dependencies, v_dependency.table_name);
    END IF;
  END LOOP;

  IF cardinality(v_dependencies) > 0 THEN
    RETURN jsonb_build_object(
      'deleted', FALSE,
      'businessId', p_business_id,
      'dependencies', to_jsonb(v_dependencies)
    );
  END IF;

  DELETE FROM public.businesses
   WHERE id = p_business_id
     AND user_id = p_actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXBUS_DELETE_FAILED';
  END IF;

  -- 기본 사업장을 삭제했거나 레거시 데이터에 기본값이 없으면 남은 첫 사업자를 복구한다.
  IF EXISTS (SELECT 1 FROM public.businesses WHERE user_id = p_actor_user_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.businesses
        WHERE user_id = p_actor_user_id AND is_default = TRUE
     ) THEN
    UPDATE public.businesses
       SET is_default = TRUE,
           updated_at = clock_timestamp()
     WHERE id = (
       SELECT id
         FROM public.businesses
        WHERE user_id = p_actor_user_id
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        FOR UPDATE
     );
  END IF;

  RETURN jsonb_build_object(
    'deleted', TRUE,
    'businessId', p_business_id,
    'dependencies', '[]'::JSONB
  );
END;
$$;

-- from 20260725120000_purchase_inventory_atomic.sql
CREATE OR REPLACE FUNCTION public.delete_purchase_atomic(
  p_actor_user_id TEXT,
  p_business_id UUID,
  p_purchase_id UUID,
  p_expected_updated_at TIMESTAMPTZ,
  p_operation_id UUID,
  p_effective_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current public.purchases%ROWTYPE;
  v_deleted public.purchases%ROWTYPE;
  v_receipt public.purchase_mutation_receipts%ROWTYPE;
  v_request JSONB;
  v_response JSONB;
  v_inventory_result JSONB := NULL;
  v_inventory_effect TEXT := 'none';
  v_movement_ids JSONB := '[]'::JSONB;
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' OR p_business_id IS NULL
     OR p_purchase_id IS NULL OR p_expected_updated_at IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_INVALID_REQUEST';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
     WHERE id = p_business_id AND user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_SCOPE_MISMATCH';
  END IF;

  v_request := jsonb_build_object(
    'expectedUpdatedAt', p_expected_updated_at,
    'effectiveDate', p_effective_date
  );

  INSERT INTO public.purchase_mutation_receipts (
    operation_id, actor_user_id, business_id, purchase_id, action, request_payload
  ) VALUES (
    p_operation_id, p_actor_user_id, p_business_id, p_purchase_id, 'delete', v_request
  )
  ON CONFLICT (operation_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT * INTO v_receipt
      FROM public.purchase_mutation_receipts
     WHERE operation_id = p_operation_id;
    IF NOT FOUND OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
       OR v_receipt.business_id IS DISTINCT FROM p_business_id
       OR v_receipt.purchase_id IS DISTINCT FROM p_purchase_id
       OR v_receipt.action IS DISTINCT FROM 'delete'
       OR v_receipt.request_payload IS DISTINCT FROM v_request
       OR v_receipt.response IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN jsonb_set(v_receipt.response, '{mutation,replayed}', 'true'::JSONB, TRUE);
  END IF;

  SELECT * INTO v_current
    FROM public.purchases
   WHERE id = p_purchase_id
     AND user_id = p_actor_user_id
     AND business_id = p_business_id
   FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.purchases WHERE id = p_purchase_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_SCOPE_MISMATCH';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_NOT_FOUND';
  END IF;
  IF v_current.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_STALE_VERSION';
  END IF;

  IF v_current.status = 'arrived' THEN
    IF v_current.product_id IS NULL OR v_current.quantity <= 0
       OR v_current.unit_cost_krw IS NULL OR v_current.unit_cost_krw <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_REVERSAL_INPUT_MISSING';
    END IF;
    v_inventory_result := public.apply_purchase_inventory_effect_atomic(
      p_actor_user_id, p_business_id, p_purchase_id, p_operation_id,
      v_current.product_id, v_current.quantity, v_current.unit_cost_krw,
      'reversal', p_effective_date, v_current.po_number
    );
    v_inventory_effect := 'reversal';
    v_movement_ids := jsonb_build_array(v_inventory_result->>'movementId');
  END IF;

  DELETE FROM public.purchases
   WHERE id = p_purchase_id
     AND user_id = p_actor_user_id
     AND business_id = p_business_id
  RETURNING * INTO v_deleted;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_PURCHASE_DELETE_FAILED';
  END IF;

  v_response := jsonb_build_object(
    'purchase', NULL,
    'mutation', jsonb_build_object(
      'operationId', p_operation_id,
      'applied', TRUE,
      'replayed', FALSE,
      'action', 'delete',
      'previousStatus', v_deleted.status,
      'status', NULL,
      'inventoryEffect', v_inventory_effect,
      'movementIds', v_movement_ids,
      'inventory', CASE WHEN v_inventory_result IS NULL THEN NULL ELSE v_inventory_result->'inventory' END
    )
  );

  UPDATE public.purchase_mutation_receipts
     SET response = v_response
   WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_RECEIPT_WRITE_FAILED';
  END IF;
  RETURN v_response;
END;
$$;

-- from 20260725130000_atomic_purchase_import.sql
CREATE OR REPLACE FUNCTION public.import_purchases_atomic(
  p_user_id TEXT,
  p_business_id UUID,
  p_import_batch_id UUID,
  p_idempotency_key TEXT,
  p_rows JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_status TEXT;
  v_receipt public.purchase_import_receipts%ROWTYPE;
  v_row RECORD;
  v_purchase_id UUID;
  v_purchase_ids UUID[] := '{}'::UUID[];
  v_inserted INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IMPORT_SERVICE_ROLE_ONLY';
  END IF;
  IF p_user_id IS NULL OR btrim(p_user_id) = '' OR p_business_id IS NULL
     OR p_import_batch_id IS NULL OR p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IMPORT_INVALID_SCOPE';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IMPORT_ROWS_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.businesses
     WHERE id = p_business_id
       AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IMPORT_BUSINESS_SCOPE_MISMATCH';
  END IF;

  -- 같은 배치의 동시 재시도를 직렬화하고 사용자·사업장·타입을 한 번에 결합한다.
  SELECT import_batch.status
    INTO v_batch_status
    FROM public.coupang_imports AS import_batch
   WHERE import_batch.id = p_import_batch_id
     AND import_batch.user_id = p_user_id
     AND import_batch.business_id = p_business_id
     AND import_batch.import_type = 'purchase'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IMPORT_BATCH_SCOPE_MISMATCH';
  END IF;

  -- 같은 batch 재시도뿐 아니라 HTTP 전체 응답 유실 후 새 batch로 재업로드해도
  -- 정규화 payload SHA-256가 같으면 기존 receipt를 재생하고 중복 매입·재고를 막는다.
  IF v_batch_status = 'completed' THEN
    SELECT *
      INTO v_receipt
      FROM public.purchase_import_receipts AS receipt
     WHERE receipt.actor_user_id = p_user_id
       AND receipt.business_id = p_business_id
       AND receipt.idempotency_key = p_idempotency_key;
    IF NOT FOUND
       OR v_receipt.actor_user_id IS DISTINCT FROM p_user_id
       OR v_receipt.business_id IS DISTINCT FROM p_business_id
       OR v_receipt.idempotency_key IS DISTINCT FROM p_idempotency_key
       OR v_receipt.request_payload IS DISTINCT FROM p_rows
       OR v_receipt.inserted_count IS NULL
       OR v_receipt.response IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IMPORT_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_receipt.inserted_count;
  END IF;
  IF v_batch_status IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IMPORT_BATCH_NOT_PROCESSING';
  END IF;

  -- 동일 사업장의 구매 Import끼리 직렬화한다. 상품별 재고 잠금과 더불어 배치의 관측 순서를 고정한다.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('import_purchases_atomic:' || p_business_id::TEXT, 0)
  );

  -- 다른 HTTP 요청이 같은 내용으로 이미 완료됐다면 새 배치만 replay 완료 처리한다.
  SELECT *
    INTO v_receipt
    FROM public.purchase_import_receipts AS receipt
   WHERE receipt.actor_user_id = p_user_id
     AND receipt.business_id = p_business_id
     AND receipt.idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.request_payload IS DISTINCT FROM p_rows
       OR v_receipt.inserted_count IS NULL
       OR v_receipt.response IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IMPORT_IDEMPOTENCY_CONFLICT';
    END IF;

    UPDATE public.coupang_imports AS import_batch
       SET status = 'completed',
           success_count = v_receipt.inserted_count,
           error_count = 0,
           completed_at = NOW(),
           summary = COALESCE(import_batch.summary, '{}'::JSONB)
             || jsonb_build_object(
               'atomic_purchase_import', TRUE,
               'replayed', TRUE,
               'source_batch_id', v_receipt.import_batch_id
             )
     WHERE import_batch.id = p_import_batch_id
       AND import_batch.user_id = p_user_id
       AND import_batch.business_id = p_business_id
       AND import_batch.import_type = 'purchase'
       AND import_batch.status = 'processing';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IMPORT_BATCH_COMPLETION_FAILED';
    END IF;
    RETURN v_receipt.inserted_count;
  END IF;

  INSERT INTO public.purchase_import_receipts (
    import_batch_id, actor_user_id, business_id, idempotency_key, request_payload
  ) VALUES (
    p_import_batch_id, p_user_id, p_business_id, p_idempotency_key, p_rows
  );

  -- jsonb_to_recordset(... INTEGER)는 소수를 정수로 반올림할 수 있으므로 cast 전 원본 JSON 정수성을 검증한다.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_rows) AS raw_row(value)
     WHERE jsonb_typeof(raw_row.value) IS DISTINCT FROM 'object'
        OR jsonb_typeof(raw_row.value->'quantity') IS DISTINCT FROM 'number'
        OR CASE
             WHEN jsonb_typeof(raw_row.value->'quantity') = 'number'
             THEN (raw_row.value->>'quantity')::NUMERIC
                    IS DISTINCT FROM trunc((raw_row.value->>'quantity')::NUMERIC)
             ELSE FALSE
           END
        OR (
          raw_row.value ? 'lead_time_weeks'
          AND jsonb_typeof(raw_row.value->'lead_time_weeks') IS DISTINCT FROM 'null'
          AND (
            jsonb_typeof(raw_row.value->'lead_time_weeks') IS DISTINCT FROM 'number'
            OR CASE
                 WHEN jsonb_typeof(raw_row.value->'lead_time_weeks') = 'number'
                 THEN (raw_row.value->>'lead_time_weeks')::NUMERIC
                        IS DISTINCT FROM trunc((raw_row.value->>'lead_time_weeks')::NUMERIC)
                 ELSE FALSE
               END
          )
        )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IMPORT_INVALID_INTEGER';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_rows) AS row_data(
        product_id UUID,
        po_number TEXT,
        order_date DATE,
        arrival_date DATE,
        expected_arrival_date DATE,
        lead_time_weeks INTEGER,
        quantity INTEGER,
        unit_price NUMERIC,
        currency TEXT,
        exchange_rate NUMERIC,
        shipping_cost NUMERIC,
        payment1_product_krw NUMERIC,
        payment1_vat NUMERIC,
        payment1_total NUMERIC,
        payment1_status TEXT,
        payment2_vat NUMERIC,
        additional_cost NUMERIC,
        payment2_total NUMERIC,
        payment2_status TEXT,
        domestic_shipping NUMERIC,
        customs_vat NUMERIC,
        payment3_total NUMERIC,
        payment3_status TEXT,
        unit_cost_krw NUMERIC,
        total_amount_krw NUMERIC,
        payment_status TEXT,
        status TEXT,
        notes TEXT,
        product_name_memo TEXT
      )
     WHERE row_data.order_date IS NULL
        OR row_data.arrival_date < row_data.order_date
        OR row_data.expected_arrival_date < row_data.order_date
        OR row_data.lead_time_weeks < 0
        OR row_data.quantity IS NULL OR row_data.quantity <= 0
        OR row_data.unit_price IS NULL OR row_data.unit_price < 0
        OR row_data.currency IS DISTINCT FROM 'CNY'
        OR row_data.exchange_rate IS NULL OR row_data.exchange_rate <= 0
        OR row_data.shipping_cost IS NULL OR row_data.shipping_cost < 0
        OR row_data.payment1_product_krw IS NULL OR row_data.payment1_product_krw < 0
        OR row_data.payment1_vat IS NULL OR row_data.payment1_vat < 0
        OR row_data.payment1_total IS NULL OR row_data.payment1_total < 0
        OR row_data.payment1_status IS DISTINCT FROM 'paid'
        OR row_data.payment2_vat IS NULL OR row_data.payment2_vat < 0
        OR row_data.additional_cost IS NULL OR row_data.additional_cost < 0
        OR row_data.payment2_total IS NULL OR row_data.payment2_total < 0
        OR row_data.payment2_status IS DISTINCT FROM 'paid'
        OR row_data.domestic_shipping IS NULL OR row_data.domestic_shipping < 0
        OR row_data.customs_vat IS NULL OR row_data.customs_vat < 0
        OR row_data.payment3_total IS NULL OR row_data.payment3_total < 0
        OR row_data.payment3_status IS DISTINCT FROM 'paid'
        OR row_data.unit_cost_krw IS NULL OR row_data.unit_cost_krw < 0
        OR row_data.total_amount_krw IS NULL OR row_data.total_amount_krw < 0
        OR row_data.payment_status IS DISTINCT FROM 'paid'
        OR row_data.status NOT IN ('ordered', 'arrived')
        OR (row_data.status = 'arrived') IS DISTINCT FROM (row_data.arrival_date IS NOT NULL)
        OR (row_data.status = 'arrived' AND row_data.product_id IS NULL)
        OR (row_data.status = 'arrived' AND row_data.unit_cost_krw <= 0)
        OR abs(row_data.payment1_total - (row_data.payment1_product_krw + row_data.payment1_vat)) > 0.01
        OR abs(row_data.payment2_total - row_data.additional_cost) > 0.01
        OR abs(row_data.payment3_total - (row_data.domestic_shipping + row_data.customs_vat)) > 0.01
        OR abs(row_data.total_amount_krw - round(row_data.payment1_total + row_data.payment2_total + row_data.payment3_total, 2)) > 0.01
        OR abs(row_data.unit_cost_krw - round(row_data.total_amount_krw / NULLIF(row_data.quantity, 0), 2)) > 0.01
        OR NULLIF(btrim(COALESCE(row_data.product_name_memo, '')), '') IS NULL
        OR length(COALESCE(row_data.product_name_memo, '')) > 500
        OR length(COALESCE(row_data.po_number, '')) > 100
        OR length(COALESCE(row_data.notes, '')) > 2000
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IMPORT_INVALID_ROW';
  END IF;

  -- service_role 호출이어도 연결 상품이 같은 사용자·사업장 소유인지 DB에서 다시 검증한다.
  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_rows) AS row_data(product_id UUID)
     WHERE row_data.product_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.products AS product
          WHERE product.id = row_data.product_id
            AND product.user_id = p_user_id
            AND product.business_id = p_business_id
       )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IMPORT_PRODUCT_SCOPE_MISMATCH';
  END IF;

  FOR v_row IN
    SELECT row_data.*
      FROM jsonb_to_recordset(p_rows) AS row_data(
        product_id UUID,
        po_number TEXT,
        order_date DATE,
        arrival_date DATE,
        expected_arrival_date DATE,
        lead_time_weeks INTEGER,
        quantity INTEGER,
        unit_price NUMERIC,
        currency TEXT,
        exchange_rate NUMERIC,
        shipping_cost NUMERIC,
        payment1_product_krw NUMERIC,
        payment1_vat NUMERIC,
        payment1_total NUMERIC,
        payment1_status TEXT,
        payment2_vat NUMERIC,
        additional_cost NUMERIC,
        payment2_total NUMERIC,
        payment2_status TEXT,
        domestic_shipping NUMERIC,
        customs_vat NUMERIC,
        payment3_total NUMERIC,
        payment3_status TEXT,
        unit_cost_krw NUMERIC,
        total_amount_krw NUMERIC,
        payment_status TEXT,
        status TEXT,
        notes TEXT,
        product_name_memo TEXT
      )
  LOOP
    INSERT INTO public.purchases (
      user_id,
      business_id,
      product_id,
      po_number,
      order_date,
      arrival_date,
      expected_arrival_date,
      lead_time_weeks,
      quantity,
      unit_price,
      currency,
      exchange_rate,
      shipping_cost,
      payment1_product_krw,
      payment1_vat,
      payment1_total,
      payment1_status,
      payment2_vat,
      additional_cost,
      payment2_total,
      payment2_status,
      domestic_shipping,
      customs_vat,
      payment3_total,
      payment3_status,
      unit_cost_krw,
      total_amount_krw,
      payment_status,
      status,
      notes,
      product_name_memo
    ) VALUES (
      p_user_id,
      p_business_id,
      v_row.product_id,
      v_row.po_number,
      v_row.order_date,
      v_row.arrival_date,
      v_row.expected_arrival_date,
      v_row.lead_time_weeks,
      v_row.quantity,
      v_row.unit_price,
      v_row.currency,
      v_row.exchange_rate,
      v_row.shipping_cost,
      v_row.payment1_product_krw,
      v_row.payment1_vat,
      v_row.payment1_total,
      v_row.payment1_status,
      v_row.payment2_vat,
      v_row.additional_cost,
      v_row.payment2_total,
      v_row.payment2_status,
      v_row.domestic_shipping,
      v_row.customs_vat,
      v_row.payment3_total,
      v_row.payment3_status,
      v_row.unit_cost_krw,
      v_row.total_amount_krw,
      v_row.payment_status,
      v_row.status,
      v_row.notes,
      v_row.product_name_memo
    )
    RETURNING id INTO v_purchase_id;

    v_purchase_ids := array_append(v_purchase_ids, v_purchase_id);
    v_inserted := v_inserted + 1;

    IF v_row.status = 'arrived' AND v_row.product_id IS NOT NULL THEN
      PERFORM public.apply_purchase_inventory_effect_atomic(
        p_user_id,
        p_business_id,
        v_purchase_id,
        p_import_batch_id,
        v_row.product_id,
        v_row.quantity,
        v_row.unit_cost_krw,
        'inbound',
        v_row.arrival_date,
        v_row.po_number
      );
    END IF;
  END LOOP;

  IF v_inserted <> jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IMPORT_COUNT_MISMATCH';
  END IF;

  UPDATE public.purchase_import_receipts AS receipt
     SET purchase_ids = v_purchase_ids,
         inserted_count = v_inserted,
         response = jsonb_build_object(
           'insertedCount', v_inserted,
           'purchaseIds', to_jsonb(v_purchase_ids),
           'replayed', FALSE
         )
   WHERE receipt.import_batch_id = p_import_batch_id
     AND receipt.actor_user_id = p_user_id
     AND receipt.business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IMPORT_RECEIPT_WRITE_FAILED';
  END IF;

  -- 구매·재고 반영과 배치 성공 확정을 같은 트랜잭션에 둔다.
  UPDATE public.coupang_imports AS import_batch
     SET status = 'completed',
         success_count = v_inserted,
         error_count = 0,
         completed_at = NOW(),
         summary = COALESCE(import_batch.summary, '{}'::JSONB)
           || jsonb_build_object('atomic_purchase_import', TRUE, 'replayed', FALSE)
   WHERE import_batch.id = p_import_batch_id
     AND import_batch.user_id = p_user_id
     AND import_batch.business_id = p_business_id
     AND import_batch.import_type = 'purchase'
     AND import_batch.status = 'processing';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IMPORT_BATCH_COMPLETION_FAILED';
  END IF;

  RETURN v_inserted;
END;
$$;

-- from 20260725180000_safe_sales_gap_backfill.sql
CREATE OR REPLACE FUNCTION public.insert_sales_gap_backfill_tx(
  p_user_id TEXT,
  p_business_id UUID,
  p_import_date DATE,
  p_content_sha256 TEXT,
  p_import_batch_id UUID,
  p_file_name TEXT,
  p_file_size INTEGER,
  p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_receipt_id UUID := gen_random_uuid();
  v_inserted INTEGER := 0;
  v_expected INTEGER := 0;
  v_row RECORD;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NXSAFE_SALES_GAP_SERVICE_ROLE_ONLY';
  END IF;

  IF p_user_id IS NULL OR btrim(p_user_id) = ''
     OR p_business_id IS NULL
     OR p_import_date IS NULL
     OR p_content_sha256 IS NULL
     OR p_content_sha256 !~ '^[a-f0-9]{64}$'
     OR p_import_batch_id IS NULL
     OR p_file_name IS NULL OR btrim(p_file_name) = ''
     OR p_file_size IS NULL OR p_file_size < 0
     OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NXSAFE_SALES_GAP_INVALID_REQUEST';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.businesses AS business
     WHERE business.id = p_business_id
       AND business.user_id = btrim(p_user_id)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NXSAFE_SALES_GAP_BUSINESS_SCOPE_MISMATCH';
  END IF;

  -- 같은 사용자·사업장·일자의 안전 복구 호출을 직렬화한다.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'insert_sales_gap_backfill_tx:'
        || btrim(p_user_id) || ':'
        || p_business_id::TEXT || ':'
        || p_import_date::TEXT,
      0
    )
  );

  -- advisory key를 모르는 일반 Import 쓰기와도 빈 날짜 확인·삽입을 직렬화한다.
  LOCK TABLE public.sales_transactions IN SHARE ROW EXCLUSIVE MODE;

  -- 원천과 무관하게 같은 범위에 판매행이 하나라도 있으면 빈 날짜가 아니다.
  IF EXISTS (
    SELECT 1
      FROM public.sales_transactions AS existing
     WHERE existing.user_id = btrim(p_user_id)
       AND existing.business_id = p_business_id
       AND existing.order_date = p_import_date
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NXSAFE_SALES_GAP_DATE_NOT_EMPTY';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.safe_sales_gap_backfill_receipts AS receipt
     WHERE (
       receipt.user_id = btrim(p_user_id)
       AND receipt.business_id = p_business_id
       AND receipt.import_date = p_import_date
       AND receipt.content_sha256 = p_content_sha256
     )
     OR receipt.import_batch_id = p_import_batch_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NXSAFE_SALES_GAP_DUPLICATE_RECEIPT';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.coupang_imports AS import_batch
     WHERE import_batch.id = p_import_batch_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NXSAFE_SALES_GAP_BATCH_ALREADY_EXISTS';
  END IF;

  -- 완전히 동일한 JSON 행 및 비어 있지 않은 주문번호 중복을 모두 거부한다.
  IF (
    SELECT count(*) FROM jsonb_array_elements(p_rows)
  ) IS DISTINCT FROM (
    SELECT count(DISTINCT row_value) FROM jsonb_array_elements(p_rows) AS input(row_value)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NXSAFE_SALES_GAP_DUPLICATE_ROW';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_rows) AS row_data(order_number TEXT)
     WHERE row_data.order_number IS NOT NULL
       AND btrim(row_data.order_number) <> ''
     GROUP BY btrim(row_data.order_number)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NXSAFE_SALES_GAP_DUPLICATE_ORDER_NUMBER';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_rows) AS row_data(
        order_number TEXT,
        option_id TEXT
      )
     WHERE row_data.order_number IS NULL
        OR btrim(row_data.order_number) = ''
     GROUP BY btrim(row_data.option_id)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NXSAFE_SALES_GAP_DUPLICATE_OPTION_ROW';
  END IF;

  v_expected := jsonb_array_length(p_rows);

  FOR v_row IN
    SELECT *
      FROM jsonb_to_recordset(p_rows) AS row_data(
        user_id TEXT,
        business_id UUID,
        product_id UUID,
        option_id TEXT,
        order_number TEXT,
        order_date DATE,
        order_quantity INTEGER,
        selling_price NUMERIC,
        total_amount NUMERIC,
        unit_cost NUMERIC,
        shipping_fee NUMERIC,
        commission_amount NUMERIC,
        exchange_rate NUMERIC,
        status TEXT,
        source TEXT,
        import_batch_id UUID,
        notes TEXT,
        product_type TEXT,
        category TEXT,
        option_name TEXT,
        item_winner_rate NUMERIC,
        gross_amount NUMERIC,
        gross_quantity INTEGER,
        cancel_amount NUMERIC,
        cancel_quantity INTEGER,
        coupon_discount NUMERIC,
        commission_rate NUMERIC,
        commission_fee NUMERIC,
        commission_vat NUMERIC,
        settlement_amount NUMERIC,
        fulfillment_fee NUMERIC,
        fulfillment_vat NUMERIC,
        payout_amount NUMERIC,
        vat NUMERIC,
        margin NUMERIC
      )
  LOOP
    IF v_row.user_id IS DISTINCT FROM btrim(p_user_id)
       OR v_row.business_id IS DISTINCT FROM p_business_id
       OR v_row.order_date IS DISTINCT FROM p_import_date
       OR v_row.source IS DISTINCT FROM 'coupang_import'
       OR v_row.import_batch_id IS DISTINCT FROM p_import_batch_id THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'NXSAFE_SALES_GAP_ROW_SCOPE_MISMATCH';
    END IF;

    IF (v_row.order_number IS NULL OR btrim(v_row.order_number) = '')
       AND (v_row.option_id IS NULL OR btrim(v_row.option_id) = '') THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'NXSAFE_SALES_GAP_AMBIGUOUS_ROW';
    END IF;

    IF v_row.product_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.products AS product
          WHERE product.id = v_row.product_id
            AND product.user_id = btrim(p_user_id)
            AND product.business_id = p_business_id
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'NXSAFE_SALES_GAP_PRODUCT_SCOPE_MISMATCH';
    END IF;

    IF v_row.order_quantity IS NULL
       OR (
         (
           v_row.order_quantity <= 0
           OR v_row.total_amount < 0
           OR v_row.commission_fee < 0
           OR v_row.commission_vat < 0
         )
         AND (
           v_row.cancel_amount IS NULL
           OR v_row.cancel_amount <= 0
           OR v_row.cancel_quantity IS NULL
           OR v_row.cancel_quantity <= 0
         )
       )
       OR v_row.selling_price IS NULL OR v_row.selling_price < 0
       OR v_row.selling_price::TEXT = 'NaN'
       OR v_row.total_amount IS NULL
       OR v_row.total_amount::TEXT = 'NaN'
       OR v_row.unit_cost < 0 OR v_row.unit_cost::TEXT = 'NaN'
       OR v_row.shipping_fee < 0 OR v_row.shipping_fee::TEXT = 'NaN'
       OR v_row.commission_amount < 0 OR v_row.commission_amount::TEXT = 'NaN'
       OR v_row.exchange_rate <= 0 OR v_row.exchange_rate::TEXT = 'NaN'
       OR v_row.item_winner_rate < 0 OR v_row.item_winner_rate > 1
       OR v_row.item_winner_rate::TEXT = 'NaN'
       OR v_row.gross_amount < 0 OR v_row.gross_amount::TEXT = 'NaN'
       OR v_row.gross_quantity < 0
       OR v_row.cancel_amount < 0 OR v_row.cancel_amount::TEXT = 'NaN'
       OR v_row.cancel_quantity < 0
       OR v_row.coupon_discount < 0 OR v_row.coupon_discount::TEXT = 'NaN'
       OR v_row.commission_rate < 0 OR v_row.commission_rate > 1
       OR v_row.commission_rate::TEXT = 'NaN'
       OR v_row.commission_fee::TEXT = 'NaN'
       OR v_row.commission_vat::TEXT = 'NaN'
       OR v_row.settlement_amount < 0 OR v_row.settlement_amount::TEXT = 'NaN'
       OR v_row.fulfillment_fee < 0 OR v_row.fulfillment_fee::TEXT = 'NaN'
       OR v_row.fulfillment_vat < 0 OR v_row.fulfillment_vat::TEXT = 'NaN'
       OR v_row.payout_amount < 0 OR v_row.payout_amount::TEXT = 'NaN'
       OR v_row.vat < 0 OR v_row.vat::TEXT = 'NaN'
       OR v_row.margin::TEXT = 'NaN'
       OR v_row.status IS NULL
       OR v_row.status NOT IN ('confirmed', 'cancelled', 'returned') THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'NXSAFE_SALES_GAP_INVALID_ROW';
    END IF;
  END LOOP;

  -- 아래 세 쓰기는 함수 호출 트랜잭션 안에서 함께 성공하거나 함께 롤백된다.
  INSERT INTO public.safe_sales_gap_backfill_receipts (
    id,
    user_id,
    business_id,
    import_date,
    content_sha256,
    import_batch_id,
    file_name,
    file_size,
    row_count
  )
  VALUES (
    v_receipt_id,
    btrim(p_user_id),
    p_business_id,
    p_import_date,
    p_content_sha256,
    p_import_batch_id,
    btrim(p_file_name),
    p_file_size,
    v_expected
  );

  INSERT INTO public.coupang_imports (
    id,
    user_id,
    business_id,
    import_type,
    file_name,
    file_size,
    row_count,
    success_count,
    error_count,
    status,
    summary,
    completed_at
  )
  VALUES (
    p_import_batch_id,
    btrim(p_user_id),
    p_business_id,
    'sales',
    btrim(p_file_name),
    p_file_size,
    v_expected,
    v_expected,
    0,
    'completed',
    jsonb_build_object(
      'mode', 'insert_only_gap_backfill',
      'derivedState', 'not_applied',
      'importDate', p_import_date,
      'contentSha256', p_content_sha256,
      'receiptId', v_receipt_id
    ),
    clock_timestamp()
  );

  INSERT INTO public.sales_transactions (
    user_id,
    business_id,
    product_id,
    option_id,
    order_number,
    order_date,
    order_quantity,
    selling_price,
    total_amount,
    unit_cost,
    shipping_fee,
    commission_amount,
    exchange_rate,
    status,
    source,
    import_batch_id,
    notes,
    product_type,
    category,
    option_name,
    item_winner_rate,
    gross_amount,
    gross_quantity,
    cancel_amount,
    cancel_quantity,
    coupon_discount,
    commission_rate,
    commission_fee,
    commission_vat,
    settlement_amount,
    fulfillment_fee,
    fulfillment_vat,
    payout_amount,
    vat,
    margin
  )
  SELECT
    btrim(p_user_id),
    p_business_id,
    row_data.product_id,
    row_data.option_id,
    row_data.order_number,
    p_import_date,
    row_data.order_quantity,
    row_data.selling_price,
    row_data.total_amount,
    row_data.unit_cost,
    row_data.shipping_fee,
    row_data.commission_amount,
    row_data.exchange_rate,
    row_data.status,
    'coupang_import',
    p_import_batch_id,
    row_data.notes,
    row_data.product_type,
    row_data.category,
    row_data.option_name,
    row_data.item_winner_rate,
    row_data.gross_amount,
    row_data.gross_quantity,
    row_data.cancel_amount,
    row_data.cancel_quantity,
    row_data.coupon_discount,
    row_data.commission_rate,
    row_data.commission_fee,
    row_data.commission_vat,
    row_data.settlement_amount,
    row_data.fulfillment_fee,
    row_data.fulfillment_vat,
    row_data.payout_amount,
    row_data.vat,
    row_data.margin
  FROM jsonb_to_recordset(p_rows) AS row_data(
    product_id UUID,
    option_id TEXT,
    order_number TEXT,
    order_quantity INTEGER,
    selling_price NUMERIC,
    total_amount NUMERIC,
    unit_cost NUMERIC,
    shipping_fee NUMERIC,
    commission_amount NUMERIC,
    exchange_rate NUMERIC,
    status TEXT,
    notes TEXT,
    product_type TEXT,
    category TEXT,
    option_name TEXT,
    item_winner_rate NUMERIC,
    gross_amount NUMERIC,
    gross_quantity INTEGER,
    cancel_amount NUMERIC,
    cancel_quantity INTEGER,
    coupon_discount NUMERIC,
    commission_rate NUMERIC,
    commission_fee NUMERIC,
    commission_vat NUMERIC,
    settlement_amount NUMERIC,
    fulfillment_fee NUMERIC,
    fulfillment_vat NUMERIC,
    payout_amount NUMERIC,
    vat NUMERIC,
    margin NUMERIC
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NXSAFE_SALES_GAP_INSERT_COUNT_MISMATCH';
  END IF;

  RETURN jsonb_build_object(
    'receiptId', v_receipt_id,
    'batchId', p_import_batch_id,
    'insertedCount', v_inserted,
    'status', 'completed',
    'mode', 'insert_only_gap_backfill',
    'derivedState', 'not_applied',
    'importDate', p_import_date,
    'contentSha256', p_content_sha256
  );
END;
$$;

-- from 20260725140000_business_mutation_atomic.sql
CREATE OR REPLACE FUNCTION public.patch_owned_business_atomic(
  p_actor_user_id TEXT,
  p_business_id UUID,
  p_fields JSONB,
  p_make_default BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current public.businesses%ROWTYPE;
  v_saved public.businesses%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = ''
     OR p_business_id IS NULL
     OR p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object'
     OR (p_fields = '{}'::JSONB AND NOT p_make_default) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXBUS_INVALID_REQUEST';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_object_keys(p_fields) AS supplied(key)
     WHERE NOT (supplied.key = ANY (ARRAY[
       'business_name', 'business_number', 'representative',
       'business_type', 'business_category', 'address'
     ]))
  ) OR (
    p_fields ? 'business_name'
    AND NULLIF(btrim(p_fields->>'business_name'), '') IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXBUS_INVALID_REQUEST';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_user_id, 0));
  SELECT * INTO v_current
    FROM public.businesses
   WHERE id = p_business_id
     AND user_id = p_actor_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.businesses WHERE id = p_business_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXBUS_SCOPE_MISMATCH';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXBUS_NOT_FOUND';
  END IF;

  IF p_make_default THEN
    UPDATE public.businesses
       SET is_default = FALSE,
           updated_at = clock_timestamp()
     WHERE user_id = p_actor_user_id
       AND id <> p_business_id
       AND is_default = TRUE;
  END IF;

  UPDATE public.businesses
     SET business_name = CASE
           WHEN p_fields ? 'business_name' THEN btrim(p_fields->>'business_name')
           ELSE business_name
         END,
         business_number = CASE
           WHEN p_fields ? 'business_number' THEN NULLIF(btrim(p_fields->>'business_number'), '')
           ELSE business_number
         END,
         representative = CASE
           WHEN p_fields ? 'representative' THEN NULLIF(btrim(p_fields->>'representative'), '')
           ELSE representative
         END,
         business_type = CASE
           WHEN p_fields ? 'business_type' THEN NULLIF(btrim(p_fields->>'business_type'), '')
           ELSE business_type
         END,
         business_category = CASE
           WHEN p_fields ? 'business_category' THEN NULLIF(btrim(p_fields->>'business_category'), '')
           ELSE business_category
         END,
         address = CASE
           WHEN p_fields ? 'address' THEN NULLIF(btrim(p_fields->>'address'), '')
           ELSE address
         END,
         is_default = CASE WHEN p_make_default THEN TRUE ELSE is_default END,
         updated_at = clock_timestamp()
   WHERE id = p_business_id
     AND user_id = p_actor_user_id
  RETURNING * INTO v_saved;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXBUS_SCOPE_MISMATCH';
  END IF;

  RETURN to_jsonb(v_saved);
END;
$$;

-- from 20260725120000_purchase_inventory_atomic.sql
CREATE OR REPLACE FUNCTION public.patch_purchase_atomic(
  p_actor_user_id TEXT,
  p_business_id UUID,
  p_purchase_id UUID,
  p_expected_updated_at TIMESTAMPTZ,
  p_operation_id UUID,
  p_patch JSONB,
  p_effective_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current public.purchases%ROWTYPE;
  v_next public.purchases%ROWTYPE;
  v_saved public.purchases%ROWTYPE;
  v_receipt public.purchase_mutation_receipts%ROWTYPE;
  v_request JSONB;
  v_response JSONB;
  v_inventory_result JSONB := NULL;
  v_inventory_effect TEXT := 'none';
  v_movement_ids JSONB := '[]'::JSONB;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_agency_fee_krw NUMERIC;
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' OR p_business_id IS NULL
     OR p_purchase_id IS NULL OR p_expected_updated_at IS NULL OR p_operation_id IS NULL
     OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_INVALID_REQUEST';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_object_keys(p_patch) AS supplied(key)
     WHERE NOT (supplied.key = ANY (ARRAY[
       'product_id', 'supplier_id', 'po_number', 'order_date', 'arrival_date',
       'expected_arrival_date', 'lead_time_weeks', 'quantity', 'unit_price', 'currency',
       'exchange_rate', 'shipping_cost', 'payment1_vat', 'payment1_status',
       'inspection_fee', 'labeling_fee', 'packaging_fee', 'customs_doc_fee',
       'agency_fee', 'payment2_vat', 'payment2_status', 'domestic_shipping',
       'customs_duty', 'customs_vat', 'payment3_status', 'payment_status',
       'status', 'notes', 'product_name_memo'
     ]))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_INVALID_PATCH_FIELD';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
     WHERE id = p_business_id AND user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_SCOPE_MISMATCH';
  END IF;

  v_request := jsonb_build_object(
    'expectedUpdatedAt', p_expected_updated_at,
    'patch', p_patch,
    'effectiveDate', p_effective_date
  );

  INSERT INTO public.purchase_mutation_receipts (
    operation_id, actor_user_id, business_id, purchase_id, action, request_payload
  ) VALUES (
    p_operation_id, p_actor_user_id, p_business_id, p_purchase_id, 'patch', v_request
  )
  ON CONFLICT (operation_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT * INTO v_receipt
      FROM public.purchase_mutation_receipts
     WHERE operation_id = p_operation_id;
    IF NOT FOUND OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
       OR v_receipt.business_id IS DISTINCT FROM p_business_id
       OR v_receipt.purchase_id IS DISTINCT FROM p_purchase_id
       OR v_receipt.action IS DISTINCT FROM 'patch'
       OR v_receipt.request_payload IS DISTINCT FROM v_request
       OR v_receipt.response IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN jsonb_set(v_receipt.response, '{mutation,replayed}', 'true'::JSONB, TRUE);
  END IF;

  SELECT * INTO v_current
    FROM public.purchases
   WHERE id = p_purchase_id
     AND user_id = p_actor_user_id
     AND business_id = p_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.purchases WHERE id = p_purchase_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_SCOPE_MISMATCH';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_NOT_FOUND';
  END IF;

  IF v_current.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_STALE_VERSION';
  END IF;

  v_next := jsonb_populate_record(v_current, p_patch);

  IF v_next.quantity IS NULL OR v_next.quantity <= 0
     OR v_next.unit_price IS NULL OR v_next.unit_price < 0
     OR v_next.exchange_rate IS NULL OR v_next.exchange_rate <= 0
     OR v_next.order_date IS NULL
     OR v_next.currency NOT IN ('CNY', 'USD', 'KRW')
     OR v_next.status NOT IN ('ordered', 'paid_1688', 'collecting', 'processing', 'shipped', 'customs', 'domestic', 'arrived', 'cancelled')
     OR v_next.payment1_status NOT IN ('unpaid', 'paid', 'none')
     OR v_next.payment2_status NOT IN ('unpaid', 'paid', 'none')
     OR v_next.payment3_status NOT IN ('unpaid', 'paid', 'none')
     OR v_next.payment_status NOT IN ('unpaid', 'partial', 'paid') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_INVALID_PATCH_VALUE';
  END IF;

  IF v_next.product_id IS NULL AND NULLIF(btrim(COALESCE(v_next.product_name_memo, '')), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_PRODUCT_REQUIRED';
  END IF;
  IF length(COALESCE(v_next.po_number, '')) > 100
     OR length(COALESCE(v_next.product_name_memo, '')) > 500
     OR length(COALESCE(v_next.notes, '')) > 2000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_INVALID_TEXT_LENGTH';
  END IF;

  IF v_next.product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.products
     WHERE id = v_next.product_id
       AND user_id = p_actor_user_id
       AND business_id = p_business_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_PRODUCT_SCOPE_MISMATCH';
  END IF;
  IF v_next.supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers
     WHERE id = v_next.supplier_id
       AND user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_SUPPLIER_SCOPE_MISMATCH';
  END IF;

  -- arrived 행의 재고 기초를 바꾸는 필드는 같은 호출에서 변경하지 못한다.
  IF v_current.status = 'arrived' AND (
    v_next.product_id IS DISTINCT FROM v_current.product_id
    OR v_next.quantity IS DISTINCT FROM v_current.quantity
    OR COALESCE(v_next.unit_price, 0) IS DISTINCT FROM COALESCE(v_current.unit_price, 0)
    OR v_next.currency IS DISTINCT FROM v_current.currency
    OR COALESCE(v_next.exchange_rate, 0) IS DISTINCT FROM COALESCE(v_current.exchange_rate, 0)
    OR COALESCE(v_next.shipping_cost, 0) IS DISTINCT FROM COALESCE(v_current.shipping_cost, 0)
    OR COALESCE(v_next.payment1_vat, 0) IS DISTINCT FROM COALESCE(v_current.payment1_vat, 0)
    OR COALESCE(v_next.inspection_fee, 0) IS DISTINCT FROM COALESCE(v_current.inspection_fee, 0)
    OR COALESCE(v_next.labeling_fee, 0) IS DISTINCT FROM COALESCE(v_current.labeling_fee, 0)
    OR COALESCE(v_next.packaging_fee, 0) IS DISTINCT FROM COALESCE(v_current.packaging_fee, 0)
    OR COALESCE(v_next.customs_doc_fee, 0) IS DISTINCT FROM COALESCE(v_current.customs_doc_fee, 0)
    OR COALESCE(v_next.agency_fee, 0) IS DISTINCT FROM COALESCE(v_current.agency_fee, 0)
    OR COALESCE(v_next.payment2_vat, 0) IS DISTINCT FROM COALESCE(v_current.payment2_vat, 0)
    OR COALESCE(v_next.domestic_shipping, 0) IS DISTINCT FROM COALESCE(v_current.domestic_shipping, 0)
    OR COALESCE(v_next.customs_duty, 0) IS DISTINCT FROM COALESCE(v_current.customs_duty, 0)
    OR COALESCE(v_next.customs_vat, 0) IS DISTINCT FROM COALESCE(v_current.customs_vat, 0)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_ARRIVED_IMMUTABLE';
  END IF;

  IF p_patch ? 'payment1_status' THEN
    v_next.payment1_date := CASE WHEN v_next.payment1_status = 'paid' THEN p_effective_date ELSE NULL END;
  END IF;
  IF p_patch ? 'payment2_status' THEN
    v_next.payment2_date := CASE WHEN v_next.payment2_status = 'paid' THEN p_effective_date ELSE NULL END;
  END IF;
  IF p_patch ? 'payment3_status' THEN
    v_next.payment3_date := CASE WHEN v_next.payment3_status = 'paid' THEN p_effective_date ELSE NULL END;
  END IF;
  IF p_patch ? 'payment_status' THEN
    v_next.payment_date := CASE WHEN v_next.payment_status = 'paid' THEN p_effective_date ELSE NULL END;
  END IF;

  v_next.additional_cost := round(
    COALESCE(v_next.shipping_cost, 0) + COALESCE(v_next.inspection_fee, 0)
    + COALESCE(v_next.labeling_fee, 0) + COALESCE(v_next.packaging_fee, 0)
    + COALESCE(v_next.customs_doc_fee, 0) + COALESCE(v_next.payment2_vat, 0), 2
  );
  v_agency_fee_krw := round(COALESCE(v_next.agency_fee, 0) * v_next.exchange_rate, 2);
  v_next.payment1_product_krw := round(
    (v_next.unit_price * v_next.exchange_rate * v_next.quantity) + v_agency_fee_krw, 2
  );
  v_next.payment1_total := round(v_next.payment1_product_krw + COALESCE(v_next.payment1_vat, 0), 2);
  v_next.payment2_total := v_next.additional_cost;
  v_next.payment3_total := round(
    COALESCE(v_next.domestic_shipping, 0) + COALESCE(v_next.customs_duty, 0) + COALESCE(v_next.customs_vat, 0), 2
  );
  v_next.total_amount_krw := round(v_next.payment1_total + v_next.payment2_total + v_next.payment3_total, 2);
  v_next.unit_cost_krw := round(
    (v_next.unit_price * v_next.exchange_rate)
    + (v_agency_fee_krw + COALESCE(v_next.payment1_vat, 0) + v_next.payment2_total + v_next.payment3_total) / v_next.quantity,
    2
  );

  IF v_current.status <> 'arrived' AND v_next.status = 'arrived' THEN
    IF v_next.product_id IS NULL OR v_next.unit_cost_krw <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_ARRIVAL_INPUT_REQUIRED';
    END IF;
    v_next.arrival_date := COALESCE(v_next.arrival_date, p_effective_date);
    v_inventory_result := public.apply_purchase_inventory_effect_atomic(
      p_actor_user_id, p_business_id, p_purchase_id, p_operation_id,
      v_next.product_id, v_next.quantity, v_next.unit_cost_krw,
      'inbound', v_next.arrival_date, v_next.po_number
    );
    v_inventory_effect := 'inbound';
  ELSIF v_current.status = 'arrived' AND v_next.status <> 'arrived' THEN
    IF v_current.product_id IS NULL OR v_current.unit_cost_krw IS NULL OR v_current.unit_cost_krw <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_REVERSAL_INPUT_MISSING';
    END IF;
    v_inventory_result := public.apply_purchase_inventory_effect_atomic(
      p_actor_user_id, p_business_id, p_purchase_id, p_operation_id,
      v_current.product_id, v_current.quantity, v_current.unit_cost_krw,
      'reversal', p_effective_date, v_current.po_number
    );
    v_inventory_effect := 'reversal';
    -- 상태를 되돌린 매입에는 실제 입고일이 남을 수 없다. 전체 폼 PATCH도 동일하게 처리한다.
    v_next.arrival_date := NULL;
  END IF;

  IF v_inventory_result IS NOT NULL THEN
    v_movement_ids := jsonb_build_array(v_inventory_result->>'movementId');
  END IF;

  UPDATE public.purchases
     SET supplier_id = v_next.supplier_id,
         product_id = v_next.product_id,
         po_number = v_next.po_number,
         order_date = v_next.order_date,
         arrival_date = v_next.arrival_date,
         expected_arrival_date = v_next.expected_arrival_date,
         lead_time_weeks = v_next.lead_time_weeks,
         quantity = v_next.quantity,
         unit_price = v_next.unit_price,
         currency = v_next.currency,
         exchange_rate = v_next.exchange_rate,
         shipping_cost = v_next.shipping_cost,
         payment1_product_krw = v_next.payment1_product_krw,
         payment1_vat = v_next.payment1_vat,
         payment1_total = v_next.payment1_total,
         payment1_date = v_next.payment1_date,
         payment1_status = v_next.payment1_status,
         inspection_fee = v_next.inspection_fee,
         labeling_fee = v_next.labeling_fee,
         packaging_fee = v_next.packaging_fee,
         customs_doc_fee = v_next.customs_doc_fee,
         agency_fee = v_next.agency_fee,
         payment2_vat = v_next.payment2_vat,
         additional_cost = v_next.additional_cost,
         payment2_total = v_next.payment2_total,
         payment2_date = v_next.payment2_date,
         payment2_status = v_next.payment2_status,
         domestic_shipping = v_next.domestic_shipping,
         customs_duty = v_next.customs_duty,
         customs_vat = v_next.customs_vat,
         payment3_total = v_next.payment3_total,
         payment3_date = v_next.payment3_date,
         payment3_status = v_next.payment3_status,
         unit_cost_krw = v_next.unit_cost_krw,
         total_amount_krw = v_next.total_amount_krw,
         payment_status = v_next.payment_status,
         payment_date = v_next.payment_date,
         status = v_next.status,
         notes = v_next.notes,
         product_name_memo = v_next.product_name_memo,
         updated_at = v_now
   WHERE id = p_purchase_id
     AND user_id = p_actor_user_id
     AND business_id = p_business_id
  RETURNING * INTO v_saved;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_PURCHASE_UPDATE_FAILED';
  END IF;

  v_response := jsonb_build_object(
    'purchase', to_jsonb(v_saved),
    'mutation', jsonb_build_object(
      'operationId', p_operation_id,
      'applied', TRUE,
      'replayed', FALSE,
      'action', 'patch',
      'previousStatus', v_current.status,
      'status', v_saved.status,
      'inventoryEffect', v_inventory_effect,
      'movementIds', v_movement_ids,
      'inventory', CASE WHEN v_inventory_result IS NULL THEN NULL ELSE v_inventory_result->'inventory' END
    )
  );

  UPDATE public.purchase_mutation_receipts
     SET response = v_response
   WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NXPUR_RECEIPT_WRITE_FAILED';
  END IF;
  RETURN v_response;
END;
$$;

-- from 20260725100000_atomic_ad_import.sql
CREATE OR REPLACE FUNCTION public.replace_coupang_import_ad_campaigns(
  p_user_id text,
  p_business_id uuid,
  p_import_batch_id uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role only';
  END IF;
  IF p_user_id IS NULL OR btrim(p_user_id) = '' OR p_business_id IS NULL OR p_import_batch_id IS NULL THEN
    RAISE EXCEPTION 'user, business and import batch are required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = p_business_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'business ownership mismatch';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'at least one ad campaign row is required';
  END IF;

  -- 동일 사업장의 날짜 교체를 직렬화한다. 잠금이 없으면 동시 트랜잭션 둘이 서로의
  -- 신규 INSERT를 보지 못한 채 각자 삽입해 서로 다른 batch_id의 중복 행이 남을 수 있다.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('replace_coupang_import_ad_campaigns:' || p_business_id::text, 0)
  );

  -- 서비스 롤이어도 호출자가 넘긴 배치가 해당 사용자·사업장의 현재 광고 Import인지
  -- 다시 결합한다. 다른 배치 UUID를 광고 행의 import_batch_id로 가장하는 것을 방지한다.
  IF NOT EXISTS (
    SELECT 1
    FROM public.coupang_imports import_batch
    WHERE import_batch.id = p_import_batch_id
      AND import_batch.user_id = p_user_id
      AND import_batch.business_id = p_business_id
      AND import_batch.import_type = 'ad_billing'
      AND import_batch.status = 'processing'
  ) THEN
    RAISE EXCEPTION 'import batch ownership, type or status mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_rows) AS row_data(
      campaign_id text,
      campaign_name text,
      ad_type text,
      ad_date date,
      spent_amount numeric,
      billable_amount numeric,
      vat_amount numeric,
      impressions integer,
      clicks integer,
      conversions integer
    )
    WHERE row_data.campaign_id IS NULL
       OR btrim(row_data.campaign_id) = ''
       OR row_data.ad_date IS NULL
       OR row_data.spent_amount IS NULL
       OR row_data.spent_amount < 0
       OR row_data.billable_amount < 0
       OR row_data.vat_amount < 0
       OR row_data.impressions < 0
       OR row_data.clicks < 0
       OR row_data.conversions < 0
  ) THEN
    RAISE EXCEPTION 'invalid ad campaign row';
  END IF;

  IF (
    SELECT count(*)
    FROM jsonb_to_recordset(p_rows) AS row_data(campaign_id text, ad_date date)
  ) <> (
    SELECT count(DISTINCT (row_data.campaign_id, row_data.ad_date))
    FROM jsonb_to_recordset(p_rows) AS row_data(campaign_id text, ad_date date)
  ) THEN
    RAISE EXCEPTION 'duplicate campaign and date rows';
  END IF;

  DELETE FROM public.ad_campaigns existing
  WHERE existing.user_id = p_user_id
    AND existing.business_id = p_business_id
    AND existing.source = 'coupang_import'
    AND existing.ad_date IN (
      SELECT DISTINCT row_data.ad_date
      FROM jsonb_to_recordset(p_rows) AS row_data(ad_date date)
    );

  INSERT INTO public.ad_campaigns (
    user_id,
    business_id,
    campaign_id,
    campaign_name,
    ad_type,
    ad_date,
    spent_amount,
    billable_amount,
    vat_amount,
    impressions,
    clicks,
    conversions,
    source,
    import_batch_id
  )
  SELECT
    p_user_id,
    p_business_id,
    row_data.campaign_id,
    row_data.campaign_name,
    row_data.ad_type,
    row_data.ad_date,
    row_data.spent_amount,
    row_data.billable_amount,
    row_data.vat_amount,
    row_data.impressions,
    row_data.clicks,
    row_data.conversions,
    'coupang_import',
    p_import_batch_id
  FROM jsonb_to_recordset(p_rows) AS row_data(
    campaign_id text,
    campaign_name text,
    ad_type text,
    ad_date date,
    spent_amount numeric,
    billable_amount numeric,
    vat_amount numeric,
    impressions integer,
    clicks integer,
    conversions integer
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'inserted row count mismatch';
  END IF;

  -- 데이터 교체와 성공 배치 확정을 같은 트랜잭션에 둔다. RPC 성공 직후 프로세스가
  -- 중단되더라도 실제 반영된 배치가 processing으로 남아 감시기에서 누락으로 보이지 않는다.
  UPDATE public.coupang_imports import_batch
  SET status = 'completed',
      success_count = v_inserted,
      error_count = 0,
      completed_at = now(),
      summary = jsonb_build_object('atomic_ad_import', true)
  WHERE import_batch.id = p_import_batch_id
    AND import_batch.user_id = p_user_id
    AND import_batch.business_id = p_business_id
    AND import_batch.import_type = 'ad_billing'
    AND import_batch.status = 'processing';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'import batch completion failed';
  END IF;
  RETURN v_inserted;
END;
$$;

-- 화면 서버(service_role)만 함수를 부른다. 브라우저 키(anon)로는 못 부르게 막는다.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- 파일 보관함: 지출 영수증(비공개), 상품등록 이미지(공개 주소로 상세페이지에 씀)
insert into storage.buckets (id, name, public)
values ('expense-receipts', 'expense-receipts', false),
       ('sourcing-product-images', 'sourcing-product-images', true)
on conflict (id) do nothing;

