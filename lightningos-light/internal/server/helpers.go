package server

import (
  "encoding/json"
  "net/http"
)

func writeJSON(w http.ResponseWriter, status int, payload any) {
  w.Header().Set("Content-Type", "application/json")
  w.WriteHeader(status)
  if payload != nil {
    _ = json.NewEncoder(w).Encode(payload)
  }
}

func readJSON(r *http.Request, dst any) error {
  dec := json.NewDecoder(r.Body)
  dec.DisallowUnknownFields()
  return dec.Decode(dst)
}

func writeError(w http.ResponseWriter, status int, message string) {
  writeJSON(w, status, map[string]string{"error": message})
}
