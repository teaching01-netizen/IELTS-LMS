package main

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
)

func TestDbgLiveVerify(t *testing.T) {
	db, err := sql.Open("mysql", "root@/ielts_go_fresh?parseTime=true&loc=UTC&time_zone=%27%2B00%3A00%27")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := config.Load()
	cfg.AuthSecret = "live-rehearsal-secret-32bytes-min!"
	tok := "eyJ0b2tlbl9pZCI6InZmXzliNTVzYU5kUEZXWGxkMnoxcG5jQ013dnJvVmoxIiwidXNlcl9pZCI6IjcxZGViNzNjLThiYmUtNDk2ZC1hYTQxLWQxZTg4YThkNTBjNCIsInNjaGVkdWxlX2lkIjoiZmE4YzBkYjQtOGI3Ni00ZDNmLWI0YWYtY2ZkN2VlNDJlZDZiIiwiYXR0ZW1wdF9pZCI6ImZhMzZiOWQxLWY3ZGQtNDg4Ny05Y2ZkLTAwNDIwZDMyZDU5ZSIsImNsaWVudF9zZXNzaW9uX2lkIjoiOGE1NTRjMzktYzJlNi00OWRiLWEyOWYtYzMxZjlmN2VlOWE3IiwibGVhc2VfZXBvY2giOjEsImV4cCI6MTc4ODg5NzA4M30.BQkf_135cTOpNIOmUQhKx3L2lqeOUnNseibLRWmMm-8"
	claims, err := auth.VerifyAttemptToken(context.Background(), db, cfg, time.Now().UTC(), tok)
	fmt.Println("claims:", claims.AttemptID, "err:", err)
}
