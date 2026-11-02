// FORGE CORE STOCK · /api/mercados
// Mercados cercanos a una coordenada, desde OpenStreetMap vía Overpass API.
//
// Por qué un proxy y no llamar a Overpass desde el navegador:
//   · Overpass limita por IP y devuelve 502 cuando está a tope; un solo
//     servidor con caché de 5 minutos evita castigar el servicio público;
//   · el proxy puede fijar User-Agent (Overpass responde 406 sin él) y
//     reintentar en espejos, cosas que el navegador no controla;
//   · la respuesta sale normalizada y con la distancia ya calculada.
//
// Sin clave, sin registro y sin base de datos: solo lectura de OSM.
// Licencia de los datos: © OpenStreetMap contributors, ODbL.
package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Espejos de Overpass. Se prueban en orden; el primero que responde bien gana.
var espejos = []string{
	"https://overpass-api.de/api/interpreter",
	"https://overpass.kumi.systems/api/interpreter",
	"https://overpass.private.coffee/api/interpreter",
}

const (
	topePorEspejo = 9 * time.Second
	ttlCache      = 5 * time.Minute
	maxMercados   = 60
	userAgent     = "FORGE-CORE-STOCK/1.0 (mercado cercano; contacto: solucionesfabrick.com)"
)

type mercado struct {
	ID        string  `json:"id"`
	Nombre    string  `json:"nombre"`
	Tipo      string  `json:"tipo"`
	Rubro     string  `json:"rubro"`
	Ico       string  `json:"ico"`
	Lat       float64 `json:"lat"`
	Lon       float64 `json:"lon"`
	Dist      int     `json:"dist"`
	Direccion string  `json:"direccion"`
	Comuna    string  `json:"comuna"`
	Horario   string  `json:"horario"`
	Telefono  string  `json:"telefono"`
	Web       string  `json:"web"`
}

type respuesta struct {
	OK       bool      `json:"ok"`
	Origen   string    `json:"origen"`
	Error    string    `json:"error,omitempty"`
	Total    int       `json:"total"`
	Radio    int       `json:"radio"`
	Centro   [2]float64 `json:"centro"`
	Generado string    `json:"generado"`
	Mercados []mercado `json:"mercados"`
}

/* ── características de OSM ─────────────────────────────────────────────── */

// rubros traduce la etiqueta de OSM a algo que se entienda en Chile, con un
// icono propio para la lista y el mapa. `ico` lo resuelve el cliente.
var rubros = map[string][2]string{
	"supermarket":      {"Supermercado", "supermercado"},
	"convenience":      {"Almacén", "almacen"},
	"grocery":          {"Almacén", "almacen"},
	"general":          {"Almacén", "almacen"},
	"greengrocer":      {"Verdulería", "verduleria"},
	"butcher":          {"Carnicería", "carniceria"},
	"bakery":           {"Panadería", "panaderia"},
	"deli":             {"Fiambrería", "fiambreria"},
	"seafood":          {"Pescadería", "pescaderia"},
	"beverages":        {"Botillería", "botilleria"},
	"alcohol":          {"Botillería", "botilleria"},
	"health_food":      {"Dietética", "dietetica"},
	"farm":             {"Granja", "granja"},
	"dairy":            {"Lácteos", "lacteos"},
	"wholesale":        {"Mayorista", "mayorista"},
	"mall":             {"Centro comercial", "mall"},
	"department_store": {"Tienda", "tienda"},
	"marketplace":      {"Feria", "feria"},
}

type osmElemento struct {
	Type   string            `json:"type"`
	ID     int64             `json:"id"`
	Lat    float64           `json:"lat"`
	Lon    float64           `json:"lon"`
	Center *struct {
		Lat float64 `json:"lat"`
		Lon float64 `json:"lon"`
	} `json:"center"`
	Tags map[string]string `json:"tags"`
}

type osmRespuesta struct {
	Elements []osmElemento `json:"elements"`
}

/* ── caché en memoria (por instancia; Vercel la reutiliza mientras vive) ── */

type entrada struct {
	at   time.Time
	body []byte
}

var (
	cacheMu sync.Mutex
	cache   = map[string]entrada{}
)

func deCache(k string) ([]byte, bool) {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	e, ok := cache[k]
	if !ok || time.Since(e.at) > ttlCache {
		if ok {
			delete(cache, k)
		}
		return nil, false
	}
	return e.body, true
}

func aCache(k string, b []byte) {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	if len(cache) > 300 { // techo simple: sin esto la instancia crecería sin fin
		cache = map[string]entrada{}
	}
	cache[k] = entrada{at: time.Now(), body: b}
}

/* ── consulta ───────────────────────────────────────────────────────────── */

func consulta(lat, lon float64, radio int) string {
	return fmt.Sprintf(`[out:json][timeout:16];
(
  nwr["shop"~"^(supermarket|convenience|grocery|general|greengrocer|butcher|bakery|deli|seafood|beverages|alcohol|health_food|farm|dairy|wholesale|mall|department_store)$"](around:%d,%.6f,%.6f);
  nwr["amenity"="marketplace"](around:%d,%.6f,%.6f);
);
out center tags %d;`, radio, lat, lon, radio, lat, lon, maxMercados*2)
}

