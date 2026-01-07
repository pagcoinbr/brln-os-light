package main

import (
  "flag"
  "log"
  "os"

  "lightningos-light/internal/config"
  "lightningos-light/internal/server"
)

func main() {
  configPath := flag.String("config", "/etc/lightningos/config.yaml", "Path to config.yaml")
  flag.Parse()

  cfg, err := config.Load(*configPath)
  if err != nil {
    log.Fatalf("config load failed: %v", err)
  }

  logger := log.New(os.Stdout, "", log.LstdFlags)
  srv := server.New(cfg, logger)

  if err := srv.Run(); err != nil {
    logger.Fatalf("server exited: %v", err)
  }
}
