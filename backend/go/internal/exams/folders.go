// Package exams — SAT exam library folders (migration 0121).
//
// Organization metadata lives outside authored entity revisions: exam_folders
// holds the hierarchy, exam_folder_entries holds exam placement with its own
// revision/CAS. Missing entry = root revision 0; after the first move a row
// persists even when returned to root so history remains. exam_library_scopes
// is the per tenant/provider mutex row serialized before hierarchy or
// membership mutations to close cycle/duplicate TOCTOU windows.
//
// Offcut ceiling: one lock per library; split only if staff organization
// writes contend.
package exams

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Folder depth + bulk ceilings (product decisions).
const (
	MaxFolderDepth   = 32
	MaxMoveBulkItems = 500
)

// Folder is one exam_folders row projected with nullable org/parent.
type Folder struct {
	ID             string    `json:"id"`
	ScopeKey       string    `json:"scopeKey"`
	ProviderKey    string    `json:"providerKey"`
	OrganizationID *string   `json:"organizationId,omitempty"`
	ParentID       *string   `json:"parentId,omitempty"`
	Name           string    `json:"name"`
	Revision       int       `json:"revision"`
	CreatedBy      string    `json:"createdBy"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// FolderEntry is one exam_folder_entries row. Missing row = root revision 0.
type FolderEntry struct {
	ExamID   string  `json:"examId"`
	FolderID *string `json:"folderId,omitempty"`
	Revision int     `json:"revision"`
}

// ValidateFolderName enforces the product name rule: trimmed 1-255 Unicode
// runes, no control characters, no slash/backslash path separators, and the
// exact dot names "." / ".." are rejected (other dotted names are allowed).
func ValidateFolderName(raw string) error {
	name := strings.TrimSpace(raw)
	if name == "" {
		return validationError("Folder name is required.")
	}
	if utf8.RuneCountInString(name) > 255 {
		return validationError("Folder name must contain between 1 and 255 characters.")
	}
	if name == "." || name == ".." {
		return validationError("Folder name cannot be \".\" or \"..\".")
	}
	if strings.Contains(name, "/") || strings.Contains(name, "\\") {
		return validationError("Folder name cannot contain \"/\" or \"\\\".")
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return validationError("Folder name cannot contain control characters.")
		}
	}
	return nil
}

// LibraryScopeKey is the stable per tenant/provider mutex key. Admin
// platform scope (nil org) and a legitimate org named "platform" must never
// collide: the key is a tagged hash, not a raw sentinel. Nil/blank maps to
// "provider|platform:<hex>", an explicit org (case-sensitive, trimmed) maps
// to "provider|org:<hex>". Hex is collation-independent, so the default DB
// collation cannot merge distinct orgs.
func LibraryScopeKey(providerKey string, organizationID *string) string {
	p := NormalizeProviderKey(providerKey)
	if organizationID == nil || strings.TrimSpace(*organizationID) == "" {
		sum := sha256.Sum256([]byte("v1|platform|" + p))
		return fmt.Sprintf("%s|platform:%x", p, sum)
	}
	org := strings.TrimSpace(*organizationID)
	sum := sha256.Sum256([]byte("v1|org|" + p + "|" + org))
	return fmt.Sprintf("%s|org:%x", p, sum)
}

// parentKeyFor maps nullable parent_id to the NOT NULL sibling-uniqueness key.
func parentKeyFor(parentID *string) string {
	if parentID == nil || strings.TrimSpace(*parentID) == "" {
		return ""
	}
	return strings.TrimSpace(*parentID)
}

// scanFolder projects one exam_folders row.
func scanFolder(row interface {
	Scan(dest ...any) error
}) (Folder, error) {
	var f Folder
	var orgID, parentID sql.NullString
	if err := row.Scan(&f.ID, &f.ScopeKey, &f.ProviderKey, &orgID, &parentID, &f.Name, &f.Revision, &f.CreatedBy, &f.CreatedAt, &f.UpdatedAt); err != nil {
		return Folder{}, err
	}
	if orgID.Valid {
		v := orgID.String
		f.OrganizationID = &v
	}
	if parentID.Valid && strings.TrimSpace(parentID.String) != "" {
		v := strings.TrimSpace(parentID.String)
		f.ParentID = &v
	}
	return f, nil
}

// actorCanReadScope reports whether actor may see folders/entries of scope.
// Admins/admin_observers read all orgs; builders see only their own org.
func actorCanReadScope(actor auth.ActorContext, organizationID *string) bool {
	if actor.IsPlatformRead() {
		return true
	}
	if actor.Role != auth.RoleBuilder {
		return false
	}
	if actor.OrgID == nil || organizationID == nil {
		return false
	}
	return strings.TrimSpace(*actor.OrgID) == strings.TrimSpace(*organizationID)
}

// lockLibraryScopeTx inserts the mutex row when absent and takes it FOR UPDATE.
// Writers use READ COMMITTED: scope resolution before this lock must not pin
// an older snapshot for the hierarchy and occupancy checks after it.
func lockLibraryScopeTx(ctx context.Context, q tx.Tx, scopeKey, providerKey string, organizationID *string) error {
	var org any
	if organizationID != nil && strings.TrimSpace(*organizationID) != "" {
		org = strings.TrimSpace(*organizationID)
	}
	// Claim an exclusive lock directly. INSERT IGNORE would take shared locks
	// on a duplicate and deadlock concurrent writers upgrading to FOR UPDATE.
	if _, err := q.ExecContext(ctx, "INSERT INTO exam_library_scopes (scope_key, provider_key, organization_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE scope_key = scope_key", scopeKey, NormalizeProviderKey(providerKey), org); err != nil {
		return err
	}
	var locked string
	if err := q.QueryRowContext(ctx, "SELECT scope_key FROM exam_library_scopes WHERE scope_key = ? FOR UPDATE", scopeKey).Scan(&locked); err != nil {
		if err == sql.ErrNoRows {
			return notFoundError("Exam library scope not found.")
		}
		return err
	}
	return nil
}

// folderDepthInTx walks parent pointers up to MaxFolderDepth; depth of a root
// folder is 1. It returns the depth and an error when the chain is broken.
// Locking reads (FOR UPDATE) see the latest committed parents after waiting
// for the library mutex, so concurrent reciprocal moves cannot splice a cycle
// from a stale REPEATABLE-READ snapshot.
func folderDepthInTx(ctx context.Context, q tx.Tx, folderID string) (int, error) {
	depth := 0
	current := folderID
	for i := 0; i < MaxFolderDepth+1; i++ {
		var parent sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT parent_id FROM exam_folders WHERE id = ? FOR UPDATE", current).Scan(&parent); err != nil {
			if err == sql.ErrNoRows {
				return 0, notFoundError("Folder not found.")
			}
			return 0, err
		}
		depth++
		if !parent.Valid || strings.TrimSpace(parent.String) == "" {
			return depth, nil
		}
		current = strings.TrimSpace(parent.String)
	}
	return depth, validationError("Folder nesting exceeds the maximum depth.")
}

// subtreeHeightInTx returns the longest root-to-leaf chain length inside the
// subtree rooted at folderID (1 = leaf). Scoped reads keep it small.
func subtreeHeightInTx(ctx context.Context, q tx.Tx, scopeKey, folderID string) (int, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, parent_id FROM exam_folders WHERE scope_key = ?", scopeKey)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	children := map[string][]string{}
	for rows.Next() {
		var id string
		var parent sql.NullString
		if err := rows.Scan(&id, &parent); err != nil {
			return 0, err
		}
		if parent.Valid && strings.TrimSpace(parent.String) != "" {
			children[strings.TrimSpace(parent.String)] = append(children[strings.TrimSpace(parent.String)], id)
		}
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	var height func(id string) int
	height = func(id string) int {
		best := 1
		for _, child := range children[id] {
			if h := 1 + height(child); h > best {
				best = h
			}
		}
		return best
	}
	return height(folderID), nil
}

// isDescendantInTx reports whether candidate is inside ancestor's subtree.
// Locking reads see the latest committed parents after the library mutex.
func isDescendantInTx(ctx context.Context, q tx.Tx, scopeKey, ancestorID, candidateID string) (bool, error) {
	current := candidateID
	for i := 0; i < MaxFolderDepth+1; i++ {
		if current == ancestorID {
			return true, nil
		}
		var parent sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT parent_id FROM exam_folders WHERE id = ? AND scope_key = ? FOR UPDATE", current, scopeKey).Scan(&parent); err != nil {
			if err == sql.ErrNoRows {
				return false, notFoundError("Folder not found.")
			}
			return false, err
		}
		if !parent.Valid || strings.TrimSpace(parent.String) == "" {
			return false, nil
		}
		current = strings.TrimSpace(parent.String)
	}
	return false, validationError("Folder nesting exceeds the maximum depth.")
}

// ListLibraryForActor returns folders + explicit membership entries visible to
// the actor. Missing entry = root. Never leaks other tenants: builders are
// fenced to their own scope, admins read the provider slice.
func (s *Service) ListLibraryForActor(ctx context.Context, actor auth.ActorContext, providerKey string) ([]Folder, []FolderEntry, error) {
	if err := requireReadActor(actor); err != nil {
		return nil, nil, err
	}
	p := NormalizeProviderKey(providerKey)
	if p != ProviderSAT {
		return nil, nil, validationError("Exam library folders are available for SAT only.")
	}
	var folders []Folder
	var entries []FolderEntry
	// Consistent snapshot: folders + entries read in one read-only transaction
	// so a concurrent move cannot splice a folder list with orphan entries.
	err := s.runner.WithTxReadOnly(ctx, func(ctx context.Context, q tx.Tx) error {
		if actor.IsPlatformRead() {
			rows, qerr := q.QueryContext(ctx, "SELECT id, scope_key, provider_key, organization_id, parent_id, name, revision, created_by, created_at, updated_at FROM exam_folders WHERE provider_key = ? ORDER BY name ASC, id ASC", p)
			if qerr != nil {
				return qerr
			}
			defer rows.Close()
			for rows.Next() {
				f, serr := scanFolder(rows)
				if serr != nil {
					return serr
				}
				folders = append(folders, f)
			}
			if err := rows.Err(); err != nil {
				return err
			}
		} else {
			if actor.Role != auth.RoleBuilder || actor.OrgID == nil || strings.TrimSpace(*actor.OrgID) == "" {
				folders = []Folder{}
				entries = []FolderEntry{}
				return nil
			}
			scope := LibraryScopeKey(p, actor.OrgID)
			rows, qerr := q.QueryContext(ctx, "SELECT id, scope_key, provider_key, organization_id, parent_id, name, revision, created_by, created_at, updated_at FROM exam_folders WHERE scope_key = ? ORDER BY name ASC, id ASC", scope)
			if qerr != nil {
				return qerr
			}
			defer rows.Close()
			for rows.Next() {
				f, serr := scanFolder(rows)
				if serr != nil {
					return serr
				}
				folders = append(folders, f)
			}
			if err := rows.Err(); err != nil {
				return err
			}
		}
		// Membership rows join authorized SAT exams only.
		query := "SELECT e.exam_id, e.folder_id, e.revision FROM exam_folder_entries e JOIN exam_entities en ON en.id = e.exam_id WHERE en.provider_key = ?"
		args := []any{p}
		scope, scopeArgs := actorExamScope(actor)
		query += scope
		args = append(args, scopeArgs...)
		query += " ORDER BY e.exam_id ASC"
		rows, qerr := q.QueryContext(ctx, query, args...)
		if qerr != nil {
			return qerr
		}
		defer rows.Close()
		entries = []FolderEntry{}
		for rows.Next() {
			var examID string
			var folderID sql.NullString
			var rev int
			if err := rows.Scan(&examID, &folderID, &rev); err != nil {
				return err
			}
			en := FolderEntry{ExamID: examID, Revision: rev}
			if folderID.Valid && strings.TrimSpace(folderID.String) != "" {
				v := strings.TrimSpace(folderID.String)
				en.FolderID = &v
			}
			entries = append(entries, en)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, nil, err
	}
	if folders == nil {
		folders = []Folder{}
	}
	if entries == nil {
		entries = []FolderEntry{}
	}
	return folders, entries, nil
}

// CreateFolderRequest is the service-level input for folder creation.
type CreateFolderRequest struct {
	ProviderKey   string
	Name          string
	ParentID      *string
	ContextExamID *string
	OperationKey  string
}

// CreateFolderForActor creates a root or nested folder. Root scope is
// actor-derived (admin nil, builder its org); child scope derives from the
// authorized parent, never from client organization input.
func (s *Service) CreateFolderForActor(ctx context.Context, actor auth.ActorContext, req CreateFolderRequest) (Folder, error) {
	if err := requireWriteActor(actor); err != nil {
		return Folder{}, err
	}
	if NormalizeProviderKey(req.ProviderKey) != ProviderSAT {
		return Folder{}, validationError("Exam library folders are available for SAT only.")
	}
	if err := ValidateFolderName(req.Name); err != nil {
		return Folder{}, err
	}
	name := strings.TrimSpace(req.Name)
	opKey := strings.TrimSpace(req.OperationKey)
	if len(opKey) > 128 {
		return Folder{}, validationError("operationKey must contain between 1 and 128 characters.")
	}
	provider := NormalizeProviderKey(req.ProviderKey)

	// Resolve scope + parent outside the mutex first (fail fast on auth).
	var scopeKey string
	var scopeOrg *string
	if req.ParentID != nil && strings.TrimSpace(*req.ParentID) != "" {
		parentID := strings.TrimSpace(*req.ParentID)
		row := s.db.QueryRowContext(ctx, "SELECT id, scope_key, provider_key, organization_id, parent_id, name, revision, created_by, created_at, updated_at FROM exam_folders WHERE id = ?", parentID)
		parent, err := scanFolder(row)
		if err != nil {
			if err == sql.ErrNoRows {
				return Folder{}, notFoundError("Folder not found.")
			}
			return Folder{}, err
		}
		if NormalizeProviderKey(parent.ProviderKey) != provider {
			return Folder{}, notFoundError("Folder not found.")
		}
		if !actorCanReadScope(actor, parent.OrganizationID) {
			return Folder{}, notFoundError("Folder not found.")
		}
		req.ParentID = &parent.ID
		scopeKey = parent.ScopeKey
		scopeOrg = parent.OrganizationID
	} else {
		if req.ContextExamID != nil && strings.TrimSpace(*req.ContextExamID) != "" {
			exam, err := s.GetForActor(ctx, actor, strings.TrimSpace(*req.ContextExamID))
			if err != nil {
				return Folder{}, err
			}
			if NormalizeProviderKey(exam.ProviderKey) != provider {
				return Folder{}, validationError("Context exam must be a SAT exam.")
			}
			scopeOrg = exam.OrganizationID
			scopeKey = LibraryScopeKey(provider, scopeOrg)
		} else {
			if actor.IsPlatformRead() && actor.Role == auth.RoleAdmin {
				scopeKey = LibraryScopeKey(provider, nil)
				scopeOrg = nil
			} else {
				if actor.OrgID == nil || strings.TrimSpace(*actor.OrgID) == "" {
					return Folder{}, notFoundError("Exam organization not found.")
				}
				org := strings.TrimSpace(*actor.OrgID)
				scopeOrg = &org
				scopeKey = LibraryScopeKey(provider, scopeOrg)
			}

		}
	}

	var created Folder
	err := s.runner.WithTxRC(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := lockLibraryScopeTx(ctx, q, scopeKey, provider, scopeOrg); err != nil {
			return err
		}
		if opKey != "" {
			fingerprintRaw, _ := json.Marshal(map[string]any{"scope": scopeKey, "parent": parentKeyFor(req.ParentID), "name": name})
			sum := folderFingerprint(string(fingerprintRaw))
			replay, claimed, err := claimExamOperationKey(ctx, q, strings.TrimSpace(actor.UserID), "exam-folder-create", opKey, sum)
			if err != nil {
				return err
			}
			if !claimed {
				if len(replay) == 0 {
					return conflictError("This folder creation is still being processed; retry with the same operation key.")
				}
				var replayed Folder
				if err := json.Unmarshal(replay, &replayed); err != nil {
					return err
				}
				created = replayed
				return nil
			}
		}
		var parentID *string
		parentKey := ""
		if req.ParentID != nil && strings.TrimSpace(*req.ParentID) != "" {
			pid := strings.TrimSpace(*req.ParentID)
			var prowScope, prowProvider string
			var prowOrg sql.NullString
			if err := q.QueryRowContext(ctx, "SELECT scope_key, provider_key, organization_id FROM exam_folders WHERE id = ? FOR UPDATE", pid).Scan(&prowScope, &prowProvider, &prowOrg); err != nil {
				if err == sql.ErrNoRows {
					return notFoundError("Folder not found.")
				}
				return err
			}
			if prowScope != scopeKey || NormalizeProviderKey(prowProvider) != provider {
				return notFoundError("Folder not found.")
			}
			depth, err := folderDepthInTx(ctx, q, pid)
			if err != nil {
				return err
			}
			if depth+1 > MaxFolderDepth {
				return validationError("Folder nesting exceeds the maximum depth.")
			}
			parentID = &pid
			parentKey = pid
			if !actorCanReadScope(actor, nullToPtr(prowOrg)) {
				return notFoundError("Folder not found.")
			}
		}
		// Case-insensitive sibling uniqueness including root.
		var clash int
		if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM exam_folders WHERE scope_key = ? AND parent_key = ? AND LOWER(name) = LOWER(?)", scopeKey, parentKey, name).Scan(&clash); err != nil {
			return err
		}
		if clash > 0 {
			return conflictError("A folder with this name already exists here.")
		}
		id := uuid.NewString()
		var orgArg any
		if scopeOrg != nil {
			orgArg = *scopeOrg
		}
		var parentArg any
		if parentID != nil {
			parentArg = *parentID
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO exam_folders (id, scope_key, provider_key, organization_id, parent_id, name, created_by, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 0)", id, scopeKey, provider, orgArg, parentArg, name, strings.TrimSpace(actor.UserID)); err != nil {
			if isDuplicateKey(err) {
				return conflictError("A folder with this name already exists here.")
			}
			return err
		}
		row := q.QueryRowContext(ctx, "SELECT id, scope_key, provider_key, organization_id, parent_id, name, revision, created_by, created_at, updated_at FROM exam_folders WHERE id = ?", id)
		f, err := scanFolder(row)
		if err != nil {
			return err
		}
		created = f
		if opKey != "" {
			raw, err := json.Marshal(created)
			if err != nil {
				return err
			}
			if _, err := q.ExecContext(ctx, "UPDATE authoring_operation_keys SET result_json = ? WHERE actor_id = ? AND scope = ? AND operation_key = ?", string(raw), strings.TrimSpace(actor.UserID), "exam-folder-create", opKey); err != nil {
				return err
			}
		}
		return nil
	})
	return created, err
}

// RenameFolderForActor renames a folder under revision fencing.
func (s *Service) RenameFolderForActor(ctx context.Context, actor auth.ActorContext, folderID, name string, revision int) (Folder, error) {
	if err := requireWriteActor(actor); err != nil {
		return Folder{}, err
	}
	if err := ValidateFolderName(name); err != nil {
		return Folder{}, err
	}
	trimmed := strings.TrimSpace(name)
	var out Folder
	err := s.runner.WithTxRC(ctx, func(ctx context.Context, q tx.Tx) error {
		// Resolve scope without locks, acquire the per-library mutex first,
		// then re-read and lock the resource. Consistent scope-first ordering
		// across every folder writer avoids the folder/scope lock inversion.
		var scopeKey, provider string
		var org sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT scope_key, provider_key, organization_id FROM exam_folders WHERE id = ?", strings.TrimSpace(folderID)).Scan(&scopeKey, &provider, &org); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Folder not found.")
			}
			return err
		}
		if NormalizeProviderKey(provider) != ProviderSAT {
			return notFoundError("Folder not found.")
		}
		if !actorCanReadScope(actor, nullToPtr(org)) {
			return notFoundError("Folder not found.")
		}
		if err := lockLibraryScopeTx(ctx, q, scopeKey, provider, nullToPtr(org)); err != nil {
			return err
		}
		var currentRev int
		var parentKey string
		var currentName string
		if err := q.QueryRowContext(ctx, "SELECT revision, parent_key, name FROM exam_folders WHERE id = ? FOR UPDATE", strings.TrimSpace(folderID)).Scan(&currentRev, &parentKey, &currentName); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Folder not found.")
			}
			return err
		}
		if currentRev != revision {
			return conflictError("Folder changed while you were editing; refresh before retrying.")
		}
		if !strings.EqualFold(currentName, trimmed) {
			var clash int
			if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM exam_folders WHERE scope_key = ? AND parent_key = ? AND LOWER(name) = LOWER(?) AND id <> ?", scopeKey, parentKey, trimmed, strings.TrimSpace(folderID)).Scan(&clash); err != nil {
				return err
			}
			if clash > 0 {
				return conflictError("A folder with this name already exists here.")
			}
		}
		res, err := q.ExecContext(ctx, "UPDATE exam_folders SET name = ?, revision = revision + 1 WHERE id = ? AND revision = ?", trimmed, strings.TrimSpace(folderID), revision)
		if err != nil {
			if isDuplicateKey(err) {
				return conflictError("A folder with this name already exists here.")
			}
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return conflictError("Folder changed while you were editing; refresh before retrying.")
		}
		row := q.QueryRowContext(ctx, "SELECT id, scope_key, provider_key, organization_id, parent_id, name, revision, created_by, created_at, updated_at FROM exam_folders WHERE id = ?", strings.TrimSpace(folderID))
		f, err := scanFolder(row)
		if err != nil {
			return err
		}
		out = f
		return nil
	})
	return out, err
}

// MoveFolderRequest changes a folder's parent (nil = root) under fencing.
type MoveFolderRequest struct {
	ParentID *string
	Revision int
}

// MoveFolderForActor reparents a folder; parent change only, descendants stay.
func (s *Service) MoveFolderForActor(ctx context.Context, actor auth.ActorContext, folderID string, req MoveFolderRequest) (Folder, error) {
	if err := requireWriteActor(actor); err != nil {
		return Folder{}, err
	}
	fid := strings.TrimSpace(folderID)
	var targetParent *string
	if req.ParentID != nil && strings.TrimSpace(*req.ParentID) != "" {
		v := strings.TrimSpace(*req.ParentID)
		targetParent = &v
	}
	if targetParent != nil && *targetParent == fid {
		return Folder{}, validationError("A folder cannot be moved into itself.")
	}
	var out Folder
	err := s.runner.WithTxRC(ctx, func(ctx context.Context, q tx.Tx) error {
		// Scope-first ordering: resolve scope without locks, lock the library,
		// then lock resources. Never hold a folder lock while acquiring the
		// scope mutex; never lock a cross-scope target.
		var scopeKey, provider string
		var org sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT id, scope_key, provider_key, organization_id FROM exam_folders WHERE id = ?", fid).Scan(&fid, &scopeKey, &provider, &org); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Folder not found.")
			}
			return err
		}
		if NormalizeProviderKey(provider) != ProviderSAT {
			return notFoundError("Folder not found.")
		}
		if !actorCanReadScope(actor, nullToPtr(org)) {
			return notFoundError("Folder not found.")
		}
		if targetParent != nil {
			var tScope, tProvider string
			var tOrg sql.NullString
			if err := q.QueryRowContext(ctx, "SELECT id, scope_key, provider_key, organization_id FROM exam_folders WHERE id = ?", *targetParent).Scan(targetParent, &tScope, &tProvider, &tOrg); err != nil {
				if err == sql.ErrNoRows {
					return notFoundError("Folder not found.")
				}
				return err
			}
			if tScope != scopeKey || NormalizeProviderKey(tProvider) != ProviderSAT {
				return validationError("Folders can only be moved within the same library.")
			}
			if !actorCanReadScope(actor, nullToPtr(tOrg)) {
				return notFoundError("Folder not found.")
			}
		}
		if err := lockLibraryScopeTx(ctx, q, scopeKey, provider, nullToPtr(org)); err != nil {
			return err
		}
		var currentRev int
		var currentParent sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT revision, parent_id FROM exam_folders WHERE id = ? FOR UPDATE", fid).Scan(&currentRev, &currentParent); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Folder not found.")
			}
			return err
		}
		if currentRev != req.Revision {
			return conflictError("Folder changed while you were editing; refresh before retrying.")
		}
		currentParentID := nullToPtr(currentParent)
		if parentKeyFor(currentParentID) == parentKeyFor(targetParent) {
			row := q.QueryRowContext(ctx, "SELECT id, scope_key, provider_key, organization_id, parent_id, name, revision, created_by, created_at, updated_at FROM exam_folders WHERE id = ?", fid)
			f, err := scanFolder(row)
			if err != nil {
				return err
			}
			out = f
			return nil
		}
		newParentKey := ""
		if targetParent != nil {
			var pScope, pProvider string
			var pOrg sql.NullString
			if err := q.QueryRowContext(ctx, "SELECT scope_key, provider_key, organization_id FROM exam_folders WHERE id = ? FOR UPDATE", *targetParent).Scan(&pScope, &pProvider, &pOrg); err != nil {
				if err == sql.ErrNoRows {
					return notFoundError("Folder not found.")
				}
				return err
			}
			if pScope != scopeKey || NormalizeProviderKey(pProvider) != ProviderSAT {
				return validationError("Folders can only be moved within the same library.")
			}
			desc, err := isDescendantInTx(ctx, q, scopeKey, fid, *targetParent)
			if err != nil {
				return err
			}
			if desc {
				return validationError("A folder cannot be moved into itself or a subfolder.")
			}
			parentDepth, err := folderDepthInTx(ctx, q, *targetParent)
			if err != nil {
				return err
			}
			height, err := subtreeHeightInTx(ctx, q, scopeKey, fid)
			if err != nil {
				return err
			}
			if parentDepth+height > MaxFolderDepth {
				return validationError("Folder nesting exceeds the maximum depth.")
			}
			newParentKey = *targetParent
		} else {
			height, err := subtreeHeightInTx(ctx, q, scopeKey, fid)
			if err != nil {
				return err
			}
			if height > MaxFolderDepth {
				return validationError("Folder nesting exceeds the maximum depth.")
			}
		}
		// Sibling uniqueness at the destination.
		var clash int
		if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM exam_folders WHERE scope_key = ? AND parent_key = ? AND LOWER(name) = (SELECT LOWER(name) FROM exam_folders WHERE id = ?) AND id <> ?", scopeKey, newParentKey, fid, fid).Scan(&clash); err != nil {
			return err
		}
		if clash > 0 {
			return conflictError("A folder with this name already exists here.")
		}
		var parentArg any
		if targetParent != nil {
			parentArg = *targetParent
		}
		res, err := q.ExecContext(ctx, "UPDATE exam_folders SET parent_id = ?, revision = revision + 1 WHERE id = ? AND revision = ?", parentArg, fid, req.Revision)
		if err != nil {
			if isDuplicateKey(err) {
				return conflictError("A folder with this name already exists here.")
			}
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return conflictError("Folder changed while you were editing; refresh before retrying.")
		}
		row := q.QueryRowContext(ctx, "SELECT id, scope_key, provider_key, organization_id, parent_id, name, revision, created_by, created_at, updated_at FROM exam_folders WHERE id = ?", fid)
		f, err := scanFolder(row)
		if err != nil {
			return err
		}
		out = f
		return nil
	})
	return out, err
}

// DeleteFolderForActor deletes EMPTY folders only; nonempty yields 409.
func (s *Service) DeleteFolderForActor(ctx context.Context, actor auth.ActorContext, folderID string, revision int) error {
	if err := requireWriteActor(actor); err != nil {
		return err
	}
	fid := strings.TrimSpace(folderID)
	return s.runner.WithTxRC(ctx, func(ctx context.Context, q tx.Tx) error {
		var scopeKey, provider string
		var org sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT scope_key, provider_key, organization_id FROM exam_folders WHERE id = ?", fid).Scan(&scopeKey, &provider, &org); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Folder not found.")
			}
			return err
		}
		if NormalizeProviderKey(provider) != ProviderSAT {
			return notFoundError("Folder not found.")
		}
		if !actorCanReadScope(actor, nullToPtr(org)) {
			return notFoundError("Folder not found.")
		}
		if err := lockLibraryScopeTx(ctx, q, scopeKey, provider, nullToPtr(org)); err != nil {
			return err
		}
		var currentRev int
		if err := q.QueryRowContext(ctx, "SELECT revision FROM exam_folders WHERE id = ? FOR UPDATE", fid).Scan(&currentRev); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Folder not found.")
			}
			return err
		}
		if currentRev != revision {
			return conflictError("Folder changed while you were editing; refresh before retrying.")
		}
		var childCount int
		if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM exam_folders WHERE parent_id = ?", fid).Scan(&childCount); err != nil {
			return err
		}
		var entryCount int
		if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM exam_folder_entries WHERE folder_id = ?", fid).Scan(&entryCount); err != nil {
			return err
		}
		if childCount > 0 || entryCount > 0 {
			return conflictError("Folder is not empty. Move its contents to the Library first.")
		}
		res, err := q.ExecContext(ctx, "DELETE FROM exam_folders WHERE id = ? AND revision = ?", fid, revision)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return conflictError("Folder changed while you were editing; refresh before retrying.")
		}
		return nil
	})
}

// MoveExamItem is one CAS-guarded placement.
type MoveExamItem struct {
	ExamID   string
	Revision int
}

// MoveExamsForActor moves visible exams atomically; failed batches preserve
// source view/selection via rollback and return the first error.
func (s *Service) MoveExamsForActor(ctx context.Context, actor auth.ActorContext, items []MoveExamItem, folderID *string) ([]FolderEntry, error) {
	if err := requireWriteActor(actor); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, validationError("Select at least one exam to move.")
	}
	if len(items) > MaxMoveBulkItems {
		return nil, validationError("Too many exams selected; move fewer at a time.")
	}
	ids := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, it := range items {
		id := strings.TrimSpace(it.ExamID)
		if id == "" {
			return nil, validationError("Exam id is required.")
		}
		if seen[id] {
			return nil, validationError("Duplicate exam in move request.")
		}
		seen[id] = true
		ids = append(ids, id)
	}
	sort.Strings(ids)
	want := map[string]int{}
	for _, it := range items {
		want[strings.TrimSpace(it.ExamID)] = it.Revision
	}
	var targetFolder *string
	if folderID != nil && strings.TrimSpace(*folderID) != "" {
		v := strings.TrimSpace(*folderID)
		targetFolder = &v
	}

	// Pre-lock authorization: every exam must be readable (404-collapse
	// cross-tenant) and share one SAT scope with the target.
	var sharedScope string
	var sharedOrg *string
	canonicalSeen := map[string]bool{}
	for i, id := range ids {
		exam, err := s.GetForActor(ctx, actor, id)
		if err != nil {
			return nil, err
		}
		if NormalizeProviderKey(exam.ProviderKey) != ProviderSAT {
			return nil, validationError("Only SAT exams can be moved in the library.")
		}
		if canonicalSeen[exam.ID] {
			return nil, validationError("Duplicate exam in move request.")
		}
		canonicalSeen[exam.ID] = true
		want[exam.ID] = want[id]
		ids[i] = exam.ID
		key := LibraryScopeKey(exam.ProviderKey, exam.OrganizationID)
		if sharedScope == "" {
			sharedScope = key
			sharedOrg = exam.OrganizationID
		} else if key != sharedScope {
			return nil, conflictError("Selected exams belong to different libraries; move one library at a time.")
		}
	}
	sort.Strings(ids)
	var folderScope string
	if targetFolder != nil {
		row := s.db.QueryRowContext(ctx, "SELECT id, scope_key, provider_key, organization_id FROM exam_folders WHERE id = ?", *targetFolder)
		var fs, fp string
		var fo sql.NullString
		if err := row.Scan(targetFolder, &fs, &fp, &fo); err != nil {
			if err == sql.ErrNoRows {
				return nil, notFoundError("Folder not found.")
			}
			return nil, err
		}
		if NormalizeProviderKey(fp) != ProviderSAT {
			return nil, notFoundError("Folder not found.")
		}
		if !actorCanReadScope(actor, nullToPtr(fo)) {
			return nil, notFoundError("Folder not found.")
		}
		folderScope = fs
		if folderScope != sharedScope {
			return nil, conflictError("Exams and the destination folder belong to different libraries.")
		}
		sharedOrg = nullToPtr(fo)
	}
	provider := ProviderSAT
	scopeKey := sharedScope
	if scopeKey == "" {
		scopeKey = LibraryScopeKey(provider, sharedOrg)
	}

	var out []FolderEntry
	err := s.runner.WithTxRC(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := lockLibraryScopeTx(ctx, q, scopeKey, provider, sharedOrg); err != nil {
			return err
		}
		// Lock exams in deterministic ID order and recheck scope in-tx.
		for _, id := range ids {
			var pkey string
			var org sql.NullString
			if err := q.QueryRowContext(ctx, "SELECT provider_key, organization_id FROM exam_entities WHERE id = ? FOR UPDATE", id).Scan(&pkey, &org); err != nil {
				if err == sql.ErrNoRows {
					return notFoundError("Exam not found.")
				}
				return err
			}
			if NormalizeProviderKey(pkey) != ProviderSAT {
				return validationError("Only SAT exams can be moved in the library.")
			}
			if LibraryScopeKey(pkey, nullToPtr(org)) != scopeKey {
				return conflictError("Exams and the destination folder belong to different libraries.")
			}
			// Builder recheck under lock: org writes cannot slip scope.
			if actor.Role == auth.RoleBuilder {
				if actor.OrgID == nil || !equalOrg(actor.OrgID, nullToPtr(org)) {
					return notFoundError("Exam not found.")
				}
			}
		}
		if targetFolder != nil {
			var fs string
			if err := q.QueryRowContext(ctx, "SELECT scope_key FROM exam_folders WHERE id = ? FOR UPDATE", *targetFolder).Scan(&fs); err != nil {
				if err == sql.ErrNoRows {
					return notFoundError("Folder not found.")
				}
				return err
			}
			if fs != scopeKey {
				return conflictError("Exams and the destination folder belong to different libraries.")
			}
		}
		out = make([]FolderEntry, 0, len(ids))
		for _, id := range ids {
			expected := want[id]
			var curFolder sql.NullString
			var curRev int
			var hasRow bool
			if err := q.QueryRowContext(ctx, "SELECT folder_id, revision FROM exam_folder_entries WHERE exam_id = ? FOR UPDATE", id).Scan(&curFolder, &curRev); err != nil {
				if err != sql.ErrNoRows {
					return err
				}
				hasRow = false
				curRev = 0
			} else {
				hasRow = true
			}
			var curFolderID *string
			if hasRow && curFolder.Valid && strings.TrimSpace(curFolder.String) != "" {
				v := strings.TrimSpace(curFolder.String)
				curFolderID = &v
			}
			// Same-target retries converge as no-op without fencing.
			if equalFolder(curFolderID, targetFolder) {
				out = append(out, FolderEntry{ExamID: id, FolderID: curFolderID, Revision: curRev})
				continue
			}
			if expected != curRev {
				return conflictError("An exam changed while you were moving it; refresh before retrying.")
			}
			var folderArg any
			if targetFolder != nil {
				folderArg = *targetFolder
			}
			if !hasRow {
				// First placement advances from implicit root revision 0 to 1
				// so a stale revision-0 retry cannot overwrite it.
				if _, err := q.ExecContext(ctx, "INSERT INTO exam_folder_entries (exam_id, folder_id, scope_key, revision) VALUES (?, ?, ?, 1)", id, folderArg, scopeKey); err != nil {
					if isDuplicateKey(err) {
						return conflictError("An exam changed while you were moving it; refresh before retrying.")
					}
					return err
				}
			} else {
				res, err := q.ExecContext(ctx, "UPDATE exam_folder_entries SET folder_id = ?, scope_key = ?, revision = revision + 1 WHERE exam_id = ? AND revision = ?", folderArg, scopeKey, id, expected)
				if err != nil {
					return err
				}
				if n, _ := res.RowsAffected(); n != 1 {
					return conflictError("An exam changed while you were moving it; refresh before retrying.")
				}
			}
			var nf sql.NullString
			var nr int
			if err := q.QueryRowContext(ctx, "SELECT folder_id, revision FROM exam_folder_entries WHERE exam_id = ?", id).Scan(&nf, &nr); err != nil {
				return err
			}
			en := FolderEntry{ExamID: id, Revision: nr}
			if nf.Valid && strings.TrimSpace(nf.String) != "" {
				v := strings.TrimSpace(nf.String)
				en.FolderID = &v
			}
			out = append(out, en)
		}
		return nil
	})
	return out, err
}

func equalOrg(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return strings.TrimSpace(*a) == strings.TrimSpace(*b)
}

func equalFolder(a, b *string) bool {
	av := ""
	if a != nil {
		av = strings.TrimSpace(*a)
	}
	bv := ""
	if b != nil {
		bv = strings.TrimSpace(*b)
	}
	return av == bv
}

func nullToPtr(n sql.NullString) *string {
	if !n.Valid {
		return nil
	}
	v := n.String
	return &v
}

func folderFingerprint(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return fmt.Sprintf("%x", sum[:])
}
