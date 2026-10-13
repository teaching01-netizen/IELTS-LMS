import InsertedImagesDelivery

/-!
  Direct statement/axiom audit. Every theorem cited in PROOF_REPORT.md is
  `#check`ed and `#print axioms`ed here, so the report can be reproduced by
  running `lake env lean AxiomAudit.lean`.
-/

open InsertedImages

/-! ## Placement (S1) -/

#check @frame_decomposition
#check @legacy_decomposition
#check @images_slots_present
#check @instruction_is_head
#check @images_at_index_one
#check @content_after_images
#check @legacy_content_at_index_one
#check @frame_content_slots

/-! ## Blank instruction (S1b) -/

#check @frameSlotsNoInstruction
#check @blank_instruction_images_are_first
#check @blank_instruction_content_after_images

/-! ## No empty container (S2) -/

#check @empty_rows_render_legacy_frame
#check @legacy_frame_has_no_images_slot

/-! ## Exclusions (S3) -/

#check @map_and_diagram_render_no_images

/-! ## Row selection (S4) -/

#check @hasSources_true_iff
#check @loadable_row_mem_and_loadable
#check @payload_row_with_sources_is_loadable
#check @loadable_rows_are_the_filter
#check @loadable_row_ids_preserve_payload_order

/-! ## Source provenance (S5) -/

#check @rendered_source_came_from_a_loadable_row
#check @rejected_row_renders_nothing
#check @drive_row_renders_four_candidates

/-! ## Key material (S6) -/

#check @image_key_positions
#check @image_keys_have_distinct_positions
#check @image_keys_length

/-! ## List helpers -/

#check @drop_length_append_self
#check @drop_instruction_and_images
#check @map_fst_zip_range

/-! ## Counterexamples and witnesses -/

#check @InsertedImages.Counterexamples.reported_block_has_loadable_rows
#check @InsertedImages.Counterexamples.reported_block_legacy_frame_lacks_images
#check @InsertedImages.Counterexamples.reported_block_fixed_frame_has_image
#check @InsertedImages.Counterexamples.reported_block_content_after_image
#check @InsertedImages.Counterexamples.map_block_with_loadable_rows_renders_no_images
#check @InsertedImages.Counterexamples.mixed_block_selects_only_the_safe_row
#check @InsertedImages.Counterexamples.mixed_block_renders_one_source
#check @InsertedImages.Counterexamples.id_only_keys_collide_on_duplicate_authoring_ids
#check @InsertedImages.Counterexamples.position_suffixed_keys_do_not_collide
#check @InsertedImages.Counterexamples.duplicate_id_block_positions

/-! ## Axiom audit -/

#print axioms frame_decomposition
#print axioms images_at_index_one
#print axioms content_after_images
#print axioms frame_content_slots
#print axioms blank_instruction_images_are_first
#print axioms blank_instruction_content_after_images
#print axioms empty_rows_render_legacy_frame
#print axioms legacy_frame_has_no_images_slot
#print axioms map_and_diagram_render_no_images
#print axioms hasSources_true_iff
#print axioms loadable_row_mem_and_loadable
#print axioms payload_row_with_sources_is_loadable
#print axioms loadable_row_ids_preserve_payload_order
#print axioms rendered_source_came_from_a_loadable_row
#print axioms rejected_row_renders_nothing
#print axioms drive_row_renders_four_candidates
#print axioms image_key_positions
#print axioms image_keys_have_distinct_positions
#print axioms image_keys_length
#print axioms drop_length_append_self
#print axioms drop_instruction_and_images
#print axioms map_fst_zip_range
#print axioms InsertedImages.Counterexamples.reported_block_has_loadable_rows
#print axioms InsertedImages.Counterexamples.reported_block_legacy_frame_lacks_images
#print axioms InsertedImages.Counterexamples.reported_block_fixed_frame_has_image
#print axioms InsertedImages.Counterexamples.reported_block_content_after_image
#print axioms InsertedImages.Counterexamples.map_block_with_loadable_rows_renders_no_images
#print axioms InsertedImages.Counterexamples.mixed_block_selects_only_the_safe_row
#print axioms InsertedImages.Counterexamples.mixed_block_renders_one_source
#print axioms InsertedImages.Counterexamples.id_only_keys_collide_on_duplicate_authoring_ids
#print axioms InsertedImages.Counterexamples.position_suffixed_keys_do_not_collide
#print axioms InsertedImages.Counterexamples.duplicate_id_block_positions
