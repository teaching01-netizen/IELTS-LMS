package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
	"github.com/gorilla/websocket"
)

func TestCoeditPublicSocketURLUsesEmbeddedPublicRoute(t *testing.T) {
	app := &App{Config: config.Config{
		AuthoringCoeditServiceURL:     "http://127.0.0.1:1235",
		AuthoringCoeditPublicURL:      "https://api.example.com/authoring-coedit",
		AuthoringCoeditPublicWSScheme: "wss",
	}}
	got := coeditPublicSocketURL(app, httptest.NewRequest(http.MethodPost, "https://api.example.com/token", nil))
	if got != "wss://api.example.com/authoring-coedit" {
		t.Fatalf("public co-edit URL = %q", got)
	}
}

func TestCoeditWebSocketProxyRewritesPublicPath(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" || r.URL.RawQuery != "room=one" {
			http.Error(w, "unexpected target URL", http.StatusBadRequest)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.WriteMessage(websocket.TextMessage, []byte("connected"))
	}))
	defer target.Close()

	public := httptest.NewServer(coeditWebSocketProxy(&App{Config: config.Config{
		AuthoringCoeditServiceURL: target.URL,
	}}))
	defer public.Close()

	wsURL := "ws" + strings.TrimPrefix(public.URL, "http") + coeditPublicProxyPath + "?room=one"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial proxied co-edit socket: %v", err)
	}
	defer conn.Close()
	_, message, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read proxied co-edit message: %v", err)
	}
	if string(message) != "connected" {
		t.Fatalf("proxied message = %q", message)
	}
}

func TestCoeditWebSocketProxyRequiresUpgrade(t *testing.T) {
	handler := coeditWebSocketProxy(&App{Config: config.Config{
		AuthoringCoeditServiceURL: "http://127.0.0.1:1235",
	}})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, coeditPublicProxyPath, nil)
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUpgradeRequired {
		t.Fatalf("plain co-edit request status = %d", rec.Code)
	}
}
