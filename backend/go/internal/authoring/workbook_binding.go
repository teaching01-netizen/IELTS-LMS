package authoring

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
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

func workbookContentDigest(targets []string, modules []SatWorkbookModuleDraft) (string, error) {
	content := make([]SatWorkbookModuleDraft, len(modules))
	for i, module := range modules {
		content[i] = module
		content[i].Questions = append([]QuestionDraft(nil), module.Questions...)
		for j := range content[i].Questions {
			question := &content[i].Questions[j]
			metadata, err := normalizeSATQuestionMetadata(question.Metadata)
			if err != nil {
				return "", err
			}
			question.Metadata = metadata
		}
	}
	hash, err := canonicalWorkbookFingerprint(struct {
		Targets []string                 `json:"targets"`
		Modules []SatWorkbookModuleDraft `json:"modules"`
	}{targets, content})
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

func prepareWorkbookCommit(request SatWorkbookCommitRequest) (SatWorkbookCommitRequest, string, error) {
	targets, err := canonicalWorkbookTargets(request.TargetModuleKeys)
	if err != nil {
		return request, "", validationError(err.Error())
	}
	if len(request.Modules) != len(targets) {
		return request, "", validationError("An import must contain exactly its detected modules.")
	}
	// Modules are sent in template order, matching the canonical target list.
	modules := append([]SatWorkbookModuleDraft(nil), request.Modules...)
	for i, key := range targets {
		spec := workbookModuleByLabel[key]
		if modules[i].ModuleKey != key {
			return request, "", validationError("An import must contain exactly its detected modules.")
		}
		if modules[i].SectionKey != spec.sectionKey || len(modules[i].Questions) != spec.count {
			return request, "", validationError(fmt.Sprintf("%s must have its complete question count and matching section.", spec.label))
		}
	}
	request.TargetModuleKeys, request.Modules = targets, modules
	digest, err := workbookContentDigest(targets, modules)
	return request, digest, err
}
