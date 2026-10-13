import Model

/-
  Safety properties of the delivered inserted-image slot.

  S1  placement: instruction, then images, then question content
  S2  no empty container / legacy equivalence when nothing is loadable
  S3  exclusions: map and diagram-labeling render no inserted images
  S4  row selection: sound, complete, order-preserving
  S5  source provenance: every rendered source comes from a loadable row
  S6  keys: positionally unique, so repeated authoring ids cannot collide
-/

namespace InsertedImages

/-! ## List helpers (core Lean only; this project has no Mathlib dependency) -/

/-- Dropping exactly a prefix's length leaves the suffix. -/
theorem drop_length_append_self (m c : List Slot) :
    List.drop m.length (m ++ c) = c := by
  induction m with
  | nil => rfl
  | cons x xs ih =>
      simp only [List.length_cons, List.cons_append]
      rw [List.drop_succ_cons]
      exact ih

/-- Dropping the instruction slot and the images slots leaves the content. -/
theorem drop_instruction_and_images (m c : List Slot) :
    List.drop (1 + m.length) ([Slot.instruction] ++ (m ++ c)) = c := by
  show List.drop ((List.length [Slot.instruction]) + m.length)
      ([Slot.instruction] ++ (m ++ c)) = c
  rw [List.drop_append]
  exact drop_length_append_self m c

/-- The first component of an index-tagged list is the index range itself. -/
theorem map_fst_zip_range (n : Nat) (f : Nat → String) :
    ((List.range n).map (fun i => (i, f i))).map Prod.fst = List.range n := by
  induction n with
  | zero => rfl
  | succ n ih =>
      rw [List.range_succ, List.map_append, List.map_append, ih]
      rfl

/-! ## Shape facts -/

/-- S1a: the delivered frame is exactly instruction, images, content. -/
theorem frame_decomposition (b : Block) :
    frameSlots b = [Slot.instruction] ++ imagesSlots b ++ contentSlots b := rfl

/-- The delivered frame before the fix, for comparison. -/
theorem legacy_decomposition (b : Block) :
    legacySlots b = [Slot.instruction] ++ contentSlots b := rfl

theorem images_slots_present (b : Block)
    (hSupported : supportsInsertedImages b = true) (hRows : loadableRows b ≠ []) :
    imagesSlots b = [Slot.images] := by
  simp [imagesSlots, hSupported, hRows]

theorem images_slots_absent (b : Block)
    (h : supportsInsertedImages b = false ∨ loadableRows b = []) :
    imagesSlots b = [] := by
  rcases h with h | h
  · simp [imagesSlots, h]
  · simp [imagesSlots, h]

/-! ## S1 — placement -/

/-- The instruction slot is the first child of the frame. -/
theorem instruction_is_head (b : Block) :
    (frameSlots b)[0]? = some Slot.instruction := by
  simp [frameSlots, imagesSlots, List.getElem?_cons_zero]

/-- The inserted images occupy index 1: strictly after the instruction and
    strictly before every question-content child. -/
theorem images_at_index_one (b : Block)
    (hSupported : supportsInsertedImages b = true) (hRows : loadableRows b ≠ []) :
    (frameSlots b)[1]? = some Slot.images := by
  have hShape : frameSlots b = Slot.instruction :: (Slot.images :: contentSlots b) := by
    simp [frameSlots, imagesSlots, hSupported, hRows]
  rw [hShape, List.getElem?_cons_succ, List.getElem?_cons_zero]

/-- Everything after the images slot is question content, so no question child
    is ever drawn above the diagram. -/
theorem content_after_images (b : Block)
    (hSupported : supportsInsertedImages b = true) (hRows : loadableRows b ≠ []) :
    (frameSlots b).drop 2 = contentSlots b := by
  have hShape : frameSlots b = Slot.instruction :: (Slot.images :: contentSlots b) := by
    simp [frameSlots, imagesSlots, hSupported, hRows]
  rw [hShape]
  rfl

/-- In the legacy frame, question content starts at index 1. -/
theorem legacy_content_at_index_one (b : Block) :
    (legacySlots b).drop 1 = contentSlots b := by
  simp [legacySlots]

/-- Question content never lands in the images slot: the frame's content
    children are all `Slot.content`. -/
theorem frame_content_slots (b : Block) (s : Slot)
    (h : s ∈ (frameSlots b).drop (1 + (imagesSlots b).length)) :
    s = Slot.content := by
  have hDecomp : frameSlots b = [Slot.instruction] ++ (imagesSlots b ++ contentSlots b) := by
    simp [frameSlots]
  have hDrop : (frameSlots b).drop (1 + (imagesSlots b).length) = contentSlots b := by
    rw [hDecomp]
    exact drop_instruction_and_images (imagesSlots b) (contentSlots b)
  rw [hDrop] at h
  exact List.eq_of_mem_replicate h

/-! ## S1b — blank instruction

The listening renderer drops the instruction element entirely when the
instruction text is blank (`renderBlockInstruction` returns `null`). The
inserted images must still precede the question content in that frame. -/

/-- The frame when the instruction renders nothing. -/
def frameSlotsNoInstruction (b : Block) : List Slot := imagesSlots b ++ contentSlots b

/-- With a blank instruction, the images become the first child. -/
theorem blank_instruction_images_are_first (b : Block)
    (hSupported : supportsInsertedImages b = true) (hRows : loadableRows b ≠ []) :
    (frameSlotsNoInstruction b)[0]? = some Slot.images := by
  have hShape : frameSlotsNoInstruction b = Slot.images :: contentSlots b := by
    simp [frameSlotsNoInstruction, imagesSlots, hSupported, hRows]
  rw [hShape, List.getElem?_cons_zero]

