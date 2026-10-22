package main

import (
	"context"
	"net/http"
	"time"
)

// contextWithTimeout acota la vida de una petición (el agente no puede colgarse).
func contextWithTimeout(r *http.Request, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), d)
}
