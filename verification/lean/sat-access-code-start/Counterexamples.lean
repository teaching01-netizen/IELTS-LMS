import OperationalModel

namespace SATAccessCodeStart.Operational.Counterexamples

structure Budget where
  failed : Nat
  pending : Nat
  deriving DecidableEq, Repr

def spent (budget : Budget) : Nat := budget.failed + budget.pending

def unsafeConcurrentClaims (budget : Budget) : Nat :=
  if spent budget < failureLimit then spent budget + 2 else spent budget

theorem unguarded_read_check_write_exceeds_limit :
    unsafeConcurrentClaims ⟨199, 0⟩ = 201 ∧
      failureLimit < unsafeConcurrentClaims ⟨199, 0⟩ := by
  decide

end SATAccessCodeStart.Operational.Counterexamples
