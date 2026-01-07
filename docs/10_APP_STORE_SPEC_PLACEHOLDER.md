# FILE: docs/10_APP_STORE_SPEC_PLACEHOLDER.md

# App Store (placeholder v0.1)

Objetivo: definir um formato de manifest para instalar apps sem Docker em versões futuras.

## Manifest (YAML)
id: "bos"
name: "Balance of Satoshis"
version: "x.y.z"
description: "CLI tools for LND"
category: "tools"
install:
  apt: ["..."]
  steps:
    - "download release"
    - "install binary"
    - "create config"
uninstall:
  steps:
    - "remove binary"
    - "remove config"
services: []
ports: []
ui:
  icon: "bos.svg"
  screenshots: []

## v0.1
Somente exibir tela “Apps” como placeholder com mensagem:
“Em breve: instale ferramentas sob demanda sem Docker”.

