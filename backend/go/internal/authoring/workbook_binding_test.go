package authoring

import (
	"encoding/json"
	"reflect"
	"testing"
)

func singleCommitRequest() SatWorkbookCommitRequest {
	r := commitRequest()
	r.Mode, r.TargetModuleKey = "single_module", "rw-m1"
	r.Modules = r.Modules[:1]
	r.OperationKey = "single-operation"
	r.PretestResolution = &SatWorkbookPretestResolution{SelectedOrders: []int{19, 8}, DesignationSource: "staff_defined", Confirmed: true}
	return r
}

func TestSingleModuleResolutionRequiresExplicitDistinctInRangePair(t *testing.T) {
	for _, resolution := range []*SatWorkbookPretestResolution{
		nil,
		{SelectedOrders: []int{8}, DesignationSource: "staff_defined", Confirmed: true},
		{SelectedOrders: []int{8, 8}, DesignationSource: "staff_defined", Confirmed: true},
		{SelectedOrders: []int{8, 19, 20}, DesignationSource: "staff_defined", Confirmed: true},
		{SelectedOrders: []int{0, 19}, DesignationSource: "staff_defined", Confirmed: true},
		{SelectedOrders: []int{8, 28}, DesignationSource: "staff_defined", Confirmed: true},
		{SelectedOrders: []int{8, 19}, DesignationSource: "", Confirmed: true},
		{SelectedOrders: []int{8, 19}, DesignationSource: "official_guess", Confirmed: true},
		{SelectedOrders: []int{8, 19}, DesignationSource: "staff_defined"},
	} {
		r := singleCommitRequest()
		r.PretestResolution = resolution
		if _, _, err := prepareSingleModuleCommit(r); err == nil {
			t.Fatalf("invalid resolution accepted: %+v", resolution)
		}
	}
}

func TestSingleModuleResolutionMaterializesExactlyTwoWithoutMutatingCaller(t *testing.T) {
	r := singleCommitRequest()
	original, _ := json.Marshal(r)
	prepared, _, err := prepareSingleModuleCommit(r)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(prepared.PretestResolution.SelectedOrders, []int{8, 19}) {
		t.Fatal("pair not canonicalized")
	}
	count := 0
	for i, q := range prepared.Modules[0].Questions {
		if q.IsPretest {
			count++
		}
		if q.IsPretest != (i == 7 || i == 18) {
			t.Fatalf("wrong flag at order %d", i+1)
		}
	}
	if count != 2 {
		t.Fatalf("got %d flags", count)
	}
	after, _ := json.Marshal(r)
	if string(after) != string(original) {
		t.Fatal("caller request was mutated")
	}
}

func TestSingleModuleContentDigestCanonicalJSONAndPretestSeparation(t *testing.T) {
	r := singleCommitRequest()
	_, first, err := prepareSingleModuleCommit(r)
	if err != nil {
		t.Fatal(err)
	}
	var object map[string]any
	json.Unmarshal(r.Modules[0].Questions[0].Prompt, &object)
	raw, _ := json.MarshalIndent(object, "", "  ")
	r.Modules[0].Questions[0].Prompt = raw
	r.PretestResolution.SelectedOrders = []int{1, 2}
	_, reordered, err := prepareSingleModuleCommit(r)
	if err != nil {
		t.Fatal(err)
	}
	if first != reordered {
		t.Fatal("format or explicit pretest decision changed checked-content digest")
	}
	r.Modules[0].Questions[0].Prompt = json.RawMessage(`{"version":1,"nodes":[{"type":"paragraph","text":"Altered checked content"}]}`)
	_, changed, err := prepareSingleModuleCommit(r)
	if err != nil {
		t.Fatal(err)
	}
	if first == changed {
		t.Fatal("changed prompt did not change content binding")
	}
}
