/**
 * Lê perfil + papel UMA vez por pessoa, em vez de a cada evento de sessão.
 *
 * O `onAuthStateChange` do supabase-js dispara muito mais do que "alguém entrou":
 * INITIAL_SESSION na carga, TOKEN_REFRESHED a cada renovação do token, SIGNED_IN
 * de novo quando a aba volta ao foco — e, como o Gestão, o Farol e a Fila
 * dividem o mesmo localStorage (mesmo domínio), a renovação feita por UMA aba
 * dispara o evento em TODAS as outras. Cada evento relia `profiles` (select *)
 * e `user_roles`.
 *
 * 📏 09/nov/2026 12–13h UTC: ~1.045 leituras/h de cada tabela vindas destes
 * módulos embutidos, para um dado que não muda durante o dia.
 *
 * Contrato:
 * - mesma pessoa → devolve a MESMA promessa (em andamento ou já resolvida);
 *   quem chama em paralelo (o evento e o getSession da carga) espera a mesma
 *   leitura, então ninguém libera a tela antes de o perfil chegar;
 * - pessoa diferente → lê de novo;
 * - `esquecer()` (saída) → a próxima entrada lê de novo;
 * - leitura que falha não fica guardada: a próxima chamada tenta outra vez.
 *
 * Troca de papel feita pelo admin passa a valer na próxima carga da página
 * (o Gestão recarrega o módulo embutido ao navegar), não no próximo evento
 * de token — que era acaso, não regra.
 */
export function criarCarregadorDeUsuario(ler: (userId: string) => Promise<void>) {
  let atual: { userId: string; promessa: Promise<void> } | null = null;

  return {
    carregar(userId: string): Promise<void> {
      if (atual && atual.userId === userId) return atual.promessa;
      const promessa = ler(userId).catch((erro) => {
        if (atual?.promessa === promessa) atual = null;
        throw erro;
      });
      atual = { userId, promessa };
      return promessa;
    },
    esquecer(): void {
      atual = null;
    },
  };
}
