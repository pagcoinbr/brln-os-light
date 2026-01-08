# FILE: docs/11_DEV_GUIDE.md

# Guia de Desenvolvimento (para o CODEX)

## Linguagens/Stack
- Backend: Go (LightningOS Manager)
- Frontend: React + Tailwind
- API: REST JSON
- System integration: systemd, smartctl, postgres

## Padrões
- Config: YAML em /etc/lightningos/config.yaml
- Secrets: /etc/lightningos/secrets.env (root:lightningos, 660)
- Logs: /var/log/lightningos/ (json ou texto estruturado)
- UI build: /opt/lightningos/ui

## Regras importantes
- Não armazenar seed phrase.
- Não expor UI fora da LAN/VPN.
- LND gRPC apenas localhost.
- bitcoin remoto host+zmq fixos; somente credenciais variam.
- mainnet only.

## Testes mínimos (smoke)
- /api/health retorna JSON válido
- wizard salva rpc creds, reescreve lnd.conf e reinicia lnd
- create-wallet retorna 24 words
- init-wallet funciona
- unlock funciona
- dashboard renderiza estados

