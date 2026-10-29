// FORGE CORE STOCK · /api/estado
// Malla del ecosistema vista desde la capa web.
//
// Sondea el /api/health de las cuatro capas en paralelo, con tope de 5 s por
// capa. Una capa caída no arrastra al resto: se informa y se sigue. Mismo
// contrato que fabri-api, fabrick-cloud y fabrick-tg-bot.
package handler

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

type capaDef struct {
	ID     string
	Nombre string
	Rol    string
	URL    string
	Health string
}

type capaEstado struct {
	ID       string `json:"id"`
	Nombre   string `json:"nombre"`
	Rol      string `json:"rol"`
	URL      string `json:"url"`
	OK       bool   `json:"ok"`
	Estado   string `json:"estado"`
	Ms       int64  `json:"ms"`
	HTTP     int    `json:"http"`
	Detalle  string `json:"detalle"`
	Servicio string `json:"servicio"`
	Version  string `json:"version"`
}

var capas = []capaDef{
	{ID: "api", Nombre: "API del teléfono", Rol: "puerta de la APK", URL: "https://fabri-api.vercel.app", Health: "/api/health"},
	{ID: "cerebro", Nombre: "Cerebro", Rol: "modelos + persona + memoria", URL: "https://fabrick-tg-bot.vercel.app", Health: "/api/health"},
	{ID: "nube", Nombre: "Nube y voz", Rol: "panel + MeloTTS + cola", URL: "https://fabrick-cloud.faubricioedms.workers.dev", Health: "/api/health"},
	{ID: "web", Nombre: "Web y PWA", Rol: "landing + app web", URL: "https://fabri-core-web.vercel.app", Health: "/api/health"},
}

const tope = 5 * time.Second

func sondar(c capaDef, cliente *http.Client) capaEstado {
	inicio := time.Now()
	out := capaEstado{
		ID: c.ID, Nombre: c.Nombre, Rol: c.Rol, URL: c.URL,
		Servicio: c.ID, Estado: "caida",
	}
	res, err := cliente.Get(c.URL + c.Health)
	out.Ms = time.Since(inicio).Milliseconds()
	if err != nil {
		if ne, ok := err.(interface{ Timeout() bool }); ok && ne.Timeout() {
			out.Detalle = "sin respuesta en 5s"
		} else {
			out.Detalle = err.Error()
		}
		return out
	}
	defer res.Body.Close()
	out.HTTP = res.StatusCode

	var cuerpo struct {
		OK       bool   `json:"ok"`
		Servicio string `json:"servicio"`
		Version  string `json:"version"`
	}
	_ = json.NewDecoder(res.Body).Decode(&cuerpo)

	out.OK = res.StatusCode >= 200 && res.StatusCode < 300 && cuerpo.OK
	if out.OK {
		out.Estado = "arriba"
		if cuerpo.Version != "" {
			out.Detalle = "v" + cuerpo.Version
		} else {
			out.Detalle = "responde"
		}
	} else {
		out.Estado = "degradada"
		out.Detalle = "HTTP " + res.Status
	}
	if cuerpo.Servicio != "" {
		out.Servicio = cuerpo.Servicio
	}
	out.Version = cuerpo.Version
	return out
}

func Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=10, s-maxage=15, stale-while-revalidate=45")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "usa GET"})
		return
	}

	cliente := &http.Client{Timeout: tope}
	resultados := make([]capaEstado, len(capas))
	var wg sync.WaitGroup
	for i, c := range capas {
		wg.Add(1)
		go func(i int, c capaDef) {
			defer wg.Done()
			resultados[i] = sondar(c, cliente)
		}(i, c)
	}
	wg.Wait()

	arriba, degradadas, caidas := 0, 0, 0
	var maxMs int64
	for _, c := range resultados {
		if c.OK {
			arriba++
		}
		switch c.Estado {
		case "degradada":
			degradadas++
		case "caida":
			caidas++
		}
		if c.Ms > maxMs {
			maxMs = c.Ms
		}
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":       arriba > 0,
		"servicio": "fabri-core-web",
		"capa":     "web",
		"version":  "1.1.0",
		"hora":     time.Now().UTC().Format(time.RFC3339),
		"capas":    resultados,
		"resumen": map[string]any{
			"capas":         len(resultados),
			"arriba":        arriba,
			"degradadas":    degradadas,
			"caidas":        caidas,
			"latenciaMaxMs": maxMs,
		},
	})
}
