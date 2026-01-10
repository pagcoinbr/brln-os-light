package server

import (
  "context"
  "net/http"

  "github.com/go-chi/chi/v5"
)

func (s *Server) handleAppsList(w http.ResponseWriter, r *http.Request) {
  defs := []appDefinition{
    lndgDefinition(),
  }
  resp := make([]appInfo, 0, len(defs))
  for _, def := range defs {
    info := s.getAppInfo(r.Context(), def)
    resp = append(resp, info)
  }
  writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleAppInstall(w http.ResponseWriter, r *http.Request) {
  appID := chi.URLParam(r, "id")
  if appID == "" {
    writeError(w, http.StatusBadRequest, "missing app id")
    return
  }
  switch appID {
  case "lndg":
    if err := s.installLndg(r.Context()); err != nil {
      writeError(w, http.StatusInternalServerError, err.Error())
      return
    }
  default:
    writeError(w, http.StatusNotFound, "app not found")
    return
  }
  writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleAppUninstall(w http.ResponseWriter, r *http.Request) {
  appID := chi.URLParam(r, "id")
  if appID == "" {
    writeError(w, http.StatusBadRequest, "missing app id")
    return
  }
  switch appID {
  case "lndg":
    if err := s.uninstallLndg(r.Context()); err != nil {
      writeError(w, http.StatusInternalServerError, err.Error())
      return
    }
  default:
    writeError(w, http.StatusNotFound, "app not found")
    return
  }
  writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleAppStart(w http.ResponseWriter, r *http.Request) {
  appID := chi.URLParam(r, "id")
  if appID == "" {
    writeError(w, http.StatusBadRequest, "missing app id")
    return
  }
  switch appID {
  case "lndg":
    if err := s.startLndg(r.Context()); err != nil {
      writeError(w, http.StatusInternalServerError, err.Error())
      return
    }
  default:
    writeError(w, http.StatusNotFound, "app not found")
    return
  }
  writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleAppStop(w http.ResponseWriter, r *http.Request) {
  appID := chi.URLParam(r, "id")
  if appID == "" {
    writeError(w, http.StatusBadRequest, "missing app id")
    return
  }
  switch appID {
  case "lndg":
    if err := s.stopLndg(r.Context()); err != nil {
      writeError(w, http.StatusInternalServerError, err.Error())
      return
    }
  default:
    writeError(w, http.StatusNotFound, "app not found")
    return
  }
  writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) getAppInfo(ctx context.Context, def appDefinition) appInfo {
  info := appInfo{
    ID: def.ID,
    Name: def.Name,
    Description: def.Description,
    Installed: false,
    Status: "not_installed",
    Port: def.Port,
  }
  if def.ID != "lndg" {
    return info
  }
  paths := lndgAppPaths()
  if fileExists(paths.ComposePath) {
    info.Installed = true
    info.AdminPasswordPath = paths.AdminPasswordPath
    status, err := getComposeStatus(ctx, paths.Root, paths.ComposePath, "lndg")
    if err != nil {
      info.Status = "unknown"
    } else {
      info.Status = status
    }
  }
  return info
}
