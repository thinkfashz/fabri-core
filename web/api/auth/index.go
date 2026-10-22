// FABRI-CORE · /api/auth
// Cuentas en la nube con almacenamiento Vercel Blob (store privado).
//
// Variables de entorno:
//   BLOB_READ_WRITE_TOKEN   token del store (lo inyecta Vercel al enlazarlo)
//
// Si falta el token, la función responde 501 con instrucciones: nunca simula
// una cuenta. Contraseñas con PBKDF2-HMAC-SHA256 (120.000 iteraciones) y sal
// única; el token de sesión se guarda solo como SHA-256.
package handler

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const pbkdf2Iter = 120000

type user struct {
	Email     string `json:"email"`
	Name      string `json:"name"`
	Salt      string `json:"salt"`
	Hash      string `json:"hash"`
	Iter      int    `json:"iter"`
	Role      string `json:"role"`
	Created   int64  `json:"created"`
	LastLogin int64  `json:"last_login"`
	TokenHash string `json:"token_hash"`
	TokenExp  int64  `json:"token_exp"`
}

func pbkdf2(pass, salt []byte, iter, keyLen int) []byte {
	prf := hmac.New(sha256.New, pass)
	hLen := prf.Size()
	blocks := (keyLen + hLen - 1) / hLen
	dk := make([]byte, 0, blocks*hLen)
	u := make([]byte, hLen)
	t := make([]byte, hLen)
	var b [4]byte
	for i := 1; i <= blocks; i++ {
		prf.Reset()
		prf.Write(salt)
		b[0], b[1], b[2], b[3] = byte(i>>24), byte(i>>16), byte(i>>8), byte(i)
		prf.Write(b[:])
		u = prf.Sum(u[:0])
		copy(t, u)
		for n := 2; n <= iter; n++ {
			prf.Reset()
			prf.Write(u)
			u = prf.Sum(u[:0])
			for x := range t {
				t[x] ^= u[x]
			}
		}
		dk = append(dk, t...)
	}
	return dk[:keyLen]
}

func newToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func pathFor(kind, email string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(email))))
	return "fabri/" + kind + "/" + hex.EncodeToString(sum[:]) + ".json"
}

func blobToken() string { return os.Getenv("BLOB_READ_WRITE_TOKEN") }

func blobPut(path string, body []byte) error {
	req, err := http.NewRequest("PUT", "https://blob.vercel-storage.com/"+path, strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("authorization", "Bearer "+blobToken())
	req.Header.Set("x-api-version", "12")
	req.Header.Set("x-content-type", "application/json")
	req.Header.Set("x-add-random-suffix", "0")
	req.Header.Set("x-allow-overwrite", "1")
	c := &http.Client{Timeout: 9 * time.Second}
	res, err := c.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 300))
		return fmt.Errorf("blob put %d: %s", res.StatusCode, string(b))
	}
	return nil
}

func blobGet(path string) ([]byte, error) {
	req, err := http.NewRequest("GET", "https://blob.vercel-storage.com/"+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("authorization", "Bearer "+blobToken())
	req.Header.Set("x-api-version", "12")
	c := &http.Client{Timeout: 9 * time.Second}
	res, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == 404 {
		return nil, nil
	}
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("blob get %d", res.StatusCode)
	}
	return io.ReadAll(io.LimitReader(res.Body, 4<<20))
}

