// Prioridade → classe de cor. Fonte única para o card, o diálogo de edição e o
// de detalhes. As classes estão ESCRITAS POR EXTENSO de propósito: o Tailwind só
// mantém no CSS o que encontra literal no código, e `prio-${tipo}` montado por
// template sumiria do build (foi o que aconteceu com os LEDs).
//
// As cores em si moram em src/index.css (--prio-*).

export const PRIO_CLASSE: Record<string, string> = {
  idoso:    "prio-idoso",
  pcd:      "prio-pcd",
  gestante: "prio-gestante",
  autista:  "prio-autista",
  crianca:  "prio-crianca",
};

/** Classe da prioridade, ou "" para normal/desconhecida. */
export function classePrioridade(prioridade: string | null | undefined): string {
  return (prioridade && PRIO_CLASSE[prioridade]) || "";
}
