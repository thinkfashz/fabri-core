// FORGE CORE STOCK · /api/lugares
// Buscador de direcciones y negocios (geocodificación) sobre Nominatim.
//
// Para qué: si el GPS falla o el usuario quiere mirar otra comuna, necesita
// escribir «Av. Providencia 1234» o «Tottus Ñuñoa» y que el mapa vaya ahí.
// Se proxya por la misma razón que /api/mercados: User-Agent propio, caché en
// el servidor y una sola política de reintentos.
//
// Política de Nominatim: máximo ~1 consulta por segundo y User-Agent que
// identifique la app. El caché de 10 minutos por consulta lo hace sostenible.
// Datos: © OpenStreetMap contributors, ODbL.
package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type lugar struct {
	Nombre    string  `json:"nombre"`
	Direccion string  `json:"direccion"`
	Tipo      string  `json:"tipo"`
	Lat       float64 `json:"lat"`
	Lon       float64 `json:"lon"`
}

type lugaresRespuesta struct {
	OK       bool    `json:"ok"`
	Consulta string  `json:"consulta"`
	Total    int     `json:"total"`
	Lugares  []lugar `json:"lugares"`
	Error    string  `json:"error,omitempty"`
	Generado string  `json:"generado"`
}

type nomBusqueda struct {
	Lat         string            `json:"lat"`
	Lon         string            `json:"lon"`
	Name        string            `json:"name"`
	DisplayName string            `json:"display_name"`
	Type        string            `json:"type"`
	Category    string            `json:"category"`
	Address     map[string]string `json:"address"`
}

type entradaLugares struct {
	at   time.Time
	body []byte
}

const userAgent = "FORGE-CORE-STOCK/1.0 (buscador de lugares; contacto: solucionesfabrick.com)"

var (
	cacheLugaresMu sync.Mutex
	cacheLugares   = map[string]entradaLugares{}
)

// ultimaConsulta serializa las llamadas a Nominatim: si llegan tres usuarios
// a la vez, las consultas salen escalonadas en vez de en paralelo.
var (
	turnoMu        sync.Mutex
	ultimaConsulta time.Time
)

func esperarTurno() {
	turnoMu.Lock()
	defer turnoMu.Unlock()
	if !ultimaConsulta.IsZero() {
		if falta := time.Until(ultimaConsulta.Add(1100 * time.Millisecond)); falta > 0 {
			time.Sleep(falta)
		}
	}
	ultimaConsulta = time.Now()
}

func Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800")

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) < 2 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(lugaresRespuesta{OK: false, Error: "escribe al menos 2 letras"})
		return
	}
	if len([]rune(q)) > 120 {
		q = string([]rune(q)[:120])
	}

	lat, _ := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lon, _ := strconv.ParseFloat(r.URL.Query().Get("lon"), 64)

	clave := strings.ToLower(q) + "|" + strconv.Itoa(int(lat*50)) + "," + strconv.Itoa(int(lon*50))
	cacheLugaresMu.Lock()
	if e, ok := cacheLugares[clave]; ok && time.Since(e.at) < 10*time.Minute {
		cacheLugaresMu.Unlock()
		w.Header().Set("X-Lugares-Cache", "hit")
		_, _ = w.Write(e.body)
		return
	}
	cacheLugaresMu.Unlock()

	param := url.Values{}
	param.Set("format", "jsonv2")
	param.Set("q", q)
	param.Set("limit", "7")
	param.Set("addressdetails", "1")
	param.Set("accept-language", "es")
	param.Set("countrycodes", "cl")
	if lat != 0 || lon != 0 {
		// viewbox sólo sesga el resultado hacia la zona del usuario.
		d := 0.6
		param.Set("viewbox", strings.Join([]string{
			format6(lon - d), format6(lat + d), format6(lon + d), format6(lat - d),
		}, ","))
		param.Set("bounded", "0")
	}

	esperarTurno()
	cliente := &http.Client{Timeout: 9 * time.Second}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet,
		"https://nominatim.openstreetmap.org/search?"+param.Encode(), nil)
	var salida lugaresRespuesta
	if err == nil {
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Accept", "application/json")
		var res *http.Response
		res, err = cliente.Do(req)
		if err == nil {
			defer res.Body.Close()
			if res.StatusCode != http.StatusOK {
				err = errDeEstado(res.StatusCode)
			} else {
				var lote []nomBusqueda
				if err = json.NewDecoder(io.LimitReader(res.Body, 3<<20)).Decode(&lote); err == nil {
					salida = lugaresRespuesta{OK: true, Consulta: q, Lugares: []lugar{}, Generado: time.Now().UTC().Format(time.RFC3339)}
					for _, it := range lote {
						la, e1 := strconv.ParseFloat(it.Lat, 64)
						lo, e2 := strconv.ParseFloat(it.Lon, 64)
						if e1 != nil || e2 != nil {
							continue
						}
						salida.Lugares = append(salida.Lugares, lugar{
							Nombre:    nombreDe(it, q),
							Direccion: direccionDe(it),
							Tipo:      it.Type,
							Lat:       la,
							Lon:       lo,
						})
					}
					salida.Total = len(salida.Lugares)
				}
			}
		}
	}
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(lugaresRespuesta{
			OK: false, Consulta: q, Lugares: []lugar{},
			Error:    "no pude buscar direcciones: " + err.Error(),
			Generado: time.Now().UTC().Format(time.RFC3339),
		})
		return
	}

	cuerpo, _ := json.Marshal(salida)
	cacheLugaresMu.Lock()
	if len(cacheLugares) > 400 {
		cacheLugares = map[string]entradaLugares{}
	}
	cacheLugares[clave] = entradaLugares{at: time.Now(), body: cuerpo}
	cacheLugaresMu.Unlock()
	_, _ = w.Write(cuerpo)
}

func format6(v float64) string {
	return strconv.FormatFloat(v, 'f', 6, 64)
}

type errorEstado int

func (e errorEstado) Error() string { return "nominatim respondió " + strconv.Itoa(int(e)) }

func errDeEstado(c int) error { return errorEstado(c) }

// nombreDe prefiere el nombre del local; si no hay, la primera parte de la
// dirección («Providencia, Región…» → «Providencia»).
func nombreDe(it nomBusqueda, consulta string) string {
	if n := strings.TrimSpace(it.Name); n != "" {
		return n
	}
	if it.Address != nil {
		for _, k := range []string{"road", "suburb", "neighbourhood", "city", "town", "village"} {
			if v := strings.TrimSpace(it.Address[k]); v != "" {
				return v
			}
		}
	}
	if d := strings.TrimSpace(it.DisplayName); d != "" {
		if i := strings.Index(d, ","); i > 0 {
			return d[:i]
		}
		return d
	}
	return consulta
}

func direccionDe(it nomBusqueda) string {
	if it.Address == nil {
		return strings.TrimSpace(it.DisplayName)
	}
	partes := []string{}
	calle := strings.TrimSpace(it.Address["road"])
	if calle != "" {
		if n := strings.TrimSpace(it.Address["house_number"]); n != "" {
			calle += " " + n
		}
		partes = append(partes, calle)
	}
	for _, k := range []string{"suburb", "neighbourhood", "city_district", "city", "town", "village"} {
		if v := strings.TrimSpace(it.Address[k]); v != "" {
			partes = append(partes, v)
		}
	}
	if len(partes) == 0 {
		return strings.TrimSpace(it.DisplayName)
	}
	return strings.Join(partes, ", ")
}
