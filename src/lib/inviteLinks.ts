/**
 * Invite link RPCs and reads. Each throws an Error with a plain-language message, so screens
 * can show `error.message` as is.
 */
import { supabase } from './supabase';

const OFFLINE = "Couldn't load the invite link. Check your connection and try again.";
const ADMINS_ONLY = 'Only people in this group can share its invite link.';

/** The Group's join link token (any active Member, via `group_invite_link`). */
export async function fetchGroupInviteToken(groupId: string): Promise<string> {
  const { data, error } = await supabase.rpc('group_invite_link', { p_group_id: groupId });
  if (error) throw new Error(error.code === '42501' ? "You're no longer in this group." : OFFLINE);
  if (!data) throw new Error("This group has no invite link right now. Reset it in the group's settings.");
  return data;
}

/** Replaces the Group's join link (Admins only). Returns the new token. */
export async function resetGroupInviteToken(groupId: string): Promise<string> {
  const { data, error } = await supabase.rpc('reset_invite_link', { p_group_id: groupId });
  if (error || !data) {
    throw new Error(error?.code === '42501' ? ADMINS_ONLY : "Couldn't reset the link. Check your connection and try again.");
  }
  return data;
}

/** A Placeholder Member's personal claim link token (Admins only; made on first request). */
export async function fetchClaimToken(groupId: string, memberId: string): Promise<string> {
  const { data, error } = await supabase.rpc('claim_link_for', { p_group_id: groupId, p_member_id: memberId });
  if (error || !data) {
    if (error?.code === '42501') throw new Error(ADMINS_ONLY);
    if (error?.code === '22023') throw new Error('They have already joined, so they no longer need a personal link.');
    throw new Error(OFFLINE);
  }
  return data;
}

export type InvitePreview = {
  groupId: string;
  groupName: string;
  /** Set for a personal claim link: who the person joins as. */
  placeholderName: string | null;
  /** The person is already an active Member of this Group. */
  alreadyMember: boolean;
};

export class InvitePreviewError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid' | 'offline',
  ) {
    super(message);
  }
}

export const INVITE_INVALID = "That invite link isn't working. It may have been reset or already used: ask for a new one.";

/** What an invite link leads to. Throws InvitePreviewError. */
export async function previewInvite(token: string): Promise<InvitePreview> {
  const { data, error } = await supabase.rpc('invite_link_preview', { p_token: token });
  if (error) throw new InvitePreviewError("Couldn't check that link. Check your connection and try again.", 'offline');
  const row = data?.[0];
  if (!row) throw new InvitePreviewError(INVITE_INVALID, 'invalid');
  // Under RLS a Group's row is readable only by its active Members (signed out: no one).
  const { data: session } = await supabase.auth.getSession();
  const { data: mine } = session.session
    ? await supabase.from('groups').select('id').eq('id', row.group_id).maybeSingle()
    : { data: null };
  return {
    groupId: row.group_id,
    groupName: row.group_name,
    placeholderName: row.placeholder_name || null,
    alreadyMember: !!mine,
  };
}
