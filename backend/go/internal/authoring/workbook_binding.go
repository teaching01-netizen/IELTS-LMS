package authoring

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
)

// Canonical JSON preserves numeric tokens and sorts object keys, including
// nested rich documents. A browser reserializing the preview is equivalent.
func canonicalWorkbookFingerprint(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var decoded any
	if err := decoder.Decode(&decoded); err != nil {
		return "", err
	}
	canonical, err := json.Marshal(decoded)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:]), nil
}

func workbookContentDigest(target string, modules []SatWorkbookModuleDraft) (string, error) {
	content := make([]SatWorkbookModuleDraft, len(modules))
	for i, module := range modules {
		content[i] = module
		content[i].Questions = append([]QuestionDraft(nil), module.Questions...)
		for j := range content[i].Questions {
			question := &content[i].Questions[j]
			// Pretest resolution is an explicit separate decision, not content.
			question.IsPretest = false
			metadata, err := normalizeSATQuestionMetadata(question.Metadata)
			if err != nil {
				return "", err
			}
			question.Metadata = metadata
		}
	}
	hash, err := canonicalWorkbookFingerprint(struct {
		Target  string                   `json:"target"`
		Modules []SatWorkbookModuleDraft `json:"modules"`
	}{target, content})
	if err != nil {
		return "", err
	}
	return "v1:" + hash, nil
}

func previewWorkbookModules(preview SatWorkbookPreview) []SatWorkbookModuleDraft {
	modules := make([]SatWorkbookModuleDraft, len(preview.Modules))
	for i, module := range preview.Modules {
		modules[i] = SatWorkbookModuleDraft{ModuleKey: module.ModuleKey, SectionKey: module.SectionKey, Questions: make([]QuestionDraft, len(module.Questions))}
		for j, question := range module.Questions {
			modules[i].Questions[j] = question.QuestionDraft
		}
	}
	return modules
}

func prepareSingleModuleCommit(request SatWorkbookCommitRequest) (SatWorkbookCommitRequest, string, error) {
	opts, err := normalizeSATWorkbookOptions(SatWorkbookImportOptions{Mode: request.Mode, TargetModuleKey: request.TargetModuleKey})
	if err != nil {
		return request, "", validationError(err.Error())
	}
	if opts.Mode != "single_module" || len(request.Modules) != 1 || request.Modules[0].ModuleKey != opts.TargetModuleKey {
		return request, "", validationError("A single-module import must contain only its selected module.")
	}
	spec := workbookModuleByLabel[opts.TargetModuleKey]
	if request.Modules[0].SectionKey != spec.sectionKey || len(request.Modules[0].Questions) != spec.count {
		return request, "", validationError("The selected module must have its complete question count and matching section.")
	}
	resolution := request.PretestResolution
	if resolution == nil || !resolution.Confirmed || (resolution.DesignationSource != "source_verified" && resolution.DesignationSource != "staff_defined") || len(resolution.SelectedOrders) != 2 {
		return request, "", validationError("Explicitly confirm exactly two pretest orders and their designation source before importing.")
	}
	selected := append([]int(nil), resolution.SelectedOrders...)
	sort.Ints(selected)
	if selected[0] < 1 || selected[1] > spec.count || selected[0] == selected[1] {
		return request, "", validationError("Choose two distinct pretest orders within the selected module.")
	}
	request.Mode, request.TargetModuleKey = opts.Mode, opts.TargetModuleKey
	request.PretestResolution = &SatWorkbookPretestResolution{SelectedOrders: selected, DesignationSource: resolution.DesignationSource, Confirmed: true}
	request.Modules = append([]SatWorkbookModuleDraft(nil), request.Modules...)
	request.Modules[0].Questions = append([]QuestionDraft(nil), request.Modules[0].Questions...)
	for i := range request.Modules[0].Questions {
		request.Modules[0].Questions[i].IsPretest = i+1 == selected[0] || i+1 == selected[1]
	}
	digest, err := workbookContentDigest(opts.TargetModuleKey, request.Modules)
	return request, digest, err
}
