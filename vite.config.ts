import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  // Tudo deste app que passa pelo domínio do controleoperacional vive sob
  // `/fila-atendimento-app` (documentos e assets) ou `/fila-atendimento-api`
  // (API). O `/fila-atendimento` puro de lá NÃO é nosso: é a rota do sistema
  // que desenha o menu em volta e nos exibe num iframe. Ver ADR 0003 em
  // imago-platform/docs/adr.
  //
  // `base` só afeta URL de asset. As rotas do React Router continuam
  // `/fila-atendimento/...`; quem as desloca sob o prefixo é o `basename` em
  // src/main.tsx. Em dev o Vite serve em http://localhost:5173/fila-atendimento-app/.
  base: "/fila-atendimento-app/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/fila-atendimento-api": "http://localhost:3001",
    },
  },
});
