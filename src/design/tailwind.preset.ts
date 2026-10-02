/* ═══════════════════════════════════════════════════════════════════════════
   IMAGO DESIGN SYSTEM — preset do Tailwind
   ---------------------------------------------------------------------------
   ARQUIVO GERADO. Não edite nas cópias dentro dos apps.
   Fonte da verdade: imago-platform/packages/design/src/tailwind.preset.ts
   Para propagar:    node packages/design/sync.mjs

   Uso no app:

       import imago from "./src/design/tailwind.preset";
       export default {
         presets: [imago],
         content: [...],
         theme: { extend: {} },   // só o que for do domínio deste app
       } satisfies Config;

   O preset carrega o núcleo. O `extend` local carrega o que é específico —
   e "específico" quer dizer informação que só existe naquele produto
   (tipo de mídia no controle-midia, a face serifada do documento no
   receituarios). Cor de marca, raio, sombra e status nunca são locais.
   ═══════════════════════════════════════════════════════════════════════════ */

import type { Config } from "tailwindcss";

const preset = {
  darkMode: ["class"],
  content: [],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      gridTemplateColumns: {
        "24": "repeat(24, minmax(0, 1fr))",
      },

      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
      },

      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",

        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // Status. Os três papéis do bloco de contraste em core.css:
        //   DEFAULT   → superfície preenchida
        //   foreground → texto POR CIMA dessa superfície
        //   strong    → a mesma cor como texto sobre o fundo da página
        // `text-warning` é quase sempre o que você NÃO quer; use
        // `text-warning-strong`.
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          strong: "hsl(var(--destructive-text))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          strong: "hsl(var(--success-text))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          strong: "hsl(var(--warning-text))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
          strong: "hsl(var(--info-text))",
        },

        // Modalidade — a rampa por família de farol.
        // bg-modality-rm, text-modality-us, border-modality-tc…
        // `none` é para quem não está em farol nenhum (Anestesia).
        modality: {
          do: "hsl(var(--modality-do))",
          rx: "hsl(var(--modality-rx))",
          nc: "hsl(var(--modality-nc))",
          eco: "hsl(var(--modality-eco))",
          us: "hsl(var(--modality-us))",
          tc: "hsl(var(--modality-tc))",
          rm: "hsl(var(--modality-rm))",
          mg: "hsl(var(--modality-mg))",
          none: "hsl(var(--modality-none))",
          foreground: "hsl(var(--modality-foreground))",
        },

        // As chaves têm de bater com as variáveis de core.css. Já houve aqui
        // `assistencial`/`tecnica`, que não existiam no CSS, enquanto
        // `enfermagem`/`revisao_exame` existiam e não eram expostas — as
        // classes do badge não geravam regra nenhuma.
        occurrence: {
          administrativa: "hsl(var(--occurrence-administrativa))",
          revisao_exame: "hsl(var(--occurrence-revisao_exame))",
          enfermagem: "hsl(var(--occurrence-enfermagem))",
        },

        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },

      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
      },

      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        primary: "var(--shadow-primary)",
      },

      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(20px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        // Mais suave que o animate-pulse do Tailwind (50%→100% em 2s). Usado
        // nos LEDs vermelhos do Farol: na TV da recepção o default fica
        // agressivo o dia inteiro no campo de visão de quem trabalha ali.
        "soft-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.72" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.4s ease-out",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        "soft-pulse": "soft-pulse 2.6s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;

export default preset;
