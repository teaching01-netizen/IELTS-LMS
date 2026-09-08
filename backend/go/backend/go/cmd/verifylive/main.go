package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"example.com/ielts-proctoring/internal/platform/db"
)

func main() {
	dsn := os.Args[1] + "?parseTime=true&multiStatements=true"
	sqlDB, err := sql.Open("mysql", dsn)
	if err != nil { fmt.Println("OPEN:", err); os.Exit(1) }
	defer sqlDB.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := db.VerifyRuntimeSchema(ctx, sqlDB); err != nil {
		fmt.Println("VERIFY_FAIL:", err); os.Exit(1)
	}
	ver, err := db.SchemaVersion(ctx, sqlDB)
	if err != nil { fmt.Println("VERSION_FAIL:", err); os.Exit(1) }
	fmt.Println("VERIFY_OK version=" + ver)
}
