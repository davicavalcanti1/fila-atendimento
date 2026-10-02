// Login por usuário (nome.sobrenome) OU e-mail, mais senha.
//
// A recepção entra no sistema de gestão com `nome.sobrenome` e tinha que
// lembrar de um e-mail diferente para entrar aqui. Agora os dois valem no mesmo
// campo, e quem decide o caminho é a presença do "@".
//
// O e-mail continua funcionando SEM o servidor Express, falando direto com o
// Supabase. Isso não é detalhe: é o que mantém a entrada possível quando o
// backend está fora, e o que faz o login continuar funcionando em dev sem subir
// dois processos. O usuário depende do servidor porque a tradução
// username → e-mail mora lá de propósito (ver server/src/routes/auth.ts).
//

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { API_BASE } from "@/lib/apiBase";

export default function Login() {
  const navigate = useNavigate();
  const [identificador, setIdentificador] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  /** Entra pelo servidor, que resolve `nome.sobrenome` e devolve os tokens. */
  async function entrarPorUsuario(usuario: string, senha: string) {
    const r = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, senha }),
    });

    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(corpo?.mensagem ?? "Usuário ou senha inválidos.");

    // O servidor devolve só os tokens; quem monta a sessão (e dispara o
    // onAuthStateChange que o AuthContext escuta) é o cliente.
    const { error } = await supabase.auth.setSession({
      access_token:  corpo.access_token,
      refresh_token: corpo.refresh_token,
    });
    if (error) throw error;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const entrada = identificador.trim();
      if (entrada.includes("@")) {
        const { error } = await supabase.auth.signInWithPassword({ email: entrada, password });
        if (error) throw error;
      } else {
        await entrarPorUsuario(entrada, password);
      }
      navigate("/fila-atendimento", { replace: true });
    } catch (err: any) {
      toast.error("Não foi possível entrar", { description: err?.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background p-6 font-sans">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <span className="inline-grid h-12 w-12 place-items-center rounded-sm bg-primary/10 text-primary ring-1 ring-primary/30">
            <ListOrdered className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-extrabold uppercase tracking-[0.22em] text-foreground">Fila</h1>
          <p className="text-sm text-muted-foreground">Entre com sua conta para continuar</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3 panel p-5">
          <Input
            /* `text` e não `email`: com type="email" o próprio navegador recusa
               "nome.sobrenome" antes de o formulário chegar aqui — era metade do
               problema que esta tela tinha. */
            type="text"
            placeholder="Usuário ou e-mail"
            value={identificador}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setIdentificador(e.target.value)}
            required
          />
          <Input
            type="password" placeholder="Senha" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} required
          />
          <Button type="submit" disabled={loading} className="w-full gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Entrar
          </Button>
          <p className="text-[11px] text-center text-muted-foreground pt-1">
            O mesmo usuário do sistema de gestão — <span className="font-mono">nome.sobrenome</span>
          </p>
        </form>
      </div>
    </div>
  );
}
