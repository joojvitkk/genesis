# GENESIS - Sistema de Gestão de Torneios e Inventário

O **GENESIS** é uma plataforma robusta e moderna projetada para a gestão completa de torneios de poker, controle de estoque de fichas, maletas e auditoria de operações. Construído com foco em alta performance, tempo real e estética premium.

![Dashboard Preview](https://raw.githubusercontent.com/joojvitkk/genesis/main/frontend/public/pwa-192x192.png)

## 🚀 Funcionalidades Principais

- **Painel de Controle (Dashboard)**: Visão geral em tempo real de torneios ativos, estoque e estatísticas rápidas.
- **Gestão de Torneios**: Criação, monitoramento e finalização de eventos com integração de fichários.
- **Controle de Inventário**: Gestão detalhada de modelos de fichas, valores, cores e quantidades físicas.
- **Fichários e Maletas**: Configuração de kits personalizados e rastreamento de alocação em torneios.
- **Chat em Tempo Real**: Comunicação interna com canais específicos e sistema de **Alertas Urgentes** globais.
- **Auditoria Completa**: Log detalhado de todas as movimentações de estoque e ações do sistema.
- **PWA (Progressive Web App)**: Instalável em dispositivos móveis (Android/iOS) para uso como aplicativo nativo.
- **Modo Escuro (Dark Mode)**: Interface premium otimizada para ambientes de salão.

## 🛠️ Tecnologias Utilizadas

### Frontend
- **React 19** + **Vite**
- **Tailwind CSS v4** (Estilização moderna e rápida)
- **Framer Motion** (Animações fluidas)
- **Lucide React** (Iconografia consistente)
- **Recharts** (Gráficos e analytics)
- **Socket.io-client** (Comunicação em tempo real)

### Backend
- **Node.js** + **Express**
- **MongoDB** + **Mongoose** (Persistência de dados)
- **Socket.io** (Websockets para alertas e chat)
- **JWT** (Autenticação segura)

## 📦 Instalação e Inicialização

### Pré-requisitos
- Docker e Docker Compose instalados.

### Passo a Passo (Docker - Recomendado)

1. **Clonar o repositório**:
   ```bash
   git clone https://github.com/joojvitkk/genesis.git
   cd genesis
   ```

2. **Subir os containers**:
   ```bash
   docker-compose up --build
   ```

3. **Acessar o sistema**:
   - Frontend: [http://localhost:5173](http://localhost:5173)
   - Backend: [http://localhost:3000](http://localhost:3000)

---

### Desenvolvimento Local (Sem Docker)

**Backend:**
1. Navegue até a pasta `backend`.
2. Instale as dependências: `npm install`.
3. Configure o arquivo `.env` (ou use os padrões no `server.js`).
4. Inicie o servidor: `npm start`.

**Frontend:**
1. Navegue até a pasta `frontend`.
2. Instale as dependências: `npm install`.
3. Inicie o servidor de desenvolvimento: `npm run dev`.

## 📱 Uso em Rede Local / Mobile

O sistema está configurado para detectar automaticamente o IP do servidor quando acessado por outros dispositivos na mesma rede Wi-Fi.

Para usar como **PWA** no celular:
1. Acesse o IP do servidor pelo navegador do celular (ex: `http://192.168.1.5:5173`).
2. Utilize um túnel HTTPS (como `localtunnel` ou `ngrok`) para liberar permissões de notificações.
3. No menu do navegador, selecione **"Adicionar à Tela de Início"** ou **"Instalar Aplicativo"**.

## 🛡️ Credenciais de Acesso Inicial
- **Email**: `admin@genesis.com`
- **Senha**: `admin123`

---
