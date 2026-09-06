// Package attempts implements the V2-only student response protocol.
// Provider-neutral core: writer lease, control fencing, response ordering,
// idempotent commands, server revision, projection, mutation ledger,
// deadline/grace writability, snapshot recovery, final digest (plan 15).
package attempts

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
)

// HashAlgorithm is fixed and versioned (plan 19). Never silently switch.
const HashAlgorithm = "sha256-canonicaljson-v1"

// canonicalValue renders v with deterministic object key ordering so hashes
// are stable across languages. Numbers use encoding/json canonical form.
func canonicalValue(v any) ([]byte, error) {
	return marshalCanonical(v)
}

func marshalCanonical(v any) ([]byte, error) {
	switch t := v.(type) {
	case nil:
		return []byte("null"), nil
	case bool:
		if t {
			return []byte("true"), nil
		}
		return []byte("false"), nil
	case string:
		return json.Marshal(t)
	case float64:
		return json.Marshal(t)
	case json.Number:
		return []byte(t.String()), nil
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return json.Marshal(t)
	case []any:
		var buf bytes.Buffer
		buf.WriteByte('[')
		for i, e := range t {
			if i > 0 {
				buf.WriteByte(',')
			}
			b, err := marshalCanonical(e)
			if err != nil {
				return nil, err
			}
			buf.Write(b)
		}
		buf.WriteByte(']')
		return buf.Bytes(), nil
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var buf bytes.Buffer
		buf.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			kb, err := json.Marshal(k)
			if err != nil {
				return nil, err
			}
			buf.Write(kb)
			buf.WriteByte(':')
			vb, err := marshalCanonical(t[k])
			if err != nil {
				return nil, err
			}
			buf.Write(vb)
		}
		buf.WriteByte('}')
		return buf.Bytes(), nil
	default:
		// Normalize via JSON round-trip (decodes objects to map[string]any
		// with json.Number preserved) so structs/maps order identically.
		raw, err := json.Marshal(v)
		if err != nil {
			return nil, err
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		var nv any
		if err := dec.Decode(&nv); err != nil {
			return nil, err
		}
		return marshalCanonical(nv)
	}
}

// CanonicalJSON returns deterministic bytes for hashing.
func CanonicalJSON(v any) ([]byte, error) { return canonicalValue(v) }

// HashResponse returns hex(sha256(canonicalJSON(payload))).
func HashResponse(payload any) (string, error) {
	b, err := CanonicalJSON(payload)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}

// FinalDigest computes the submit digest over sorted question/hash pairs
// (plan 19.6): sha256 of canonical JSON of [[questionID, hash]...] sorted.
func FinalDigest(questionHashes map[string]string) (string, error) {
	if len(questionHashes) == 0 {
		return "", fmt.Errorf("empty response set")
	}
	ids := make([]string, 0, len(questionHashes))
	for id := range questionHashes {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	pairs := make([]any, 0, len(ids))
	for _, id := range ids {
		pairs = append(pairs, []any{id, questionHashes[id]})
	}
	b, err := CanonicalJSON(pairs)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}
