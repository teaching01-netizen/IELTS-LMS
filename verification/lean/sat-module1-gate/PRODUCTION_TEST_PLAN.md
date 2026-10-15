# PRODUCTION TEST PLAN

Run against real MySQL (the `mysql`-tagged terminalization harness) with seeded published versions.

1. **Query shape:** m1_hard plan, two sections, decision only for math → math flag from decision, RW `false` (no row). Confirms LEFT JOIN returns one row per section and NULLs scan.
2. **Boundary matrix:** per shape × raw ∈ {T-1, T, T+1, 0, ops} → expect `module1Qualified` and `conversionStatus` per SPEC.
3. **Revision publish:** seal an unqualified result, publish a new conversion revision, read via student and staff endpoints → still `unavailable`, no `totalScaled`.
4. **Corrupt revision:** force `ActiveRevision` integrity error → raw-only, flag preserved.
5. **Repair sweep:** pending classroom result with unqualified M1 → `RepairClassroomResults` releases with flag `false`.
6. **Concurrency (A1):** M1 timeout auto-submit racing a late save after routing → decision raw equals sealed M1 raw (`assessment_module_attempts.raw_correct`). Invariant query:
   ```sql
   SELECT rd.attempt_id FROM assessment_route_decisions rd
   JOIN assessment_module_attempts ma ON ma.id = rd.base_module_attempt_id
   WHERE ma.raw_correct <> rd.raw_correct;   -- expect 0 rows
   ```
7. **Legacy audit (A6):** count forced-plan results lacking the flag:
   ```sql
   SELECT COUNT(*) FROM assessment_results ar
   JOIN student_attempts a ON a.id = ar.attempt_id
   JOIN exam_versions v ON v.id = a.published_version_id
   WHERE ar.provider_key = 'sat' AND v.sat_classroom_plan IS NOT NULL
     AND JSON_SEARCH(v.sat_classroom_plan, 'one', 'm1\_%') IS NOT NULL
     AND JSON_SEARCH(ar.score_payload, 'one', '%', NULL, '$.classroomRaw.sections[*].module1Qualified') IS NULL;
   ```
