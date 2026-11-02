// FORGE CORE STOCK · /api/mercados
// Mercados cercanos a una coordenada, desde OpenStreetMap vía Overpass API.
//
// Por qué un proxy y no llamar a Overpass desde el navegador:
//
//	· Overpass limita por IP y devuelve 502 cuando está a tope; un solo
//	  servidor con caché de 5 minutos evita castigar el servicio público;
//	· el proxy puede fijar User-Agent (Overpass responde 406 sin él) y
//	  reintentar en espejos, cosas que el navegador no controla;
//	· la respuesta sale normalizada y con la distancia ya calculada.
//
// Sin clave, sin registro y sin base de datos: solo lectura de OSM.
// Licencia de los datos: © OpenStreetMap contributors, ODbL.
package handler

import (
	"context"
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

// Espejos de Overpass. Se consultan EN PARALELO y gana el primero que responde:
// en serie, con un espejo caído, el usuario esperaba 20 s. osm.ch es el que
// responde desde las redes móviles de acá; el resto son respaldo.
// (overpass.osm.ch queda fuera a propósito: es la instancia suiza y responde
// vacío para Chile, que es peor que fallar.)
var espejos = []string{
	"https://overpass-api.de/api/interpreter",
	"https://overpass.kumi.systems/api/interpreter",
	"https://overpass.private.coffee/api/interpreter",
	"https://overpass.osm.jp/api/interpreter",
}

const (
	topePorEspejo = 11 * time.Second
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
	OK       bool       `json:"ok"`
	Origen   string     `json:"origen"`
	Error    string     `json:"error,omitempty"`
	Total    int        `json:"total"`
	Radio    int        `json:"radio"`
	Centro   [2]float64 `json:"centro"`
	Generado string     `json:"generado"`
	Mercados []mercado  `json:"mercados"`
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
	Type   string  `json:"type"`
	ID     int64   `json:"id"`
	Lat    float64 `json:"lat"`
	Lon    float64 `json:"lon"`
	Center *struct {
		Lat float64 `json:"lat"`
		Lon float64 `json:"lon"`
	} `json:"center"`
	Tags map[string]string `json:"tags"`
}

type osmRespuesta struct {
	Elements []osmElemento `json:"elements"`
}

/* ── Nominatim: segunda fuente ─────────────────────────────────────────── */
// Overpass se satura seguido (502 "at capacity") y varias instancias solo
// resuelven por IPv6, que en las redes móviles de acá es un agujero negro.
// Nominatim responde por IPv4 y devuelve los mismos POIs de OSM con nombre y
// dirección; se usa como red de seguridad y para completar la lista.

type nomItem struct {
	PlaceID   int               `json:"place_id"`
	Lat       string            `json:"lat"`
	Lon       string            `json:"lon"`
	Name      string            `json:"name"`
	Type      string            `json:"type"`
	Address   map[string]string `json:"address"`
	ExtraTags map[string]string `json:"extratags"`
}

// Términos de búsqueda: Nominatim es un buscador, no un filtro por etiqueta.
var terminos = []string{"supermercado", "almacén", "feria", "verdulería", "panadería"}

func buscarNominatim(ctx context.Context, cliente *http.Client, lat, lon float64, radio int) ([]mercado, error) {
	d := float64(radio) / 111000.0
	caja := fmt.Sprintf("%.6f,%.6f,%.6f,%.6f",
		lon-d, lat+d, lon+d, lat-d) // left,top,right,bottom

	type salida struct {
		items []mercado
		err   error
	}
	canal := make(chan salida, len(terminos))
	for i, termino := range terminos {
		go func(i int, termino string) {
			// Una consulta por segundo como máximo (política de Nominatim).
			select {
			case <-time.After(time.Duration(i) * 1050 * time.Millisecond):
			case <-ctx.Done():
				canal <- salida{nil, ctx.Err()}
				return
			}
			q := url.Values{}
			q.Set("format", "jsonv2")
			q.Set("q", termino)
			q.Set("viewbox", caja)
			q.Set("bounded", "1")
			q.Set("limit", "25")
			q.Set("addressdetails", "1")
			q.Set("extratags", "1")
			q.Set("accept-language", "es")

			req, err := http.NewRequestWithContext(ctx, http.MethodGet,
				"https://nominatim.openstreetmap.org/search?"+q.Encode(), nil)
			if err != nil {
				canal <- salida{nil, err}
				return
			}
			req.Header.Set("User-Agent", userAgent)
			req.Header.Set("Accept", "application/json")

			res, err := cliente.Do(req)
			if err != nil {
				canal <- salida{nil, err}
				return
			}
			defer res.Body.Close()
			if res.StatusCode != http.StatusOK {
				canal <- salida{nil, fmt.Errorf("nominatim %d", res.StatusCode)}
				return
			}
			var lote []nomItem
			if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&lote); err != nil {
				canal <- salida{nil, err}
				return
			}
			out := make([]mercado, 0, len(lote))
			for _, it := range lote {
				la, e1 := strconv.ParseFloat(it.Lat, 64)
				lo, e2 := strconv.ParseFloat(it.Lon, 64)
				if e1 != nil || e2 != nil {
					continue
				}
				dist := int(math.Round(haversine(lat, lon, la, lo)))
				if dist > radio || it.Name == "" {
					continue
				}
				rubro, ico := rubros[it.Type][0], rubros[it.Type][1]
				if rubro == "" {
					rubro, ico = rubros[terminos[0]][0], "supermercado"
					switch termino {
					case "feria":
						rubro, ico = "Feria", "feria"
					case "verdulería":
						rubro, ico = "Verdulería", "verduleria"
					case "panadería":
						rubro, ico = "Panadería", "panaderia"
					case "almacén":
						rubro, ico = "Almacén", "almacen"
					}
				}
				out = append(out, mercado{
					ID:     "nominatim/" + strconv.Itoa(it.PlaceID),
					Nombre: it.Name,
					Tipo:   it.Type,
					Rubro:  rubro,
					Ico:    ico,
					Lat:    la, Lon: lo, Dist: dist,
					Direccion: strings.TrimSpace(it.Address["road"] + " " + it.Address["house_number"]),
					Comuna:    first(it.Address["city"], it.Address["town"], it.Address["suburb"]),
					Horario:   it.ExtraTags["opening_hours"],
					Telefono:  first(it.ExtraTags["phone"], it.ExtraTags["contact:phone"]),
					Web:       first(it.ExtraTags["website"], it.ExtraTags["contact:website"]),
				})
			}
			canal <- salida{out, nil}
		}(i, termino)
	}

	var todos []mercado
	var ultimo error
	for i := 0; i < len(terminos); i++ {
		select {
		case s := <-canal:
			if s.err != nil {
				ultimo = s.err
			}
			todos = append(todos, s.items...)
		case <-ctx.Done():
			i = len(terminos)
		}
	}
	if len(todos) == 0 && ultimo != nil {
		return nil, ultimo
	}
	return todos, nil
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

func pedir(ctx context.Context, cliente *http.Client, base, q string) (*osmRespuesta, error) {
	v := url.Values{}
	v.Set("data", q)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base, strings.NewReader(v.Encode()))
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

// unir descarta duplicados: el mismo negocio puede venir de Overpass y de
// Nominatim con identificadores distintos.
func unir(lista []mercado) []mercado {
	vistos := make([]mercado, 0, len(lista))
	for _, m := range lista {
		repetido := false
		for _, v := range vistos {
			if strings.EqualFold(v.Nombre, m.Nombre) && haversine(v.Lat, v.Lon, m.Lat, m.Lon) < 60 {
				repetido = true
				break
			}
		}
		if !repetido {
			vistos = append(vistos, m)
		}
	}
	return vistos
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

/* ── handler ────────────────────────────────────────────────────────────── */

// buscarOverpass lanza todos los espejos a la vez y devuelve la primera
// respuesta CON datos; las demás se cancelan.
func buscarOverpass(ctx context.Context, cliente *http.Client, lat, lon float64, radio int) ([]mercado, error) {
	q := consulta(lat, lon, radio)
	tipo, cancelar := context.WithTimeout(ctx, topePorEspejo)
	defer cancelar()

	type salida struct {
		res *osmRespuesta
		err error
	}
	canal := make(chan salida, len(espejos))
	for _, espejo := range espejos {
		go func(base string) {
			res, err := pedir(tipo, cliente, base, q)
			canal <- salida{res, err}
		}(espejo)
	}

	var osm *osmRespuesta
	var vacia *osmRespuesta
	var ultimo error
	for i := 0; i < len(espejos); i++ {
		select {
		case s := <-canal:
			if s.err == nil && s.res != nil {
				if len(s.res.Elements) > 0 {
					osm = s.res
					cancelar()
				} else if vacia == nil {
					vacia = s.res
				}
			} else if s.err != nil {
				ultimo = s.err
			}
		case <-tipo.Done():
			i = len(espejos)
		}
		if osm != nil {
			break
		}
	}
	if osm == nil {
		osm = vacia
	}
	if osm == nil {
		if ultimo == nil {
			ultimo = fmt.Errorf("sin respuesta de Overpass")
		}
		return nil, ultimo
	}

	vistos := map[string]bool{}
	out := make([]mercado, 0, len(osm.Elements))
	for _, el := range osm.Elements {
		m, ok := normalizar(el, lat, lon)
		if !ok || vistos[m.ID] || m.Dist > radio {
			continue
		}
		vistos[m.ID] = true
		out = append(out, m)
	}
	return out, nil
}

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
	ctxO, cancelarO := context.WithTimeout(r.Context(), topePorEspejo)
	defer cancelarO()
	ctxN, cancelarN := context.WithTimeout(r.Context(), 9*time.Second)
	defer cancelarN()

	// Las dos fuentes arrancan juntas: Overpass trae más comercios y Nominatim
	// responde aunque Overpass esté saturado. Se usa la primera que llegue con
	// datos y, si la otra aparece en la ventana de gracia, se suman.
	type resultado struct {
		lista []mercado
		err   error
	}
	canalO := make(chan resultado, 1)
	canalN := make(chan []mercado, 1)
	go func() {
		l, err := buscarOverpass(ctxO, cliente, lat, lon, radio)
		canalO <- resultado{l, err}
	}()
	go func() {
		l, _ := buscarNominatim(ctxN, cliente, lat, lon, radio)
		canalN <- l
	}()

	var deO, deN []mercado
	var errOverpass error
	recibidas := 0
	limite := time.NewTimer(topePorEspejo)
	defer limite.Stop()
	for recibidas < 2 {
		select {
		case r := <-canalO:
			deO, errOverpass = r.lista, r.err
			recibidas++
		case l := <-canalN:
			deN = l
			recibidas++
		case <-limite.C:
			recibidas = 2
		}
		if recibidas >= 1 && (len(deO) > 0 || len(deN) > 0) {
			// ventana corta para la otra fuente; no se espera de más
			select {
			case r := <-canalO:
				deO, errOverpass = r.lista, r.err
			case l := <-canalN:
				deN = l
			case <-time.After(1200 * time.Millisecond):
			}
			break
		}
	}
	cancelarO()
	cancelarN()

	out := respuesta{
		OK:       false,
		Origen:   "overpass",
		Radio:    radio,
		Centro:   [2]float64{lat, lon},
		Generado: time.Now().UTC().Format(time.RFC3339),
		Mercados: []mercado{},
	}
	if len(deN) > 0 && len(deO) == 0 {
		out.Origen = "nominatim"
	}
	out.Mercados = unir(append(deO, deN...))
	sort.Slice(out.Mercados, func(i, j int) bool { return out.Mercados[i].Dist < out.Mercados[j].Dist })
	if len(out.Mercados) > maxMercados {
		out.Mercados = out.Mercados[:maxMercados]
	}
	out.Total = len(out.Mercados)
	if out.Total > 0 {
		out.OK = true
	} else if errOverpass != nil {
		out.Error = errOverpass.Error()
	} else {
		out.Error = "sin comercios en el radio"
	}

	cuerpo, _ := json.Marshal(out)
	if out.OK {
		aCache(clave, cuerpo)
	}
	_, _ = w.Write(cuerpo)
}
