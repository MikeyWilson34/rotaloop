# Rotations are ordered queues, with an Admin Rebalance

Each Responsibility's Rotation is an ordered queue of the Members on its team, not a fairness score recalculated at every Event. Volunteers need to predict their turn ("I'm after Sarah"), and pure scoring makes the next turn look random. To correct drift, an Admin can run Rebalance, which reorders the queue by workload: served turns plus Covers, counted per Responsibility. Members passed over for Time Off keep their place at the front, and Rebalance also settles any outstanding Make-up Turns so debts are never double-counted.

## Considered Options

- **Pure scoring** (always pick whoever has the lowest workload). This is fairer on paper, but members can't predict their turns. Rejected.
- **Pure queue** (no correction). Declines and Covers drift the totals apart with no way to fix them. Rejected.
