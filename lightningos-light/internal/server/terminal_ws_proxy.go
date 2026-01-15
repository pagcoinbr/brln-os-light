package server

import (
  "context"
  "net/http"
  "net/url"
  "os"
  "strings"
  "time"

  "github.com/gorilla/websocket"
)

func (s *Server) handleTerminalWebsocket(w http.ResponseWriter, r *http.Request) {
  if strings.TrimSpace(os.Getenv("TERMINAL_ENABLED")) != "1" {
    http.NotFound(w, r)
    return
  }

  upgrader := websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool {
      return true
    },
  }

  clientConn, err := upgrader.Upgrade(w, r, nil)
  if err != nil {
    return
  }
  defer clientConn.Close()

  target := terminalProxyTarget()
  upstreamURL := url.URL{Scheme: "ws", Host: target.Host, Path: "/ws"}

  headers := http.Header{}
  if authHeader := basicAuthHeader(terminalCredential()); authHeader != "" {
    headers.Set("Authorization", authHeader)
  }

  dialer := websocket.Dialer{
    HandshakeTimeout: 10 * time.Second,
  }

  upstreamConn, _, err := dialer.DialContext(context.Background(), upstreamURL.String(), headers)
  if err != nil {
    return
  }
  defer upstreamConn.Close()

  done := make(chan struct{}, 2)

  go func() {
    proxyWebsocket(upstreamConn, clientConn)
    done <- struct{}{}
  }()

  go func() {
    proxyWebsocket(clientConn, upstreamConn)
    done <- struct{}{}
  }()

  <-done
}

func proxyWebsocket(src *websocket.Conn, dst *websocket.Conn) {
  for {
    msgType, msg, err := src.ReadMessage()
    if err != nil {
      return
    }
    if err := dst.WriteMessage(msgType, msg); err != nil {
      return
    }
  }
}
