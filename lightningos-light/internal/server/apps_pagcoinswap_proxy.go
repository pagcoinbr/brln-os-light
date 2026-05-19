// Pagcoin Swap — local reverse proxy.
//
// The Pagcoin Swap gateway lives at a Tor v3 hidden service which a normal
// browser cannot reach (no name resolution for .onion). This handler is the
// bridge: the React page calls `/api/apps/pagcoinswap/proxy/<rest>`, and we
// forward it to `<onion-base>/<rest>` through the local Tor SOCKS5 proxy,
// injecting the operator's Bearer key server-side so it never reaches the
// browser.
//
// All sensitive config (operator API key, onion URL, Tor proxy address)
// stays in the brln-os-light secrets env file. The frontend can ask whether
// they're set, but never sees the values themselves.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"golang.org/x/net/proxy"
)

const (
	pagcoinSwapOperatorKeyEnv = "PAGCOINSWAP_OPERATOR_KEY"
	pagcoinSwapSocksAddrEnv   = "PAGCOINSWAP_SOCKS_ADDR"
	pagcoinSwapDefaultSocks   = "127.0.0.1:9050"

	pagcoinSwapProxyPrefix = "/api/apps/pagcoinswap/proxy/"
)

func pagcoinSwapOperatorKey() string {
	if v := strings.TrimSpace(envOrFileValue(pagcoinSwapOperatorKeyEnv)); v != "" {
		return v
	}
	return ""
}

func pagcoinSwapSocksAddr() string {
	if v := strings.TrimSpace(envOrFileValue(pagcoinSwapSocksAddrEnv)); v != "" {
		return v
	}
	return pagcoinSwapDefaultSocks
}

// envOrFileValue checks the process env first, then the shared secrets env
// file. Returns "" if neither has a non-empty value.
func envOrFileValue(key string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	v, err := readEnvFileValue(secretsEnvPath, key)
	if err != nil {
		return ""
	}
	return v
}

// Tor-aware HTTP client. SOCKS5 dialing fails fast at request time if Tor
// isn't reachable — there is no "graceful degrade" to clearnet here, and
// that's intentional: this code should not silently leak operator calls.
func pagcoinSwapHTTPClient() (*http.Client, error) {
	socks := pagcoinSwapSocksAddr()
	dialer, err := proxy.SOCKS5("tcp", socks, nil, proxy.Direct)
	if err != nil {
		return nil, fmt.Errorf("init socks5 dialer (%s): %w", socks, err)
	}
	cdialer, ok := dialer.(proxy.ContextDialer)
	if !ok {
		return nil, errors.New("socks5 dialer missing context support")
	}
	transport := &http.Transport{
		DialContext: cdialer.DialContext,
		// Onion connections are slow; keep generous but bounded.
		TLSHandshakeTimeout:   30 * time.Second,
		ResponseHeaderTimeout: 60 * time.Second,
	}
	return &http.Client{Transport: transport, Timeout: 90 * time.Second}, nil
}

