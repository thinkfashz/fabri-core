// fabri-core-agent — backend local de FABRI-CORE.
//
// Qué hace (todo real, sin simular):
//   GET  /health   → estado del servicio
//   GET  /events   → SSE con los eventos reales (agente, tareas, memoria)
//   POST /agent    → ejecuta el agente (OpenCode CLI) y emite sus eventos al SSE
//   GET  /stats    → contadores reales de eventos emitidos
//
// No toca la base de datos: esa es de la app (almacenamiento privado).
// Se compila sin cgo para correr en Android: CGO_ENABLED=0 GOOS=android GOARCH=arm64
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type Event struct {
	Seq   int64  `json:"seq"`
	Kind  string `json:"kind"`
	Stage string `json:"stage,omitempty"`
	Text  string `json:"text,omitempty"`
	At    string `json:"at"`
	Ms    int64  `json:"ms,omitempty"`
}

type Hub struct {
	mu       sync.Mutex
	seq      int64
	clients  map[chan Event]struct{}
	last     []Event
	started  time.Time
	agentRuns int
}

var hub = &Hub{clients: map[chan Event]struct{}{}, started: time.Now()}

func (h *Hub) publish(kind, stage, text string, ms int64) {
	h.mu.Lock()
	h.seq++
	e := Event{Seq: h.seq, Kind: kind, Stage: stage, Text: text, At: time.Now().Format(time.RFC3339), Ms: ms}
	h.last = append(h.last, e)
	if len(h.last) > 100 {
		h.last = h.last[len(h.last)-100:]
	}
	for ch := range h.clients {
		select {
		case ch <- e:
		default: // cliente lento: se descarta, no bloquea
		}
	}
	h.mu.Unlock()
}

func (h *Hub) subscribe() chan Event {
	ch := make(chan Event, 64)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *Hub) unsubscribe(ch chan Event) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func health(w http.ResponseWriter, r *http.Request) {
	cli := findAgent()
	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "ok",
		"service":    "fabri-core-agent",
		"version":    "1.0.0-spec",
		"uptime_s":   int(time.Since(hub.started).Seconds()),
		"agent_cli":  cli,
		"agent_ok":   cli != "",
		"events_seq": hub.seq,
		"time":       time.Now().Format(time.RFC3339),
	})
}

func stats(w http.ResponseWriter, r *http.Request) {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	byKind := map[string]int{}
	for _, e := range hub.last {
		byKind[e.Kind]++
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"events_total": hub.seq,
		"by_kind":      byKind,
		"recent":       hub.last,
		"agent_runs":   hub.agentRuns,
	})
}

func events(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming no soportado", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	ch := hub.subscribe()
	defer hub.unsubscribe(ch)

	fmt.Fprintf(w, ": conectado a fabri-core-agent\n\n")
	fl.Flush()

	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case e := <-ch:
			b, _ := json.Marshal(e)
			fmt.Fprintf(w, "data: %s\n\n", b)
			fl.Flush()
		case <-ticker.C:
			fmt.Fprintf(w, ": keepalive\n\n")
			fl.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func findAgent() string {
	cands := []string{
		"/data/data/com.termux/files/usr/bin/opencode",
		"/data/data/com.termux/files/home/.opencode/bin/opencode",
		"/root/.opencode/bin/opencode",
	}
	for _, c := range cands {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

type agentReq struct {
	Prompt string `json:"prompt"`
}

func agent(w http.ResponseWriter, r *http.Request) {
	var req agentReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Prompt) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "prompt vacío o JSON inválido"})
		return
	}
	cli := findAgent()
	if cli == "" {
		hub.publish("agent_error", "init", "no hay CLI de OpenCode en el dispositivo", 0)
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error":  "sin CLI de OpenCode en el dispositivo",
			"detail": "instálalo o configura el endpoint del agente en la app",
		})
		return
	}

	hub.mu.Lock()
	hub.agentRuns++
	hub.mu.Unlock()
	start := time.Now()
	hub.publish("agent_start", "init", req.Prompt, 0)

	ctx, cancel := contextWithTimeout(r, 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, cli, "run", req.Prompt)
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	ms := time.Since(start).Milliseconds()
	out := buf.String()

	if err != nil {
		hub.publish("agent_error", "done", err.Error(), ms)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "ms": ms, "output": out})
		return
	}
	hub.publish("agent_done", "done", out, ms)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "ms": ms, "output": out})
}

func main() {
	addr := os.Getenv("FABRI_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8787"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", health)
	mux.HandleFunc("/events", events)
	mux.HandleFunc("/agent", agent)
	mux.HandleFunc("/stats", stats)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"service": "fabri-core-agent",
			"endpoints": []string{"/health", "/events", "/agent", "/stats"},
		})
	})
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	log.Printf("fabri-core-agent escuchando en %s", addr)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
