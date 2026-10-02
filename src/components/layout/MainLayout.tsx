// Shell próprio do produto — substitui o MainLayout do sistema de origem
// (que arrastava Sidebar/TopNav/BottomNav do Imago). Mantém a MESMA interface
// de props, então as páginas copiadas não precisaram mudar.

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
  // empilharia dois cabeçalhos, entregando que é um app dentro de outro.
  // Calculado no render: uma página não deixa de estar em iframe no meio da
  // vida. try/catch por segurança. Ver ADR 0003 em imago-platform/docs/adr.
  let embutido = false;
  try { embutido = window.self !== window.top; } catch { embutido = true; }

  const content = title ? (
    <div className="space-y-6">
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} actions={headerActions} />
      {children}
    </div>
  ) : (
    children
  );

  return (
    <div className="min-h-screen bg-background font-sans antialiased flex flex-col">
      {!embutido && (
        <header className="h-14 shrink-0 border-b border-border bg-card flex items-center justify-between px-4 md:px-8 gap-4">
          <button
            onClick={() => navigate("/fila-atendimento")}
            className="flex items-center gap-2 font-extrabold text-foreground tracking-tight shrink-0"
          >
            <span className="h-8 w-8 rounded-lg bg-primary text-primary-foreground grid place-items-center">
              <ListOrdered className="h-4 w-4" />
            </span>
            Fila de Atendimento
          </button>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {profile?.full_name ?? user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5 text-muted-foreground">
              <LogOut className="h-4 w-4" /> Sair
            </Button>
          </div>
        </header>
      )}
      {/* Largura total de propósito: a fila por médico é um kanban com até
          oito colunas, e uma coluna central de 1152px era o que mais a
          espremia no monitor da recepção. As páginas já trazem o próprio
          respiro (p-4 md:p-6). */}
      <main className="flex-1 overflow-y-auto">{content}</main>
    </div>
  );
}
