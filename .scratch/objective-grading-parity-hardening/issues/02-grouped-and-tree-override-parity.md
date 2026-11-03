# 02: Grouped-slot and tree-root overrides score identically

**What to build:** A schedule answer-key override targeted at a grouped table slot or a sub-answer-tree root produces the same awarded score and maximum score on the server and the website. The group mark must use the override's maximum consistently rather than one side honouring it and the other assuming one mark.

**Blocked by:** 01 (one group-scoring routine per side)

**Status:** done

- [ ] An override on a grouped table slot gives identical awarded/max scores on both graders.
- [ ] An override on a sub-answer-tree root gives identical awarded/max scores on both graders.
- [ ] Choose-N and ungrouped overrides keep their existing behaviour.
- [ ] The full-coverage fixture includes grouped-slot and tree-root override cases.
- [ ] The replay report still shows zero mismatches.

## Implementation note

Group maximum is now the maximum override max across the group on both sides (`groupOverrideMax`). The full-coverage fixture adds a grouped-table and a tree-root override; replay reports 0 mismatches.
