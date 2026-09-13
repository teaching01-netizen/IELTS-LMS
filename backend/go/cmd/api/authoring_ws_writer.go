package main

import (
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/liveupdates"
)

// authoringWriter serializes every write to one authoring socket.
//
// gorilla/websocket permits only ONE concurrent writer per connection. The
// authoring connection has a single writer goroutine (authoringWritePump) that
// owns every post-handshake frame; this guard exists so that any other path
// (the pre-pump handshake, a future helper) can never interleave two JSON
// frames on the wire — which would corrupt the stream or trip the library's
// concurrent-write panic. The read pump does not write at all: it hands frames
// to the writer goroutine through a control channel.
type authoringWriter struct {
	mu   sync.Mutex
	conn *websocket.Conn
}

func newAuthoringWriter(conn *websocket.Conn) *authoringWriter {
	return &authoringWriter{conn: conn}
}

// write sends one JSON frame under the guard.
//
// This is the single choke point for every outbound authoring frame, which
// makes it the right place for the socket-write failure signal: Phase 06 counts
// a DELIVERY failure here (the frame never reached the client), deliberately
// not a persistence failure (canonical state is unaffected and the client will
// simply reconnect and resync).
func (w *authoringWriter) write(value any) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	err := writeLiveJSON(w.conn, value)
	if err != nil {
		authoringrealtime.EmitDeliveryFailure(authoringrealtime.DeliveryStageSocket)
	}
	return err
}

// ping sends a keepalive control frame under the same guard, so a ping can
// never interleave with a data frame.
func (w *authoringWriter) ping() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := w.conn.SetWriteDeadline(time.Now().Add(liveupdates.WriteTimeout)); err != nil {
		return err
	}
	return w.conn.WriteMessage(websocket.PingMessage, nil)
}
