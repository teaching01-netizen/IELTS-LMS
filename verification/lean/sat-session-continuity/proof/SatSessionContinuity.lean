import Model
import Continuity
import Counterexamples
import Retention

open SatSessionContinuity

-- Fixed policy: an active student is served for the whole sitting.
#print axioms SatSessionContinuity.active_student_always_served
#print axioms SatSessionContinuity.prod_active_student_always_served
-- Pre-fix policy: counterexamples (explain the incident).
#print axioms SatSessionContinuity.idleBound_logs_out_active_student
#print axioms SatSessionContinuity.idleBound_rejects_saves
#print axioms SatSessionContinuity.fixed_policy_serves_three_hours
#print axioms SatSessionContinuity.old_policy_fails_three_hours
-- Answer retention.
#print axioms SatSessionContinuity.Retention.answer_never_silently_lost
#print axioms SatSessionContinuity.Retention.saved_answer_scored
#print axioms SatSessionContinuity.Retention.answer_accounted
#print axioms SatSessionContinuity.Retention.ackLost_then_closed_is_duplicate
#print axioms SatSessionContinuity.Retention.wipe_breaks_retention
#print axioms SatSessionContinuity.Retention.nonvacuous_trace
