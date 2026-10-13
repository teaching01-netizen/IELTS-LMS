import Safety
import Counterexamples

/-! Every theorem must depend only on propext / Classical.choice / Quot.sound. -/
open SatClassroom
#check ainv_init
#check ainv_step
#check reachable_inv
#check t1_decision_stable
#check t2_staff_only
#check t3_route_fidelity
#check t3_plan_fidelity
#check t4_snapshot
#check t5_sealed_gate
#check t6_release
#check t7_served
#check g7_standalone
#check corrected_replay_after_seal
#check current_violates_staff_only_plan_shape
#check current_violates_staff_only_old_binary
#check current_violates_plan_route
#check corrected_fence_rejects_plan_bypass
#print axioms ainv_init
#print axioms ainv_step
#print axioms reachable_inv
#print axioms t1_decision_stable
#print axioms t2_staff_only
#print axioms t3_route_fidelity
#print axioms t3_plan_fidelity
#print axioms t4_snapshot
#print axioms t5_sealed_gate
#print axioms t6_release
#print axioms t7_served
#print axioms g7_standalone
#print axioms corrected_replay_after_seal
#print axioms awaiting_reachable
#print axioms sealed_staff_reachable_corrected
#print axioms current_violates_staff_only_plan_shape
#print axioms current_violates_staff_only_old_binary
#print axioms legacyFixedPlanBypass_reachable
#print axioms current_violates_plan_route
#print axioms corrected_fence_rejects_plan_bypass
#print axioms awaitingWorld_reachable
#print axioms sealedAfterStaff_reachable
#print axioms current_replay_after_seal_refused