func jsonOut(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

func hashToken(t string) string {
	s := sha256.Sum256([]byte(t))
	return hex.EncodeToString(s[:])
}

func Handler(w http.ResponseWriter, r *http.Request) {
	if blobToken() == "" {
		jsonOut(w, http.StatusNotImplemented, map[string]any{
			"ok": false, "cloud": "unconfigured",
			"error":   "La nube no está configurada en este despliegue.",
			"how":     "En Vercel: Storage → Blob crea un store privado y enlázalo a este proyecto; eso define BLOB_READ_WRITE_TOKEN. Luego vuelve a desplegar.",
			"local":   "Mientras tanto la cuenta y las sesiones siguen funcionando en tu dispositivo.",
			"billing": "Si el plan free ya usó su único store, hay que liberar cupo o cambiar de plan.",
		})
		return
	}
	if r.Method == "GET" {
		me(w, r)
		return
	}
	if r.Method != "POST" {
		jsonOut(w, 405, map[string]any{"ok": false, "error": "usa POST"})
		return
	}

	var in struct {
		Action string `json:"action"`
		Email  string `json:"email"`
		Name   string `json:"name"`
		Pass   string `json:"pass"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&in); err != nil {
		jsonOut(w, 400, map[string]any{"ok": false, "error": "cuerpo inválido"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))

	switch in.Action {
	case "register", "login":
		if email == "" || !strings.Contains(email, "@") {
			jsonOut(w, 400, map[string]any{"ok": false, "error": "correo inválido"})
			return
		}
		raw, err := blobGet(pathFor("users", email))
		if err != nil {
			jsonOut(w, 502, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		var u user
		if raw != nil {
			if err := json.Unmarshal(raw, &u); err != nil {
				jsonOut(w, 500, map[string]any{"ok": false, "error": "registro corrupto"})
				return
			}
		}
		if in.Action == "register" {
			if raw != nil {
				jsonOut(w, 409, map[string]any{"ok": false, "error": "ese correo ya tiene cuenta en la nube"})
				return
			}
			if len(in.Pass) < 8 {
				jsonOut(w, 400, map[string]any{"ok": false, "error": "la contraseña necesita 8 caracteres o más"})
				return
			}
			salt := make([]byte, 16)
			_, _ = rand.Read(salt)
			u = user{
				Email: email, Name: firstNonEmpty(in.Name, strings.Split(email, "@")[0]),
				Salt: base64.RawURLEncoding.EncodeToString(salt),
				Hash: base64.RawURLEncoding.EncodeToString(pbkdf2([]byte(in.Pass), salt, pbkdf2Iter, 32)),
				Iter: pbkdf2Iter, Role: "member", Created: time.Now().UnixMilli(),
			}
		} else {
			if raw == nil {
				jsonOut(w, 404, map[string]any{"ok": false, "error": "no existe esa cuenta en la nube"})
				return
			}
			salt, _ := base64.RawURLEncoding.DecodeString(u.Salt)
			calc := pbkdf2([]byte(in.Pass), salt, u.Iter, 32)
			want, _ := base64.RawURLEncoding.DecodeString(u.Hash)
			if subtle.ConstantTimeCompare(calc, want) != 1 {
				jsonOut(w, 401, map[string]any{"ok": false, "error": "contraseña incorrecta"})
				return
			}
		}
		tok := newToken(32)
		u.TokenHash = hashToken(tok)
		u.TokenExp = time.Now().Add(30 * 24 * time.Hour).UnixMilli()
		u.LastLogin = time.Now().UnixMilli()
		body, _ := json.Marshal(u)
		if err := blobPut(pathFor("users", email), body); err != nil {
			jsonOut(w, 502, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		jsonOut(w, 200, map[string]any{
			"ok": true, "token": tok, "email": u.Email, "name": u.Name, "role": u.Role,
			"salt": u.Salt, "iter": u.Iter, "expires": u.TokenExp,
		})

	case "logout":
		tok := bearer(r)
		if tok == "" {
			jsonOut(w, 401, map[string]any{"ok": false, "error": "falta el token"})
			return
		}
		_ = tok
		jsonOut(w, 200, map[string]any{"ok": true, "note": "el token caduca solo; para revocarlo ya, inicia sesión de nuevo"})
	default:
		jsonOut(w, 400, map[string]any{"ok": false, "error": "acción desconocida"})
	}
}

func me(w http.ResponseWriter, r *http.Request) {
	tok := bearer(r)
	if tok == "" {
		jsonOut(w, 401, map[string]any{"ok": false, "error": "falta el token"})
		return
	}
	_ = url.Values{}
	jsonOut(w, 200, map[string]any{"ok": true, "note": "usa POST /api/auth con action=login", "cloud": "ready"})
}

func firstNonEmpty(a ...string) string {
	for _, s := range a {
		if strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

var _ = errors.New
