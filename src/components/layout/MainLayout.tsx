// Shell próprio do produto — substitui o MainLayout do sistema de origem
// (que arrastava Sidebar/TopNav/BottomNav do Imago). Mantém a MESMA interface
// de props, então as páginas copiadas não precisaram mudar.
//
// 02/10/2026 — mesma identidade "sala de comando" do Farol (ver src/index.css).
// A barra é a dele sem o feixe, que é assinatura do Farol. O relógio NÃO mora
// aqui: embutida no sistema esta barra some, e na fila o relógio é informação
// de trabalho ("quanto falta para o das 10:40?"), então ele vive no cabeçalho
// da própria tela, que aparece nos dois lugares.

import React from "react";
import { useNavigate } from "react-router-dom";
import { ListOrdered, LogOut } from "lucide-react";
import { PageHeader } from "./PageHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/shared/contexts/AuthContext";

interface MainLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  headerActions?: React.ReactNode;
}

export function MainLayout({ children, title, subtitle, eyebrow, headerActions }: MainLayoutProps) {
  const { profile, signOut, user } = useAuth();
  const navigate = useNavigate();

  // Embutido = rodando dentro do controleoperacional (gestao.…/fila-atendimento).
  // Lá a casca é a de lá — menu, avatar, sair — e mostrar a barra daqui
  // empilharia dois cabeçalhos. Calculado no render; try/catch por segurança.
  // Ver ADR 0003 em imago-platform/docs/adr.
  let embutido = false;
  try { embutido = window.self !== window.top; } catch { embutido = true; }

  const content = title ? (
    <div className="space-y-4">
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} actions={headerActions} />
      {children}
    </div>
  ) : (
    children
  );

  return (
    <div className="min-h-screen bg-background font-sans antialiased flex flex-col">
      {!embutido && (
        <header className="h-12 shrink-0 border-b border-border bg-card/70 backdrop-blur flex items-center justify-between px-3 md:px-5">
          <button
            onClick={() => navigate("/fila-atendimento")}
            className="flex items-center gap-2 text-foreground group"
          >
            <span className="h-7 w-7 rounded-sm bg-primary/12 text-primary grid place-items-center ring-1 ring-primary/30 group-hover:bg-primary/20 transition-colors">
              <ListOrdered className="h-3.5 w-3.5" />
            </span>
            <span className="font-extrabold tracking-[0.22em] text-[13px] uppercase">Fila</span>
          </button>
          <div className="flex items-center gap-1.5">
            <span className="console-label hidden lg:block max-w-[160px] truncate pr-2 border-r border-border">
              {profile?.full_name ?? user?.email}
            </span>
            <Button
              variant="ghost" size="sm" onClick={signOut}
              className="gap-1.5 text-muted-foreground h-8 px-2 text-xs"
              title="Sair"
            >
              <LogOut className="h-3.5 w-3.5" /> <span className="hidden md:inline">Sair</span>
            </Button>
          </div>
        </header>
      )}
      {/* Largura total: a fila por médico é um kanban, e coluna central
          estreita era o que mais a espremia no monitor da recepção. Respiro
          curto pelo mesmo motivo do Farol — cada pixel de margem é um pixel a
          menos de fila visível. */}
      <main className="flex-1 overflow-y-auto px-3 py-4 md:px-5 md:py-5">{content}</main>
    </div>
  );
}
