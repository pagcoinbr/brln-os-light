# FILE: docs/08_UI_WIREFRAMES.md

# UI Wireframes (texto) — LightningOS Light

## Layout geral
- Sidebar esquerda:
  - Dashboard
  - Wallet
  - Bitcoin (Remote)
  - LND
  - Disks
  - Logs
  - Apps (placeholder)
  - Bitcoin Local (placeholder)
- Topbar:
  - status badge (OK/WARN/ERR)
  - node name (opcional)
  - theme toggle (dark/light)

## Tela: Wizard (primeiro acesso)
### Step 1: Conectar ao Bitcoin remoto
- Explicar: “Você vai usar o Bitcoin da comunidade (BRLN) por enquanto.”
- Mostrar host/zmq fixos (read-only).
- Inputs:
  - RPC User
  - RPC Password
- Botão: Testar Conexão
  - mostra RPC OK/Fail
  - mostra ZMQ OK/Fail
- Botão: Salvar e Continuar

### Step 2: Wallet do LND
- Escolha (cards):
  - Criar nova wallet
  - Importar wallet existente
- Se Criar:
  - input: Wallet password (e confirmação)
  - botão: Gerar seed
  - Mostrar 24 palavras em UI (1 vez)
  - Checkbox obrigatório: “Eu anotei minhas 24 palavras. Sei que não será possível recuperá-las depois.”
  - Botão: Inicializar wallet
- Se Importar:
  - input: Wallet password (e confirmação)
  - textarea: seed words (24) com validação
  - Botão: Importar e Inicializar

### Step 3: Unlock
- input: wallet password
- botão: Unlock
- status: unlocked OK

### Step 4: Finalizar
- CTA: “Ir para o Dashboard”

## Tela: Dashboard
- Header: Status Geral + Issues list
- Cards:
  - System
  - Disks lifespan
  - Bitcoin Remote
  - PostgreSQL
  - LND
- Seções:
  - quick actions (restart lnd, restart manager)
  - logs recentes

## Tela: Wallet
- Balance card (On-chain / Lightning)
- Create invoice
- Pay invoice
- Recent activity (opcional)

## Tela: Disks
- Lista de discos com:
  - wear%, power_on_hours
  - days_left_estimate
  - smart status + alerts
- “What this means” tooltip

## Tela: Logs
- Dropdown: lnd | manager | postgres
- lines selector: 200/500/1000
- search box

