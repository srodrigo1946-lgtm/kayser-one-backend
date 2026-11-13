// Gera um PDF de amostra para conferência visual (rodar só sob demanda: AMOSTRA=caminho npx jest gerar-amostra).
import { writeFileSync } from "fs";
import { montarApresentacao } from "./tathy-relatorio";

const alvo = process.env.AMOSTRA;
(alvo ? it : it.skip)("gera amostra", async () => {
  const nomes = ["Claudia Marcello", "Diego Fernandes dos Santos", "João José dos Santos Filho", "Anita de Alvarenga Silva", "Patricia Alves", "Michele de Melo", "Angela Faria", "Diego Pontes Sampaio"];
  const painel = {
    canais: {
      meta: { gasto: 2213.5, leads: 113, leadsPlataforma: 134, cpl: 19.6, vendas: 1, vgv: 350000, custoVenda: 2213, semInteresse: 3, temDados: true },
      google: { gasto: 120, leads: 6, leadsPlataforma: 5, cpl: 20, vendas: 0, vgv: 0, custoVenda: null, semInteresse: 0, temDados: true },
    },
    alertas: [
      { nivel: "critico", texto: "3 lead(s) de anúncio em Novo Lead há mais de 1 dia sem atendimento." },
      { nivel: "atencao", texto: "1 anúncio(s) com Problema — veja abaixo o que trocar no criativo." },
      { nivel: "atencao", texto: "Meta diz 134 leads no mês; no K1 chegaram 113. Guie-se pelo K1 (lead real)." },
    ],
    funil: [
      ["Primeiro Contato", 1, 114, 18.4], ["Em Atendimento", 2, 513, 24.3], ["Agendamento", 3, 9, 21.4], ["Visita Realizada", 5, 2, 21.2],
      ["Subida de Pasta", 7, 1, 22.9], ["Aprovação", 8, 1, 6.5], ["Cliente sem interesse", 12, 145, 27.8],
    ].map(([t, p, n, dd]) => ({ canal: "meta", etapa: t, titulo: t, pos: p, total: n, comCorretor: t === "Cliente sem interesse" ? 0 : n, comGestor: t === "Cliente sem interesse" ? n : 0, semDono: 0, diasMedio: dd, diasMax: 69 })),
    porResponsavel: [...nomes.map((n, i) => ({ nome: n, cargo: "corretor", leads: 40 - i * 4, meta: 40 - i * 4, google: 0, diasMedio: 10 + i * 3 })), { nome: "Rodrigo Kayser", cargo: "diretor", leads: 3, meta: 2, google: 1, diasMedio: 2 }, { nome: "Isaac Mesquita", cargo: "gerente", leads: 1, meta: 1, google: 0, diasMedio: 40 }],
    rankingCorretores: nomes.map((n, i) => ({ posicao: i + 1, nome: n, recebidos: 9 - i, meta: 9 - i, google: 0, abertos: 6, agendamentos: Math.max(0, 3 - i), visitas: Math.max(0, 2 - i), vendas: i === 0 ? 1 : 0, semInteresse: i % 3, diasParado: 4 + i * 2, pctAgendamento: 33.3 - i * 4, pctVisita: 22.2 - i * 3, pctVenda: i === 0 ? 11.1 : 0, pctSemInteresse: (i % 3) * 12.5 })),
    parados: nomes.map((n, i) => ({ id: String(i), nome: `Cliente ${i + 1}`, canal: i % 4 ? "meta" : "google", etapa: "Em Atendimento", dias: 69 - i * 5, responsavel: n, cargo: "corretor" })),
    paraDistribuir: [{ id: "1" }],
    anuncios: [
      { canal: "meta", anuncio: "ilha stay 09", nota: "bom", gasto: 277, impressoes: 3470, cliques: 424, conversoes: 43, cpl: 6.4, ctr: 0.122, dica: "Lead a R$ 6 (média R$ 17). Está funcionando — pode receber mais verba enquanto o custo não subir." },
      { canal: "meta", anuncio: "Promovendo o site: WhatsApp", nota: "problema", gasto: 980, impressoes: 27326, cliques: 831, conversoes: 20, cpl: 49, ctr: 0.03, dica: "Lead a R$ 49, 197% acima da média do canal (R$ 17). Tirar verba daqui ou trocar o criativo." },
      { canal: "google", anuncio: "Barra e Recreio · Apartamento na Barra Olímpica", nota: "sem_veredito", gasto: 120, impressoes: 800, cliques: 40, conversoes: 5, cpl: 24, ctr: 0.05, dica: "Ainda aprendendo (3 dia(s), 800 impressões)." },
    ],
    semInteresse: [{ id: "x", nome: "João Pereira", canal: "meta", motivo: "Comprou com outra construtora na mesma região", em: new Date().toISOString(), corretor: "Claudia Marcello", marcadoPor: "Claudia Marcello" }],
    ranking: [{ nome: "Claudia Marcello", total: 2, semMotivo: 0 }, { nome: "Diego Pontes", total: 1, semMotivo: 1 }],
  };
  const pdf = await montarApresentacao({ inicio: "06/11", fim: "12/11", mesNome: "Novembro", semana: { meta: { gasto: 512, leads: 41, semInteresse: 2 }, google: { gasto: 120, leads: 6, semInteresse: 0 } }, painel });
  writeFileSync(alvo as string, Buffer.from(pdf));
});
