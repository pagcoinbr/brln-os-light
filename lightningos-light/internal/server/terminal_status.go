package server

import (
  "net/http"
  "os"
  "strconv"
  "strings"
)

type terminalStatus struct {
  Enabled bool `json:"enabled"`
  Credential string `json:"credential"`
  AllowWrite bool `json:"allow_write"`
  Port int `json:"port"`
}

func (s *Server) handleTerminalStatus(w http.ResponseWriter, r *http.Request) {
  enabled := strings.TrimSpace(os.Getenv("TERMINAL_ENABLED")) == "1"
  credential := strings.TrimSpace(os.Getenv("TERMINAL_CREDENTIAL"))
  allowWrite := strings.TrimSpace(os.Getenv("TERMINAL_ALLOW_WRITE")) == "1"
  port := 7681
  if raw := strings.TrimSpace(os.Getenv("TERMINAL_PORT")); raw != "" {
    if parsed, err := strconv.Atoi(raw); err == nil {
      port = parsed
    }
  }

  writeJSON(w, http.StatusOK, terminalStatus{
    Enabled: enabled,
    Credential: credential,
    AllowWrite: allowWrite,
    Port: port,
  })
}
