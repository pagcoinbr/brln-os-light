package server

const (
  appsRoot = "/var/lib/lightningos/apps"
  appsDataRoot = "/var/lib/lightningos/apps-data"
)

type appDefinition struct {
  ID string
  Name string
  Description string
  Port int
}

type appInfo struct {
  ID string `json:"id"`
  Name string `json:"name"`
  Description string `json:"description"`
  Installed bool `json:"installed"`
  Status string `json:"status"`
  Port int `json:"port"`
  AdminPasswordPath string `json:"admin_password_path,omitempty"`
}
