package attempts

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// Validation limits mirror the Rust V2 engine.
const (
	MaxBatchCommands   = 100
	MaxWriteIDLen      = 64
	MaxQuestionIDLen   = 255
	MaxSessionLen      = 36
	MaxReasonLen       = 500
	MaxSubmissionIDLen = 64
	MaxAttemptIDLen    = 64
	MaxPayloadBytes    = 256 << 10
	MaxDepth           = 32
	MaxArrayLen        = 512
	MaxObjectKeys      = 256
	MaxStringLen       = 64 << 10
	// Response-aggregate shape caps shared by the V2 engine and the SAT
	// delivery save path (eliminated options + annotations).
	MaxEliminatedOptions = 16
	MaxEliminatedLen     = 64
	MaxAnnotations       = 64
	MaxAnnotationIDLen   = 255
	MaxAnnotationKindLen = 64
	MaxAnnotationTextLen = 8 << 10
)

func identErr(field string) *apperrors.Error {
	return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: fmt.Sprintf("Invalid %s.", field), HTTPStatus: 400}
}

// ValidateAttemptID checks ident shape.
func ValidateAttemptID(id string) error {
	if id == "" || len(id) > MaxAttemptIDLen {
		return identErr("attempt id")
	}
	return nil
}

// ValidateSaveEnvelope checks the batch envelope.
func ValidateSaveEnvelope(cmd SaveResponsesCommand) error {
	if err := ValidateAttemptID(cmd.AttemptID); err != nil {
		return err
	}
	if cmd.LeaseEpoch == 0 || cmd.ControlEpoch == 0 {
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Lease and control epochs must be positive.", HTTPStatus: 400}
	}
	if len(cmd.Commands) > MaxBatchCommands {
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Too many commands in batch.", HTTPStatus: 400}
	}
	// I2: duplicate write IDs within one batch can never be intentional
	// (clients mint UUIDs) and would otherwise insert-or-conflict against
	// itself mid-tx. Fail closed at the envelope, before any tx begins.
	seen := make(map[string]struct{}, len(cmd.Commands))
	for _, c := range cmd.Commands {
		if _, dup := seen[c.WriteID]; dup {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Duplicate write id in batch.", HTTPStatus: 400}
		}
		seen[c.WriteID] = struct{}{}
	}
	for _, c := range cmd.Commands {
		if err := ValidateCommand(c); err != nil {
			return err
		}
	}
	return nil
}

// ValidateCommand checks one response command.
func ValidateCommand(c ResponseCommand) error {
	if c.WriteID == "" || len(c.WriteID) > MaxWriteIDLen {
		return identErr("write id")
	}
	if c.QuestionID == "" || len(c.QuestionID) > MaxQuestionIDLen {
		return identErr("question id")
	}
	if c.ClientVersion == 0 {
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "clientVersion must be positive.", HTTPStatus: 400}
	}
	if err := ValidatePayload(c.Response); err != nil {
		return err
	}
	return nil
}

// ValidatePayload enforces size/depth/shape rules on the response aggregate.
func ValidatePayload(p ResponsePayload) error {
	if len(p.EliminatedOptions) > MaxEliminatedOptions {
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Too many eliminated options.", HTTPStatus: 400}
	}
	for _, o := range p.EliminatedOptions {
		if o == "" || len(o) > MaxEliminatedLen {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Invalid eliminated option.", HTTPStatus: 400}
		}
	}
	if len(p.Annotations) > MaxAnnotations {
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Too many annotations.", HTTPStatus: 400}
	}
	for _, a := range p.Annotations {
		if a.Kind == "sat_annotations" {
			if err := validateSATAnnotations(a); err != nil {
				return err
			}
		}
		if a.ID == "" || len(a.ID) > MaxAnnotationIDLen {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Annotation id is required.", HTTPStatus: 400}
		}
		if a.Kind == "" || len(a.Kind) > MaxAnnotationKindLen {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Annotation kind is required.", HTTPStatus: 400}
		}
		if len(a.Text) > MaxAnnotationTextLen {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Annotation text too large.", HTTPStatus: 400}
		}
	}
	if p.Answer != nil {
		if err := checkValue(p.Answer, 0); err != nil {
			return err
		}
	}
	return nil
}

// validSATHighlightColor reports whether a stored highlight ink is known.
// An empty string is valid and means the default ink (yellow), so payloads
// written before colors existed keep saving unchanged.
func validSATHighlightColor(color string) bool {
	switch color {
	case "", "yellow", "blue", "pink":
		return true
	default:
		return false
	}
}

func validateSATAnnotations(a Annotation) error {
	invalid := func() error {
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Invalid SAT annotations.", HTTPStatus: 400}
	}
	units := func(s string) int { return len(utf16.Encode([]rune(s))) }
	if a.ID != "sat-annotations" || a.Version != 2 || len(a.Annotations) > 200 || units(a.LegacyQuestionNote) > 2000 {
		return invalid()
	}
	seen := map[string]bool{}
	for _, item := range a.Annotations {
		anchor := item.Anchor
		if item.ID == "" || len(item.ID) > 80 || seen[item.ID] || (item.Kind != "highlight" && item.Kind != "underline") {
			return invalid()
		}
		// Color only means something on a highlight; an underline carrying ink
		// is a malformed producer, not a different mark.
		if !validSATHighlightColor(item.Color) || (item.Color != "" && item.Kind != "highlight") {
			return invalid()
		}
		seen[item.ID] = true
		if strings.TrimSpace(anchor.NodeID) == "" || len(anchor.NodeID) > 1024 || anchor.StartOffset < 0 || anchor.EndOffset <= anchor.StartOffset || anchor.Exact == "" || units(anchor.Exact) > 2000 || units(anchor.Prefix) > 64 || units(anchor.Suffix) > 64 || units(item.Note) > 2000 {
			return invalid()
		}
		if _, err := time.Parse(time.RFC3339Nano, item.CreatedAt); err != nil {
			return invalid()
		}
		if _, err := time.Parse(time.RFC3339Nano, item.UpdatedAt); err != nil {
			return invalid()
		}
	}
	return nil
}

func checkValue(v any, depth int) error {
	if depth > MaxDepth {
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Response payload too deep.", HTTPStatus: 400}
	}
	switch t := v.(type) {
	case nil, bool, float64, int, int64, json.Number:
		return nil
	case string:
		if len(t) > MaxStringLen {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Response string too large.", HTTPStatus: 400}
		}
		for _, r := range t {
			if r < 0x20 && r != '\n' && r != '\r' && r != '\t' {
				return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Response contains control characters.", HTTPStatus: 400}
			}
		}
		if !utf8.ValidString(t) {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Response is not valid UTF-8.", HTTPStatus: 400}
		}
		return nil
	case []any:
		if len(t) > MaxArrayLen {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Response array too large.", HTTPStatus: 400}
		}
		for _, e := range t {
			if err := checkValue(e, depth+1); err != nil {
				return err
			}
		}
		return nil
	case map[string]any:
		if len(t) > MaxObjectKeys {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Response object too large.", HTTPStatus: 400}
		}
		for k, e := range t {
			if len(k) > MaxStringLen {
				return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Response key too large.", HTTPStatus: 400}
			}
			if err := checkValue(e, depth+1); err != nil {
				return err
			}
		}
		return nil
	default:
		if strings.HasPrefix(fmt.Sprintf("%T", v), "[]") {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Invalid response value.", HTTPStatus: 400}
		}
		return nil
	}
}
