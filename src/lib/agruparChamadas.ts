import { logError } from "@/lib/logger";

// Agrupa uma rajada de chamadas numa só execução.
//
// Por que existe (30/out/2026): o poll do Farol regrava várias linhas de uma vez
// e o Realtime entrega um aviso POR LINHA para cada tela aberta. Cada aviso
// disparava uma recarga completa (Farol + Fila), então 15 linhas × 20 telas
// viravam ~600 consultas num segundo. Às 08:23 desse dia uma rajada dessas
// chegou a 2.552 consultas em 10 s e derrubou o banco até o reinício às 08:51.
//
// Comportamento:
// - o primeiro `agendar()` marca a execução para daqui a `esperaMs`; os
//   seguintes dentro da janela não marcam de novo (a recarga sai no máximo
//   `esperaMs` depois do primeiro aviso, não fica empurrando para frente);
// - se chegar aviso enquanto `fn` ainda está rodando, roda mais UMA vez ao
//   terminar — nenhum aviso se perde, e nunca há duas execuções em paralelo;
// - `cancelar()` descarta o que estiver pendente (usar no cleanup do efeito).
export function agruparChamadas(fn: () => unknown, esperaMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rodando = false;
  let deNovo = false;
  let cancelado = false;

  const executar = async () => {
    timer = null;
    if (cancelado) return;
    if (rodando) { deNovo = true; return; }
    rodando = true;
    try {
      await fn();
    } catch (e) {
      logError("[agruparChamadas] recarga falhou:", e);
    } finally {
      rodando = false;
      if (deNovo && !cancelado) { deNovo = false; agendar(); }
    }
  };

  const agendar = () => {
    if (cancelado) return;
    if (rodando) { deNovo = true; return; }
    if (timer) return;
    timer = setTimeout(executar, esperaMs);
  };

  const cancelar = () => {
    cancelado = true;
    deNovo = false;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return { agendar, cancelar };
}
