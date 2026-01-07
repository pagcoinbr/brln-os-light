package server

import (
  "net/http"
  "path/filepath"
  "strings"

  "github.com/go-chi/chi/v5"
  "github.com/go-chi/chi/v5/middleware"
)

func (s *Server) routes() http.Handler {
  r := chi.NewRouter()
  r.Use(middleware.Recoverer)
  r.Use(s.requestLogger())

  r.Get("/api/health", s.handleHealth)
  r.Get("/api/system", s.handleSystem)
  r.Get("/api/disk", s.handleDisk)
  r.Get("/api/postgres", s.handlePostgres)
  r.Get("/api/bitcoin", s.handleBitcoin)
  r.Get("/api/lnd/status", s.handleLNDStatus)
  r.Get("/api/lnd/config", s.handleLNDConfigGet)
  r.Post("/api/wizard/bitcoin-remote", s.handleWizardBitcoinRemote)
  r.Post("/api/wizard/lnd/create-wallet", s.handleCreateWallet)
  r.Post("/api/wizard/lnd/init-wallet", s.handleInitWallet)
  r.Post("/api/wizard/lnd/unlock", s.handleUnlockWallet)
  r.Post("/api/actions/restart", s.handleRestart)
  r.Get("/api/logs", s.handleLogs)
  r.Post("/api/lnd/config", s.handleLNDConfigPost)
  r.Post("/api/lnd/config/raw", s.handleLNDConfigRaw)

  r.Route("/api/wallet", func(r chi.Router) {
    r.Get("/summary", s.handleWalletSummary)
    r.Post("/invoice", s.handleWalletInvoice)
    r.Post("/pay", s.handleWalletPay)
  })

  staticDir := s.cfg.UI.StaticDir
  r.Get("/*", s.handleSPA(staticDir))

  return r
}

func (s *Server) handleSPA(staticDir string) http.HandlerFunc {
  fileServer := http.FileServer(http.Dir(staticDir))
  indexPath := filepath.Join(staticDir, "index.html")

  return func(w http.ResponseWriter, r *http.Request) {
    if r.URL.Path != "/" {
      path := strings.TrimPrefix(r.URL.Path, "/")
      if _, err := http.Dir(staticDir).Open(path); err == nil {
        fileServer.ServeHTTP(w, r)
        return
      }
    }

    http.ServeFile(w, r, indexPath)
  }
}
