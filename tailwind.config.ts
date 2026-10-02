/* Fila de Atendimento — configuração do Tailwind.
   O tema vem do preset compartilhado. Não redefina cor, raio, sombra ou
   fonte aqui: mexa em imago-platform/packages/design/src/tailwind.preset.ts
   e rode `node packages/design/sync.mjs`.

   `theme.extend` local é só para informação que existe exclusivamente neste
   app. Ver o cabeçalho do preset. */

import type { Config } from "tailwindcss";
import imago from "./src/design/tailwind.preset";

export default {
  presets: [imago],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
} satisfies Config;
