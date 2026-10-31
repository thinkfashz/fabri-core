// FORGE CORE STOCK · /api/catalogo
// Marketplace en la nube: catálogo público de productos de la tienda.
//
// Cada producto lleva: id, nombre, categoria, clasificacion, descripcion,
// precio (CLP), stock y un token de tinte para la tarjeta (sin imágenes
// pesadas). El endpoint permite filtrar por:
//
//	q=<texto>          búsqueda en nombre + descripción
//	categoria=<id>      filtro por categoría
//	clasificacion=<id>  filtro por clasificación
//	max_precio=<numero>  precio de venta máximo
//
// Es público y de solo lectura: no guarda nada ni pide token. El catálogo se
// sirve desde datos sembrados; si el proyecto tiene BLOB_READ_WRITE_TOKEN, se
// intenta leer una sobreescritura de "fabri/catalogo.json" (mismo formato:
// { "productos": [...] }), útil para editar el catálogo sin redeploy.
package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
)

type producto struct {
	ID            string  `json:"id"`
	Nombre        string  `json:"nombre"`
	Categoria     string  `json:"categoria"`
	Clasificacion string  `json:"clasificacion"`
	Descripcion   string  `json:"descripcion"`
	Precio        float64 `json:"precio"`
	Moneda        string  `json:"moneda"`
	Stock         int     `json:"stock"`
	Tinte         string  `json:"tinte"`
}

// Catálogo sembrado. Los tintes son colores de acento del sistema (lima,
// púrpura, cian) para la tarjeta; no son imágenes.
var catalogoSeed = []producto{
	{ID: "eq-001", Nombre: "Caja registradora táctil", Categoria: "Equipos", Clasificacion: "Gama alta", Descripcion: "Pantalla de 15,6\" con Android integrado, impresora térmica de 80 mm y batería de respaldo.", Precio: 489990, Moneda: "CLP", Stock: 12, Tinte: "#c8f542"},
	{ID: "eq-002", Nombre: "Lector de códigos láser", Categoria: "Equipos", Clasificacion: "Gama media", Descripcion: "Escáner de mano ergonómico, lee EAN-13, Code128 y QR a 30 cm.", Precio: 45990, Moneda: "CLP", Stock: 40, Tinte: "#8c8cff"},
	{ID: "eq-003", Nombre: "Báscula de mostrador", Categoria: "Equipos", Clasificacion: "Economico", Descripcion: "Capacidad 30 kg, precisión de 5 g, cabezal orientable con teclado.", Precio: 74990, Moneda: "CLP", Stock: 8, Tinte: "#3fe0c9"},
	{ID: "eq-004", Nombre: "Terminal de punto de venta", Categoria: "Equipos", Clasificacion: "Gama alta", Descripcion: "Procesador dual-core, doble pantalla, soporte VESA y 4 GB de RAM.", Precio: 359990, Moneda: "CLP", Stock: 5, Tinte: "#c8f542"},
	{ID: "ac-001", Nombre: "Papel térmico 80 mm", Categoria: "Insumos", Clasificacion: "Gama media", Descripcion: "Rollos de 50 mm de diámetro, calidad industrial, por caja de 50 unidades.", Precio: 18990, Moneda: "CLP", Stock: 120, Tinte: "#5aa9ff"},
	{ID: "ac-002", Nombre: "Cinta para medir stock", Categoria: "Insumos", Clasificacion: "Economico", Descripcion: "Rollo de 300 etiquetas por caja, resistente a agua y frío.", Precio: 8990, Moneda: "CLP", Stock: 86, Tinte: "#3fe0c9"},
	{ID: "ac-003", Nombre: "Cargador de sobremesa", Categoria: "Accesorios", Clasificacion: "Gama media", Descripcion: "Fuente de 12 V / 3 A con cable de 1,5 m, ideal para terminales POS.", Precio: 12990, Moneda: "CLP", Stock: 34, Tinte: "#ffc24b"},
	{ID: "ac-004", Nombre: "Soporte metálico para display", Categoria: "Accesorios", Clasificacion: "Economico", Descripcion: "Base orientable 360° con brazo ajustable en altura.", Precio: 15990, Moneda: "CLP", Stock: 22, Tinte: "#8c8cff"},
	{ID: "au-001", Nombre: "Altavoz de mostrador", Categoria: "Audio", Clasificacion: "Gama media", Descripcion: "5 W, plug 3,5 mm, carcasa de aluminio.", Precio: 19990, Moneda: "CLP", Stock: 18, Tinte: "#c8f542"},
	{ID: "au-002", Nombre: "Torre de sonido para local", Categoria: "Audio", Clasificacion: "Gama alta", Descripcion: "2×50 W, Bluetooth, entrada USB y control remoto.", Precio: 129990, Moneda: "CLP", Stock: 6, Tinte: "#ff7a8a"},
	{ID: "pr-001", Nombre: "Lámina anti-robo para vitrina", Categoria: "Protección", Clasificacion: "Premium", Descripcion: "Lámina de seguridad de 0,22 mm con adhesivo de alta sujeción.", Precio: 34990, Moneda: "CLP", Stock: 4, Tinte: "#5aa9ff"},
	{ID: "pr-002", Nombre: "Candado de vitrina", Categoria: "Protección", Clasificacion: "Gama media", Descripcion: "Cuerpo de acero, llave doble y cierre reforzado.", Precio: 11990, Moneda: "CLP", Stock: 15, Tinte: "#3fe0c9"},
}

