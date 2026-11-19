-- Rotation rules (simplify ticket 01): a swap (Make-up Turn) lapses when the Member who
-- owes it is on Time Off at the coverer's next natural turn; normal rotation stands.
-- Additive only.

alter type public.make_up_turn_closed_reason add value if not exists 'lapsed';
