import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { criarCarregadorDeUsuario } from "@/lib/carregarUsuarioUmaVez";

// Mesmo contrato do AuthContext de origem (controleoperacional): as páginas
// copiadas leem profile.tenant_id como string. Perfil sem tenant é o owner
// global, que não opera a fila.
interface Profile {
  id: string;
  tenant_id: string;
  full_name: string;
  email: string;
  [key: string]: unknown;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  /** Derivado de profile.tenant_id — mesma interface do AuthContext de origem */
  tenant: { id: string } | null;
  role: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUserData = async (userId: string) => {
    const [{ data: profileData, error: erroPerfil }, { data: roleData, error: erroPapel }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
    ]);
    setProfile((profileData as Profile) ?? ({ id: userId } as Profile));
    setRole((roleData as { role: string } | null)?.role ?? null);
    // Falha de leitura: mantém o comportamento de antes na tela, mas avisa o
    // carregador para NÃO guardar este resultado — a próxima chamada lê de novo.
    if (erroPerfil || erroPapel) throw erroPerfil ?? erroPapel;
  };

  // Perfil e papel não mudam durante o dia: uma leitura por pessoa, não por
  // evento de sessão (ver src/lib/carregarUsuarioUmaVez.ts). Mesmo objeto em
  // todos os renders — o useEffect abaixo roda uma vez só.
  const [carregador] = useState(() => criarCarregadorDeUsuario(fetchUserData));

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        // setTimeout evita deadlock: chamadas ao Supabase dentro do callback do
        // onAuthStateChange travam enquanto o lock interno de auth está preso.
        setTimeout(() => { carregador.carregar(newSession.user.id).catch(() => {}); }, 0);
      } else {
        carregador.esquecer();
        setProfile(null);
        setRole(null);
      }
    });

    supabase.auth.getSession().then(async ({ data: { session: existing } }) => {
      setSession(existing);
      setUser(existing?.user ?? null);
      if (existing?.user) await carregador.carregar(existing.user.id).catch(() => {});
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const tenant = profile?.tenant_id ? { id: profile.tenant_id } : null;

  return (
    <AuthContext.Provider value={{ user, session, profile, tenant, role, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
