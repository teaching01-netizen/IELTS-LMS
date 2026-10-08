package exams

import (
 "database/sql"
 "testing"
)

func TestStoredScopeCorruptionNeverWidensAccess(t *testing.T) {
 for _, raw:=range []string{"","[]","null","nope",`["science"]`,`["math","science"]`,`["math",null]`} {
  scope:=ParseStoredSectionScope(sql.NullString{String:raw,Valid:true})
  if AllowsSection(scope,"reading-writing") || AllowsSection(scope,"math") {t.Fatalf("corrupt scope %q widened access: %v",raw,scope)}
 }
 scope:=ParseStoredSectionScope(sql.NullString{String:`["math"]`,Valid:true})
 if !AllowsSection(scope,"math") || AllowsSection(scope,"reading-writing") {t.Fatalf("valid narrowed scope=%v",scope)}
 if !AllowsSection(ParseStoredSectionScope(sql.NullString{}),"math") {t.Fatal("legacy absent scope must remain unrestricted")}
}
