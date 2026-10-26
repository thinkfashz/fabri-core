// FABRI-CORE · /api/health
// Salud PÚBLICA y barata de la capa web. Contrato común con fabri-api,
// fabrick-cloud y fabrick-tg-bot:
//
//	{ ok, servicio, capa, version, hora, dependencias[] }
//
// No consulta la base ni el agente: responde en milisegundos para que la
// malla de las otras capas pueda sondearlo sin castigar el arranque en frío.
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
	w.Header().Set("Access-Control-Allow-Origin", "*")

	agentOK := os.Getenv("FABRI_LLM_URL") != "" && os.Getenv("FABRI_LLM_KEY") != ""
	cloudOK := os.Getenv("BLOB_READ_WRITE_TOKEN") != ""

	agent := "unconfigured"
	detalleAgente := "faltan FABRI_LLM_URL / FABRI_LLM_KEY"
	if agentOK {
		agent = "configured"
		detalleAgente = "FABRI_LLM_URL y FABRI_LLM_KEY presentes"
	}

	cloud := "sin configurar"
	detalleNube := "sin token: /api/auth y /api/sync responden 501"
	if cloudOK {
		cloud = "lista"
		detalleNube = "BLOB_READ_WRITE_TOKEN presente"
	}

	dependencias := []map[string]any{
		{"nombre": "Agente Go", "ok": agentOK, "detalle": detalleAgente, "critica": false},
		{"nombre": "Vercel Blob", "ok": cloudOK, "detalle": detalleNube, "critica": false},
	}

	listas := 0
	for _, d := range dependencias {
		if d["ok"].(bool) {
			listas++
		}
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":           true,
		"servicio":     "fabri-core-web",
		"capa":         "web",
		"version":      "1.1.0",
		"hora":         time.Now().UTC().Format(time.RFC3339),
		"agent":        agent,
		"cloud":        cloud,
		"runtime":      "go " + runtime.Version(),
		"time":         time.Now().UTC().Format(time.RFC3339),
		"dependencias": dependencias,
		"resumen": map[string]any{
			"dependencias": len(dependencias),
			"listas":       listas,
		},
	})
}
