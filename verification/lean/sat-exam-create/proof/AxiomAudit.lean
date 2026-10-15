import Safety
import Counterexamples

/-! Exact theorem types and transitive axiom audit for this project. -/
open SatExamCreate

#check initiate
#check commit_preserves
#check clearOperation_preserves
#check step_preserves
#check reachable_invariant
#check same_key_retry_replays
#check mismatched_key_payload_conflicts
#check abort_is_stutter
#check lost_ack_is_stutter
#check receipt_points_to_complete_exam
#check emptyState_invariant
#check valid_create_is_reachable
#check old_client_lost_ack_can_duplicate
#check keyed_lost_ack_then_retry_replays
#check expired_key_allows_late_duplicate

#print axioms initiate
#print axioms commit_preserves
#print axioms clearOperation_preserves
#print axioms step_preserves
#print axioms reachable_invariant
#print axioms same_key_retry_replays
#print axioms mismatched_key_payload_conflicts
#print axioms abort_is_stutter
#print axioms lost_ack_is_stutter
#print axioms receipt_points_to_complete_exam
#print axioms emptyState_invariant
#print axioms valid_create_is_reachable
#print axioms old_client_lost_ack_can_duplicate
#print axioms keyed_lost_ack_then_retry_replays
#print axioms expired_key_allows_late_duplicate
