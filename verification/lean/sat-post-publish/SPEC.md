# SAT post-publish workspace specification

## Verification target

The target is the staff workspace's publish completion lifecycle: a successful publish POST acknowledges one immutable published version, then the author can use that version to create a room or leave the sheet. The authoritative publication state belongs to the backend; this browser operation's exact target belongs to its validated POST receipt. Release and shell reads are projections and may fail, stall, or reflect a later publication.

## Requirements

| ID | Guarantee | Classification |
| --- | --- | --- |
| R1 | Once the client receives and validates a successful publish receipt, later release/list/shell refresh failures or stalls do not convert that operation into a publish failure. | Safety |
| R2 | Shell loading, cache removal, or `NO_DRAFT` does not unmount or remount the open publish sheet. A valid receipt remains visible while the document remains open. | Safety; visible completion is conditional on a later render |
| R3 | Create room from the completion sheet uses the exact version ID, number, and scope in that receipt, even if another author publishes later. | Ordering / consistency |
| R4 | Done and reload leave a usable published workspace. Reads do not open drafts; only an explicit, authorized Edit exam action may request one. | Safety / recovery |
| R5 | A rejected, lost, malformed, or mismatched response never produces a fabricated receipt. Missing, forbidden, rejected, and unknown states remain distinct where the API supplies that distinction. | Safety |
| R6 | This change preserves the existing dirty-work recovery and sealed-version write fences during remote publication. | Data integrity; compatibility obligation |
| R7 | Completion actions remain keyboard reachable and focus has a usable destination if publication removes the original trigger. Existing release and settings consumers remain compatible. | Accessibility / compatibility |

## Formal envelope

The Lean project models one exam and one client document. Its state separates a durable current version, the version committed by this operation, the cached release projection, the shell state, the publish outcome, the sheet instance/open state, the ephemeral receipt, and the selected room target. Its transition function models commit and acknowledgment separately, lost/malformed acknowledgment, release read success/failure/held, shell response, remote publish, Done, reload, explicit draft open, and exam change.

The model proves selected lifecycle properties for this transition function. It does not model SQL, multiple simultaneous client states, arbitrary network queues, clocks, actual React reconciliation, dirty recovery payloads, access control, server persistence, or a production scheduler. The legacy counterexamples are small executable state traces of the two previously observed failure shapes; they are not a simulation of the complete old application.

`Provenance.lean` adds ghost history of accepted local commit transitions. Reachable receipts are proved to refer to a commit in that history, and erasing the history yields the original Lean operational step. This strengthens receipt provenance without assuming the invariant as an initial condition; initial clients have no receipt, and a universally parameterized successful target trace shows the model is executable. The wrapper remains a one-client abstraction and does not verify database acknowledgments.

The following are intentionally not formal claims: SQL commit durability/atomicity; API-to-DB correspondence; at-most-once database effects; eventual browser rendering under permanent failure; multi-user linearizability; capacity; WCAG conformance; or production readiness.