func pedir(cliente *http.Client, base, q string) (*osmRespuesta, error) {
	v := url.Values{}
	v.Set("data", q)
	req, err := http.NewRequest(http.MethodPost, base, strings.NewReader(v.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")

	res, err := cliente.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	cuerpo, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("overpass %d: %s", res.StatusCode, strings.TrimSpace(string(cuerpo[:min(len(cuerpo), 120)])))
	}
	var out osmRespuesta
	if err := json.Unmarshal(cuerpo, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func haversine(la1, lo1, la2, lo2 float64) float64 {
	const r = 6371000.0
	f1, f2 := la1*math.Pi/180, la2*math.Pi/180
	df := (la2 - la1) * math.Pi / 180
	dl := (lo2 - lo1) * math.Pi / 180
	a := math.Sin(df/2)*math.Sin(df/2) + math.Cos(f1)*math.Cos(f2)*math.Sin(dl/2)*math.Sin(dl/2)
	return 2 * r * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func normalizar(el osmElemento, lat, lon float64) (mercado, bool) {
	t := el.Tags
	if t == nil {
		return mercado{}, false
	}
	clave, valor := "", ""
	switch {
	case t["amenity"] == "marketplace":
		clave, valor = "marketplace", "marketplace"
	case t["shop"] != "":
		clave, valor = "shop", t["shop"]
	}
	if clave == "" {
		return mercado{}, false
	}

	la, lo := el.Lat, el.Lon
	if el.Center != nil && (la == 0 || lo == 0) {
		la, lo = el.Center.Lat, el.Center.Lon
	}
	if la == 0 && lo == 0 {
		return mercado{}, false
	}

	rubro, ico := rubros[valor][0], rubros[valor][1]
	if rubro == "" {
		rubro, ico = "Local", "tienda"
	}
	nombre := strings.TrimSpace(t["name"])
	if nombre == "" {
		nombre = rubro + " sin nombre"
	}

	dir := strings.TrimSpace(strings.TrimSpace(t["addr:street"]) + " " + strings.TrimSpace(t["addr:housenumber"]))
	comuna := t["addr:city"]
	if comuna == "" {
		comuna = t["addr:suburb"]
	}

	return mercado{
		ID:        fmt.Sprintf("%s/%d", el.Type, el.ID),
		Nombre:    nombre,
		Tipo:      valor,
		Rubro:     rubro,
		Ico:       ico,
		Lat:       la,
		Lon:       lo,
		Dist:      int(math.Round(haversine(lat, lon, la, lo))),
		Direccion: dir,
		Comuna:    comuna,
		Horario:   t["opening_hours"],
		Telefono:  first(t["phone"], t["contact:phone"], t["mobile"]),
		Web:       first(t["website"], t["contact:website"], t["facebook"]),
	}, true
}

func first(vs ...string) string {
	for _, v := range vs {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

/* ── handler ────────────────────────────────────────────────────────────── */

func Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600")

	lat, errLat := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lon, errLon := strconv.ParseFloat(r.URL.Query().Get("lon"), 64)
	if errLat != nil || errLon != nil || math.Abs(lat) > 90 || math.Abs(lon) > 180 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(respuesta{OK: false, Error: "lat y lon son obligatorios (grados decimales)"})
		return
	}

	radio, _ := strconv.Atoi(r.URL.Query().Get("r"))
	if radio < 200 {
		radio = 1500
	}
	if radio > 5000 {
		radio = 5000
	}

	clave := fmt.Sprintf("%.3f,%.3f,%d", lat, lon, radio)
	if cuerpo, ok := deCache(clave); ok {
		w.Header().Set("X-Mercados-Cache", "hit")
		_, _ = w.Write(cuerpo)
		return
	}
	w.Header().Set("X-Mercados-Cache", "miss")

	cliente := &http.Client{Timeout: topePorEspejo}
	q := consulta(lat, lon, radio)

	var osm *osmRespuesta
	var ultimo error
	for _, espejo := range espejos {
		osm, ultimo = pedir(cliente, espejo, q)
		if ultimo == nil {
			break
		}
	}

	out := respuesta{
		OK:       osm != nil,
		Origen:   "overpass",
		Radio:    radio,
		Centro:   [2]float64{lat, lon},
		Generado: time.Now().UTC().Format(time.RFC3339),
		Mercados: []mercado{},
	}
	if osm == nil {
		out.Error = "Overpass no respondió"
		if ultimo != nil {
			out.Error = ultimo.Error()
		}
	} else {
		vistos := map[string]bool{}
		for _, el := range osm.Elements {
			m, ok := normalizar(el, lat, lon)
			if !ok || vistos[m.ID] {
				continue
			}
			if m.Dist > radio { // `around` ya filtra, pero el centro del área puede caer fuera
				continue
			}
			vistos[m.ID] = true
			out.Mercados = append(out.Mercados, m)
		}
		sort.Slice(out.Mercados, func(i, j int) bool { return out.Mercados[i].Dist < out.Mercados[j].Dist })
		if len(out.Mercados) > maxMercados {
			out.Mercados = out.Mercados[:maxMercados]
		}
		out.Total = len(out.Mercados)
	}

	cuerpo, _ := json.Marshal(out)
	if out.OK && len(out.Mercados) > 0 {
		aCache(clave, cuerpo)
	}
	_, _ = w.Write(cuerpo)
}
