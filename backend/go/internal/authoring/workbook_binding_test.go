package authoring

import (
	"encoding/json"
	"reflect"
	"testing"
)

func oneModuleCommitRequest() SatWorkbookCommitRequest {
	r := commitRequest()
	r.TargetModuleKeys = []string{"rw-m1"}
	r.Modules = r.Modules[:1]
	r.OperationKey = "single-operation"
	return r
}

func TestWorkbookCommitMustMatchDetectedModulesExactly(t *testing.T) {
	missing := oneModuleCommitRequest()
	missing.TargetModuleKeys = []string{"rw-m1", "rw-m2-lower"}
	if _, _, err := prepareWorkbookCommit(missing); err == nil {
		t.Fatal("a target module with no content was accepted")
	}
	extra := commitRequest()
	extra.TargetModuleKeys = []string{"rw-m1"}
	if _, _, err := prepareWorkbookCommit(extra); err == nil {
		t.Fatal("content for an undetected module was accepted")
	}
	wrong := oneModuleCommitRequest()
	wrong.TargetModuleKeys = []string{"math-m1"}
	if _, _, err := prepareWorkbookCommit(wrong); err == nil {
		t.Fatal("content for a different module than targeted was accepted")
	}
	none := oneModuleCommitRequest()
	none.TargetModuleKeys = nil
	if _, _, err := prepareWorkbookCommit(none); err == nil {
		t.Fatal("a commit with no target modules was accepted")
	}
	short := oneModuleCommitRequest()
	short.Modules[0].Questions = short.Modules[0].Questions[:26]
	if _, _, err := prepareWorkbookCommit(short); err == nil {
		t.Fatal("incomplete module accepted")
	}
}

func TestWorkbookCommitCanonicalisesTargetsWithoutMutatingCaller(t *testing.T) {
	r := commitRequest()
	r.TargetModuleKeys = []string{"math-m1", "rw-m1"}
	r.Modules = []SatWorkbookModuleDraft{r.Modules[0], r.Modules[3]}
	original, _ := json.Marshal(r)
	prepared, digest, err := prepareWorkbookCommit(r)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(prepared.TargetModuleKeys, []string{"rw-m1", "math-m1"}) || digest == "" {
		t.Fatalf("targets not canonicalised: %v", prepared.TargetModuleKeys)
	}
	after, _ := json.Marshal(r)
	if string(after) != string(original) {
		t.Fatal("caller request was mutated")
	}
}

func TestWorkbookCommitIgnoresLegacyPretestFlags(t *testing.T) {
	r := oneModuleCommitRequest()
	for i := range r.Modules[0].Questions {
		r.Modules[0].Questions[i].LegacyIsPretest = i%3 == 0
	}
	if _, _, err := prepareWorkbookCommit(r); err != nil {
		t.Fatalf("legacy pretest flags must be ignored at import: %v", err)
	}
}

func TestWorkbookContentDigestBindsContentAndTargets(t *testing.T) {
	r := oneModuleCommitRequest()
	_, first, err := prepareWorkbookCommit(r)
	if err != nil {
		t.Fatal(err)
	}
	var object map[string]any
	json.Unmarshal(r.Modules[0].Questions[0].Prompt, &object)
	raw, _ := json.MarshalIndent(object, "", "  ")
	r.Modules[0].Questions[0].Prompt = raw
	_, reformatted, err := prepareWorkbookCommit(r)
	if err != nil {
		t.Fatal(err)
	}
	if first != reformatted {
		t.Fatal("JSON formatting changed the checked-content digest")
	}
	r.Modules[0].Questions[0].Prompt = json.RawMessage(`{"version":1,"nodes":[{"type":"paragraph","text":"Altered checked content"}]}`)
	_, changed, err := prepareWorkbookCommit(r)
	if err != nil {
		t.Fatal(err)
	}
	if first == changed {
		t.Fatal("changed prompt did not change content binding")
	}
}
