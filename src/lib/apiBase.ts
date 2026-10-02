// Prefixo de TODAS as chamadas do frontend ao Express deste módulo.
//
// Por que não é `/api`: este app roda em dois lugares. No host próprio ele é a
// raiz do domínio e `/api` estaria livre. Mas ele também é servido sob
// `gestao.imagoradiologia.cloud/fila-atendimento-app`, por proxy do nginx do
// controleoperacional — e lá `/api/` já é do Express do sistema.
//
// Ver ADR 0003 em imago-platform/docs/adr.
export const API_BASE = "/fila-atendimento-api";
