/**
 * Conta de cliente bloqueada/encerrada pela Kayser (painel Clientes → variável CONTA_BLOQUEADA
 * no servidor do cliente). Ninguém entra e quem já está dentro cai na próxima ação.
 */
export const MSG_CONTA_BLOQUEADA = "Esta conta do Kayser One está bloqueada. Fale com a Kayser One: contato@kayserone.com.br";

export const contaBloqueada = () => process.env.CONTA_BLOQUEADA === "1";
