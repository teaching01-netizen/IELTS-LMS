import Safety

namespace SatClassroomGate

def sampleRequest (nonce : OperationNonce) (session : Session := .classroom) : Request :=
  { key := (17, nonce), payload := { exam := 42, session, formDigest := 9 } }

def allEnabled : InstanceId → Bool := fun _ => true

/-- A concrete successful commit followed by an ACK-loss retry with the same
key returns the existing receipt and leaves the effect count at one. -/
theorem lost_ack_same_key_replays_once :
    let request := sampleRequest 1
    let first := handle (Store.empty allEnabled) 0 request
    let second := handle first.1 0 request
    (∃ receipt, first.2 = .created receipt ∧ second.2 = .replayed receipt) ∧
    second.1.roomEffects request.key = 1 := by
  simp [sampleRequest, allEnabled, handle, Store.empty, Store.commit]

def partiallyEnabled (node : InstanceId) : Bool := if node = 0 then true else false

/-- Per-process flags produce partial availability during a skewed rollout:
one fresh request succeeds at an enabled node, then a separate fresh request
is refused at a disabled node in the same sequential history. -/
theorem mixed_instance_configuration_is_not_global :
    let acceptedRequest := sampleRequest 2
    let refusedRequest := sampleRequest 3
    let store := Store.empty partiallyEnabled
    let accepted := handle store 0 acceptedRequest
    let refused := handle accepted.1 1 refusedRequest
    (∃ receipt, accepted.2 = .created receipt) ∧
    refused.2 = .classroomDisabled ∧
    refused.1.roomEffects acceptedRequest.key = 1 := by
  simp [sampleRequest, partiallyEnabled, handle, Store.empty, Store.commit]

/-- Counterexample to clearing a generic 5xx key: if the first operation
committed and the UI invents a second key, two rooms are permitted. -/
theorem clearing_generic_5xx_key_can_duplicate_rooms :
    let firstRequest := sampleRequest 3 .practice
    let secondRequest := sampleRequest 4 .practice
    let first := handle (Store.empty (fun _ => false)) 0 firstRequest
    let second := handle first.1 0 secondRequest
    first.1.roomEffects firstRequest.key = 1 ∧
    second.1.roomEffects firstRequest.key = 1 ∧
    second.1.roomEffects secondRequest.key = 1 ∧
    second.1.totalRooms = 2 := by
  simp [sampleRequest, handle, Store.empty, Store.commit]

end SatClassroomGate