/-- With a blank instruction, question content still starts only after the
    images. -/
theorem blank_instruction_content_after_images (b : Block) :
    (frameSlotsNoInstruction b).drop (imagesSlots b).length = contentSlots b := by
  simp only [frameSlotsNoInstruction]
  exact drop_length_append_self (imagesSlots b) (contentSlots b)

/-! ## S2 — no empty container, legacy equivalence -/

/-- With nothing loadable, the delivered frame is byte-shape identical to the
    pre-fix frame: the fix adds no empty container and removes nothing. -/
theorem empty_rows_render_legacy_frame (b : Block) (hRows : loadableRows b = []) :
    frameSlots b = legacySlots b := by
  simp [frameSlots, legacySlots, imagesSlots, hRows]

/-- The pre-fix frame never contained an images slot, for any block. -/
theorem legacy_frame_has_no_images_slot (b : Block) (s : Slot)
    (h : s ∈ legacySlots b) : s ≠ Slot.images := by
  have hmem : s ∈ Slot.instruction :: contentSlots b := by
    simpa [legacySlots] using h
  rcases List.mem_cons.mp hmem with hHead | hContent
  · rw [hHead]; intro hContra; exact Slot.noConfusion hContra
  · rw [List.eq_of_mem_replicate hContent]
    intro hContra
    exact Slot.noConfusion hContra

/-! ## S3 — exclusions -/

/-- Blocks the authoring editor excludes render no inserted images, whatever
    data they carry. -/
theorem map_and_diagram_render_no_images (b : Block)
    (h : b.blockType = BlockType.map ∨ b.blockType = BlockType.diagramLabeling) :
    imagesSlots b = [] := by
  rcases h with h | h <;> simp [imagesSlots, supportsInsertedImages, h]

/-! ## S4 — row selection -/

/-- The filter predicate agrees with `getImageUrlCandidates`'s emptiness test. -/
theorem hasSources_true_iff (r : Row) : hasSources r = true ↔ candidatesOf r.url ≠ [] := by
  unfold hasSources
  split <;> simp_all

/-- Selection is sound: a row kept for rendering came from the payload and
    resolves to at least one source. -/
theorem loadable_row_mem_and_loadable (b : Block) (r : Row)
    (h : r ∈ loadableRows b) :
    r ∈ b.rows ∧ candidatesOf r.url ≠ [] := by
  have hBoth := List.mem_filter.mp h
  exact ⟨hBoth.1, (hasSources_true_iff r).mp hBoth.2⟩

/-- Selection is complete: any payload row that resolves to a source renders. -/
theorem payload_row_with_sources_is_loadable (b : Block) (r : Row)
    (hRows : r ∈ b.rows) (hCandidates : candidatesOf r.url ≠ []) :
    r ∈ loadableRows b :=
  List.mem_filter.mpr ⟨hRows, (hasSources_true_iff r).mpr hCandidates⟩

/-- Selection is the filter itself, in payload order: no sort, no dedupe, no
    reversal. -/
theorem loadable_rows_are_the_filter (b : Block) :
    loadableRows b = b.rows.filter hasSources := rfl

/-- Equality of the selected id sequence with the payload order restricted to
    loadable rows: order preservation, by construction. -/
theorem loadable_row_ids_preserve_payload_order (b : Block) :
    (loadableRows b).map Row.id = (b.rows.filter hasSources).map Row.id := by
  rw [loadable_rows_are_the_filter]

/-! ## S5 — source provenance -/

/-- Every rendered source is attributed to a loadable row and is one of that
    row's candidates: rendering never invents a URL. -/
theorem rendered_source_came_from_a_loadable_row (b : Block) (src : Source)
    (h : src ∈ renderedSources b) :
    ∃ r ∈ loadableRows b, src.origin = r.id ∧ src.text ∈ candidatesOf r.url := by
  rcases (List.mem_flatMap.mp h) with ⟨r, hr, hsrc⟩
  rcases (List.mem_map.mp hsrc) with ⟨text, htext, hEq⟩
  refine ⟨r, hr, ?_, ?_⟩
  · rw [← hEq]
  · rw [← hEq]; exact htext

/-- A rejected URL contributes no source at all and never renders. -/
theorem rejected_row_renders_nothing (b : Block) (r : Row) (hRows : r ∈ b.rows)
    (hRejected : candidatesOf r.url = []) :
    r ∈ b.rows ∧ renderedSourcesFor r = [] ∧ r ∉ loadableRows b := by
  refine ⟨hRows, ?_, ?_⟩
  · simp [renderedSourcesFor, hRejected]
  · intro hMember
    exact (loadable_row_mem_and_loadable b r hMember).2 hRejected

/-- A Drive share link renders the four Drive candidate forms. -/
theorem drive_row_renders_four_candidates (fileId : String) :
    (candidatesOf (UrlKind.drive fileId)).length = 4 := rfl

/-! ## S6 — key material -/

/-- The position component of the key material is the row's own position, so
    the keys are exactly `0 … n-1`. -/
theorem image_key_positions (b : Block) :
    (imageKeys b).map Prod.fst = List.range (loadableRows b).length := by
  unfold imageKeys
  exact map_fst_zip_range (loadableRows b).length
    (fun i => Option.getD (Option.map Row.id (loadableRows b)[i]?) "")

/-- Consequently the rendered image keys are pairwise distinct even when an
    imported payload repeats an authoring id. -/
theorem image_keys_have_distinct_positions (b : Block) :
    ((imageKeys b).map Prod.fst).Nodup := by
  rw [image_key_positions]
  exact List.nodup_range

theorem image_keys_length (b : Block) :
    (imageKeys b).length = (loadableRows b).length := by
  simp [imageKeys]

end InsertedImages
