// Package server — Pagcoin Swap app handler.
//
// Pagcoin Swap is a thin-client entry in the app store that exposes the
// Pagcoin-run multi-provider swap gateway, reached over Tor. The brln-os-light
// host does NOT run the daemon itself; "installing" the app simply enables
// access to the .onion from the operator's UI and surfaces the link.
//
// Configuration is intentionally minimal for v1:
//   - ExternalURL points at the gateway .onion (overridable via PAGCOINSWAP_URL
//     for staging / future endpoint changes).
//   - Installed/enabled state lives in the shared secrets env file, same
//     pattern as fswap.
package server

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
)

const (
	pagcoinSwapAppID           = "pagcoinswap"
	pagcoinSwapAppInstalledEnv = "PAGCOINSWAP_APP_INSTALLED"
	pagcoinSwapAppEnabledEnv   = "PAGCOINSWAP_APP_ENABLED"
	pagcoinSwapURLEnv          = "PAGCOINSWAP_URL"
	pagcoinSwapDefaultURL      = "http://4og2jukmrzjwcjluk7r4ksnqmrjozlrzdehjcxgyjgiwntc5i7kuvtyd.onion"
)

type pagcoinSwapApp struct {
	server *Server
}

func newPagcoinSwapApp(s *Server) appHandler {
	return pagcoinSwapApp{server: s}
}

func pagcoinSwapURL() string {
	if v := strings.TrimSpace(os.Getenv(pagcoinSwapURLEnv)); v != "" {
		return v
	}
	if v, err := readEnvFileValue(secretsEnvPath, pagcoinSwapURLEnv); err == nil {
		if v = strings.TrimSpace(v); v != "" {
			return v
		}
	}
	return pagcoinSwapDefaultURL
}

func pagcoinSwapDefinition() appDefinition {
	return appDefinition{
		ID:          pagcoinSwapAppID,
		Name:        "Pagcoin Swap",
		Description: "Troque criptos entre redes via Tor, com taxa anti-bot em sats e cotações de múltiplos provedores.",
		ExternalURL: pagcoinSwapURL(),
	}
}

func (a pagcoinSwapApp) Definition() appDefinition {
	return pagcoinSwapDefinition()
}

func pagcoinSwapReadBoolSetting(key string, fallback bool) bool {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return parseBoolSetting(value, fallback)
	}
	value, err := readEnvFileValue(secretsEnvPath, key)
	if err != nil {
		return fallback
	}
	return parseBoolSetting(value, fallback)
}

func pagcoinSwapAppState() (installed bool, enabled bool) {
	installed = pagcoinSwapReadBoolSetting(pagcoinSwapAppInstalledEnv, false)
	enabled = pagcoinSwapReadBoolSetting(pagcoinSwapAppEnabledEnv, false)
	if !installed {
		enabled = false
	}
	return installed, enabled
}

func pagcoinSwapSetAppState(installed bool, enabled bool) error {
	if !installed {
		enabled = false
	}
	installedValue := strconv.FormatBool(installed)
	enabledValue := strconv.FormatBool(enabled)
	if err := writeEnvFileValue(secretsEnvPath, pagcoinSwapAppInstalledEnv, installedValue); err != nil {
		return err
	}
	if err := writeEnvFileValue(secretsEnvPath, pagcoinSwapAppEnabledEnv, enabledValue); err != nil {
		return err
	}
	_ = os.Setenv(pagcoinSwapAppInstalledEnv, installedValue)
	_ = os.Setenv(pagcoinSwapAppEnabledEnv, enabledValue)
	return nil
}

func (a pagcoinSwapApp) Info(_ context.Context) (appInfo, error) {
	info := newAppInfo(a.Definition())
	installed, enabled := pagcoinSwapAppState()
	if !installed {
		return info, nil
	}
	info.Installed = true
	if enabled {
		info.Status = "running"
	} else {
		info.Status = "stopped"
	}
	return info, nil
}

func (a pagcoinSwapApp) Install(_ context.Context) error {
	return pagcoinSwapSetAppState(true, true)
}

func (a pagcoinSwapApp) Uninstall(_ context.Context) error {
	return pagcoinSwapSetAppState(false, false)
}

func (a pagcoinSwapApp) Start(_ context.Context) error {
	installed, _ := pagcoinSwapAppState()
	if !installed {
		return errors.New("Pagcoin Swap is not installed")
	}
	return pagcoinSwapSetAppState(true, true)
}

func (a pagcoinSwapApp) Stop(_ context.Context) error {
	installed, _ := pagcoinSwapAppState()
	if !installed {
		return errors.New("Pagcoin Swap is not installed")
	}
	return pagcoinSwapSetAppState(true, false)
}
