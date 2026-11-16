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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      assignments: {
        Row: {
          confirmation: Database["public"]["Enums"]["confirmation"]
          cover_arranged_by: string | null
          cover_guest_name: string | null
          cover_kind: Database["public"]["Enums"]["cover_kind"] | null
          cover_member_id: string | null
          coverage_reason:
            | Database["public"]["Enums"]["coverage_request_reason"]
            | null
          coverage_requested_at: string | null
          coverage_requested_by: string | null
          covered_at: string | null
          event_id: string
          group_id: string
          id: string
          make_up_turn_id: string | null
          member_id: string | null
          position: number
          responsibility_id: string
          turn_of: string | null
        }
        Insert: {
          confirmation: Database["public"]["Enums"]["confirmation"]
          cover_arranged_by?: string | null
          cover_guest_name?: string | null
          cover_kind?: Database["public"]["Enums"]["cover_kind"] | null
          cover_member_id?: string | null
          coverage_reason?:
            | Database["public"]["Enums"]["coverage_request_reason"]
            | null
          coverage_requested_at?: string | null
          coverage_requested_by?: string | null
          covered_at?: string | null
          event_id: string
          group_id: string
          id: string
          make_up_turn_id?: string | null
          member_id?: string | null
          position: number
          responsibility_id: string
          turn_of?: string | null
        }
        Update: {
          confirmation?: Database["public"]["Enums"]["confirmation"]
          cover_arranged_by?: string | null
          cover_guest_name?: string | null
          cover_kind?: Database["public"]["Enums"]["cover_kind"] | null
          cover_member_id?: string | null
          coverage_reason?:
            | Database["public"]["Enums"]["coverage_request_reason"]
            | null
          coverage_requested_at?: string | null
          coverage_requested_by?: string | null
          covered_at?: string | null
          event_id?: string
          group_id?: string
          id?: string
          make_up_turn_id?: string | null
          member_id?: string | null
          position?: number
          responsibility_id?: string
          turn_of?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assignments_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["group_id", "id"]
          },
          {
            foreignKeyName: "assignments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_group_id_make_up_turn_id_fkey"
            columns: ["group_id", "make_up_turn_id"]
            isOneToOne: false
            referencedRelation: "make_up_turns"
            referencedColumns: ["group_id", "id"]
          },
          {
            foreignKeyName: "assignments_group_id_member_id_fkey"
            columns: ["group_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["group_id", "id"]
          },
          {
            foreignKeyName: "assignments_group_id_responsibility_id_fkey"
            columns: ["group_id", "responsibility_id"]
            isOneToOne: false
            referencedRelation: "responsibilities"
            referencedColumns: ["group_id", "id"]
          },
          {
            foreignKeyName: "assignments_group_id_turn_of_fkey"
            columns: ["group_id", "turn_of"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["group_id", "id"]
          },
        ]
      }
      event_series: {
        Row: {
          group_id: string
          id: string
          name: string
          position: number
          removed_at: string | null
          repeat: Json | null
          responsibility_ids: string[]
        }
        Insert: {
          group_id: string
          id: string
          name: string
          position: number
          removed_at?: string | null
          repeat?: Json | null
          responsibility_ids: string[]
        }
        Update: {
          group_id?: string
          id?: string
          name?: string
          position?: number
          removed_at?: string | null
          repeat?: Json | null
          responsibility_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "event_series_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          group_id: string
          id: string
          position: number
          responsibility_ids: string[] | null
          series_id: string | null
          skip_date_marked_at: string | null
          skip_date_marked_by: string | null
          starts_at: string
        }
        Insert: {
          group_id: string
          id: string
          position: number
          responsibility_ids?: string[] | null
          series_id?: string | null
          skip_date_marked_at?: string | null
          skip_date_marked_by?: string | null
          starts_at: string
        }
        Update: {
          group_id?: string
          id?: string
          position?: number
          responsibility_ids?: string[] | null
          series_id?: string | null
          skip_date_marked_at?: string | null
          skip_date_marked_by?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_group_id_series_id_fkey"
            columns: ["group_id", "series_id"]
            isOneToOne: false
            referencedRelation: "event_series"
            referencedColumns: ["group_id", "id"]
          },
        ]
      }
      groups: {
        Row: {
          allow_doubling: boolean
          coverage_policy: Database["public"]["Enums"]["coverage_policy"]
          created_at: string
          created_by: string | null
          id: string
          id_sequence: number
          name: string
          primary_responsibility_id: string | null
          replacement_deadline_ms: number
          replacement_duty: Database["public"]["Enums"]["replacement_duty"]
          rotated_through: string | null
          state_version: number
          time_off_handling: Database["public"]["Enums"]["time_off_handling"]
          time_zone: string
          updated_at: string
        }
        Insert: {
          allow_doubling?: boolean
          coverage_policy?: Database["public"]["Enums"]["coverage_policy"]
          created_at?: string
          created_by?: string | null
          id?: string
          id_sequence?: number
          name: string
          primary_responsibility_id?: string | null
          replacement_deadline_ms?: number
          replacement_duty?: Database["public"]["Enums"]["replacement_duty"]
          rotated_through?: string | null
          state_version?: number
          time_off_handling?: Database["public"]["Enums"]["time_off_handling"]
          time_zone?: string
          updated_at?: string
        }
        Update: {
          allow_doubling?: boolean
          coverage_policy?: Database["public"]["Enums"]["coverage_policy"]
          created_at?: string
          created_by?: string | null
          id?: string
          id_sequence?: number
          name?: string
          primary_responsibility_id?: string | null
          replacement_deadline_ms?: number
          replacement_duty?: Database["public"]["Enums"]["replacement_duty"]
          rotated_through?: string | null
          state_version?: number
          time_off_handling?: Database["public"]["Enums"]["time_off_handling"]
          time_zone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_primary_responsibility_fk"
            columns: ["id", "primary_responsibility_id"]
            isOneToOne: false
            referencedRelation: "responsibilities"
            referencedColumns: ["group_id", "id"]
          },
        ]
      }
      invite_links: {
        Row: {
          created_at: string
          group_id: string
          member_id: string | null
          token: string
        }
        Insert: {
          created_at?: string
          group_id: string
          member_id?: string | null
          token?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          member_id?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_links_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_links_group_id_member_id_fkey"
            columns: ["group_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["group_id", "id"]
          },
        ]
      }
      make_up_turns: {
        Row: {
          closed_at: string | null
          closed_reason:
            | Database["public"]["Enums"]["make_up_turn_closed_reason"]
            | null
          cover_assignment_id: string
          created_at: string
          creditor_id: string
          debtor_id: string
          group_id: string
          id: string
          position: number
          responsibility_id: string
          status: Database["public"]["Enums"]["make_up_turn_status"]
        }
        Insert: {
          closed_at?: string | null
          closed_reason?:
            | Database["public"]["Enums"]["make_up_turn_closed_reason"]
            | null
          cover_assignment_id: string
          created_at: string
          creditor_id: string
          debtor_id: string
          group_id: string
          id: string
          position: number
          responsibility_id: string
          status: Database["public"]["Enums"]["make_up_turn_status"]
        }
        Update: {
          closed_at?: string | null
          closed_reason?:
            | Database["public"]["Enums"]["make_up_turn_closed_reason"]
            | null
          cover_assignment_id?: string
          created_at?: string
          creditor_id?: string
          debtor_id?: string
          group_id?: string
          id?: string
          position?: number
          responsibility_id?: string
          status?: Database["public"]["Enums"]["make_up_turn_status"]
        }
        Relationships: [
          {
            foreignKeyName: "make_up_turns_group_id_creditor_id_fkey"
            columns: ["group_id", "creditor_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["group_id", "id"]
          },
          {
            foreignKeyName: "make_up_turns_group_id_debtor_id_fkey"
            columns: ["group_id", "debtor_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["group_id", "id"]
          },
          {
            foreignKeyName: "make_up_turns_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "make_up_turns_group_id_responsibility_id_fkey"
            columns: ["group_id", "responsibility_id"]
            isOneToOne: false
            referencedRelation: "responsibilities"
            referencedColumns: ["group_id", "id"]
          },
        ]
      }
      members: {
        Row: {
          account_id: string | null
          created_at: string
          display_name: string
          group_id: string
          id: string
          is_admin: boolean
          left_at: string | null
          position: number
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          display_name: string
          group_id: string
          id: string
          is_admin?: boolean
          left_at?: string | null
          position: number
        }
        Update: {
          account_id?: string | null
          created_at?: string
          display_name?: string
          group_id?: string
          id?: string
          is_admin?: boolean
          left_at?: string | null
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          admin_alert_lead_time_ms: number
          created_at: string
          display_name: string
          email_enabled: boolean
          id: string
          notify_changes: boolean
          notify_coverage_requests: boolean
          onboarding_completed_at: string | null
          phone: string | null
          push_enabled: boolean
          reminder_days_before: number[]
          reminder_time: string
          sms_enabled: boolean
          time_zone: string
          updated_at: string
        }
        Insert: {
          admin_alert_lead_time_ms?: number
          created_at?: string
          display_name?: string
          email_enabled?: boolean
          id: string
          notify_changes?: boolean
          notify_coverage_requests?: boolean
          onboarding_completed_at?: string | null
          phone?: string | null
          push_enabled?: boolean
          reminder_days_before?: number[]
          reminder_time?: string
          sms_enabled?: boolean
          time_zone?: string
          updated_at?: string
        }
        Update: {
          admin_alert_lead_time_ms?: number
          created_at?: string
          display_name?: string
          email_enabled?: boolean
          id?: string
          notify_changes?: boolean
          notify_coverage_requests?: boolean
          onboarding_completed_at?: string | null
          phone?: string | null
          push_enabled?: boolean
          reminder_days_before?: number[]
          reminder_time?: string
          sms_enabled?: boolean
          time_zone?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          account_id: string
          created_at: string
          last_seen_at: string
          platform: Database["public"]["Enums"]["push_platform"]
          token: string
        }
        Insert: {
          account_id?: string
          created_at?: string
          last_seen_at?: string
          platform: Database["public"]["Enums"]["push_platform"]
          token: string
        }
        Update: {
          account_id?: string
          created_at?: string
          last_seen_at?: string
          platform?: Database["public"]["Enums"]["push_platform"]
          token?: string
        }
        Relationships: []
      }
      responsibilities: {
        Row: {
          group_id: string
          headcount: number
          id: string
          name: string
          position: number
          removed_at: string | null
          requires_confirmation: boolean
        }
        Insert: {
          group_id: string
          headcount: number
          id: string
          name: string
          position: number
          removed_at?: string | null
          requires_confirmation: boolean
        }
        Update: {
          group_id?: string
          headcount?: number
          id?: string
          name?: string
          position?: number
          removed_at?: string | null
          requires_confirmation?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "responsibilities_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      rotations: {
        Row: {
          group_id: string
          position: number
          queue: string[]
          responsibility_id: string
          turns_taken_early: Json
        }
        Insert: {
          group_id: string
          position: number
          queue: string[]
          responsibility_id: string
          turns_taken_early?: Json
        }
        Update: {
          group_id?: string
          position?: number
          queue?: string[]
          responsibility_id?: string
          turns_taken_early?: Json
        }
        Relationships: [
          {
            foreignKeyName: "rotations_group_id_responsibility_id_fkey"
            columns: ["group_id", "responsibility_id"]
            isOneToOne: true
            referencedRelation: "responsibilities"
            referencedColumns: ["group_id", "id"]
          },
        ]
      }
      schedule_history: {
        Row: {
          actor_id: string | null
          at: string
          cause: Json
          cause_type: string | null
          changes: Json
          created_at: string
          group_id: string
          id: number
          make_up_turns: Json
          state_version: number
        }
        Insert: {
          actor_id?: string | null
          at: string
          cause: Json
          cause_type?: string | null
          changes?: Json
          created_at?: string
          group_id: string
          id?: never
          make_up_turns?: Json
          state_version: number
        }
        Update: {
          actor_id?: string | null
          at?: string
          cause?: Json
          cause_type?: string | null
          changes?: Json
          created_at?: string
          group_id?: string
          id?: never
          make_up_turns?: Json
          state_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "schedule_history_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      time_off: {
        Row: {
          ends_at: string
          group_id: string
          id: string
          member_id: string
          position: number
          removed_at: string | null
          repeat_every_weeks: number | null
          repeat_until: string | null
          responsibility_ids: string[] | null
          retained_event_ids: string[]
          starts_at: string
        }
        Insert: {
          ends_at: string
          group_id: string
          id: string
          member_id: string
          position: number
          removed_at?: string | null
          repeat_every_weeks?: number | null
          repeat_until?: string | null
          responsibility_ids?: string[] | null
          retained_event_ids?: string[]
          starts_at: string
        }
        Update: {
          ends_at?: string
          group_id?: string
          id?: string
          member_id?: string
          position?: number
          removed_at?: string | null
          repeat_every_weeks?: number | null
          repeat_until?: string | null
          responsibility_ids?: string[] | null
          retained_event_ids?: string[]
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_off_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_off_group_id_member_id_fkey"
            columns: ["group_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["group_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_group_command_result: {
        Args: {
          p_expected_version: number
          p_group_id: string
          p_history?: Json
          p_rows: Json
        }
        Returns: number
      }
      claim_link_for: {
        Args: { p_group_id: string; p_member_id: string }
        Returns: string
      }
      group_invite_link: { Args: { p_group_id: string }; Returns: string }
      group_state_rows: { Args: { p_group_id: string }; Returns: Json }
      invite_link_preview: {
        Args: { p_token: string }
        Returns: {
          group_id: string
          group_name: string
          placeholder_name: string
        }[]
      }
      is_group_admin: { Args: { p_group_id: string }; Returns: boolean }
      is_group_member: { Args: { p_group_id: string }; Returns: boolean }
      is_repeat_pattern: { Args: { p: Json }; Returns: boolean }
      new_token: { Args: never; Returns: string }
      register_push_token: {
        Args: {
          p_platform: Database["public"]["Enums"]["push_platform"]
          p_token: string
        }
        Returns: undefined
      }
      reset_invite_link: { Args: { p_group_id: string }; Returns: string }
      update_group_details: {
        Args: { p_group_id: string; p_name: string; p_time_zone: string }
        Returns: undefined
      }
    }
    Enums: {
      confirmation:
        | "notRequired"
        | "notYetRequested"
        | "requested"
        | "confirmed"
      cover_kind: "member" | "guest"
      coverage_policy: "payItBack" | "countRealWork"
      coverage_request_reason: "declined" | "timeOff" | "noOneAvailable"
      make_up_turn_closed_reason:
        | "paid"
        | "movedAlong"
        | "rebalance"
        | "coveragePolicyChanged"
        | "memberLeft"
        | "memberNoLongerQualified"
        | "coverWithdrawn"
        | "responsibilityRemoved"
      make_up_turn_status: "outstanding" | "paid" | "settled" | "cancelled"
      push_platform: "ios" | "android" | "web"
      replacement_duty: "assignedMember" | "admins"
      time_off_handling: "routeAround" | "askVolunteer"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      confirmation: [
        "notRequired",
        "notYetRequested",
        "requested",
        "confirmed",
      ],
      cover_kind: ["member", "guest"],
      coverage_policy: ["payItBack", "countRealWork"],
      coverage_request_reason: ["declined", "timeOff", "noOneAvailable"],
      make_up_turn_closed_reason: [
        "paid",
        "movedAlong",
        "rebalance",
        "coveragePolicyChanged",
        "memberLeft",
        "memberNoLongerQualified",
        "coverWithdrawn",
        "responsibilityRemoved",
      ],
      make_up_turn_status: ["outstanding", "paid", "settled", "cancelled"],
      push_platform: ["ios", "android", "web"],
      replacement_duty: ["assignedMember", "admins"],
      time_off_handling: ["routeAround", "askVolunteer"],
    },
  },
} as const
