// ─────────────────────────────────────────────────────────────────────────────
// NetRis HTTP Client — fundação de TODAS as integrações
//
// Dados confirmados via testes em 14/04/2026:
//   - Datas nos params: DD/MM/YYYY
//   - Datas nos responses: epoch ms (timestamps)
//   - horaInicial: ms desde meia-noite (57600000 = 16:00)
//   - Paginação: &limit=5000 (default retorna só 10!)
//   - situacaoId no query NÃO filtra — filtrar no cliente
// ─────────────────────────────────────────────────────────────────────────────

// Neste módulo só os IDs são usados: a Fila lê `farol_timestamps`, que o Farol
// alimenta a partir do NetRis — nenhuma chamada HTTP sai daqui. O cliente HTTP
// completo vive no repo `farol` (src/services/netris/client.ts).

// ── IDs de situação (confirmados via API) ────────────────────────────────────
// Confirmados via API real em 15/04/2026 (varredura de 1.036 atendimentos)
export const SITUACAO = {
  MARCADO:              1,
  A_CONFIRMAR:          2,   // "A CONFIRMAR" — faltas/campanhas
  CONFIRMADO:           3,   // "CONFIRMADO"
  CANCELADO:            5,
  CHEGOU:              10,   // "CHEGOU" — check-in/totem
  ATENDIMENTO:         11,   // "ATENDIMENTO" — em atendimento na recepção
  ENCAMINHADO_EXAME:   13,   // "ENCAMINHADO PARA EXAME" — FAROL geral
  EXAME_REALIZADO:     18,   // "EXECUTADO" — exame realizado, relatórios
  LANCAR_MATERIAL:     19,   // "LANCAR_MATERIAL"
  A_CANCELAR:          26,
  FINALIZADO:          27,   // "FINALIZADO"
  FATURADO:            28,   // "FATURADO"
  EM_SALA:             45,   // "EM SALA" — paciente já na sala de exame
  ANAMNESE:            61,   // "ANAMNESE REALIZADA" — pré RM/TC
  PACIENTE_PREPARADO:  62,   // "PACIENTE PREPARADO" — pré RM/TC
  PREPARADO_ENFERMAGEM:63,   // "PREPARADO ENFERMAGEM" — pronto para exame
  ENCAMINHADO_RM_TC:   64,   // "RM E TC ENCAMINHADO PARA EXAME" — exclusivo RM e TC

  // ── Fluxo financeiro / faturamento (confirmados via dados reais) ─────────
  // IDs numéricos precisam ser validados contra NetRis; nomes confirmados pelo usuário
  GUIA_DEVOLVIDA_RECEPCAO: 51, // "GUIA DEVOLVIDA À RECEPÇÃO" — confirmado via sync-controle-guias
} as const;

// ── IDs de modalidade (confirmados via API) ──────────────────────────────────
export const MODALIDADE = {
  RAIO_X:              1,
  USG:                 2,
  ANESTESIA:           3,
  TOMOGRAFIA:          4,
  RESSONANCIA:         5,
  MAMOGRAFIA:          6,
  DENSITOMETRIA:       7,
  BIOPSIA_US:          8,
  ECOCARDIOGRAMA:     10,
  ELETROENCEFALOGRAMA:14,
  ELETROCARDIOGRAMA:  15,
  RESSONANCIA_CONTRASTE:16,
  ESPIROMETRIA:       18,
  HOLTER:             19,
  RETORNO_MAPA:       20,
  RETORNO_HOLTER:     21,
} as const;

export const IMPRESSAO = {
  MOTIVO_PADRAO: 1,
  MODELO_PADRAO: 10,
} as const;

export type SituacaoId   = (typeof SITUACAO)[keyof typeof SITUACAO];
export type ModalidadeId = (typeof MODALIDADE)[keyof typeof MODALIDADE];

