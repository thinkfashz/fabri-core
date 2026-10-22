// FABRI-CORE · /api/sync
// Guarda y devuelve la copia cifrada del dispositivo en Vercel Blob.
//
// El servidor NUNCA ve el contenido en claro: el navegador cifra con
// AES-256-GCM usando una clave derivada de la contraseña (PBKDF2) y aquí
// solo se almacena el sobre {iv, data, v}. Sin BLOB_READ_WRITE_TOKEN → 501.
package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func token() string { return os.Getenv("BLOB_READ_WRITE_TOKEN") }

func out(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func authHeader(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

func call(method, path string, body []byte, extra map[string]string) (int, []byte, error) {
	var rd io.Reader
	if body != nil {
		rd = strings.NewReader(string(body))
	}
	req, err := http.NewRequest(method, "https://blob.vercel-storage.com/"+path, rd)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("authorization", "Bearer "+token())
	req.Header.Set("x-api-version", "12")
	for k, v := range extra {
		req.Header.Set(k, v)
	}
	c := &http.Client{Timeout: 9 * time.Second}
	res, err := c.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 6<<20))
	return res.StatusCode, b, nil
}

func Handler(w http.ResponseWriter, r *http.Request) {
	if token() == "" {
		out(w, http.StatusNotImplemented, map[string]any{
			"ok": false, "cloud": "unconfigured",
			"error": "La nube no está configurada: falta BLOB_READ_WRITE_TOKEN.",
			"how":   "Vercel → Storage → Blob (privado) → conectar al proyecto → redeploy.",
		})
		return
	}
	tok := authHeader(r)
	if tok == "" {
		out(w, 401, map[string]any{"ok": false, "error": "falta el token de sesión"})
		return
	}
	sum := sha256.Sum256([]byte(tok))
	path := "fabri/snap/" + hex.EncodeToString(sum[:]) + ".json"

	switch r.Method {
	case "GET":
		code, body, err := call("GET", path, nil, nil)
		if err != nil {
			out(w, 502, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		if code == 404 {
			out(w, 200, map[string]any{"ok": true, "empty": true})
			return
		}
		if code >= 300 {
			out(w, 502, map[string]any{"ok": false, "error": fmt.Sprintf("blob get %d", code)})
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(body)

	case "PUT", "POST":
		var in struct {
			IV    string `json:"iv"`
			Data  string `json:"data"`
			V     int    `json:"v"`
			Bytes int    `json:"bytes"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 3<<20)).Decode(&in); err != nil {
			out(w, 400, map[string]any{"ok": false, "error": "sobre inválido"})
			return
		}
		if in.Data == "" || in.IV == "" {
			out(w, 400, map[string]any{"ok": false, "error": "faltan data o iv"})
			return
		}
		envelope := map[string]any{
			"v": in.V, "iv": in.IV, "data": in.Data,
			"bytes": len(in.Data), "saved_at": time.Now().UnixMilli(),
		}
		body, _ := json.Marshal(envelope)
		code, resp, err := call("PUT", path, body, map[string]string{
			"x-content-type": "application/json", "x-add-random-suffix": "0", "x-allow-overwrite": "1",
		})
		if err != nil {
			out(w, 502, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		if code >= 300 {
			out(w, 502, map[string]any{"ok": false, "error": fmt.Sprintf("blob put %d: %s", code, string(resp[:min(len(resp), 200)]))})
			return
		}
		out(w, 200, map[string]any{"ok": true, "bytes": len(in.Data), "saved_at": envelope["saved_at"]})

	default:
		out(w, 405, map[string]any{"ok": false, "error": "usa GET o PUT"})
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