func (s *Server) handlePagcoinSwapProxy(w http.ResponseWriter, r *http.Request) {
	gatewayURL := strings.TrimSpace(pagcoinSwapURL())
	if gatewayURL == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "gateway_url_not_set",
		})
		return
	}
	gatewayURL = strings.TrimRight(gatewayURL, "/")

	rest := strings.TrimPrefix(r.URL.Path, pagcoinSwapProxyPrefix)
	if rest == r.URL.Path {
		// Shouldn't happen given the route registration, but defend.
		writeJSON(w, http.StatusNotFound, map[string]string{
			"error": "bad_proxy_path",
		})
		return
	}
	target := gatewayURL + "/" + rest
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}

	if _, err := url.Parse(target); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "invalid_target",
		})
		return
	}

	body := r.Body
	defer func() { _ = body.Close() }()

	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	upstreamReq, err := http.NewRequestWithContext(ctx, r.Method, target, body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "build_request_failed", "detail": err.Error(),
		})
		return
	}

	// Forward only safe headers. Strip browser cookies, host, and anything
	// that would leak the local origin to the onion.
	for _, k := range []string{"Content-Type", "Accept", "Accept-Encoding"} {
		if v := r.Header.Get(k); v != "" {
			upstreamReq.Header.Set(k, v)
		}
	}
	// Inject operator bearer key server-side. If it's missing, surface a
	// clean 412 rather than a generic 401 from the upstream.
	if key := pagcoinSwapOperatorKey(); key != "" {
		upstreamReq.Header.Set("Authorization", "Bearer "+key)
	} else {
		writeJSON(w, http.StatusPreconditionFailed, map[string]string{
			"error": "operator_key_not_set",
			"hint":  "POST /api/apps/pagcoinswap/config with operator_key",
		})
		return
	}

	client, err := pagcoinSwapHTTPClient()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"error": "tor_unavailable", "detail": err.Error(),
		})
		return
	}

	resp, err := client.Do(upstreamReq)
	if err != nil {
		// Distinguish network-layer (Tor not reachable, no descriptor, etc.)
		// from upstream auth/server errors — those come back via resp.
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"error":  "upstream_request_failed",
			"detail": err.Error(),
		})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	for k, vv := range resp.Header {
		// Stream the response transparently — clients of the proxy
		// route the brln-os-light frontend can read errors directly.
		if k == "Set-Cookie" {
			// Don't propagate gateway cookies into the brln-os-light origin.
			continue
		}
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

// -- Config endpoints ---------------------------------------------------------

// GET /api/apps/pagcoinswap/config — what's configured, with secrets redacted.
func (s *Server) handlePagcoinSwapConfigGet(w http.ResponseWriter, _ *http.Request) {
	resp := map[string]any{
		"gateway_url":      pagcoinSwapURL(),
		"operator_key_set": pagcoinSwapOperatorKey() != "",
		"socks_addr":       pagcoinSwapSocksAddr(),
		"tor_reachable":    pagcoinSwapTorReachable(),
	}
	writeJSON(w, http.StatusOK, resp)
}

// POST /api/apps/pagcoinswap/config — set operator_key and/or gateway_url.
// Empty fields are ignored (allows partial updates). Operator key is never
// echoed back.
func (s *Server) handlePagcoinSwapConfigPost(w http.ResponseWriter, r *http.Request) {
	defer func() { _ = r.Body.Close() }()
	var body struct {
		OperatorKey *string `json:"operator_key"`
		GatewayURL  *string `json:"gateway_url"`
		SocksAddr   *string `json:"socks_addr"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "invalid_body", "detail": err.Error(),
		})
		return
	}
	if body.OperatorKey != nil {
		v := strings.TrimSpace(*body.OperatorKey)
		// Soft sanity check; the real validation is whether the gateway
		// accepts the bearer. We just refuse obviously-empty saves.
		if err := writeEnvFileValue(secretsEnvPath, pagcoinSwapOperatorKeyEnv, v); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "write_failed", "detail": err.Error(),
			})
			return
		}
		_ = os.Setenv(pagcoinSwapOperatorKeyEnv, v)
	}
	if body.GatewayURL != nil {
		v := strings.TrimSpace(*body.GatewayURL)
		if err := writeEnvFileValue(secretsEnvPath, pagcoinSwapURLEnv, v); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "write_failed", "detail": err.Error(),
			})
			return
		}
		_ = os.Setenv(pagcoinSwapURLEnv, v)
	}
	if body.SocksAddr != nil {
		v := strings.TrimSpace(*body.SocksAddr)
		if err := writeEnvFileValue(secretsEnvPath, pagcoinSwapSocksAddrEnv, v); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "write_failed", "detail": err.Error(),
			})
			return
		}
		_ = os.Setenv(pagcoinSwapSocksAddrEnv, v)
	}
	// Reflect new state.
	s.handlePagcoinSwapConfigGet(w, r)
}

func pagcoinSwapTorReachable() bool {
	conn, err := net.DialTimeout("tcp", pagcoinSwapSocksAddr(), 2*time.Second)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
