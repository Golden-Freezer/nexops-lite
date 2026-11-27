export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      ad_campaigns: {
        Row: {
          ad_date: string
          ad_type: string | null
          billable_amount: number | null
          budget: number | null
          business_id: string | null
          campaign_id: string | null
          campaign_name: string | null
          clicks: number | null
          conversions: number | null
          created_at: string | null
          id: string
          import_batch_id: string | null
          impressions: number | null
          notes: string | null
          product_id: string | null
          roas: number | null
          source: string | null
          spent_amount: number
          updated_at: string | null
          user_id: string
          vat_amount: number | null
        }
        Insert: {
          ad_date: string
          ad_type?: string | null
          billable_amount?: number | null
          budget?: number | null
          business_id?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          clicks?: number | null
          conversions?: number | null
          created_at?: string | null
          id?: string
          import_batch_id?: string | null
          impressions?: number | null
          notes?: string | null
          product_id?: string | null
          roas?: number | null
          source?: string | null
          spent_amount: number
          updated_at?: string | null
          user_id: string
          vat_amount?: number | null
        }
        Update: {
          ad_date?: string
          ad_type?: string | null
          billable_amount?: number | null
          budget?: number | null
          business_id?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          clicks?: number | null
          conversions?: number | null
          created_at?: string | null
          id?: string
          import_batch_id?: string | null
          impressions?: number | null
          notes?: string | null
          product_id?: string | null
          roas?: number | null
          source?: string | null
          spent_amount?: number
          updated_at?: string | null
          user_id?: string
          vat_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaigns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_setting_change: {
        Row: {
          business_id: string
          campaign_id: string
          created_at: string | null
          effective_at: string | null
          effective_on: string
          effective_precision: string
          first_observed_at: string | null
          id: string
          idempotency_key: string
          note: string | null
          origin: string
          setting_key: string
          setting_unit: string
          setting_value: number
          user_id: string
        }
        Insert: {
          business_id: string
          campaign_id: string
          created_at?: string | null
          effective_at?: string | null
          effective_on: string
          effective_precision: string
          first_observed_at?: string | null
          id?: string
          idempotency_key: string
          note?: string | null
          origin: string
          setting_key: string
          setting_unit: string
          setting_value: number
          user_id: string
        }
        Update: {
          business_id?: string
          campaign_id?: string
          created_at?: string | null
          effective_at?: string | null
          effective_on?: string
          effective_precision?: string
          first_observed_at?: string | null
          id?: string
          idempotency_key?: string
          note?: string | null
          origin?: string
          setting_key?: string
          setting_unit?: string
          setting_value?: number
          user_id?: string
        }
        Relationships: []
      }
      adx_action_logs: {
        Row: {
          action_date: string | null
          action_type: string
          after_snapshot: string | null
          before_snapshot: string | null
          business_id: string | null
          campaign_id: string
          created_at: string | null
          expected_kpi: string | null
          follow_up: string | null
          hypothesis: string | null
          id: number
          keywords_json: Json | null
          note: string | null
          priority: string | null
          result_judgment: string | null
          source: string | null
          status: string | null
          updated_at: string | null
          user_id: string
          value: string | null
          week_label: string
        }
        Insert: {
          action_date?: string | null
          action_type?: string
          after_snapshot?: string | null
          before_snapshot?: string | null
          business_id?: string | null
          campaign_id: string
          created_at?: string | null
          expected_kpi?: string | null
          follow_up?: string | null
          hypothesis?: string | null
          id?: number
          keywords_json?: Json | null
          note?: string | null
          priority?: string | null
          result_judgment?: string | null
          source?: string | null
          status?: string | null
          updated_at?: string | null
          user_id: string
          value?: string | null
          week_label: string
        }
        Update: {
          action_date?: string | null
          action_type?: string
          after_snapshot?: string | null
          before_snapshot?: string | null
          business_id?: string | null
          campaign_id?: string
          created_at?: string | null
          expected_kpi?: string | null
          follow_up?: string | null
          hypothesis?: string | null
          id?: number
          keywords_json?: Json | null
          note?: string | null
          priority?: string | null
          result_judgment?: string | null
          source?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string
          value?: string | null
          week_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "adx_action_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adx_action_logs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "adx_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      adx_campaign_product_map: {
        Row: {
          business_id: string | null
          campaign_id: string
          created_at: string | null
          id: string
          mapping_type: string | null
          product_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          business_id?: string | null
          campaign_id: string
          created_at?: string | null
          id?: string
          mapping_type?: string | null
          product_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          business_id?: string | null
          campaign_id?: string
          created_at?: string | null
          id?: string
          mapping_type?: string | null
          product_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adx_campaign_product_map_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adx_campaign_product_map_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "adx_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adx_campaign_product_map_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      adx_campaign_type_detection: {
        Row: {
          ad_type_raw: string | null
          billing_type: string | null
          business_id: string | null
          campaign_id: string
          confidence: number | null
          detected_at: string | null
          detected_type: string
          detection_method: string | null
          evidence_json: Json | null
          id: number
          sales_type: string | null
          user_id: string
        }
        Insert: {
          ad_type_raw?: string | null
          billing_type?: string | null
          business_id?: string | null
          campaign_id: string
          confidence?: number | null
          detected_at?: string | null
          detected_type?: string
          detection_method?: string | null
          evidence_json?: Json | null
          id?: number
          sales_type?: string | null
          user_id: string
        }
        Update: {
          ad_type_raw?: string | null
          billing_type?: string | null
          business_id?: string | null
          campaign_id?: string
          confidence?: number | null
          detected_at?: string | null
          detected_type?: string
          detection_method?: string | null
          evidence_json?: Json | null
          id?: number
          sales_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adx_campaign_type_detection_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adx_campaign_type_detection_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "adx_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      adx_campaigns: {
        Row: {
          ad_type: string | null
          billing_type: string | null
          business_id: string | null
          campaign_key: string
          campaign_native_id: string | null
          campaign_type: string | null
          coupang_id: string | null
          created_at: string | null
          daily_budget: number | null
          end_date: string | null
          excluded_keywords: Json | null
          id: string
          name: string
          note: string | null
          objective_type: string | null
          owner: string | null
          platform: string | null
          product_name: string | null
          product_price: number | null
          protected_keywords: Json | null
          sales_type: string | null
          start_date: string | null
          status: string | null
          target_roas: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ad_type?: string | null
          billing_type?: string | null
          business_id?: string | null
          campaign_key: string
          campaign_native_id?: string | null
          campaign_type?: string | null
          coupang_id?: string | null
          created_at?: string | null
          daily_budget?: number | null
          end_date?: string | null
          excluded_keywords?: Json | null
          id?: string
          name: string
          note?: string | null
          objective_type?: string | null
          owner?: string | null
          platform?: string | null
          product_name?: string | null
          product_price?: number | null
          protected_keywords?: Json | null
          sales_type?: string | null
          start_date?: string | null
          status?: string | null
          target_roas?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ad_type?: string | null
          billing_type?: string | null
          business_id?: string | null
          campaign_key?: string
          campaign_native_id?: string | null
          campaign_type?: string | null
          coupang_id?: string | null
          created_at?: string | null
          daily_budget?: number | null
          end_date?: string | null
          excluded_keywords?: Json | null
          id?: string
          name?: string
          note?: string | null
          objective_type?: string | null
          owner?: string | null
          platform?: string | null
          product_name?: string | null
          product_price?: number | null
          protected_keywords?: Json | null
          sales_type?: string | null
          start_date?: string | null
          status?: string | null
          target_roas?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adx_campaigns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      adx_keywords: {
        Row: {
          action_recommendation: string | null
          business_id: string | null
          campaign_id: string
          clicks: number | null
          cost: number | null
          cpc: number | null
          ctr: number | null
          cvr_14d: number | null
          id: number
          impressions: number | null
          keyword: string
          keyword_grade: string | null
          match_type: string | null
          orders_14d: number | null
          orders_1d: number | null
          revenue_14d: number | null
          revenue_1d: number | null
          roas_14d: number | null
          surface: string | null
          user_id: string
          week_label: string
          week_start_date: string | null
        }
        Insert: {
          action_recommendation?: string | null
          business_id?: string | null
          campaign_id: string
          clicks?: number | null
          cost?: number | null
          cpc?: number | null
          ctr?: number | null
          cvr_14d?: number | null
          id?: number
          impressions?: number | null
          keyword: string
          keyword_grade?: string | null
          match_type?: string | null
          orders_14d?: number | null
          orders_1d?: number | null
          revenue_14d?: number | null
          revenue_1d?: number | null
          roas_14d?: number | null
          surface?: string | null
          user_id: string
          week_label: string
          week_start_date?: string | null
        }
        Update: {
          action_recommendation?: string | null
          business_id?: string | null
          campaign_id?: string
          clicks?: number | null
          cost?: number | null
          cpc?: number | null
          ctr?: number | null
          cvr_14d?: number | null
          id?: number
          impressions?: number | null
          keyword?: string
          keyword_grade?: string | null
          match_type?: string | null
          orders_14d?: number | null
          orders_1d?: number | null
          revenue_14d?: number | null
          revenue_1d?: number | null
          roas_14d?: number | null
          surface?: string | null
          user_id?: string
          week_label?: string
          week_start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "adx_keywords_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adx_keywords_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "adx_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      adx_report_snapshots: {
        Row: {
          business_id: string | null
          campaign_id: string
          created_at: string | null
          id: number
          report_json: Json | null
          report_type: string | null
          user_id: string
          week_label: string
        }
        Insert: {
          business_id?: string | null
          campaign_id: string
          created_at?: string | null
          id?: number
          report_json?: Json | null
          report_type?: string | null
          user_id: string
          week_label: string
        }
        Update: {
          business_id?: string | null
          campaign_id?: string
          created_at?: string | null
          id?: number
          report_json?: Json | null
          report_type?: string | null
          user_id?: string
          week_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "adx_report_snapshots_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adx_report_snapshots_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "adx_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      adx_weekly_data: {
        Row: {
          actual_weekly_orders: number | null
          ad_health_score: number | null
          anomaly_flag: number | null
          business_id: string | null
          campaign_id: string
          diagnosis_tag: string | null
          direct_order_ratio_14d: number | null
          growth_state: string | null
          id: number
          indirect_order_ratio_14d: number | null
          inventory_risk_flag: number | null
          next_action_priority: string | null
          nonsearch_clicks: number | null
          nonsearch_cost: number | null
          nonsearch_cpc: number | null
          nonsearch_ctr: number | null
          nonsearch_cvr_14d: number | null
          nonsearch_direct_orders: number | null
          nonsearch_direct_revenue: number | null
          nonsearch_impressions: number | null
          nonsearch_indirect_orders: number | null
          nonsearch_indirect_revenue: number | null
          nonsearch_orders: number | null
          nonsearch_orders_14d: number | null
          nonsearch_orders_1d: number | null
          nonsearch_revenue: number | null
          nonsearch_revenue_14d: number | null
          nonsearch_revenue_1d: number | null
          nonsearch_roas_14d: number | null
          search_clicks: number | null
          search_cost: number | null
          search_cpc: number | null
          search_ctr: number | null
          search_cvr_14d: number | null
          search_direct_orders: number | null
          search_direct_revenue: number | null
          search_impressions: number | null
          search_indirect_orders: number | null
          search_indirect_revenue: number | null
          search_orders: number | null
          search_orders_14d: number | null
          search_orders_1d: number | null
          search_revenue: number | null
          search_revenue_14d: number | null
          search_revenue_1d: number | null
          search_roas_14d: number | null
          source_file_name: string | null
          total_cost: number | null
          total_direct_orders_14d: number | null
          total_direct_revenue_14d: number | null
          total_indirect_orders_14d: number | null
          total_indirect_revenue_14d: number | null
          total_orders_14d: number | null
          total_revenue_14d: number | null
          total_roas_14d: number | null
          upload_batch_id: string | null
          upload_date: string | null
          user_id: string
          week_end_date: string | null
          week_grade: string | null
          week_label: string
          week_start_date: string | null
          weekly_revenue: number | null
          wow_cost_change_pct: number | null
          wow_nonsearch_ctr_change_pct: number | null
          wow_revenue_14d_change_pct: number | null
          wow_roas_14d_change_pct: number | null
          wow_search_ctr_change_pct: number | null
          wow_search_cvr_14d_change_pct: number | null
        }
        Insert: {
          actual_weekly_orders?: number | null
          ad_health_score?: number | null
          anomaly_flag?: number | null
          business_id?: string | null
          campaign_id: string
          diagnosis_tag?: string | null
          direct_order_ratio_14d?: number | null
          growth_state?: string | null
          id?: number
          indirect_order_ratio_14d?: number | null
          inventory_risk_flag?: number | null
          next_action_priority?: string | null
          nonsearch_clicks?: number | null
          nonsearch_cost?: number | null
          nonsearch_cpc?: number | null
          nonsearch_ctr?: number | null
          nonsearch_cvr_14d?: number | null
          nonsearch_direct_orders?: number | null
          nonsearch_direct_revenue?: number | null
          nonsearch_impressions?: number | null
          nonsearch_indirect_orders?: number | null
          nonsearch_indirect_revenue?: number | null
          nonsearch_orders?: number | null
          nonsearch_orders_14d?: number | null
          nonsearch_orders_1d?: number | null
          nonsearch_revenue?: number | null
          nonsearch_revenue_14d?: number | null
          nonsearch_revenue_1d?: number | null
          nonsearch_roas_14d?: number | null
          search_clicks?: number | null
          search_cost?: number | null
          search_cpc?: number | null
          search_ctr?: number | null
          search_cvr_14d?: number | null
          search_direct_orders?: number | null
          search_direct_revenue?: number | null
          search_impressions?: number | null
          search_indirect_orders?: number | null
          search_indirect_revenue?: number | null
          search_orders?: number | null
          search_orders_14d?: number | null
          search_orders_1d?: number | null
          search_revenue?: number | null
          search_revenue_14d?: number | null
          search_revenue_1d?: number | null
          search_roas_14d?: number | null
          source_file_name?: string | null
          total_cost?: number | null
          total_direct_orders_14d?: number | null
          total_direct_revenue_14d?: number | null
          total_indirect_orders_14d?: number | null
          total_indirect_revenue_14d?: number | null
          total_orders_14d?: number | null
          total_revenue_14d?: number | null
          total_roas_14d?: number | null
          upload_batch_id?: string | null
          upload_date?: string | null
          user_id: string
          week_end_date?: string | null
          week_grade?: string | null
          week_label: string
          week_start_date?: string | null
          weekly_revenue?: number | null
          wow_cost_change_pct?: number | null
          wow_nonsearch_ctr_change_pct?: number | null
          wow_revenue_14d_change_pct?: number | null
          wow_roas_14d_change_pct?: number | null
          wow_search_ctr_change_pct?: number | null
          wow_search_cvr_14d_change_pct?: number | null
        }
        Update: {
          actual_weekly_orders?: number | null
          ad_health_score?: number | null
          anomaly_flag?: number | null
          business_id?: string | null
          campaign_id?: string
          diagnosis_tag?: string | null
          direct_order_ratio_14d?: number | null
          growth_state?: string | null
          id?: number
          indirect_order_ratio_14d?: number | null
          inventory_risk_flag?: number | null
          next_action_priority?: string | null
          nonsearch_clicks?: number | null
          nonsearch_cost?: number | null
          nonsearch_cpc?: number | null
          nonsearch_ctr?: number | null
          nonsearch_cvr_14d?: number | null
          nonsearch_direct_orders?: number | null
          nonsearch_direct_revenue?: number | null
          nonsearch_impressions?: number | null
          nonsearch_indirect_orders?: number | null
          nonsearch_indirect_revenue?: number | null
          nonsearch_orders?: number | null
          nonsearch_orders_14d?: number | null
          nonsearch_orders_1d?: number | null
          nonsearch_revenue?: number | null
          nonsearch_revenue_14d?: number | null
          nonsearch_revenue_1d?: number | null
          nonsearch_roas_14d?: number | null
          search_clicks?: number | null
          search_cost?: number | null
          search_cpc?: number | null
          search_ctr?: number | null
          search_cvr_14d?: number | null
          search_direct_orders?: number | null
          search_direct_revenue?: number | null
          search_impressions?: number | null
          search_indirect_orders?: number | null
          search_indirect_revenue?: number | null
          search_orders?: number | null
          search_orders_14d?: number | null
          search_orders_1d?: number | null
          search_revenue?: number | null
          search_revenue_14d?: number | null
          search_revenue_1d?: number | null
          search_roas_14d?: number | null
          source_file_name?: string | null
          total_cost?: number | null
          total_direct_orders_14d?: number | null
          total_direct_revenue_14d?: number | null
          total_indirect_orders_14d?: number | null
          total_indirect_revenue_14d?: number | null
          total_orders_14d?: number | null
          total_revenue_14d?: number | null
          total_roas_14d?: number | null
          upload_batch_id?: string | null
          upload_date?: string | null
          user_id?: string
          week_end_date?: string | null
          week_grade?: string | null
          week_label?: string
          week_start_date?: string | null
          weekly_revenue?: number | null
          wow_cost_change_pct?: number | null
          wow_nonsearch_ctr_change_pct?: number | null
          wow_revenue_14d_change_pct?: number | null
          wow_roas_14d_change_pct?: number | null
          wow_search_ctr_change_pct?: number | null
          wow_search_cvr_14d_change_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "adx_weekly_data_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adx_weekly_data_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "adx_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      adx_weekly_diagnostics: {
        Row: {
          ad_health_score: number | null
          anomaly_flag: number | null
          business_id: string | null
          campaign_id: string
          created_at: string | null
          diagnostics_json: Json | null
          growth_state: string | null
          id: number
          inventory_health_score: number | null
          inventory_risk_flag: number | null
          next_action_priority: string | null
          priority_score: number | null
          user_id: string
          week_label: string
          wow_cost_change_pct: number | null
          wow_revenue_change_pct: number | null
          wow_roas_change_pct: number | null
        }
        Insert: {
          ad_health_score?: number | null
          anomaly_flag?: number | null
          business_id?: string | null
          campaign_id: string
          created_at?: string | null
          diagnostics_json?: Json | null
          growth_state?: string | null
          id?: number
          inventory_health_score?: number | null
          inventory_risk_flag?: number | null
          next_action_priority?: string | null
          priority_score?: number | null
          user_id: string
          week_label: string
          wow_cost_change_pct?: number | null
          wow_revenue_change_pct?: number | null
          wow_roas_change_pct?: number | null
        }
        Update: {
          ad_health_score?: number | null
          anomaly_flag?: number | null
          business_id?: string | null
          campaign_id?: string
          created_at?: string | null
          diagnostics_json?: Json | null
          growth_state?: string | null
          id?: number
          inventory_health_score?: number | null
          inventory_risk_flag?: number | null
          next_action_priority?: string | null
          priority_score?: number | null
          user_id?: string
          week_label?: string
          wow_cost_change_pct?: number | null
          wow_revenue_change_pct?: number | null
          wow_roas_change_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "adx_weekly_diagnostics_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adx_weekly_diagnostics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "adx_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent: string
          attempt: number
          business_id: string | null
          code_version: string | null
          cost_usd: number | null
          duration_ms: number | null
          ended_at: string | null
          error: string | null
          idempotency_key: string | null
          input_hash: string | null
          input_tokens: number | null
          knowledge_version: string | null
          model: string | null
          output_tokens: number | null
          parent_run_id: string | null
          prompt_version: string | null
          purpose: string | null
          ref_id: string | null
          ref_table: string | null
          run_id: string
          started_at: string
          status: string
          surface: string
          trigger: string
          user_id: string
        }
        Insert: {
          agent: string
          attempt?: number
          business_id?: string | null
          code_version?: string | null
          cost_usd?: number | null
          duration_ms?: number | null
          ended_at?: string | null
          error?: string | null
          idempotency_key?: string | null
          input_hash?: string | null
          input_tokens?: number | null
          knowledge_version?: string | null
          model?: string | null
          output_tokens?: number | null
          parent_run_id?: string | null
          prompt_version?: string | null
          purpose?: string | null
          ref_id?: string | null
          ref_table?: string | null
          run_id?: string
          started_at?: string
          status?: string
          surface: string
          trigger: string
          user_id: string
        }
        Update: {
          agent?: string
          attempt?: number
          business_id?: string | null
          code_version?: string | null
          cost_usd?: number | null
          duration_ms?: number | null
          ended_at?: string | null
          error?: string | null
          idempotency_key?: string | null
          input_hash?: string | null
          input_tokens?: number | null
          knowledge_version?: string | null
          model?: string | null
          output_tokens?: number | null
          parent_run_id?: string | null
          prompt_version?: string | null
          purpose?: string | null
          ref_id?: string | null
          ref_table?: string | null
          run_id?: string
          started_at?: string
          status?: string
          surface?: string
          trigger?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_parent_run_id_fkey"
            columns: ["parent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      ai_staff_reports: {
        Row: {
          approved_at: string | null
          created_at: string | null
          fail_reason: string | null
          finished_at: string | null
          id: string
          read_at: string | null
          report_md: string | null
          staff: string
          started_at: string
          status: string
          summary: string | null
          tokens_used: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          created_at?: string | null
          fail_reason?: string | null
          finished_at?: string | null
          id?: string
          read_at?: string | null
          report_md?: string | null
          staff: string
          started_at?: string
          status?: string
          summary?: string | null
          tokens_used?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          approved_at?: string | null
          created_at?: string | null
          fail_reason?: string | null
          finished_at?: string | null
          id?: string
          read_at?: string | null
          report_md?: string | null
          staff?: string
          started_at?: string
          status?: string
          summary?: string | null
          tokens_used?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          agent: string | null
          attempts: number | null
          business_id: string | null
          cost_usd: number
          created_at: string | null
          duration_ms: number | null
          id: string
          input_tokens: number
          model: string
          month_key: string
          output_tokens: number
          run_id: string | null
          stage: string | null
          success: boolean | null
          user_id: string | null
        }
        Insert: {
          agent?: string | null
          attempts?: number | null
          business_id?: string | null
          cost_usd?: number
          created_at?: string | null
          duration_ms?: number | null
          id?: string
          input_tokens?: number
          model: string
          month_key: string
          output_tokens?: number
          run_id?: string | null
          stage?: string | null
          success?: boolean | null
          user_id?: string | null
        }
        Update: {
          agent?: string | null
          attempts?: number | null
          business_id?: string | null
          cost_usd?: number
          created_at?: string | null
          duration_ms?: number | null
          id?: string
          input_tokens?: number
          model?: string
          month_key?: string
          output_tokens?: number
          run_id?: string | null
          stage?: string | null
          success?: boolean | null
          user_id?: string | null
        }
        Relationships: []
      }
      approval_events: {
        Row: {
          action: string
          actor_id: string
          actor_type: string
          decided_at: string
          id: string
          next_state: string | null
          prev_state: string | null
          reason: string | null
          run_id: string | null
          source: string | null
          subject_id: string
          subject_table: string
        }
        Insert: {
          action: string
          actor_id: string
          actor_type: string
          decided_at?: string
          id?: string
          next_state?: string | null
          prev_state?: string | null
          reason?: string | null
          run_id?: string | null
          source?: string | null
          subject_id: string
          subject_table: string
        }
        Update: {
          action?: string
          actor_id?: string
          actor_type?: string
          decided_at?: string
          id?: string
          next_state?: string | null
          prev_state?: string | null
          reason?: string | null
          run_id?: string | null
          source?: string | null
          subject_id?: string
          subject_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      assistant_memories: {
        Row: {
          category: string
          content: string
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          name: string
          source_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          content: string
          created_at?: string
          deleted_at?: string | null
          description: string
          id?: string
          name: string
          source_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          name?: string
          source_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      auto_import_receipts: {
        Row: {
          batch_id: string
          business_id: string
          claimed_at: string
          completed_at: string | null
          content_sha256: string
          file_name: string
          hash_basis: string
          id: string
          import_date: string
          import_kind: string
          indeterminate_at: string | null
          indeterminate_stage: string | null
          response: Json | null
          row_count: number
          status: string
          user_id: string
        }
        Insert: {
          batch_id: string
          business_id: string
          claimed_at?: string
          completed_at?: string | null
          content_sha256: string
          file_name: string
          hash_basis: string
          id?: string
          import_date: string
          import_kind: string
          indeterminate_at?: string | null
          indeterminate_stage?: string | null
          response?: Json | null
          row_count: number
          status?: string
          user_id: string
        }
        Update: {
          batch_id?: string
          business_id?: string
          claimed_at?: string
          completed_at?: string | null
          content_sha256?: string
          file_name?: string
          hash_basis?: string
          id?: string
          import_date?: string
          import_kind?: string
          indeterminate_at?: string | null
          indeterminate_stage?: string | null
          response?: Json | null
          row_count?: number
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      business_settings: {
        Row: {
          business_id: string
          created_at: string
          default_commission_rate: number
          default_return_rate: number
          import_column_mappings: Json
          inventory_alert_threshold_days: number
          inventory_notifications_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          default_commission_rate?: number
          default_return_rate?: number
          import_column_mappings?: Json
          inventory_alert_threshold_days?: number
          inventory_notifications_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          default_commission_rate?: number
          default_return_rate?: number
          import_column_mappings?: Json
          inventory_alert_threshold_days?: number
          inventory_notifications_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          address: string | null
          business_category: string | null
          business_name: string
          business_number: string | null
          business_type: string | null
          coupang_vendor_id: string | null
          created_at: string | null
          id: string
          is_default: boolean
          representative: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          business_category?: string | null
          business_name: string
          business_number?: string | null
          business_type?: string | null
          coupang_vendor_id?: string | null
          created_at?: string | null
          id?: string
          is_default?: boolean
          representative?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          business_category?: string | null
          business_name?: string
          business_number?: string | null
          business_type?: string | null
          coupang_vendor_id?: string | null
          created_at?: string | null
          id?: string
          is_default?: boolean
          representative?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      category_scan_results: {
        Row: {
          category_code: number
          created_at: string | null
          filter_reason: string | null
          glance_view: number | null
          glance_view_variance: number | null
          id: string
          is_promising: boolean | null
          keywords: Json | null
          metric: Json | null
          scanned_at: string | null
          top100_ads_impression_percentage: number | null
          user_id: string
        }
        Insert: {
          category_code: number
          created_at?: string | null
          filter_reason?: string | null
          glance_view?: number | null
          glance_view_variance?: number | null
          id?: string
          is_promising?: boolean | null
          keywords?: Json | null
          metric?: Json | null
          scanned_at?: string | null
          top100_ads_impression_percentage?: number | null
          user_id: string
        }
        Update: {
          category_code?: number
          created_at?: string | null
          filter_reason?: string | null
          glance_view?: number | null
          glance_view_variance?: number | null
          id?: string
          is_promising?: boolean | null
          keywords?: Json | null
          metric?: Json | null
          scanned_at?: string | null
          top100_ads_impression_percentage?: number | null
          user_id?: string
        }
        Relationships: []
      }
      commission_rules: {
        Row: {
          created_at: string | null
          id: number
          major_category: string
          mid_category: string | null
          rate: number
          sub_category: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          major_category: string
          mid_category?: string | null
          rate: number
          sub_category?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          major_category?: string
          mid_category?: string | null
          rate?: number
          sub_category?: string | null
        }
        Relationships: []
      }
      competitor_stock_daily: {
        Row: {
          capture_kind: string | null
          captured_at: string
          censored: boolean
          censored_reason: string | null
          created_at: string | null
          id: string
          item_id: string | null
          keyword: string | null
          observation_ok: boolean
          product_id: string | null
          product_key: string
          product_name: string | null
          rank: number | null
          remain_quantity: number | null
          source: string
          source_kind: string
          user_id: string
          vendor_item_id: string | null
        }
        Insert: {
          capture_kind?: string | null
          captured_at?: string
          censored?: boolean
          censored_reason?: string | null
          created_at?: string | null
          id?: string
          item_id?: string | null
          keyword?: string | null
          observation_ok?: boolean
          product_id?: string | null
          product_key: string
          product_name?: string | null
          rank?: number | null
          remain_quantity?: number | null
          source?: string
          source_kind?: string
          user_id: string
          vendor_item_id?: string | null
        }
        Update: {
          capture_kind?: string | null
          captured_at?: string
          censored?: boolean
          censored_reason?: string | null
          created_at?: string | null
          id?: string
          item_id?: string | null
          keyword?: string | null
          observation_ok?: boolean
          product_id?: string | null
          product_key?: string
          product_name?: string | null
          rank?: number | null
          remain_quantity?: number | null
          source?: string
          source_kind?: string
          user_id?: string
          vendor_item_id?: string | null
        }
        Relationships: []
      }
      competitor_stock_readouts: {
        Row: {
          changed_by_max_buy: boolean | null
          created_at: string | null
          delivery_type: string | null
          id: string
          item_id: string | null
          keyword: string
          likely_person_limit: boolean | null
          max_buy_for_person: number | null
          observed_at: string
          possible_inventory: number | null
          product_id: string | null
          product_key: string
          product_name: string | null
          rank: number | null
          user_id: string
          vendor_item_id: string | null
          verdict_kind: string
          verdict_value: number | null
        }
        Insert: {
          changed_by_max_buy?: boolean | null
          created_at?: string | null
          delivery_type?: string | null
          id?: string
          item_id?: string | null
          keyword: string
          likely_person_limit?: boolean | null
          max_buy_for_person?: number | null
          observed_at?: string
          possible_inventory?: number | null
          product_id?: string | null
          product_key: string
          product_name?: string | null
          rank?: number | null
          user_id: string
          vendor_item_id?: string | null
          verdict_kind: string
          verdict_value?: number | null
        }
        Update: {
          changed_by_max_buy?: boolean | null
          created_at?: string | null
          delivery_type?: string | null
          id?: string
          item_id?: string | null
          keyword?: string
          likely_person_limit?: boolean | null
          max_buy_for_person?: number | null
          observed_at?: string
          possible_inventory?: number | null
          product_id?: string | null
          product_key?: string
          product_name?: string | null
          rank?: number | null
          user_id?: string
          vendor_item_id?: string | null
          verdict_kind?: string
          verdict_value?: number | null
        }
        Relationships: []
      }
      coupang_categories: {
        Row: {
          category_id: number
          depth: number
          full_path: string
          l1: string
          l2: string | null
          l3: string | null
          last_scanned_at: string | null
          rate: number
          scan_enabled: boolean | null
        }
        Insert: {
          category_id: number
          depth: number
          full_path: string
          l1: string
          l2?: string | null
          l3?: string | null
          last_scanned_at?: string | null
          rate: number
          scan_enabled?: boolean | null
        }
        Update: {
          category_id?: number
          depth?: number
          full_path?: string
          l1?: string
          l2?: string | null
          l3?: string | null
          last_scanned_at?: string | null
          rate?: number
          scan_enabled?: boolean | null
        }
        Relationships: []
      }
      coupang_category_units: {
        Row: {
          captured_at: string
          category_id: number
          kan_category_id: number | null
          kan_category_name: string | null
          mapping_source: string
          unit_seq: number | null
          unit1: string
          unit2: string
        }
        Insert: {
          captured_at?: string
          category_id: number
          kan_category_id?: number | null
          kan_category_name?: string | null
          mapping_source?: string
          unit_seq?: number | null
          unit1: string
          unit2: string
        }
        Update: {
          captured_at?: string
          category_id?: number
          kan_category_id?: number | null
          kan_category_name?: string | null
          mapping_source?: string
          unit_seq?: number | null
          unit1?: string
          unit2?: string
        }
        Relationships: []
      }
      coupang_fulfillment_fees: {
        Row: {
          capacity_type: string
          captured_at: string
          fee: number
          fee_id: string | null
          final_fee: number
          id: number
          min_price: number
          promotion: string
          unit1: string
          unit2: string
          variant: string
        }
        Insert: {
          capacity_type: string
          captured_at?: string
          fee: number
          fee_id?: string | null
          final_fee: number
          id?: number
          min_price: number
          promotion: string
          unit1: string
          unit2: string
          variant: string
        }
        Update: {
          capacity_type?: string
          captured_at?: string
          fee?: number
          fee_id?: string | null
          final_fee?: number
          id?: number
          min_price?: number
          promotion?: string
          unit1?: string
          unit2?: string
          variant?: string
        }
        Relationships: []
      }
      coupang_imports: {
        Row: {
          business_id: string | null
          completed_at: string | null
          created_at: string | null
          error_count: number | null
          error_message: string | null
          file_name: string
          file_size: number | null
          id: string
          import_type: string
          row_count: number | null
          status: string | null
          success_count: number | null
          summary: Json | null
          user_id: string
        }
        Insert: {
          business_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          error_count?: number | null
          error_message?: string | null
          file_name: string
          file_size?: number | null
          id?: string
          import_type: string
          row_count?: number | null
          status?: string | null
          success_count?: number | null
          summary?: Json | null
          user_id: string
        }
        Update: {
          business_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          error_count?: number | null
          error_message?: string | null
          file_name?: string
          file_size?: number | null
          id?: string
          import_type?: string
          row_count?: number | null
          status?: string | null
          success_count?: number | null
          summary?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupang_imports_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      coupang_inventory_observations: {
        Row: {
          amount_in_stock: number
          baseline_stale: boolean
          business_id: string
          created_at: string
          delta: number | null
          health_stock: number | null
          health_synced_at: string | null
          id: string
          observed_at: string
          on_sale: boolean
          product_id: string
          raw_meta: Json
          run_id: string
          sale_price: number
          severity: string
          user_id: string
          vendor_id: string
          vendor_item_id: string
        }
        Insert: {
          amount_in_stock: number
          baseline_stale?: boolean
          business_id: string
          created_at?: string
          delta?: number | null
          health_stock?: number | null
          health_synced_at?: string | null
          id?: string
          observed_at?: string
          on_sale: boolean
          product_id: string
          raw_meta?: Json
          run_id: string
          sale_price: number
          severity?: string
          user_id: string
          vendor_id: string
          vendor_item_id: string
        }
        Update: {
          amount_in_stock?: number
          baseline_stale?: boolean
          business_id?: string
          created_at?: string
          delta?: number | null
          health_stock?: number | null
          health_synced_at?: string | null
          id?: string
          observed_at?: string
          on_sale?: boolean
          product_id?: string
          raw_meta?: Json
          run_id?: string
          sale_price?: number
          severity?: string
          user_id?: string
          vendor_id?: string
          vendor_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupang_inventory_observations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupang_inventory_observations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupang_inventory_observations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "coupang_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      coupang_lowasp_policy: {
        Row: {
          captured_at: string
          low_asp_max_price: number | null
          policy_label: string | null
          unit1: string
          unit2: string
        }
        Insert: {
          captured_at?: string
          low_asp_max_price?: number | null
          policy_label?: string | null
          unit1: string
          unit2: string
        }
        Update: {
          captured_at?: string
          low_asp_max_price?: number | null
          policy_label?: string | null
          unit1?: string
          unit2?: string
        }
        Relationships: []
      }
      coupang_order_events: {
        Row: {
          business_id: string
          created_at: string
          event_key: string
          event_type: string
          fault_by_type: string | null
          id: string
          modified_at: string | null
          order_id: string
          processed_at: string | null
          quantity: number
          raw_meta: Json
          reason_code: string | null
          reason_text: string | null
          receipt_id: string
          receipt_status: string | null
          requested_at: string | null
          run_id: string | null
          updated_at: string
          user_id: string
          vendor_id: string
          vendor_item_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          event_key: string
          event_type: string
          fault_by_type?: string | null
          id?: string
          modified_at?: string | null
          order_id: string
          processed_at?: string | null
          quantity: number
          raw_meta?: Json
          reason_code?: string | null
          reason_text?: string | null
          receipt_id: string
          receipt_status?: string | null
          requested_at?: string | null
          run_id?: string | null
          updated_at?: string
          user_id: string
          vendor_id: string
          vendor_item_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          event_key?: string
          event_type?: string
          fault_by_type?: string | null
          id?: string
          modified_at?: string | null
          order_id?: string
          processed_at?: string | null
          quantity?: number
          raw_meta?: Json
          reason_code?: string | null
          reason_text?: string | null
          receipt_id?: string
          receipt_status?: string | null
          requested_at?: string | null
          run_id?: string | null
          updated_at?: string
          user_id?: string
          vendor_id?: string
          vendor_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupang_order_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupang_order_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "coupang_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      coupang_revenue_items: {
        Row: {
          business_id: string
          collected_at: string
          delivery_amount: number
          delivery_fee: number
          delivery_fee_vat: number
          downloadable_coupon: number
          external_seller_sku_code: string | null
          id: string
          ledger_key: string
          order_id: string
          product_name: string | null
          quantity: number
          raw_meta: Json
          recognition_date: string
          run_id: string | null
          sale_amount: number
          sale_date: string | null
          sale_price: number
          sale_type: string
          seller_discount_coupon: number
          service_fee: number
          service_fee_vat: number
          settlement_amount: number
          settlement_date: string | null
          tax_type: string | null
          updated_at: string
          user_id: string
          vendor_id: string
          vendor_item_id: string
          vendor_item_name: string | null
        }
        Insert: {
          business_id: string
          collected_at?: string
          delivery_amount?: number
          delivery_fee?: number
          delivery_fee_vat?: number
          downloadable_coupon?: number
          external_seller_sku_code?: string | null
          id?: string
          ledger_key: string
          order_id: string
          product_name?: string | null
          quantity: number
          raw_meta?: Json
          recognition_date: string
          run_id?: string | null
          sale_amount?: number
          sale_date?: string | null
          sale_price?: number
          sale_type: string
          seller_discount_coupon?: number
          service_fee?: number
          service_fee_vat?: number
          settlement_amount?: number
          settlement_date?: string | null
          tax_type?: string | null
          updated_at?: string
          user_id: string
          vendor_id: string
          vendor_item_id: string
          vendor_item_name?: string | null
        }
        Update: {
          business_id?: string
          collected_at?: string
          delivery_amount?: number
          delivery_fee?: number
          delivery_fee_vat?: number
          downloadable_coupon?: number
          external_seller_sku_code?: string | null
          id?: string
          ledger_key?: string
          order_id?: string
          product_name?: string | null
          quantity?: number
          raw_meta?: Json
          recognition_date?: string
          run_id?: string | null
          sale_amount?: number
          sale_date?: string | null
          sale_price?: number
          sale_type?: string
          seller_discount_coupon?: number
          service_fee?: number
          service_fee_vat?: number
          settlement_amount?: number
          settlement_date?: string | null
          tax_type?: string | null
          updated_at?: string
          user_id?: string
          vendor_id?: string
          vendor_item_id?: string
          vendor_item_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupang_revenue_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupang_revenue_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "coupang_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      coupang_settlement_reports: {
        Row: {
          business_id: string | null
          collected_at: string | null
          detail_json: Json | null
          final_settlement_amount: number | null
          id: string
          period_end: string | null
          period_start: string | null
          settlement_cycle: string | null
          settlement_date: string | null
          settlement_group_key: string
          settlement_ratio: number | null
          total_ad_sales_deduction_amount: number | null
          total_business_insights_deduction_amount: number | null
          total_cfs_inventory_compensation_amount: number | null
          total_final_cfs_fee_deduction_amount: number | null
          total_fulfillment_fee_deduction_amount: number | null
          total_refunded_amount: number | null
          total_sales_amount: number | null
          total_seller_discount: number | null
          total_storage_fee_deduction_amount: number | null
          total_subscription_fee_deduction_amount: number | null
          total_take_rate_amount_with_vat: number | null
          total_warehousing_fee_deduction_amount: number | null
          updated_at: string | null
          user_id: string
          vendor_id: string
        }
        Insert: {
          business_id?: string | null
          collected_at?: string | null
          detail_json?: Json | null
          final_settlement_amount?: number | null
          id?: string
          period_end?: string | null
          period_start?: string | null
          settlement_cycle?: string | null
          settlement_date?: string | null
          settlement_group_key: string
          settlement_ratio?: number | null
          total_ad_sales_deduction_amount?: number | null
          total_business_insights_deduction_amount?: number | null
          total_cfs_inventory_compensation_amount?: number | null
          total_final_cfs_fee_deduction_amount?: number | null
          total_fulfillment_fee_deduction_amount?: number | null
          total_refunded_amount?: number | null
          total_sales_amount?: number | null
          total_seller_discount?: number | null
          total_storage_fee_deduction_amount?: number | null
          total_subscription_fee_deduction_amount?: number | null
          total_take_rate_amount_with_vat?: number | null
          total_warehousing_fee_deduction_amount?: number | null
          updated_at?: string | null
          user_id: string
          vendor_id: string
        }
        Update: {
          business_id?: string | null
          collected_at?: string | null
          detail_json?: Json | null
          final_settlement_amount?: number | null
          id?: string
          period_end?: string | null
          period_start?: string | null
          settlement_cycle?: string | null
          settlement_date?: string | null
          settlement_group_key?: string
          settlement_ratio?: number | null
          total_ad_sales_deduction_amount?: number | null
          total_business_insights_deduction_amount?: number | null
          total_cfs_inventory_compensation_amount?: number | null
          total_final_cfs_fee_deduction_amount?: number | null
          total_fulfillment_fee_deduction_amount?: number | null
          total_refunded_amount?: number | null
          total_sales_amount?: number | null
          total_seller_discount?: number | null
          total_storage_fee_deduction_amount?: number | null
          total_subscription_fee_deduction_amount?: number | null
          total_take_rate_amount_with_vat?: number | null
          total_warehousing_fee_deduction_amount?: number | null
          updated_at?: string | null
          user_id?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupang_settlement_reports_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      coupang_sync_runs: {
        Row: {
          attempt: number
          baseline_stale: boolean
          business_id: string
          changed_count: number
          completed_at: string | null
          created_at: string
          error_summary: Json
          id: string
          idempotency_key: string
          kst_date: string
          mismatch_count: number
          report_json: Json
          scope: string
          started_at: string
          status: string
          successful_calls: number
          total_calls: number
          updated_at: string
          user_id: string
          vendor_id: string
        }
        Insert: {
          attempt?: number
          baseline_stale?: boolean
          business_id: string
          changed_count?: number
          completed_at?: string | null
          created_at?: string
          error_summary?: Json
          id?: string
          idempotency_key: string
          kst_date: string
          mismatch_count?: number
          report_json?: Json
          scope: string
          started_at?: string
          status?: string
          successful_calls?: number
          total_calls?: number
          updated_at?: string
          user_id: string
          vendor_id: string
        }
        Update: {
          attempt?: number
          baseline_stale?: boolean
          business_id?: string
          changed_count?: number
          completed_at?: string | null
          created_at?: string
          error_summary?: Json
          id?: string
          idempotency_key?: string
          kst_date?: string
          mismatch_count?: number
          report_json?: Json
          scope?: string
          started_at?: string
          status?: string
          successful_calls?: number
          total_calls?: number
          updated_at?: string
          user_id?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupang_sync_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      coupang_wallet_events: {
        Row: {
          amount: number | null
          business_id: string | null
          collected_at: string | null
          id: string
          payment_date: string | null
          user_id: string
          vendor_id: string
          wallet_event_id: string
          wallet_event_type: string | null
        }
        Insert: {
          amount?: number | null
          business_id?: string | null
          collected_at?: string | null
          id?: string
          payment_date?: string | null
          user_id: string
          vendor_id: string
          wallet_event_id: string
          wallet_event_type?: string | null
        }
        Update: {
          amount?: number | null
          business_id?: string | null
          collected_at?: string | null
          id?: string
          payment_date?: string | null
          user_id?: string
          vendor_id?: string
          wallet_event_id?: string
          wallet_event_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupang_wallet_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      demand_estimates: {
        Row: {
          created_at: string | null
          est_monthly_margin: number | null
          est_monthly_revenue: number | null
          est_monthly_sales: number | null
          id: string
          product_id: string
          snapshot_date: string
          views_28d: number | null
        }
        Insert: {
          created_at?: string | null
          est_monthly_margin?: number | null
          est_monthly_revenue?: number | null
          est_monthly_sales?: number | null
          id?: string
          product_id: string
          snapshot_date?: string
          views_28d?: number | null
        }
        Update: {
          created_at?: string | null
          est_monthly_margin?: number | null
          est_monthly_revenue?: number | null
          est_monthly_sales?: number | null
          id?: string
          product_id?: string
          snapshot_date?: string
          views_28d?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "demand_estimates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      discovered_keyword_products: {
        Row: {
          brand_name: string | null
          category: string | null
          coupang_product_id: string | null
          created_at: string | null
          delivery_type: string | null
          discovered_keyword_id: string | null
          id: string
          price: number | null
          product_name: string | null
          product_url: string | null
          rank: number | null
          rating: number | null
          review_count: number | null
          sales_count: number | null
          thumbnail_url: string | null
          view_count: number | null
        }
        Insert: {
          brand_name?: string | null
          category?: string | null
          coupang_product_id?: string | null
          created_at?: string | null
          delivery_type?: string | null
          discovered_keyword_id?: string | null
          id?: string
          price?: number | null
          product_name?: string | null
          product_url?: string | null
          rank?: number | null
          rating?: number | null
          review_count?: number | null
          sales_count?: number | null
          thumbnail_url?: string | null
          view_count?: number | null
        }
        Update: {
          brand_name?: string | null
          category?: string | null
          coupang_product_id?: string | null
          created_at?: string | null
          delivery_type?: string | null
          discovered_keyword_id?: string | null
          id?: string
          price?: number | null
          product_name?: string | null
          product_url?: string | null
          rank?: number | null
          rating?: number | null
          review_count?: number | null
          sales_count?: number | null
          thumbnail_url?: string | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "discovered_keyword_products_discovered_keyword_id_fkey"
            columns: ["discovered_keyword_id"]
            isOneToOne: false
            referencedRelation: "discovered_keywords"
            referencedColumns: ["id"]
          },
        ]
      }
      discovered_keywords: {
        Row: {
          avg_conversion_rate: number | null
          avg_price: number | null
          avg_review_count: number | null
          competition_score: number | null
          created_at: string | null
          delivery_rocket_ratio: number | null
          delivery_seller_ratio: number | null
          discovery_id: string | null
          entry_score: number | null
          id: string
          keyword: string
          market_score: number | null
          max_review_count: number | null
          seed_keyword: string | null
          source: string
          status: string | null
          total_sales_28d: number | null
          total_score: number | null
          total_views_28d: number | null
          verdict: string | null
          wing_collected: boolean | null
        }
        Insert: {
          avg_conversion_rate?: number | null
          avg_price?: number | null
          avg_review_count?: number | null
          competition_score?: number | null
          created_at?: string | null
          delivery_rocket_ratio?: number | null
          delivery_seller_ratio?: number | null
          discovery_id?: string | null
          entry_score?: number | null
          id?: string
          keyword: string
          market_score?: number | null
          max_review_count?: number | null
          seed_keyword?: string | null
          source: string
          status?: string | null
          total_sales_28d?: number | null
          total_score?: number | null
          total_views_28d?: number | null
          verdict?: string | null
          wing_collected?: boolean | null
        }
        Update: {
          avg_conversion_rate?: number | null
          avg_price?: number | null
          avg_review_count?: number | null
          competition_score?: number | null
          created_at?: string | null
          delivery_rocket_ratio?: number | null
          delivery_seller_ratio?: number | null
          discovery_id?: string | null
          entry_score?: number | null
          id?: string
          keyword?: string
          market_score?: number | null
          max_review_count?: number | null
          seed_keyword?: string | null
          source?: string
          status?: string | null
          total_sales_28d?: number | null
          total_score?: number | null
          total_views_28d?: number | null
          verdict?: string | null
          wing_collected?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "discovered_keywords_discovery_id_fkey"
            columns: ["discovery_id"]
            isOneToOne: false
            referencedRelation: "keyword_discoveries"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_vendors: {
        Row: {
          business_id: string | null
          business_number: string | null
          contact: string | null
          created_at: string
          default_category: string | null
          default_payment_method: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          business_id?: string | null
          business_number?: string | null
          contact?: string | null
          created_at?: string
          default_category?: string | null
          default_payment_method?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          business_id?: string | null
          business_number?: string | null
          contact?: string | null
          created_at?: string
          default_category?: string | null
          default_payment_method?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_vendors_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          business_id: string | null
          category: string
          created_at: string | null
          description: string | null
          expense_date: string
          id: string
          notes: string | null
          payment_method: string | null
          receipt_path: string | null
          receipt_url: string | null
          updated_at: string | null
          user_id: string
          vat_amount: number | null
          vendor_id: string | null
        }
        Insert: {
          amount: number
          business_id?: string | null
          category: string
          created_at?: string | null
          description?: string | null
          expense_date: string
          id?: string
          notes?: string | null
          payment_method?: string | null
          receipt_path?: string | null
          receipt_url?: string | null
          updated_at?: string | null
          user_id: string
          vat_amount?: number | null
          vendor_id?: string | null
        }
        Update: {
          amount?: number
          business_id?: string | null
          category?: string
          created_at?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          notes?: string | null
          payment_method?: string | null
          receipt_path?: string | null
          receipt_url?: string | null
          updated_at?: string | null
          user_id?: string
          vat_amount?: number | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "expense_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      extension_tokens: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          label: string | null
          last_used: string | null
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          label?: string | null
          last_used?: string | null
          token: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          label?: string | null
          last_used?: string | null
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      focus_ad_daily: {
        Row: {
          ad_attributed_orders: number | null
          ad_attributed_sales: number | null
          ad_attributed_units: number | null
          business_id: string
          campaign_id: string
          clicks: number | null
          created_at: string | null
          delivered_ad_cost: number | null
          extractor_version: string
          first_observed_at: string
          id: string
          impressions: number | null
          last_observed_at: string
          metric_date: string
          platform_roas: number | null
          source: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ad_attributed_orders?: number | null
          ad_attributed_sales?: number | null
          ad_attributed_units?: number | null
          business_id: string
          campaign_id: string
          clicks?: number | null
          created_at?: string | null
          delivered_ad_cost?: number | null
          extractor_version?: string
          first_observed_at: string
          id?: string
          impressions?: number | null
          last_observed_at: string
          metric_date: string
          platform_roas?: number | null
          source?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ad_attributed_orders?: number | null
          ad_attributed_sales?: number | null
          ad_attributed_units?: number | null
          business_id?: string
          campaign_id?: string
          clicks?: number | null
          created_at?: string | null
          delivered_ad_cost?: number | null
          extractor_version?: string
          first_observed_at?: string
          id?: string
          impressions?: number | null
          last_observed_at?: string
          metric_date?: string
          platform_roas?: number | null
          source?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      focus_campaign_catalog: {
        Row: {
          budget: number | null
          business_id: string
          campaign_id: string
          created_at_source: string | null
          goal_type: string | null
          harvested_at: string
          id: string
          is_active: boolean | null
          is_auto_product_selection: boolean
          name: string | null
          objective: string | null
          roas_target: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          budget?: number | null
          business_id: string
          campaign_id: string
          created_at_source?: string | null
          goal_type?: string | null
          harvested_at?: string
          id?: string
          is_active?: boolean | null
          is_auto_product_selection?: boolean
          name?: string | null
          objective?: string | null
          roas_target?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          budget?: number | null
          business_id?: string
          campaign_id?: string
          created_at_source?: string | null
          goal_type?: string | null
          harvested_at?: string
          id?: string
          is_active?: boolean | null
          is_auto_product_selection?: boolean
          name?: string | null
          objective?: string | null
          roas_target?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      focus_daily_note: {
        Row: {
          business_id: string
          coupang_exposure_id: string
          created_at: string | null
          id: string
          metric_date: string
          note: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          business_id: string
          coupang_exposure_id: string
          created_at?: string | null
          id?: string
          metric_date: string
          note: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          business_id?: string
          coupang_exposure_id?: string
          created_at?: string | null
          id?: string
          metric_date?: string
          note?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      focus_product_status_events: {
        Row: {
          business_id: string
          created_at: string | null
          effective_at: string
          focus_product_id: string
          id: string
          idempotency_key: string
          note: string | null
          status: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string | null
          effective_at?: string
          focus_product_id: string
          id?: string
          idempotency_key: string
          note?: string | null
          status: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string | null
          effective_at?: string
          focus_product_id?: string
          id?: string
          idempotency_key?: string
          note?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "focus_product_status_events_focus_product_id_fkey"
            columns: ["focus_product_id"]
            isOneToOne: false
            referencedRelation: "focus_products"
            referencedColumns: ["id"]
          },
        ]
      }
      focus_products: {
        Row: {
          business_id: string
          campaign_id: string
          coupang_exposure_id: string
          created_at: string | null
          id: string
          is_active: boolean
          label: string | null
          product_id: string | null
          updated_at: string | null
          user_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          business_id: string
          campaign_id: string
          coupang_exposure_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          product_id?: string | null
          updated_at?: string | null
          user_id: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          business_id?: string
          campaign_id?: string
          coupang_exposure_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          product_id?: string | null
          updated_at?: string | null
          user_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "focus_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      focus_rank_daily: {
        Row: {
          business_id: string
          found: boolean | null
          id: string
          metric_date: string
          observed_at: string
          page: number | null
          page_size: number | null
          position_in_page: number | null
          rank: number | null
          scan_depth: number | null
          source: string
          source_ranking_item_id: string | null
          target_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          business_id: string
          found?: boolean | null
          id?: string
          metric_date: string
          observed_at?: string
          page?: number | null
          page_size?: number | null
          position_in_page?: number | null
          rank?: number | null
          scan_depth?: number | null
          source: string
          source_ranking_item_id?: string | null
          target_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          business_id?: string
          found?: boolean | null
          id?: string
          metric_date?: string
          observed_at?: string
          page?: number | null
          page_size?: number | null
          position_in_page?: number | null
          rank?: number | null
          scan_depth?: number | null
          source?: string
          source_ranking_item_id?: string | null
          target_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "focus_rank_daily_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "focus_rank_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      focus_rank_targets: {
        Row: {
          business_id: string
          created_at: string | null
          focus_product_id: string
          id: string
          is_active: boolean
          keyword: string
          option_label: string | null
          updated_at: string | null
          user_id: string
          valid_from: string
          valid_to: string | null
          vendor_item_id: string
        }
        Insert: {
          business_id: string
          created_at?: string | null
          focus_product_id: string
          id?: string
          is_active?: boolean
          keyword: string
          option_label?: string | null
          updated_at?: string | null
          user_id: string
          valid_from?: string
          valid_to?: string | null
          vendor_item_id: string
        }
        Update: {
          business_id?: string
          created_at?: string | null
          focus_product_id?: string
          id?: string
          is_active?: boolean
          keyword?: string
          option_label?: string | null
          updated_at?: string | null
          user_id?: string
          valid_from?: string
          valid_to?: string | null
          vendor_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "focus_rank_targets_focus_product_id_fkey"
            columns: ["focus_product_id"]
            isOneToOne: false
            referencedRelation: "focus_products"
            referencedColumns: ["id"]
          },
        ]
      }
      import_watchdog_job_receipts: {
        Row: {
          claimed_at: string
          failure: Json | null
          finished_at: string | null
          id: string
          job_key: string
          kst_date: string
          request_payload: Json
          result: Json | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          claimed_at?: string
          failure?: Json | null
          finished_at?: string | null
          id?: string
          job_key: string
          kst_date: string
          request_payload: Json
          result?: Json | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          claimed_at?: string
          failure?: Json | null
          finished_at?: string | null
          id?: string
          job_key?: string
          kst_date?: string
          request_payload?: Json
          result?: Json | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      inventory: {
        Row: {
          avg_daily_sales: number | null
          coupang_stock: number | null
          current_stock: number | null
          depletion_date: string | null
          health_grade: string | null
          id: string
          last_health_sync: string | null
          last_inbound_at: string | null
          product_id: string
          reorder_date: string | null
          reorder_point: number | null
          safety_stock: number | null
          storage_fee_monthly: number | null
          updated_at: string | null
        }
        Insert: {
          avg_daily_sales?: number | null
          coupang_stock?: number | null
          current_stock?: number | null
          depletion_date?: string | null
          health_grade?: string | null
          id?: string
          last_health_sync?: string | null
          last_inbound_at?: string | null
          product_id: string
          reorder_date?: string | null
          reorder_point?: number | null
          safety_stock?: number | null
          storage_fee_monthly?: number | null
          updated_at?: string | null
        }
        Update: {
          avg_daily_sales?: number | null
          coupang_stock?: number | null
          current_stock?: number | null
          depletion_date?: string | null
          health_grade?: string | null
          id?: string
          last_health_sync?: string | null
          last_inbound_at?: string | null
          product_id?: string
          reorder_date?: string | null
          reorder_point?: number | null
          safety_stock?: number | null
          storage_fee_monthly?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_health_history: {
        Row: {
          business_id: string | null
          coupang_stock: number
          created_at: string | null
          depletion_date: string | null
          health_grade: string | null
          id: string
          import_batch_id: string | null
          product_id: string
          sku: string | null
          snapshot_date: string
          storage_fee_monthly: number | null
          user_id: string
        }
        Insert: {
          business_id?: string | null
          coupang_stock?: number
          created_at?: string | null
          depletion_date?: string | null
          health_grade?: string | null
          id?: string
          import_batch_id?: string | null
          product_id: string
          sku?: string | null
          snapshot_date?: string
          storage_fee_monthly?: number | null
          user_id: string
        }
        Update: {
          business_id?: string | null
          coupang_stock?: number
          created_at?: string | null
          depletion_date?: string | null
          health_grade?: string | null
          id?: string
          import_batch_id?: string | null
          product_id?: string
          sku?: string | null
          snapshot_date?: string
          storage_fee_monthly?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_health_history_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_health_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string | null
          id: string
          inventory_id: string
          movement_date: string
          movement_type: string
          notes: string | null
          product_id: string
          quantity: number
          reference_no: string | null
          unit_cost: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          inventory_id: string
          movement_date?: string
          movement_type: string
          notes?: string | null
          product_id: string
          quantity: number
          reference_no?: string | null
          unit_cost?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          inventory_id?: string
          movement_date?: string
          movement_type?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          reference_no?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_state: {
        Row: {
          avg_cost_krw: number
          product_id: string
          qty: number
          total_value: number
          updated_at: string
        }
        Insert: {
          avg_cost_krw?: number
          product_id: string
          qty?: number
          total_value?: number
          updated_at?: string
        }
        Update: {
          avg_cost_krw?: number
          product_id?: string
          qty?: number
          total_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_state_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      keyword_category_map: {
        Row: {
          category_code: number
          category_hierarchy: Json | null
          confidence: number | null
          created_at: string | null
          id: string
          keyword: string
          last_visited_at: string | null
          source: string | null
          updated_at: string | null
          user_id: string
          visit_count: number | null
        }
        Insert: {
          category_code: number
          category_hierarchy?: Json | null
          confidence?: number | null
          created_at?: string | null
          id?: string
          keyword: string
          last_visited_at?: string | null
          source?: string | null
          updated_at?: string | null
          user_id: string
          visit_count?: number | null
        }
        Update: {
          category_code?: number
          category_hierarchy?: Json | null
          confidence?: number | null
          created_at?: string | null
          id?: string
          keyword?: string
          last_visited_at?: string | null
          source?: string | null
          updated_at?: string | null
          user_id?: string
          visit_count?: number | null
        }
        Relationships: []
      }
      keyword_discoveries: {
        Row: {
          completed_at: string | null
          created_at: string | null
          id: string
          seed_type: string
          session_name: string | null
          status: string | null
          total_expanded: number | null
          total_filtered: number | null
          total_scored: number | null
          total_seeds: number | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          seed_type: string
          session_name?: string | null
          status?: string | null
          total_expanded?: number | null
          total_filtered?: number | null
          total_scored?: number | null
          total_seeds?: number | null
          user_id?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          seed_type?: string
          session_name?: string | null
          status?: string | null
          total_expanded?: number | null
          total_filtered?: number | null
          total_scored?: number | null
          total_seeds?: number | null
          user_id?: string
        }
        Relationships: []
      }
      keyword_ranking_items: {
        Row: {
          coupang_product_id: string | null
          created_at: string | null
          delivery_type: string | null
          discount_rate: number | null
          final_price: number | null
          id: string
          origin_price: number | null
          price: number | null
          product_name: string | null
          product_url: string | null
          rank: number
          ranking_id: string
          rating: number | null
          review_count: number | null
          sale_price: number | null
          sales_count: number | null
          thumbnail_url: string | null
          vendor_item_id: string | null
          view_collected_at: string | null
          view_count: number | null
          wing_sale_price: number | null
        }
        Insert: {
          coupang_product_id?: string | null
          created_at?: string | null
          delivery_type?: string | null
          discount_rate?: number | null
          final_price?: number | null
          id?: string
          origin_price?: number | null
          price?: number | null
          product_name?: string | null
          product_url?: string | null
          rank: number
          ranking_id: string
          rating?: number | null
          review_count?: number | null
          sale_price?: number | null
          sales_count?: number | null
          thumbnail_url?: string | null
          vendor_item_id?: string | null
          view_collected_at?: string | null
          view_count?: number | null
          wing_sale_price?: number | null
        }
        Update: {
          coupang_product_id?: string | null
          created_at?: string | null
          delivery_type?: string | null
          discount_rate?: number | null
          final_price?: number | null
          id?: string
          origin_price?: number | null
          price?: number | null
          product_name?: string | null
          product_url?: string | null
          rank?: number
          ranking_id?: string
          rating?: number | null
          review_count?: number | null
          sale_price?: number | null
          sales_count?: number | null
          thumbnail_url?: string | null
          vendor_item_id?: string | null
          view_collected_at?: string | null
          view_count?: number | null
          wing_sale_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "keyword_ranking_items_ranking_id_fkey"
            columns: ["ranking_id"]
            isOneToOne: false
            referencedRelation: "keyword_rankings"
            referencedColumns: ["id"]
          },
        ]
      }
      keyword_rankings: {
        Row: {
          clusters: Json | null
          clusters_analyzed_at: string | null
          collected_at: string
          created_at: string | null
          id: string
          keyword: string
          product_count: number
          rank_sales_analysis: Json | null
          rank_sales_analyzed_at: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          clusters?: Json | null
          clusters_analyzed_at?: string | null
          collected_at?: string
          created_at?: string | null
          id?: string
          keyword: string
          product_count?: number
          rank_sales_analysis?: Json | null
          rank_sales_analyzed_at?: string | null
          source?: string
          user_id?: string | null
        }
        Update: {
          clusters?: Json | null
          clusters_analyzed_at?: string | null
          collected_at?: string
          created_at?: string | null
          id?: string
          keyword?: string
          product_count?: number
          rank_sales_analysis?: Json | null
          rank_sales_analyzed_at?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      keyword_scores: {
        Row: {
          ad_pressure_score: number | null
          category_code: number
          competition_score: number | null
          computed_at: string | null
          growth_score: number | null
          id: string
          insight_id: string | null
          keyword: string
          market_score: number | null
          opportunity_score: number | null
          sub_scores: Json | null
          tier: string | null
          user_id: string
          wiki_entry_id: string | null
        }
        Insert: {
          ad_pressure_score?: number | null
          category_code: number
          competition_score?: number | null
          computed_at?: string | null
          growth_score?: number | null
          id?: string
          insight_id?: string | null
          keyword: string
          market_score?: number | null
          opportunity_score?: number | null
          sub_scores?: Json | null
          tier?: string | null
          user_id: string
          wiki_entry_id?: string | null
        }
        Update: {
          ad_pressure_score?: number | null
          category_code?: number
          competition_score?: number | null
          computed_at?: string | null
          growth_score?: number | null
          id?: string
          insight_id?: string | null
          keyword?: string
          market_score?: number | null
          opportunity_score?: number | null
          sub_scores?: Json | null
          tier?: string | null
          user_id?: string
          wiki_entry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "keyword_scores_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "market_insights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keyword_scores_wiki_entry_id_fkey"
            columns: ["wiki_entry_id"]
            isOneToOne: false
            referencedRelation: "sourcing_wiki_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_inventory_operation_receipts: {
        Row: {
          business_id: string
          created_at: string
          operation_id: string
          request_fingerprint: string
          result: Json | null
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          operation_id: string
          request_fingerprint: string
          result?: Json | null
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          operation_id?: string
          request_fingerprint?: string
          result?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      market_insight_items: {
        Row: {
          ad_dependency_tag: string | null
          ad_efficiency: number | null
          ad_ratio: number | null
          brand_name: string | null
          category: string | null
          coupang_product_id: string | null
          created_at: string | null
          delivery_type: string | null
          gmv: number | null
          id: string
          insight_id: string | null
          is_winner: boolean | null
          item_id: number | null
          keyword: string | null
          price: number | null
          product_name: string | null
          product_url: string | null
          rank: number | null
          rating: number | null
          raw_data: Json | null
          review_count: number | null
          sales: number | null
          srp_click_share: number | null
          thumbnail_url: string | null
          units_sold: number | null
          vendor_item_id: number | null
        }
        Insert: {
          ad_dependency_tag?: string | null
          ad_efficiency?: number | null
          ad_ratio?: number | null
          brand_name?: string | null
          category?: string | null
          coupang_product_id?: string | null
          created_at?: string | null
          delivery_type?: string | null
          gmv?: number | null
          id?: string
          insight_id?: string | null
          is_winner?: boolean | null
          item_id?: number | null
          keyword?: string | null
          price?: number | null
          product_name?: string | null
          product_url?: string | null
          rank?: number | null
          rating?: number | null
          raw_data?: Json | null
          review_count?: number | null
          sales?: number | null
          srp_click_share?: number | null
          thumbnail_url?: string | null
          units_sold?: number | null
          vendor_item_id?: number | null
        }
        Update: {
          ad_dependency_tag?: string | null
          ad_efficiency?: number | null
          ad_ratio?: number | null
          brand_name?: string | null
          category?: string | null
          coupang_product_id?: string | null
          created_at?: string | null
          delivery_type?: string | null
          gmv?: number | null
          id?: string
          insight_id?: string | null
          is_winner?: boolean | null
          item_id?: number | null
          keyword?: string | null
          price?: number | null
          product_name?: string | null
          product_url?: string | null
          rank?: number | null
          rating?: number | null
          raw_data?: Json | null
          review_count?: number | null
          sales?: number | null
          srp_click_share?: number | null
          thumbnail_url?: string | null
          units_sold?: number | null
          vendor_item_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "market_insight_items_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "market_insights"
            referencedColumns: ["id"]
          },
        ]
      }
      market_insight_keywords: {
        Row: {
          ad_clicks: number | null
          ad_impressions: number | null
          ad_ratio: number | null
          avg_product_price: number | null
          click_through_rate: number | null
          clicks: number | null
          conversion_rate: number | null
          created_at: string | null
          id: string
          impressions: number | null
          insight_id: string | null
          keyword: string
          rank: number | null
          raw_data: Json | null
          srp_click_share: number | null
        }
        Insert: {
          ad_clicks?: number | null
          ad_impressions?: number | null
          ad_ratio?: number | null
          avg_product_price?: number | null
          click_through_rate?: number | null
          clicks?: number | null
          conversion_rate?: number | null
          created_at?: string | null
          id?: string
          impressions?: number | null
          insight_id?: string | null
          keyword: string
          rank?: number | null
          raw_data?: Json | null
          srp_click_share?: number | null
        }
        Update: {
          ad_clicks?: number | null
          ad_impressions?: number | null
          ad_ratio?: number | null
          avg_product_price?: number | null
          click_through_rate?: number | null
          clicks?: number | null
          conversion_rate?: number | null
          created_at?: string | null
          id?: string
          impressions?: number | null
          insight_id?: string | null
          keyword?: string
          rank?: number | null
          raw_data?: Json | null
          srp_click_share?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "market_insight_keywords_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "market_insights"
            referencedColumns: ["id"]
          },
        ]
      }
      market_insight_price_buckets: {
        Row: {
          bucket_label: string | null
          bucket_max: number | null
          bucket_min: number | null
          created_at: string | null
          gmv_share: number | null
          id: string
          insight_id: string | null
          item_count: number | null
          keyword: string
          raw_data: Json | null
          sales_share: number | null
        }
        Insert: {
          bucket_label?: string | null
          bucket_max?: number | null
          bucket_min?: number | null
          created_at?: string | null
          gmv_share?: number | null
          id?: string
          insight_id?: string | null
          item_count?: number | null
          keyword: string
          raw_data?: Json | null
          sales_share?: number | null
        }
        Update: {
          bucket_label?: string | null
          bucket_max?: number | null
          bucket_min?: number | null
          created_at?: string | null
          gmv_share?: number | null
          id?: string
          insight_id?: string | null
          item_count?: number | null
          keyword?: string
          raw_data?: Json | null
          sales_share?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "market_insight_price_buckets_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "market_insights"
            referencedColumns: ["id"]
          },
        ]
      }
      market_insights: {
        Row: {
          category_code: number
          category_keywords_datewise: Json | null
          category_metric: Json | null
          collected_at: string
          created_at: string | null
          errors: Json | null
          glance_view: number | null
          glance_view_variance: number | null
          id: string
          item_winners: Json | null
          keyword: string | null
          source: string
          top100_ads_impression_percentage: number | null
          total_errors: number | null
          total_items: number | null
          total_keywords: number | null
          trends_search: Json | null
          user_id: string
        }
        Insert: {
          category_code: number
          category_keywords_datewise?: Json | null
          category_metric?: Json | null
          collected_at: string
          created_at?: string | null
          errors?: Json | null
          glance_view?: number | null
          glance_view_variance?: number | null
          id?: string
          item_winners?: Json | null
          keyword?: string | null
          source?: string
          top100_ads_impression_percentage?: number | null
          total_errors?: number | null
          total_items?: number | null
          total_keywords?: number | null
          trends_search?: Json | null
          user_id: string
        }
        Update: {
          category_code?: number
          category_keywords_datewise?: Json | null
          category_metric?: Json | null
          collected_at?: string
          created_at?: string | null
          errors?: Json | null
          glance_view?: number | null
          glance_view_variance?: number | null
          id?: string
          item_winners?: Json | null
          keyword?: string | null
          source?: string
          top100_ads_impression_percentage?: number | null
          total_errors?: number | null
          total_items?: number | null
          total_keywords?: number | null
          trends_search?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      owner_api_tokens: {
        Row: {
          created_at: string
          id: string
          label: string
          last_used_at: string | null
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      pricing: {
        Row: {
          coupon_amount: number | null
          created_at: string | null
          discount_rate: number | null
          effective_price: number
          id: string
          is_active: boolean | null
          list_price: number
          product_id: string
          sale_type: string
          selling_price: number
          updated_at: string | null
        }
        Insert: {
          coupon_amount?: number | null
          created_at?: string | null
          discount_rate?: number | null
          effective_price: number
          id?: string
          is_active?: boolean | null
          list_price: number
          product_id: string
          sale_type: string
          selling_price: number
          updated_at?: string | null
        }
        Update: {
          coupon_amount?: number | null
          created_at?: string | null
          discount_rate?: number | null
          effective_price?: number
          id?: string
          is_active?: boolean | null
          list_price?: number
          product_id?: string
          sale_type?: string
          selling_price?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_costs: {
        Row: {
          approved_at: string | null
          commission_amount: number | null
          commission_rate: number
          commission_vat: number | null
          created_at: string | null
          fulfillment_fee: number | null
          fulfillment_vat: number | null
          id: string
          margin: number | null
          margin_rate: number | null
          min_roas: number | null
          option_name: string | null
          product_id: string
          quantity_per_set: number | null
          return_pickup_fee: number | null
          return_pickup_vat: number | null
          return_rate: number | null
          return_restock_fee: number | null
          return_restock_vat: number | null
          selling_price: number
          sim_quantity: number | null
          source_context: Json | null
          supplier_id: string | null
          total_commission: number | null
          total_cost: number | null
          total_fulfillment: number | null
          total_margin: number | null
          total_margin_rate: number | null
          total_min_roas: number | null
          total_return_cost: number | null
          total_revenue: number | null
          total_vat: number | null
          unit_cost: number | null
          updated_at: string | null
          vat: number | null
        }
        Insert: {
          approved_at?: string | null
          commission_amount?: number | null
          commission_rate: number
          commission_vat?: number | null
          created_at?: string | null
          fulfillment_fee?: number | null
          fulfillment_vat?: number | null
          id?: string
          margin?: number | null
          margin_rate?: number | null
          min_roas?: number | null
          option_name?: string | null
          product_id: string
          quantity_per_set?: number | null
          return_pickup_fee?: number | null
          return_pickup_vat?: number | null
          return_rate?: number | null
          return_restock_fee?: number | null
          return_restock_vat?: number | null
          selling_price: number
          sim_quantity?: number | null
          source_context?: Json | null
          supplier_id?: string | null
          total_commission?: number | null
          total_cost?: number | null
          total_fulfillment?: number | null
          total_margin?: number | null
          total_margin_rate?: number | null
          total_min_roas?: number | null
          total_return_cost?: number | null
          total_revenue?: number | null
          total_vat?: number | null
          unit_cost?: number | null
          updated_at?: string | null
          vat?: number | null
        }
        Update: {
          approved_at?: string | null
          commission_amount?: number | null
          commission_rate?: number
          commission_vat?: number | null
          created_at?: string | null
          fulfillment_fee?: number | null
          fulfillment_vat?: number | null
          id?: string
          margin?: number | null
          margin_rate?: number | null
          min_roas?: number | null
          option_name?: string | null
          product_id?: string
          quantity_per_set?: number | null
          return_pickup_fee?: number | null
          return_pickup_vat?: number | null
          return_rate?: number | null
          return_restock_fee?: number | null
          return_restock_vat?: number | null
          selling_price?: number
          sim_quantity?: number | null
          source_context?: Json | null
          supplier_id?: string | null
          total_commission?: number | null
          total_cost?: number | null
          total_fulfillment?: number | null
          total_margin?: number | null
          total_margin_rate?: number | null
          total_min_roas?: number | null
          total_return_cost?: number | null
          total_revenue?: number | null
          total_vat?: number | null
          unit_cost?: number | null
          updated_at?: string | null
          vat?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_costs_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      product_identity_map: {
        Row: {
          confidence: string
          created_at: string | null
          external_id: string
          id: string
          namespace: string
          product_id: string
          source: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          confidence?: string
          created_at?: string | null
          external_id: string
          id?: string
          namespace: string
          product_id: string
          source?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          confidence?: string
          created_at?: string | null
          external_id?: string
          id?: string
          namespace?: string
          product_id?: string
          source?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_identity_map_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_name_history: {
        Row: {
          business_id: string | null
          created_at: string | null
          id: string
          new_name: string
          previous_name: string | null
          product_id: string
          product_name_record_id: string | null
          source: string
          user_id: string
          wing_applied_at: string | null
        }
        Insert: {
          business_id?: string | null
          created_at?: string | null
          id?: string
          new_name: string
          previous_name?: string | null
          product_id: string
          product_name_record_id?: string | null
          source: string
          user_id: string
          wing_applied_at?: string | null
        }
        Update: {
          business_id?: string | null
          created_at?: string | null
          id?: string
          new_name?: string
          previous_name?: string | null
          product_id?: string
          product_name_record_id?: string | null
          source?: string
          user_id?: string
          wing_applied_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_name_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_name_history_product_name_record_id_fkey"
            columns: ["product_name_record_id"]
            isOneToOne: false
            referencedRelation: "product_names"
            referencedColumns: ["id"]
          },
        ]
      }
      product_names: {
        Row: {
          brand_name: string
          core_keyword: string
          created_at: string | null
          excluded_keywords: Json | null
          generated_names: Json | null
          id: string
          keyword_analysis: Json | null
          market_size: string
          platform: string
          product_attributes: Json | null
          product_id: string | null
          screenshots: Json | null
          search_tags: Json | null
          selected_name: string | null
          status: string | null
          sub_keywords: Json | null
          target_keyword: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          brand_name: string
          core_keyword: string
          created_at?: string | null
          excluded_keywords?: Json | null
          generated_names?: Json | null
          id?: string
          keyword_analysis?: Json | null
          market_size?: string
          platform?: string
          product_attributes?: Json | null
          product_id?: string | null
          screenshots?: Json | null
          search_tags?: Json | null
          selected_name?: string | null
          status?: string | null
          sub_keywords?: Json | null
          target_keyword?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          brand_name?: string
          core_keyword?: string
          created_at?: string | null
          excluded_keywords?: Json | null
          generated_names?: Json | null
          id?: string
          keyword_analysis?: Json | null
          market_size?: string
          platform?: string
          product_attributes?: Json | null
          product_id?: string | null
          screenshots?: Json | null
          search_tags?: Json | null
          selected_name?: string | null
          status?: string | null
          sub_keywords?: Json | null
          target_keyword?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_names_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_price_history: {
        Row: {
          created_at: string | null
          effective_date: string
          field_name: string
          id: string
          product_id: string
          value: number
        }
        Insert: {
          created_at?: string | null
          effective_date: string
          field_name: string
          id?: string
          product_id: string
          value: number
        }
        Update: {
          created_at?: string | null
          effective_date?: string
          field_name?: string
          id?: string
          product_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_views: {
        Row: {
          collected_at: string
          coupang_product_id: string
          created_at: string | null
          id: string
          product_name: string | null
          sale_price: number | null
          sales_count: number | null
          source: string
          user_id: string | null
          view_count: number
        }
        Insert: {
          collected_at?: string
          coupang_product_id: string
          created_at?: string | null
          id?: string
          product_name?: string | null
          sale_price?: number | null
          sales_count?: number | null
          source?: string
          user_id?: string | null
          view_count: number
        }
        Update: {
          collected_at?: string
          coupang_product_id?: string
          created_at?: string | null
          id?: string
          product_name?: string | null
          sale_price?: number | null
          sales_count?: number | null
          source?: string
          user_id?: string | null
          view_count?: number
        }
        Relationships: []
      }
      products: {
        Row: {
          barcode: string | null
          business_id: string | null
          category_path: string | null
          commission_rate: number | null
          condition_value: string | null
          content_handoff: Json | null
          coupang_display_name: string | null
          coupang_exposure_id: string | null
          coupang_option_id: string | null
          coupang_product_id: string | null
          coupang_product_url: string | null
          coupang_sku_id: string | null
          created_at: string | null
          fulfillment_fee_benefit_until: string | null
          fulfillment_fee_default: number | null
          id: string
          inventory_weeks: number | null
          is_refurbished: boolean | null
          item_winner: boolean | null
          keyword: string | null
          lead_time_weeks: number | null
          notes: string | null
          option_name: string | null
          options: Json | null
          parent_product_id: string | null
          product_grade: string | null
          product_name: string | null
          purchase_required: number | null
          purpose: string
          rating: number | null
          return_resale_info: string | null
          sale_type: string | null
          sales_status: string | null
          search_tags: string[] | null
          seller_discount_coupon: number | null
          seq: number | null
          sku: string | null
          source_watchlist_id: string | null
          status: string | null
          unit_cost_default: number | null
          updated_at: string | null
          user_id: string | null
          vendor_product_id: string | null
          weekly_avg_sales: number | null
        }
        Insert: {
          barcode?: string | null
          business_id?: string | null
          category_path?: string | null
          commission_rate?: number | null
          condition_value?: string | null
          content_handoff?: Json | null
          coupang_display_name?: string | null
          coupang_exposure_id?: string | null
          coupang_option_id?: string | null
          coupang_product_id?: string | null
          coupang_product_url?: string | null
          coupang_sku_id?: string | null
          created_at?: string | null
          fulfillment_fee_benefit_until?: string | null
          fulfillment_fee_default?: number | null
          id?: string
          inventory_weeks?: number | null
          is_refurbished?: boolean | null
          item_winner?: boolean | null
          keyword?: string | null
          lead_time_weeks?: number | null
          notes?: string | null
          option_name?: string | null
          options?: Json | null
          parent_product_id?: string | null
          product_grade?: string | null
          product_name?: string | null
          purchase_required?: number | null
          purpose?: string
          rating?: number | null
          return_resale_info?: string | null
          sale_type?: string | null
          sales_status?: string | null
          search_tags?: string[] | null
          seller_discount_coupon?: number | null
          seq?: number | null
          sku?: string | null
          source_watchlist_id?: string | null
          status?: string | null
          unit_cost_default?: number | null
          updated_at?: string | null
          user_id?: string | null
          vendor_product_id?: string | null
          weekly_avg_sales?: number | null
        }
        Update: {
          barcode?: string | null
          business_id?: string | null
          category_path?: string | null
          commission_rate?: number | null
          condition_value?: string | null
          content_handoff?: Json | null
          coupang_display_name?: string | null
          coupang_exposure_id?: string | null
          coupang_option_id?: string | null
          coupang_product_id?: string | null
          coupang_product_url?: string | null
          coupang_sku_id?: string | null
          created_at?: string | null
          fulfillment_fee_benefit_until?: string | null
          fulfillment_fee_default?: number | null
          id?: string
          inventory_weeks?: number | null
          is_refurbished?: boolean | null
          item_winner?: boolean | null
          keyword?: string | null
          lead_time_weeks?: number | null
          notes?: string | null
          option_name?: string | null
          options?: Json | null
          parent_product_id?: string | null
          product_grade?: string | null
          product_name?: string | null
          purchase_required?: number | null
          purpose?: string
          rating?: number | null
          return_resale_info?: string | null
          sale_type?: string | null
          sales_status?: string | null
          search_tags?: string[] | null
          seller_discount_coupon?: number | null
          seq?: number | null
          sku?: string | null
          source_watchlist_id?: string | null
          status?: string | null
          unit_cost_default?: number | null
          updated_at?: string | null
          user_id?: string | null
          vendor_product_id?: string | null
          weekly_avg_sales?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_source_watchlist_id_fkey"
            columns: ["source_watchlist_id"]
            isOneToOne: false
            referencedRelation: "sourcing_watchlist"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_import_receipts: {
        Row: {
          actor_user_id: string
          business_id: string
          created_at: string
          idempotency_key: string
          import_batch_id: string
          inserted_count: number | null
          purchase_ids: string[]
          request_payload: Json
          response: Json | null
        }
        Insert: {
          actor_user_id: string
          business_id: string
          created_at?: string
          idempotency_key: string
          import_batch_id: string
          inserted_count?: number | null
          purchase_ids?: string[]
          request_payload: Json
          response?: Json | null
        }
        Update: {
          actor_user_id?: string
          business_id?: string
          created_at?: string
          idempotency_key?: string
          import_batch_id?: string
          inserted_count?: number | null
          purchase_ids?: string[]
          request_payload?: Json
          response?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_import_receipts_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: true
            referencedRelation: "coupang_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_inventory_effect_receipts: {
        Row: {
          created_at: string
          effect: string
          inventory_id: string
          movement_id: string
          operation_id: string
          product_id: string
          purchase_id: string
          quantity: number
          resulting_avg: number
          resulting_qty: number
          resulting_stock: number
          resulting_value: number
          unit_cost_krw: number
        }
        Insert: {
          created_at?: string
          effect: string
          inventory_id: string
          movement_id: string
          operation_id: string
          product_id: string
          purchase_id: string
          quantity: number
          resulting_avg: number
          resulting_qty: number
          resulting_stock: number
          resulting_value: number
          unit_cost_krw: number
        }
        Update: {
          created_at?: string
          effect?: string
          inventory_id?: string
          movement_id?: string
          operation_id?: string
          product_id?: string
          purchase_id?: string
          quantity?: number
          resulting_avg?: number
          resulting_qty?: number
          resulting_stock?: number
          resulting_value?: number
          unit_cost_krw?: number
        }
        Relationships: []
      }
      purchase_mutation_receipts: {
        Row: {
          action: string
          actor_user_id: string
          business_id: string
          created_at: string
          operation_id: string
          purchase_id: string
          request_payload: Json
          response: Json | null
        }
        Insert: {
          action: string
          actor_user_id: string
          business_id: string
          created_at?: string
          operation_id: string
          purchase_id: string
          request_payload: Json
          response?: Json | null
        }
        Update: {
          action?: string
          actor_user_id?: string
          business_id?: string
          created_at?: string
          operation_id?: string
          purchase_id?: string
          request_payload?: Json
          response?: Json | null
        }
        Relationships: []
      }
      purchases: {
        Row: {
          additional_cost: number | null
          agency_fee: number | null
          arrival_date: string | null
          business_id: string | null
          created_at: string | null
          currency: string | null
          customs_doc_fee: number | null
          customs_duty: number | null
          customs_vat: number | null
          domestic_shipping: number | null
          exchange_rate: number | null
          expected_arrival_date: string | null
          id: string
          inspection_fee: number | null
          labeling_fee: number | null
          lead_time_weeks: number | null
          notes: string | null
          order_date: string
          packaging_fee: number | null
          payment_date: string | null
          payment_status: string | null
          payment1_date: string | null
          payment1_product_krw: number | null
          payment1_status: string | null
          payment1_total: number | null
          payment1_vat: number | null
          payment2_date: string | null
          payment2_status: string | null
          payment2_total: number | null
          payment2_vat: number | null
          payment3_date: string | null
          payment3_status: string | null
          payment3_total: number | null
          po_number: string | null
          product_id: string | null
          product_name_memo: string | null
          quantity: number
          shipping_cost: number | null
          status: string | null
          supplier_id: string | null
          total_amount_krw: number
          unit_cost_krw: number | null
          unit_price: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          additional_cost?: number | null
          agency_fee?: number | null
          arrival_date?: string | null
          business_id?: string | null
          created_at?: string | null
          currency?: string | null
          customs_doc_fee?: number | null
          customs_duty?: number | null
          customs_vat?: number | null
          domestic_shipping?: number | null
          exchange_rate?: number | null
          expected_arrival_date?: string | null
          id?: string
          inspection_fee?: number | null
          labeling_fee?: number | null
          lead_time_weeks?: number | null
          notes?: string | null
          order_date: string
          packaging_fee?: number | null
          payment_date?: string | null
          payment_status?: string | null
          payment1_date?: string | null
          payment1_product_krw?: number | null
          payment1_status?: string | null
          payment1_total?: number | null
          payment1_vat?: number | null
          payment2_date?: string | null
          payment2_status?: string | null
          payment2_total?: number | null
          payment2_vat?: number | null
          payment3_date?: string | null
          payment3_status?: string | null
          payment3_total?: number | null
          po_number?: string | null
          product_id?: string | null
          product_name_memo?: string | null
          quantity: number
          shipping_cost?: number | null
          status?: string | null
          supplier_id?: string | null
          total_amount_krw: number
          unit_cost_krw?: number | null
          unit_price: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          additional_cost?: number | null
          agency_fee?: number | null
          arrival_date?: string | null
          business_id?: string | null
          created_at?: string | null
          currency?: string | null
          customs_doc_fee?: number | null
          customs_duty?: number | null
          customs_vat?: number | null
          domestic_shipping?: number | null
          exchange_rate?: number | null
          expected_arrival_date?: string | null
          id?: string
          inspection_fee?: number | null
          labeling_fee?: number | null
          lead_time_weeks?: number | null
          notes?: string | null
          order_date?: string
          packaging_fee?: number | null
          payment_date?: string | null
          payment_status?: string | null
          payment1_date?: string | null
          payment1_product_krw?: number | null
          payment1_status?: string | null
          payment1_total?: number | null
          payment1_vat?: number | null
          payment2_date?: string | null
          payment2_status?: string | null
          payment2_total?: number | null
          payment2_vat?: number | null
          payment3_date?: string | null
          payment3_status?: string | null
          payment3_total?: number | null
          po_number?: string | null
          product_id?: string | null
          product_name_memo?: string | null
          quantity?: number
          shipping_cost?: number | null
          status?: string | null
          supplier_id?: string | null
          total_amount_krw?: number
          unit_cost_krw?: number | null
          unit_price?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_editor_data: {
        Row: {
          id: string
          layout_assignments: Json
          pdp_job_id: string
          sections_data: Json
          updated_at: string | null
          user_id: string
        }
        Insert: {
          id?: string
          layout_assignments?: Json
          pdp_job_id: string
          sections_data?: Json
          updated_at?: string | null
          user_id: string
        }
        Update: {
          id?: string
          layout_assignments?: Json
          pdp_job_id?: string
          sections_data?: Json
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "registration_editor_data_pdp_job_id_fkey"
            columns: ["pdp_job_id"]
            isOneToOne: true
            referencedRelation: "registration_pdp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_pdp_jobs: {
        Row: {
          analysis: Json | null
          business_id: string | null
          copy_sections: Json | null
          corpus_version: string | null
          cost_usd: number | null
          created_at: string | null
          current_step: string
          design_prompts: Json | null
          draft_id: string | null
          error: string | null
          final_html: string | null
          generation_track: string
          id: string
          image_model: string
          image_quality: string
          mode: string
          progress: number
          research_result: Json | null
          section_images: Json | null
          section_plan: Json | null
          source_images: Json
          spec_sheet: Json
          updated_at: string | null
          user_id: string
        }
        Insert: {
          analysis?: Json | null
          business_id?: string | null
          copy_sections?: Json | null
          corpus_version?: string | null
          cost_usd?: number | null
          created_at?: string | null
          current_step?: string
          design_prompts?: Json | null
          draft_id?: string | null
          error?: string | null
          final_html?: string | null
          generation_track?: string
          id?: string
          image_model?: string
          image_quality?: string
          mode?: string
          progress?: number
          research_result?: Json | null
          section_images?: Json | null
          section_plan?: Json | null
          source_images?: Json
          spec_sheet: Json
          updated_at?: string | null
          user_id: string
        }
        Update: {
          analysis?: Json | null
          business_id?: string | null
          copy_sections?: Json | null
          corpus_version?: string | null
          cost_usd?: number | null
          created_at?: string | null
          current_step?: string
          design_prompts?: Json | null
          draft_id?: string | null
          error?: string | null
          final_html?: string | null
          generation_track?: string
          id?: string
          image_model?: string
          image_quality?: string
          mode?: string
          progress?: number
          research_result?: Json | null
          section_images?: Json | null
          section_plan?: Json | null
          source_images?: Json
          spec_sheet?: Json
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "registration_pdp_jobs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_pdp_jobs_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "sourcing_registration_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_thumbnail_jobs: {
        Row: {
          business_id: string | null
          category_hint: string | null
          cost_usd: number | null
          created_at: string | null
          cuts: Json | null
          draft_id: string | null
          error: string | null
          id: string
          image_model: string
          image_quality: string
          product_name: string | null
          progress: number
          selected_cut: string | null
          source_images: Json
          status: string
          updated_at: string | null
          user_id: string
          vision_analysis: Json | null
        }
        Insert: {
          business_id?: string | null
          category_hint?: string | null
          cost_usd?: number | null
          created_at?: string | null
          cuts?: Json | null
          draft_id?: string | null
          error?: string | null
          id?: string
          image_model?: string
          image_quality?: string
          product_name?: string | null
          progress?: number
          selected_cut?: string | null
          source_images?: Json
          status?: string
          updated_at?: string | null
          user_id: string
          vision_analysis?: Json | null
        }
        Update: {
          business_id?: string | null
          category_hint?: string | null
          cost_usd?: number | null
          created_at?: string | null
          cuts?: Json | null
          draft_id?: string | null
          error?: string | null
          id?: string
          image_model?: string
          image_quality?: string
          product_name?: string | null
          progress?: number
          selected_cut?: string | null
          source_images?: Json
          status?: string
          updated_at?: string | null
          user_id?: string
          vision_analysis?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "registration_thumbnail_jobs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_thumbnail_jobs_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "sourcing_registration_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      rg_cost_schedule: {
        Row: {
          created_at: string | null
          effective_from: string | null
          id: string
          inbound_fee: number | null
          is_promotion: boolean | null
          length_cm_max: number | null
          note: string | null
          outbound_fee: number | null
          size_label: string
          size_tier: string
          storage_fee_monthly: number | null
          total_fee: number | null
          weight_kg_max: number | null
        }
        Insert: {
          created_at?: string | null
          effective_from?: string | null
          id?: string
          inbound_fee?: number | null
          is_promotion?: boolean | null
          length_cm_max?: number | null
          note?: string | null
          outbound_fee?: number | null
          size_label: string
          size_tier: string
          storage_fee_monthly?: number | null
          total_fee?: number | null
          weight_kg_max?: number | null
        }
        Update: {
          created_at?: string | null
          effective_from?: string | null
          id?: string
          inbound_fee?: number | null
          is_promotion?: boolean | null
          length_cm_max?: number | null
          note?: string | null
          outbound_fee?: number | null
          size_label?: string
          size_tier?: string
          storage_fee_monthly?: number | null
          total_fee?: number | null
          weight_kg_max?: number | null
        }
        Relationships: []
      }
      safe_sales_gap_backfill_receipts: {
        Row: {
          business_id: string
          content_sha256: string
          created_at: string
          derived_state: string
          file_name: string
          file_size: number
          hash_basis: string
          id: string
          import_batch_id: string
          import_date: string
          mode: string
          row_count: number
          user_id: string
        }
        Insert: {
          business_id: string
          content_sha256: string
          created_at?: string
          derived_state?: string
          file_name: string
          file_size: number
          hash_basis?: string
          id?: string
          import_batch_id: string
          import_date: string
          mode?: string
          row_count: number
          user_id: string
        }
        Update: {
          business_id?: string
          content_sha256?: string
          created_at?: string
          derived_state?: string
          file_name?: string
          file_size?: number
          hash_basis?: string
          id?: string
          import_batch_id?: string
          import_date?: string
          mode?: string
          row_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safe_sales_gap_backfill_receipts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safe_sales_gap_backfill_receipts_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: true
            referencedRelation: "coupang_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_transactions: {
        Row: {
          business_id: string | null
          cancel_amount: number | null
          cancel_quantity: number | null
          category: string | null
          commission_amount: number | null
          commission_fee: number | null
          commission_rate: number | null
          commission_vat: number | null
          coupon_discount: number | null
          created_at: string | null
          exchange_rate: number | null
          fulfillment_fee: number | null
          fulfillment_vat: number | null
          gross_amount: number | null
          gross_quantity: number | null
          id: string
          import_batch_id: string | null
          item_winner_rate: number | null
          margin: number | null
          notes: string | null
          option_id: string | null
          option_name: string | null
          order_date: string
          order_number: string | null
          order_quantity: number
          payout_amount: number | null
          product_id: string | null
          product_type: string | null
          selling_price: number
          settlement_amount: number | null
          shipping_fee: number | null
          source: string | null
          status: string | null
          total_amount: number
          unit_cost: number | null
          updated_at: string | null
          user_id: string
          vat: number | null
        }
        Insert: {
          business_id?: string | null
          cancel_amount?: number | null
          cancel_quantity?: number | null
          category?: string | null
          commission_amount?: number | null
          commission_fee?: number | null
          commission_rate?: number | null
          commission_vat?: number | null
          coupon_discount?: number | null
          created_at?: string | null
          exchange_rate?: number | null
          fulfillment_fee?: number | null
          fulfillment_vat?: number | null
          gross_amount?: number | null
          gross_quantity?: number | null
          id?: string
          import_batch_id?: string | null
          item_winner_rate?: number | null
          margin?: number | null
          notes?: string | null
          option_id?: string | null
          option_name?: string | null
          order_date: string
          order_number?: string | null
          order_quantity?: number
          payout_amount?: number | null
          product_id?: string | null
          product_type?: string | null
          selling_price: number
          settlement_amount?: number | null
          shipping_fee?: number | null
          source?: string | null
          status?: string | null
          total_amount: number
          unit_cost?: number | null
          updated_at?: string | null
          user_id: string
          vat?: number | null
        }
        Update: {
          business_id?: string | null
          cancel_amount?: number | null
          cancel_quantity?: number | null
          category?: string | null
          commission_amount?: number | null
          commission_fee?: number | null
          commission_rate?: number | null
          commission_vat?: number | null
          coupon_discount?: number | null
          created_at?: string | null
          exchange_rate?: number | null
          fulfillment_fee?: number | null
          fulfillment_vat?: number | null
          gross_amount?: number | null
          gross_quantity?: number | null
          id?: string
          import_batch_id?: string | null
          item_winner_rate?: number | null
          margin?: number | null
          notes?: string | null
          option_id?: string | null
          option_name?: string | null
          order_date?: string
          order_number?: string | null
          order_quantity?: number
          payout_amount?: number | null
          product_id?: string | null
          product_type?: string | null
          selling_price?: number
          settlement_amount?: number | null
          shipping_fee?: number | null
          source?: string | null
          status?: string | null
          total_amount?: number
          unit_cost?: number | null
          updated_at?: string | null
          user_id?: string
          vat?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_transactions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          ad_cost: number | null
          aggregation_key: string | null
          business_id: string | null
          created_at: string | null
          id: string
          import_batch_id: string | null
          net_profit: number | null
          period_end: string
          period_start: string
          product_id: string
          sales_quantity: number | null
          settlement_type: string | null
          source: string | null
          total_commission: number | null
          total_commission_vat: number | null
          total_cost: number | null
          total_fulfillment: number | null
          total_fulfillment_vat: number | null
          total_margin: number | null
          total_margin_rate: number | null
          total_return_pickup: number | null
          total_return_restock: number | null
          total_revenue: number | null
          total_vat: number | null
          user_id: string | null
          verified: boolean | null
        }
        Insert: {
          ad_cost?: number | null
          aggregation_key?: string | null
          business_id?: string | null
          created_at?: string | null
          id?: string
          import_batch_id?: string | null
          net_profit?: number | null
          period_end: string
          period_start: string
          product_id: string
          sales_quantity?: number | null
          settlement_type?: string | null
          source?: string | null
          total_commission?: number | null
          total_commission_vat?: number | null
          total_cost?: number | null
          total_fulfillment?: number | null
          total_fulfillment_vat?: number | null
          total_margin?: number | null
          total_margin_rate?: number | null
          total_return_pickup?: number | null
          total_return_restock?: number | null
          total_revenue?: number | null
          total_vat?: number | null
          user_id?: string | null
          verified?: boolean | null
        }
        Update: {
          ad_cost?: number | null
          aggregation_key?: string | null
          business_id?: string | null
          created_at?: string | null
          id?: string
          import_batch_id?: string | null
          net_profit?: number | null
          period_end?: string
          period_start?: string
          product_id?: string
          sales_quantity?: number | null
          settlement_type?: string | null
          source?: string | null
          total_commission?: number | null
          total_commission_vat?: number | null
          total_cost?: number | null
          total_fulfillment?: number | null
          total_fulfillment_vat?: number | null
          total_margin?: number | null
          total_margin_rate?: number | null
          total_return_pickup?: number | null
          total_return_restock?: number | null
          total_revenue?: number | null
          total_vat?: number | null
          user_id?: string | null
          verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "settlements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      sourcing_brands: {
        Row: {
          category_path: string | null
          created_at: string | null
          id: string
          is_active: boolean
          memo: string | null
          name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          category_path?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean
          memo?: string | null
          name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          category_path?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean
          memo?: string | null
          name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sourcing_collect_queue: {
        Row: {
          attempt_count: number
          created_at: string | null
          heartbeat_at: string | null
          id: string
          last_error: string | null
          lease_until: string | null
          needs_wing_enrich: boolean
          payload: Json | null
          priority: string
          status: string
          target_key: string
          target_type: string
          updated_at: string | null
          user_id: string
          worker_id: string | null
        }
        Insert: {
          attempt_count?: number
          created_at?: string | null
          heartbeat_at?: string | null
          id?: string
          last_error?: string | null
          lease_until?: string | null
          needs_wing_enrich?: boolean
          payload?: Json | null
          priority?: string
          status?: string
          target_key: string
          target_type: string
          updated_at?: string | null
          user_id: string
          worker_id?: string | null
        }
        Update: {
          attempt_count?: number
          created_at?: string | null
          heartbeat_at?: string | null
          id?: string
          last_error?: string | null
          lease_until?: string | null
          needs_wing_enrich?: boolean
          payload?: Json | null
          priority?: string
          status?: string
          target_key?: string
          target_type?: string
          updated_at?: string | null
          user_id?: string
          worker_id?: string | null
        }
        Relationships: []
      }
      sourcing_collection_log: {
        Row: {
          attempt: number | null
          bytes: number | null
          created_at: string | null
          duration_ms: number | null
          error: string | null
          http_status: number | null
          id: string
          path: string
          target_key: string | null
          target_type: string | null
          url_host: string | null
          user_id: string
          verdict: string | null
          waf_profile: string | null
        }
        Insert: {
          attempt?: number | null
          bytes?: number | null
          created_at?: string | null
          duration_ms?: number | null
          error?: string | null
          http_status?: number | null
          id?: string
          path: string
          target_key?: string | null
          target_type?: string | null
          url_host?: string | null
          user_id: string
          verdict?: string | null
          waf_profile?: string | null
        }
        Update: {
          attempt?: number | null
          bytes?: number | null
          created_at?: string | null
          duration_ms?: number | null
          error?: string | null
          http_status?: number | null
          id?: string
          path?: string
          target_key?: string | null
          target_type?: string | null
          url_host?: string | null
          user_id?: string
          verdict?: string | null
          waf_profile?: string | null
        }
        Relationships: []
      }
      sourcing_decisions: {
        Row: {
          category_code: number
          created_at: string | null
          gates: Json | null
          id: string
          insight_id: string | null
          keyword: string | null
          phase1_pass: boolean | null
          phase2_pass: boolean | null
          phase3_pass: boolean | null
          phase4_pass: boolean | null
          phase5_pass: boolean | null
          simulator_input: Json | null
          simulator_output: Json | null
          summary: string | null
          user_id: string
          verdict: string
          wiki_entry_id: string | null
        }
        Insert: {
          category_code: number
          created_at?: string | null
          gates?: Json | null
          id?: string
          insight_id?: string | null
          keyword?: string | null
          phase1_pass?: boolean | null
          phase2_pass?: boolean | null
          phase3_pass?: boolean | null
          phase4_pass?: boolean | null
          phase5_pass?: boolean | null
          simulator_input?: Json | null
          simulator_output?: Json | null
          summary?: string | null
          user_id: string
          verdict: string
          wiki_entry_id?: string | null
        }
        Update: {
          category_code?: number
          created_at?: string | null
          gates?: Json | null
          id?: string
          insight_id?: string | null
          keyword?: string | null
          phase1_pass?: boolean | null
          phase2_pass?: boolean | null
          phase3_pass?: boolean | null
          phase4_pass?: boolean | null
          phase5_pass?: boolean | null
          simulator_input?: Json | null
          simulator_output?: Json | null
          summary?: string | null
          user_id?: string
          verdict?: string
          wiki_entry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sourcing_decisions_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "market_insights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sourcing_decisions_wiki_entry_id_fkey"
            columns: ["wiki_entry_id"]
            isOneToOne: false
            referencedRelation: "sourcing_wiki_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      sourcing_freshness_index: {
        Row: {
          axis: string
          created_at: string | null
          decay_started_at: string | null
          freshness_score: number | null
          id: string
          last_collected_at: string | null
          target_key: string
          target_type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          axis: string
          created_at?: string | null
          decay_started_at?: string | null
          freshness_score?: number | null
          id?: string
          last_collected_at?: string | null
          target_key: string
          target_type: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          axis?: string
          created_at?: string | null
          decay_started_at?: string | null
          freshness_score?: number | null
          id?: string
          last_collected_at?: string | null
          target_key?: string
          target_type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sourcing_keyword_expansions: {
        Row: {
          collected_at: string | null
          id: string
          kind: string
          seed_keyword: string
          source: string
          terms: Json
          updated_at: string | null
          user_id: string
        }
        Insert: {
          collected_at?: string | null
          id?: string
          kind: string
          seed_keyword: string
          source?: string
          terms?: Json
          updated_at?: string | null
          user_id: string
        }
        Update: {
          collected_at?: string | null
          id?: string
          kind?: string
          seed_keyword?: string
          source?: string
          terms?: Json
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sourcing_keyword_scores: {
        Row: {
          base_score: number | null
          base_tier: string | null
          combined_score: number | null
          combined_tier: string | null
          competition_delta: number | null
          computed_at: string
          id: string
          keyword: string
          market_sample_size: number | null
          price_delta: number | null
          trend_delta: number | null
          user_id: string
        }
        Insert: {
          base_score?: number | null
          base_tier?: string | null
          combined_score?: number | null
          combined_tier?: string | null
          competition_delta?: number | null
          computed_at?: string
          id?: string
          keyword: string
          market_sample_size?: number | null
          price_delta?: number | null
          trend_delta?: number | null
          user_id: string
        }
        Update: {
          base_score?: number | null
          base_tier?: string | null
          combined_score?: number | null
          combined_tier?: string | null
          competition_delta?: number | null
          computed_at?: string
          id?: string
          keyword?: string
          market_sample_size?: number | null
          price_delta?: number | null
          trend_delta?: number | null
          user_id?: string
        }
        Relationships: []
      }
      sourcing_keyword_verdicts: {
        Row: {
          created_at: string
          decided_at: string
          id: string
          keyword: string
          memo: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string
          id?: string
          keyword: string
          memo?: string | null
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string
          id?: string
          keyword?: string
          memo?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sourcing_launch_cohorts: {
        Row: {
          cash_recovered_at: string | null
          cash_recovery_days: number | null
          contribution_margin: number | null
          created_at: string | null
          entry_features: Json
          first_order_at: string | null
          first_order_days: number | null
          id: string
          invested_cash: number | null
          keyword: string | null
          launched_at: string
          notes: string | null
          outcome_grade: string | null
          product_key: string | null
          product_name: string | null
          residual_stock_ratio: number | null
          sales_14d: number | null
          sales_30d: number | null
          sourcing_product_id: string | null
          updated_at: string | null
          user_id: string
          verdict: string
          veto_reason: string | null
        }
        Insert: {
          cash_recovered_at?: string | null
          cash_recovery_days?: number | null
          contribution_margin?: number | null
          created_at?: string | null
          entry_features?: Json
          first_order_at?: string | null
          first_order_days?: number | null
          id?: string
          invested_cash?: number | null
          keyword?: string | null
          launched_at?: string
          notes?: string | null
          outcome_grade?: string | null
          product_key?: string | null
          product_name?: string | null
          residual_stock_ratio?: number | null
          sales_14d?: number | null
          sales_30d?: number | null
          sourcing_product_id?: string | null
          updated_at?: string | null
          user_id: string
          verdict?: string
          veto_reason?: string | null
        }
        Update: {
          cash_recovered_at?: string | null
          cash_recovery_days?: number | null
          contribution_margin?: number | null
          created_at?: string | null
          entry_features?: Json
          first_order_at?: string | null
          first_order_days?: number | null
          id?: string
          invested_cash?: number | null
          keyword?: string | null
          launched_at?: string
          notes?: string | null
          outcome_grade?: string | null
          product_key?: string | null
          product_name?: string | null
          residual_stock_ratio?: number | null
          sales_14d?: number | null
          sales_30d?: number | null
          sourcing_product_id?: string | null
          updated_at?: string | null
          user_id?: string
          verdict?: string
          veto_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sourcing_launch_cohorts_sourcing_product_id_fkey"
            columns: ["sourcing_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      sourcing_market_price_history: {
        Row: {
          change_flags: Json | null
          collected_at: string
          created_at: string | null
          id: string
          prev_price: number | null
          price: number
          product_key: string
          snapshot_id: string | null
          user_id: string
        }
        Insert: {
          change_flags?: Json | null
          collected_at?: string
          created_at?: string | null
          id?: string
          prev_price?: number | null
          price: number
          product_key: string
          snapshot_id?: string | null
          user_id: string
        }
        Update: {
          change_flags?: Json | null
          collected_at?: string
          created_at?: string | null
          id?: string
          prev_price?: number | null
          price?: number
          product_key?: string
          snapshot_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sourcing_market_price_history_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "sourcing_market_snapshot"
            referencedColumns: ["id"]
          },
        ]
      }
      sourcing_market_snapshot: {
        Row: {
          created_at: string | null
          first_seen_at: string | null
          id: string
          last_collected_at: string | null
          price: number | null
          product_key: string
          product_name: string | null
          product_url: string | null
          rank: number | null
          rating: number | null
          raw_meta: Json | null
          review_count: number | null
          search_keyword: string
          source: string
          updated_at: string | null
          user_id: string
          wing_sale_price: number | null
          wing_sales_collected_at: string | null
          wing_units_sold: number | null
        }
        Insert: {
          created_at?: string | null
          first_seen_at?: string | null
          id?: string
          last_collected_at?: string | null
          price?: number | null
          product_key: string
          product_name?: string | null
          product_url?: string | null
          rank?: number | null
          rating?: number | null
          raw_meta?: Json | null
          review_count?: number | null
          search_keyword?: string
          source: string
          updated_at?: string | null
          user_id: string
          wing_sale_price?: number | null
          wing_sales_collected_at?: string | null
          wing_units_sold?: number | null
        }
        Update: {
          created_at?: string | null
          first_seen_at?: string | null
          id?: string
          last_collected_at?: string | null
          price?: number | null
          product_key?: string
          product_name?: string | null
          product_url?: string | null
          rank?: number | null
          rating?: number | null
          raw_meta?: Json | null
          review_count?: number | null
          search_keyword?: string
          source?: string
          updated_at?: string | null
          user_id?: string
          wing_sale_price?: number | null
          wing_sales_collected_at?: string | null
          wing_units_sold?: number | null
        }
        Relationships: []
      }
      sourcing_my_rank_history: {
        Row: {
          collected_at: string
          created_at: string | null
          id: string
          keyword: string
          price: number | null
          product_key: string
          rank: number | null
          source: string
          target_id: string
          total_items: number | null
          user_id: string
        }
        Insert: {
          collected_at?: string
          created_at?: string | null
          id?: string
          keyword: string
          price?: number | null
          product_key: string
          rank?: number | null
          source: string
          target_id: string
          total_items?: number | null
          user_id: string
        }
        Update: {
          collected_at?: string
          created_at?: string | null
          id?: string
          keyword?: string
          price?: number | null
          product_key?: string
          rank?: number | null
          source?: string
          target_id?: string
          total_items?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sourcing_my_rank_history_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "sourcing_my_rank_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      sourcing_my_rank_targets: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: string
          keyword: string
          memo: string | null
          product_key: string
          product_name: string | null
          product_url: string | null
          resolved_product_id: string | null
          resolved_vendor_item_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          keyword: string
          memo?: string | null
          product_key: string
          product_name?: string | null
          product_url?: string | null
          resolved_product_id?: string | null
          resolved_vendor_item_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          keyword?: string
          memo?: string | null
          product_key?: string
          product_name?: string | null
          product_url?: string | null
          resolved_product_id?: string | null
          resolved_vendor_item_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sourcing_registration_drafts: {
        Row: {
          business_id: string | null
          created_at: string | null
          form: Json
          id: string
          keyword: string | null
          sourcing_product_id: string | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string | null
          form?: Json
          id?: string
          keyword?: string | null
          sourcing_product_id?: string | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          business_id?: string | null
          created_at?: string | null
          form?: Json
          id?: string
          keyword?: string | null
          sourcing_product_id?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sourcing_trending_rank_history: {
        Row: {
          category_id: string
          collected_at: string
          created_at: string | null
          cycle_id: string | null
          id: string
          prev_rank: number | null
          price: number | null
          product_key: string
          rank: number
          snapshot_id: string | null
          user_id: string
        }
        Insert: {
          category_id: string
          collected_at?: string
          created_at?: string | null
          cycle_id?: string | null
          id?: string
          prev_rank?: number | null
          price?: number | null
          product_key: string
          rank: number
          snapshot_id?: string | null
          user_id: string
        }
        Update: {
          category_id?: string
          collected_at?: string
          created_at?: string | null
          cycle_id?: string | null
          id?: string
          prev_rank?: number | null
          price?: number | null
          product_key?: string
          rank?: number
          snapshot_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sourcing_trending_rank_history_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "sourcing_trending_snapshot"
            referencedColumns: ["id"]
          },
        ]
      }
      sourcing_trending_snapshot: {
        Row: {
          best_rank: number | null
          category_id: string
          category_name: string | null
          created_at: string | null
          first_seen_at: string | null
          id: string
          is_rocket: boolean | null
          last_collected_at: string | null
          leaf_category_code: number | null
          price: number | null
          product_key: string
          product_name: string | null
          product_url: string | null
          rank: number
          rating: number | null
          raw_meta: Json | null
          review_count: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          best_rank?: number | null
          category_id: string
          category_name?: string | null
          created_at?: string | null
          first_seen_at?: string | null
          id?: string
          is_rocket?: boolean | null
          last_collected_at?: string | null
          leaf_category_code?: number | null
          price?: number | null
          product_key: string
          product_name?: string | null
          product_url?: string | null
          rank: number
          rating?: number | null
          raw_meta?: Json | null
          review_count?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          best_rank?: number | null
          category_id?: string
          category_name?: string | null
          created_at?: string | null
          first_seen_at?: string | null
          id?: string
          is_rocket?: boolean | null
          last_collected_at?: string | null
          leaf_category_code?: number | null
          price?: number | null
          product_key?: string
          product_name?: string | null
          product_url?: string | null
          rank?: number
          rating?: number | null
          raw_meta?: Json | null
          review_count?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sourcing_watchlist: {
        Row: {
          attempt_count: number | null
          category_code: number | null
          created_at: string | null
          heartbeat_at: string | null
          id: string
          keyword: string | null
          last_scanned_at: string | null
          next_scan_due_at: string | null
          priority: string
          reason: string | null
          scan_mode: string | null
          status: string
          user_id: string
          worker_id: string | null
        }
        Insert: {
          attempt_count?: number | null
          category_code?: number | null
          created_at?: string | null
          heartbeat_at?: string | null
          id?: string
          keyword?: string | null
          last_scanned_at?: string | null
          next_scan_due_at?: string | null
          priority?: string
          reason?: string | null
          scan_mode?: string | null
          status?: string
          user_id: string
          worker_id?: string | null
        }
        Update: {
          attempt_count?: number | null
          category_code?: number | null
          created_at?: string | null
          heartbeat_at?: string | null
          id?: string
          keyword?: string | null
          last_scanned_at?: string | null
          next_scan_due_at?: string | null
          priority?: string
          reason?: string | null
          scan_mode?: string | null
          status?: string
          user_id?: string
          worker_id?: string | null
        }
        Relationships: []
      }
      sourcing_wiki_entries: {
        Row: {
          ad_dependency_dominant: string | null
          ad_ratio_median: number | null
          avg_price: number | null
          category_code: number | null
          category_hierarchy: Json | null
          click_through_rate: number | null
          conversion_rate: number | null
          created_at: string | null
          entry_type: string
          est_revenue_28d: number | null
          estimated_margin_rate: number | null
          first_seen_at: string | null
          freshness_tier: string | null
          growth_variance: number | null
          id: string
          impressions: number | null
          keyword: string | null
          last_refreshed_at: string | null
          opportunity_product_count: number | null
          qualifying_product_count: number | null
          review_barrier: number | null
          sales_source: string | null
          source_refs: Json | null
          top_sales_28d: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ad_dependency_dominant?: string | null
          ad_ratio_median?: number | null
          avg_price?: number | null
          category_code?: number | null
          category_hierarchy?: Json | null
          click_through_rate?: number | null
          conversion_rate?: number | null
          created_at?: string | null
          entry_type: string
          est_revenue_28d?: number | null
          estimated_margin_rate?: number | null
          first_seen_at?: string | null
          freshness_tier?: string | null
          growth_variance?: number | null
          id?: string
          impressions?: number | null
          keyword?: string | null
          last_refreshed_at?: string | null
          opportunity_product_count?: number | null
          qualifying_product_count?: number | null
          review_barrier?: number | null
          sales_source?: string | null
          source_refs?: Json | null
          top_sales_28d?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ad_dependency_dominant?: string | null
          ad_ratio_median?: number | null
          avg_price?: number | null
          category_code?: number | null
          category_hierarchy?: Json | null
          click_through_rate?: number | null
          conversion_rate?: number | null
          created_at?: string | null
          entry_type?: string
          est_revenue_28d?: number | null
          estimated_margin_rate?: number | null
          first_seen_at?: string | null
          freshness_tier?: string | null
          growth_variance?: number | null
          id?: string
          impressions?: number | null
          keyword?: string | null
          last_refreshed_at?: string | null
          opportunity_product_count?: number | null
          qualifying_product_count?: number | null
          review_barrier?: number | null
          sales_source?: string | null
          source_refs?: Json | null
          top_sales_28d?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      staff_job_requests: {
        Row: {
          approved_at: string | null
          args: Json
          created_at: string
          exit_code: number | null
          finished_at: string | null
          id: string
          job_key: string
          requested_by: string
          result_log: string | null
          started_at: string | null
          status: string
          summary: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          args?: Json
          created_at?: string
          exit_code?: number | null
          finished_at?: string | null
          id?: string
          job_key: string
          requested_by?: string
          result_log?: string | null
          started_at?: string | null
          status?: string
          summary: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          args?: Json
          created_at?: string
          exit_code?: number | null
          finished_at?: string | null
          id?: string
          job_key?: string
          requested_by?: string
          result_log?: string | null
          started_at?: string | null
          status?: string
          summary?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          contact_info: string | null
          contact_name: string | null
          created_at: string | null
          currency: string | null
          id: string
          is_active: boolean | null
          lead_time_days: number | null
          moq: number | null
          name: string
          negotiated_price: number | null
          notes: string | null
          payment_terms: string | null
          rating: number | null
          screenshots: Json | null
          shipping_fee: number | null
          source_type: string
          updated_at: string | null
          url: string | null
          user_id: string | null
        }
        Insert: {
          contact_info?: string | null
          contact_name?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          is_active?: boolean | null
          lead_time_days?: number | null
          moq?: number | null
          name: string
          negotiated_price?: number | null
          notes?: string | null
          payment_terms?: string | null
          rating?: number | null
          screenshots?: Json | null
          shipping_fee?: number | null
          source_type: string
          updated_at?: string | null
          url?: string | null
          user_id?: string | null
        }
        Update: {
          contact_info?: string | null
          contact_name?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          is_active?: boolean | null
          lead_time_days?: number | null
          moq?: number | null
          name?: string
          negotiated_price?: number | null
          notes?: string | null
          payment_terms?: string | null
          rating?: number | null
          screenshots?: Json | null
          shipping_fee?: number | null
          source_type?: string
          updated_at?: string | null
          url?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      wing_analysis_categories: {
        Row: {
          category_code: number
          depth: number | null
          first_seen_at: string | null
          full_path: string | null
          id: string
          is_leaf: boolean | null
          last_seen_at: string | null
          name: string
          parent_code: number | null
          user_id: string
        }
        Insert: {
          category_code: number
          depth?: number | null
          first_seen_at?: string | null
          full_path?: string | null
          id?: string
          is_leaf?: boolean | null
          last_seen_at?: string | null
          name: string
          parent_code?: number | null
          user_id: string
        }
        Update: {
          category_code?: number
          depth?: number | null
          first_seen_at?: string | null
          full_path?: string | null
          id?: string
          is_leaf?: boolean | null
          last_seen_at?: string | null
          name?: string
          parent_code?: number | null
          user_id?: string
        }
        Relationships: []
      }
      wing_api_call_log: {
        Row: {
          attempt: number
          business_id: string | null
          called_at: string | null
          duration_ms: number | null
          endpoint: string
          error_message: string | null
          id: string
          insight_id: string | null
          method: string | null
          operation: string | null
          provider: string
          request_meta: Json | null
          response_meta: Json | null
          run_id: string | null
          status_code: number | null
          user_id: string | null
        }
        Insert: {
          attempt?: number
          business_id?: string | null
          called_at?: string | null
          duration_ms?: number | null
          endpoint: string
          error_message?: string | null
          id?: string
          insight_id?: string | null
          method?: string | null
          operation?: string | null
          provider?: string
          request_meta?: Json | null
          response_meta?: Json | null
          run_id?: string | null
          status_code?: number | null
          user_id?: string | null
        }
        Update: {
          attempt?: number
          business_id?: string | null
          called_at?: string | null
          duration_ms?: number | null
          endpoint?: string
          error_message?: string | null
          id?: string
          insight_id?: string | null
          method?: string | null
          operation?: string | null
          provider?: string
          request_meta?: Json | null
          response_meta?: Json | null
          run_id?: string | null
          status_code?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wing_api_call_log_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wing_api_call_log_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "market_insights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wing_api_call_log_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "coupang_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      wing_rate_limit_state: {
        Row: {
          circuit_broken_until: string | null
          consecutive_rate_hits: number | null
          daily_datewise_count: number | null
          daily_insight_count: number | null
          daily_reset_at: string | null
          last_hit_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          circuit_broken_until?: string | null
          consecutive_rate_hits?: number | null
          daily_datewise_count?: number | null
          daily_insight_count?: number | null
          daily_reset_at?: string | null
          last_hit_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          circuit_broken_until?: string | null
          consecutive_rate_hits?: number | null
          daily_datewise_count?: number | null
          daily_insight_count?: number | null
          daily_reset_at?: string | null
          last_hit_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ai_usage_month_total: {
        Args: { p_agent?: string; p_month_key: string }
        Returns: number
      }
      apply_manual_inventory_movement: {
        Args: {
          p_business_id: string
          p_inventory_id: string
          p_movement_date?: string
          p_movement_type: string
          p_notes?: string
          p_operation_id: string
          p_product_id: string
          p_quantity: number
          p_reference_no?: string
          p_unit_cost?: number
          p_user_id: string
        }
        Returns: Json
      }
      apply_owned_bulk_coupon_atomic: {
        Args: {
          p_actor_user_id: string
          p_business_id: string
          p_end_date: string
          p_per_unit_coupon: number
          p_product_id: string
          p_start_date: string
        }
        Returns: Json
      }
      apply_purchase_inventory_effect_atomic: {
        Args: {
          p_actor_user_id: string
          p_business_id: string
          p_effect: string
          p_effective_date: string
          p_operation_id: string
          p_po_number?: string
          p_product_id: string
          p_purchase_id: string
          p_quantity: number
          p_unit_cost_krw: number
        }
        Returns: Json
      }
      claim_auto_import_receipt: {
        Args: {
          p_batch_id: string
          p_business_id: string
          p_content_sha256: string
          p_file_name: string
          p_hash_basis: string
          p_import_date: string
          p_import_kind: string
          p_row_count: number
          p_user_id: string
        }
        Returns: Json
      }
      claim_import_watchdog_job: {
        Args: {
          p_job_key: string
          p_kst_date: string
          p_request_payload: Json
          p_user_id: string
        }
        Returns: Json
      }
      complete_auto_import_receipt: {
        Args: {
          p_batch_id: string
          p_business_id: string
          p_receipt_id: string
          p_response: Json
          p_user_id: string
        }
        Returns: Json
      }
      complete_import_watchdog_job: {
        Args: {
          p_job_key: string
          p_kst_date: string
          p_report_payload?: Json
          p_result: Json
          p_user_id: string
        }
        Returns: Json
      }
      create_owned_business_atomic: {
        Args: {
          p_actor_user_id: string
          p_fields: Json
          p_make_default?: boolean
        }
        Returns: Json
      }
      delete_owned_empty_business_atomic: {
        Args: { p_actor_user_id: string; p_business_id: string }
        Returns: Json
      }
      delete_purchase_atomic: {
        Args: {
          p_actor_user_id: string
          p_business_id: string
          p_effective_date?: string
          p_expected_updated_at: string
          p_operation_id: string
          p_purchase_id: string
        }
        Returns: Json
      }
      fail_import_watchdog_job: {
        Args: {
          p_failure: Json
          p_job_key: string
          p_kst_date: string
          p_user_id: string
        }
        Returns: Json
      }
      import_purchases_atomic: {
        Args: {
          p_business_id: string
          p_idempotency_key: string
          p_import_batch_id: string
          p_rows: Json
          p_user_id: string
        }
        Returns: number
      }
      insert_sales_gap_backfill_tx: {
        Args: {
          p_business_id: string
          p_content_sha256: string
          p_file_name: string
          p_file_size: number
          p_import_batch_id: string
          p_import_date: string
          p_rows: Json
          p_user_id: string
        }
        Returns: Json
      }
      mark_auto_import_receipt_indeterminate: {
        Args: {
          p_batch_id: string
          p_business_id: string
          p_receipt_id: string
          p_stage: string
          p_user_id: string
        }
        Returns: Json
      }
      migrate_costs: { Args: { data: Json }; Returns: number }
      migrate_demands: { Args: { data: Json }; Returns: number }
      migrate_products: { Args: { data: Json }; Returns: number }
      patch_owned_business_atomic: {
        Args: {
          p_actor_user_id: string
          p_business_id: string
          p_fields: Json
          p_make_default?: boolean
        }
        Returns: Json
      }
      patch_owned_product_with_price_history_atomic: {
        Args: {
          p_actor_user_id: string
          p_business_id: string
          p_effective_date: string
          p_patch: Json
          p_product_id: string
        }
        Returns: Json
      }
      patch_purchase_atomic: {
        Args: {
          p_actor_user_id: string
          p_business_id: string
          p_effective_date?: string
          p_expected_updated_at: string
          p_operation_id: string
          p_patch: Json
          p_purchase_id: string
        }
        Returns: Json
      }
      refresh_coupang_api_daily_settlements: {
        Args: { p_business_id: string; p_dates: string[]; p_user_id: string }
        Returns: number
      }
      replace_coupang_import_ad_campaigns: {
        Args: {
          p_business_id: string
          p_import_batch_id: string
          p_rows: Json
          p_user_id: string
        }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
