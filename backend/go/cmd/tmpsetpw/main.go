package main

import (
	"database/sql"
	"fmt"
	"os"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/db"
	"context"
)

func main() {
	cfg := config.Load()
	pool, err := db.Open(cfg)
	if err != nil {
		fmt.Println("open:", err)
		os.Exit(1)
	}
	defer pool.Close()
	h, err := auth.HashPassword("TempPass123!")
	if err != nil {
		fmt.Println("hash:", err)
		os.Exit(1)
	}
	fmt.Println("hash-prefix:", h[:20])
	var id string
	ctx := context.Background()
	if err := pool.QueryRowContext(ctx, "SELECT id FROM users WHERE email='editor@example.com'").Scan(&id); err != nil {
		fmt.Println("lookup:", err)
		os.Exit(1)
	}
	var _ = sql.ErrNoRows
	if _, err := pool.ExecContext(ctx, "INSERT INTO user_password_credentials (user_id, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)", id, h); err != nil {
		fmt.Println("upsert:", err)
		os.Exit(1)
	}
	fmt.Println("password set for editor@example.com")
}