func catalogoPath() string { return "fabri/catalogo.json" }

func out(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// Lee el catálogo definitivo: sobreescritura de Blob si existe, si no el seed.
func catalogoCargar() []producto {
	if t := os.Getenv("BLOB_READ_WRITE_TOKEN"); t != "" {
		req, err := http.NewRequest("GET", "https://blob.vercel-storage.com/"+catalogoPath(), nil)
		if err == nil {
			req.Header.Set("authorization", "Bearer "+t)
			req.Header.Set("x-api-version", "12")
			cliente := &http.Client{Timeout: 7e9}
			res, err := cliente.Do(req)
			if err == nil && res.StatusCode == 200 {
				defer res.Body.Close()
				var sobre struct {
					Data string `json:"data"`
				}
				if json.NewDecoder(res.Body).Decode(&sobre) == nil && sobre.Data != "" {
					var varios []producto
					if json.Unmarshal([]byte(sobre.Data), &varios) == nil && len(varios) > 0 {
						return varios
					}
				}
			}
		}
	}
	return catalogoSeed
}

func Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		out(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "solo GET"})
		return
	}

	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	categoria := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("categoria")))
	clasificacion := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("clasificacion")))
	maxPrecio := -1.0
	if v := strings.TrimSpace(r.URL.Query().Get("max_precio")); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil && n > 0 {
			maxPrecio = n
		}
	}

	productos := catalogoCargar()
	filtrados := make([]producto, 0, len(productos))
	for _, p := range productos {
		if categoria != "" && strings.ToLower(p.Categoria) != categoria {
			continue
		}
		if clasificacion != "" && strings.ToLower(p.Clasificacion) != clasificacion {
			continue
		}
		if maxPrecio >= 0 && p.Precio > maxPrecio {
			continue
		}
		if q != "" {
			texto := strings.ToLower(p.Nombre + " " + p.Descripcion + " " + p.Categoria + " " + p.Clasificacion)
			if !strings.Contains(texto, q) {
				continue
			}
		}
		filtrados = append(filtrados, p)
	}

	sort.Slice(filtrados, func(i, j int) bool { return filtrados[i].Precio < filtrados[j].Precio })

	// Categorías y clasificaciones disponibles (para poblar los filtros).
	unico := func(sel func(producto) string) []string {
		vis := map[string]bool{}
		var salida []string
		for _, p := range productos {
			if v := sel(p); v != "" && !vis[v] {
				vis[v] = true
				salida = append(salida, v)
			}
		}
		sort.Strings(salida)
		return salida
	}

	out(w, 200, map[string]any{
		"ok":              true,
		"servicio":        "fabri-api",
		"catalogo":        "forge-core-stock",
		"total":           len(filtrados),
		"productos":       filtrados,
		"categorias":      unico(func(p producto) string { return p.Categoria }),
		"clasificaciones": unico(func(p producto) string { return p.Clasificacion }),
		"filtros": map[string]any{
			"q": q, "categoria": categoria, "clasificacion": clasificacion,
			"max_precio": fmt.Sprintf("%v", maxPrecio),
		},
	})
}
