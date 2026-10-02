// ─────────────────────────────────────────────────────────────────────────────
// PageHeader — cabeçalho canônico de página do design system
//
// 21/09/2026 — repaginado para a identidade "sala de comando" (src/index.css).
// O padrão antigo era editorial: eyebrow azul, título extrabold de 30px,
// subtítulo cinza. Num painel isso é caro — o título ocupava a altura de duas
// filas de paciente para dizer o que a barra de cima já dizia.
//
// O novo é placa de instrumento: uma régua fina, o eyebrow como etiqueta de
// console à esquerda, título compacto, e o subtítulo ao LADO e não abaixo,
// para o cabeçalho caber numa linha só. Toda página interna usa ESTE
// componente — não inventar headers locais.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";

interface PageHeaderProps {
  /** Categoria/contexto em caixa alta — ex: "Recepção", "Operacional" */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Botões/controles alinhados à direita */
  actions?: React.ReactNode;
}

export function PageHeader({ eyebrow, title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border pb-3">
      <div className="min-w-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {eyebrow && (
          /* A barra vertical antes da etiqueta é o único ornamento, e ela
             trabalha: ancora o cabeçalho na mesma coluna em que os rails de
             modalidade nascem, logo abaixo. */
          <span className="flex items-center gap-2 shrink-0">
            <span className="h-3.5 w-0.5 rounded-full bg-primary" />
            <span className="console-label">{eyebrow}</span>
          </span>
        )}
        <h1 className="text-xl md:text-2xl font-extrabold tracking-tight text-foreground leading-none">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs text-muted-foreground leading-snug max-w-xl">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </header>
  );
}
