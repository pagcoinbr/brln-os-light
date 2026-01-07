# FILE: docs/00_PROJECT_OVERVIEW.md

# LightningOS Light — Visão Geral do Projeto

## Objetivo
Criar um instalador + dashboard + wallet web + app store minimalista para rodar LND (sem Docker no core), reduzindo a barreira de entrada para usuários comuns. O sistema inicia usando Bitcoin remoto comunitário (BRLN) e, futuramente, permitirá instalação e migração para Bitcoin local.

## Público-alvo
- Usuário não técnico que quer operar um node Lightning de forma guiada
- Usuário técnico iniciante que quer evoluir para CLI aos poucos

## Princípios
- Sem Docker no core: serviços via systemd, arquivos de configuração claros.
- UI bonita, engajadora, “produto”.
- LAN/VPN only: nada exposto à internet por padrão.
- Segurança por padrão: credenciais protegidas, mínimos privilégios.
- Transparência e reversibilidade: logs e “undo” bem definidos.

## Escopo do MVP (v0.1)
- Ubuntu Server
- LND instalado por binário
- Backend DB do LND em PostgreSQL
- LightningOS Manager (Go) servindo API + UI
- UI web (SPA) elegante, com dashboard e wizard
- Bitcoin remoto padrão:
  - bitcoind.rpchost=bitcoin.br-ln.com:8085
  - bitcoind.zmqpubrawblock=tcp://bitcoin.br-ln.com:28332
  - bitcoind.zmqpubrawtx=tcp://bitcoin.br-ln.com:28333
  - usuário/senha informados pelo membro
- Wizard do LND:
  - Criar nova wallet (mostrar 24 palavras — não armazenar)
  - Importar wallet (usuário digita seed)
  - Unlock da wallet
- Dashboard com sinais vitais: Linux, Postgres, Bitcoin remoto, LND
- Card de “vida útil do disco” baseado em SMART/NVMe wear

## Fora do escopo do MVP
- Instalação de Bitcoin local e migração (apenas “placeholder” de UI)
- App store completa (apenas base/estrutura e 1 app exemplo opcional)
- Exposição WAN, reverse proxy, login via OAuth etc.

## Porta e Acesso
- UI e API em https://127.0.0.1:8443 (default)
- Pode permitir bind em IP da LAN via config (opcional), mas SEM WAN.

