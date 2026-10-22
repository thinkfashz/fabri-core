// FABRI-CORE · /api/agent
// Proxy mínimo a un LLM compatible con la API de chat completions.
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   FABRI_LLM_URL    p. ej. https://api.openai.com/v1/chat/completions
//   FABRI_LLM_KEY    la clave
//   FABRI_LLM_MODEL  p. ej. gpt-4o-mini  (opcional, por defecto el de abajo)
//
// Si no están configuradas, la función NO inventa una respuesta: devuelve un
// error explícito con instrucciones. Es la misma regla que sigue la app.
package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type reqBody struct {
	Prompt string `json:"prompt"`
}

type chatMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatReq struct {
	Model    string    `json:"model"`
	Messages []chatMsg `json:"messages"`
	Stream   bool      `json:"stream"`
}

type chatResp struct {
	Choices []struct {
		Message chatMsg `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
	Model string `json:"model"`
}

const systemPrompt = `Eres FABRI-CORE, una consola autónoma que corre en el dispositivo del usuario.
Respondes en español, breve y concreto (máximo 8 líneas salvo que pidan detalle).
Reglas: no inventes datos; si no sabes algo, dilo. No pidas credenciales.
Si te piden algo que requiere la base local, explica qué consulta SQL haría falta.`

func Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "usa POST"})
		return
	}

	var body reqBody
	dec := json.NewDecoder(io.LimitReader(r.Body, 16<<10))
	if err := dec.Decode(&body); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "cuerpo JSON inválido"})
		return
	}
	prompt := strings.TrimSpace(body.Prompt)
	if prompt == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "falta el campo prompt"})
		return
	}

	url := os.Getenv("FABRI_LLM_URL")
	key := os.Getenv("FABRI_LLM_KEY")
	model := os.Getenv("FABRI_LLM_MODEL")
	if model == "" {
		model = "gpt-4o-mini"
	}
	if url == "" || key == "" {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error": "El agente no está configurado en este despliegue: define FABRI_LLM_URL y FABRI_LLM_KEY en Vercel (Settings → Environment Variables) y vuelve a desplegar.",
			"hint":  "La app funciona igual sin agente: base local, memoria, consola SQL y flujos.",
		})
		return
	}

	payload, _ := json.Marshal(chatReq{
		Model: model,
		Messages: []chatMsg{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: prompt},
		},
	})

	client := &http.Client{Timeout: 26 * time.Second}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "no pude armar la petición: " + err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	res, err := client.Do(req)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "el proveedor del modelo no respondió: " + err.Error()})
		return
	}
	defer res.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var out chatResp
	if err := json.Unmarshal(raw, &out); err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "respuesta ilegible del proveedor (HTTP " + res.Status + ")"})
		return
	}
	if out.Error != nil && out.Error.Message != "" {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": out.Error.Message})
		return
	}
	if len(out.Choices) == 0 {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "el modelo no devolvió texto (HTTP " + res.Status + ")"})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"reply": out.Choices[0].Message.Content,
		"model": model,
	})
}
