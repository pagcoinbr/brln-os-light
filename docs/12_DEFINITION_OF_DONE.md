# FILE: docs/12_DEFINITION_OF_DONE.md

# Definition of Done (v0.1)

## Instalação
- Rodar instalador em Ubuntu Server limpo
- Serviços:
  - postgresql active
  - lnd active (mesmo que locked)
  - lightningos-manager active
- UI disponível em https://localhost:8443

## Wizard
- Conecta ao Bitcoin remoto BRLN com rpcuser/rpcpass
- Cria OU importa wallet
- Exibe seed apenas uma vez e não persiste
- Unlock bem sucedido

## Wallet
- Criar invoice
- Pagar invoice

## Dashboard
- Exibe sistema + postgres + bitcoin remoto + lnd
- Exibe disk lifespan com wear e estimativa

## Segurança
- Bind localhost
- Segredos não aparecem em UI/log

