package satscoring

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strconv"
	"sync"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/satconvert"
	"example.com/ielts-proctoring/internal/satpublish"
)

// ModuleRaw is one administered module's persisted score.
type ModuleRaw struct {
	Role string // satpublish.RoleBase | RoleLower | RoleHigher
	Raw  int
	Ops  int
}

// ResolveSection converts one section from its administered modules: the
// topology comes from the roles, a full topology reads the matrix at
// (Module 1 raw, Module 2 raw) and a standalone Module 2 reads its 1D table.
func ResolveSection(c *satconvert.Content, section string, mods []ModuleRaw) (satconvert.Topology, satconvert.Score, bool) {
	roles := make([]string, len(mods))
	for i, m := range mods {
		roles[i] = m.Role
	}
	topo, ok := satconvert.TopologyOf(roles)
	if !ok {
		return "", satconvert.Score{}, false
	}
	var base, branch ModuleRaw
	for _, m := range mods {
		if m.Role == satpublish.RoleBase {
			base = m
		} else {
			branch = m
		}
	}
	score, ok := c.Resolve(section, topo, base.Raw, base.Ops, branch.Raw, branch.Ops)
	return topo, score, ok
}

// Module1QualifiedKey is the classroomRaw section flag, recorded at seal for a
// plan that fixes the Module 2 branch: false when the student's Module 1 raw
// score did not meet the section threshold for that branch.
const Module1QualifiedKey = "module1Qualified"

// SectionQualified reports whether a section may be converted. A section
// without the flag (full adaptive, standalone M2, or sealed before the flag
// existed) qualifies.
func SectionQualified(section map[string]any) bool {
	v, ok := section[Module1QualifiedKey].(bool)
	return !ok || v
}

func toInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), n == float64(int(n))
	case int:
		return n, true
	case int64:
		return int(n), true
	case json.Number:
		i, err := n.Int64()
		return int(i), err == nil
	}
	return 0, false
}

// sectionModules reads one classroomRaw section's modules; ok is false when
// the shape is not the persisted one (the section is then unavailable).
func sectionModules(section map[string]any) ([]ModuleRaw, bool) {
	var list []any
	switch m := section["modules"].(type) {
	case []any:
		list = m
	case []map[string]any:
		for _, e := range m {
			list = append(list, e)
		}
	default:
		return nil, false
	}
	out := make([]ModuleRaw, 0, len(list))
	for _, e := range list {
		mod, _ := e.(map[string]any)
		key, _ := mod["moduleKey"].(string)
		raw, okRaw := toInt(mod["rawCorrect"])
		ops, okOps := toInt(mod["total"])
		if !okRaw || !okOps {
			return nil, false
		}
		out = append(out, ModuleRaw{Role: satpublish.RoleOfModuleKey(key), Raw: raw, Ops: ops})
	}
	return out, len(out) > 0
}

// stripConversion removes every conversion field so none survives from an
// earlier (per-exam) conversion or from a revision that cannot be trusted.
func stripConversion(raw map[string]any) {
	delete(raw, "conversion")
	delete(raw, "totalScaled")
	for _, s := range sectionList(raw) {
		delete(s, "scaled")
		delete(s, "topology")
		delete(s, "conversionStatus")
	}
}

func sectionList(raw map[string]any) []map[string]any {
	var out []map[string]any
	switch list := raw["sections"].(type) {
	case []any:
		for _, e := range list {
			if m, ok := e.(map[string]any); ok {
				out = append(out, m)
			}
		}
	case []map[string]any:
		out = list
	}
	return out
}

// Overlay resolves payload["classroomRaw"] against the active revision, in
// place. It changes only the caller-owned response payload; the caller must
// still enforce its release gates before exposing that payload:
//
//   - no classroomRaw (withheld / pending / invalidated): untouched (INV-4);
//   - no active revision: untouched, so previously stored scores stay visible
//     until the first publish;
//   - an active revision: every conversion field is recomputed from the
//     persisted module raw scores (INV-3) and anything that cannot be
//     converted is marked unavailable, never invented;
//   - an unreadable or corrupted revision: conversion fields are removed so
//     the report degrades to raw-only, and a metric records why.
func Overlay(ctx context.Context, q Queryer, payload map[string]any) {
	raw, _ := payload["classroomRaw"].(map[string]any)
	if raw == nil {
		return
	}
	active, err := ActiveRevision(ctx, q)
	if err != nil {
		stripConversion(raw)
		status := "error"
		if errors.Is(err, ErrIntegrity) {
			status = "integrity"
		}
		telemetry.IncCounter(telemetry.MSATScoreConversionOverlayTotal, "status", status)
		logDegraded(status, err)
		return
	}
	if active == nil {
		telemetry.IncCounter(telemetry.MSATScoreConversionOverlayTotal, "status", "no_policy")
		return
	}
	ApplyRevision(active, raw)
	status := "unavailable"
	if _, ok := raw["totalScaled"]; ok {
		status = "converted"
	} else {
		for _, s := range sectionList(raw) {
			if s["conversionStatus"] == "converted" {
				status = "converted"
			}
		}
	}
	telemetry.IncCounter(telemetry.MSATScoreConversionOverlayTotal, "status", status)
}

var degradedLog = struct {
	sync.Mutex
	last time.Time
}{}

// logDegraded logs at most once every 30 seconds: a corrupted or unreachable policy
// degrades EVERY result read, and one log line per read would bury the signal. The
// counter (status integrity/error) still records every occurrence.
func logDegraded(status string, err error) {
	degradedLog.Lock()
	defer degradedLog.Unlock()
	if time.Since(degradedLog.last) < 30*time.Second {
		return
	}
	degradedLog.last = time.Now()
	log.Printf("satscoring: overlay degraded to raw-only (%s): %v", status, err)
}

// ApplyRevision writes the conversion of one classroomRaw object from rev.
func ApplyRevision(rev *Revision, raw map[string]any) {
	stripConversion(raw)
	raw["conversion"] = map[string]any{
		"converterVersion":  ConverterVersion(rev),
		"scoreType":         satconvert.ScoreType,
		"calibrationSource": rev.CalibrationSource,
	}
	converted := map[string]*satconvert.Score{}
	topologies := map[string]satconvert.Topology{}
	for _, section := range sectionList(raw) {
		key, _ := section["sectionKey"].(string)
		section["conversionStatus"] = "unavailable"
		mods, ok := sectionModules(section)
		if !ok {
			continue
		}
		topo, score, ok := ResolveSection(rev.Content, key, mods)
		if topo != "" {
			section["topology"] = string(topo)
		}
		if !ok || !SectionQualified(section) {
			continue
		}
		section["conversionStatus"] = "converted"
		section["scaled"] = score
		converted[key], topologies[key] = &score, topo
	}
	rw, math := satconvert.SectionReadingWriting, satconvert.SectionMath
	if total, ok := satconvert.Total(converted[rw], converted[math], topologies[rw], topologies[math]); ok {
		raw["totalScaled"] = total
	}
}

// ConverterVersion is the stable label shown next to a converted score.
func ConverterVersion(rev *Revision) string {
	if rev.RevisionNumber == nil {
		return "sat-global-draft"
	}
	return "sat-global-v" + strconv.Itoa(*rev.RevisionNumber)
}
