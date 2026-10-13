import Model
import Safety

/-
  Compiled witnesses. These exist so the safety theorems over `Block` are not
  vacuous: the model admits blocks with loadable rows, and the pre-fix frame of
  such a block provably lacks the images slot the fix adds.

  They also pin the second hazard this verification surfaced: an imported
  payload can repeat an authoring id, which collides under an id-only React key
  and does not collide under the position-suffixed key the fix now uses.
-/

namespace InsertedImages.Counterexamples

open InsertedImages

/-- The reported scenario: a short-answer block whose instruction is "Label the
    diagram below." and which carries one Google Drive diagram. -/
def reportedBlock : Block :=
  { id := "sa-11-13"
    blockType := BlockType.shortAnswer
    instruction := "Label the diagram below."
    rows := [{ id := "img-1", url := UrlKind.drive "1DgrUF", caption := "Water heater" }]
    contentCount := 3 }

/-- The reported block really does carry a loadable row, so the theorems above
    are not satisfied by an empty selection. -/
theorem reported_block_has_loadable_rows : loadableRows reportedBlock ≠ [] := by decide

/-- The pre-fix frame of the reported block renders no image: the user-visible
    bug, as a compiled statement about the legacy shape. -/
theorem reported_block_legacy_frame_lacks_images :
    ∀ s ∈ legacySlots reportedBlock, s ≠ Slot.images :=
  legacy_frame_has_no_images_slot reportedBlock

/-- The fixed frame of the reported block places the image at index 1. -/
theorem reported_block_fixed_frame_has_image :
    (frameSlots reportedBlock)[1]? = some Slot.images := by decide

/-- The fixed frame keeps the three question children after the image. -/
theorem reported_block_content_after_image :
    (frameSlots reportedBlock).drop 2 = contentSlots reportedBlock := by decide

/-- A map block carrying a loadable inserted image still renders none: the
    exclusion is data-independent, matching the authoring editor. -/
def mapBlockWithRows : Block :=
  { id := "map-1"
    blockType := BlockType.map
    instruction := "Label the map."
    rows := [{ id := "img-1", url := UrlKind.plain "https://example.com/extra.png", caption := "" }]
    contentCount := 2 }

theorem map_block_with_loadable_rows_renders_no_images :
    imagesSlots mapBlockWithRows = [] := by decide

/-- A rejected URL (`javascript:`), a blank URL, and a plain URL in one payload. -/
def mixedBlock : Block :=
  { id := "sa-mixed"
    blockType := BlockType.shortAnswer
    instruction := "Label the diagram below."
    rows :=
      [ { id := "img-unsafe", url := UrlKind.unsafeScheme, caption := "" },
        { id := "img-blank", url := UrlKind.blank, caption := "" },
        { id := "img-ok", url := UrlKind.plain "https://example.com/diagram.png", caption := "" } ]
    contentCount := 1 }

/-- Only the safe row survives selection, and it is the last one: the filter
    keeps payload order. -/
theorem mixed_block_selects_only_the_safe_row :
    (loadableRows mixedBlock).map Row.id = ["img-ok"] := by decide

theorem mixed_block_renders_one_source :
    (renderedSources mixedBlock).length = 1 := by decide

/-- An imported payload that repeats an authoring id. -/
def duplicateIdBlock : Block :=
  { id := "sa-dup"
    blockType := BlockType.shortAnswer
    instruction := "Label the diagram below."
    rows :=
      [ { id := "img-1", url := UrlKind.plain "https://example.com/a.png", caption := "" },
        { id := "img-1", url := UrlKind.plain "https://example.com/b.png", caption := "" } ]
    contentCount := 2 }

/-- The pre-hardening key scheme (authoring id only) collides on this payload,
    which is what React reports as a duplicate-key reconciliation hazard. -/
def legacyImageKeys (b : Block) : List String :=
  (loadableRows b).map Row.id

theorem id_only_keys_collide_on_duplicate_authoring_ids :
    ¬(legacyImageKeys duplicateIdBlock).Nodup := by decide

/-- The position-suffixed key material has distinct positions for the same
    payload, so no two rendered images can share a key token. -/
theorem position_suffixed_keys_do_not_collide :
    ((imageKeys duplicateIdBlock).map Prod.fst).Nodup :=
  image_keys_have_distinct_positions duplicateIdBlock

theorem duplicate_id_block_positions :
    (imageKeys duplicateIdBlock).map Prod.fst = [0, 1] := by decide

end InsertedImages.Counterexamples
