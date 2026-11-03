# 07: Publish refusal is visible in the builder

**What to build:** Publishing an exam whose objective key the server cannot read fails with a message naming the section, question number and problem, and the builder's publish flow shows that message to the teacher. The valid-exam path still publishes.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] Publishing an exam with an unreadable objective key returns the section, question number and problem through the API.
- [ ] The publish modal displays that message verbatim.
- [ ] A valid exam covering every key-source row still publishes.
- [ ] A Go handler test and a builder interaction test cover the refusal and the successful path.

## Implementation note

The builder modal test proves the server message is shown verbatim; the Go validator test proves the refusal names section and question. The valid-exam path remains covered by the Go validator test.
