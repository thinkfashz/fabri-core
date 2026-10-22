// FABRI-CORE · /api/health
// Función Go en Vercel: devuelve el estado real del núcleo y si hay agente configurado.
package handler

import (
	"encoding/json"
	"net/http"
	"os"
	"runtime"
	"time"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")

	agent := "unconfigured"
	if os.Getenv("FABRI_LLM_URL") != "" && os.Getenv("FABRI_LLM_KEY") != "" {
		agent = "configured"
	}

	cloud := "sin configurar"
	if os.Getenv("BLOB_READ_WRITE_TOKEN") != "" {
		cloud = "lista"
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":      true,
		"agent":   agent,
		"cloud":   cloud,
		"runtime": "go " + runtime.Version(),
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}
