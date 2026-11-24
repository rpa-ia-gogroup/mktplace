/**
 * Qualidade da resposta (pedido da Nath, 24/11/2026): no detalhe da Taxa de resposta,
 * por marca, o tempo ate' a 1a resposta (SLA), a fila de agora e o que a fonte nao tem.
 * Regra da operacao: SLA acima de 1 dia = fora (vermelho). Sem medida = "—" com motivo, nunca 0.
 * So' dados que a resposta da aba ja' traz: zero fetch novo.
 */
import { duracao, inteiro, type CxShopeeResponse } from "./cx.ts";
import type { CxMlResponse } from "./cx-ml.ts";

export const SLA_LIMITE_S = 86400;

export interface LinhaQualidade {
  chave: string;
  marca: string;
  /** Tempo ate' a 1a resposta ("—" sem medida) e se passa do SLA. */
  tempo: string;
  tempoFora: boolean;
  tempoDetalhe: string | null;
  /** Fila de agora: quantas aguardam e a mais antiga. */
  fila: string;
  filaFora: boolean;
  filaDetalhe: string | null;
}

export interface QualidadeResposta {
  linhas: LinhaQualidade[];
  /** Indicadores que a fonte do canal nao entrega (texto unico, nunca 0 na tela). */
  semFonte: string;
}

const fora = (s: number | null | undefined) => s != null && s > SLA_LIMITE_S;
const porForaPrimeiro = (a: LinhaQualidade, b: LinhaQualidade) =>
  Number(b.tempoFora || b.filaFora) - Number(a.tempoFora || a.filaFora) || a.marca.localeCompare(b.marca);

export function qualidadeShopee(dados: Pick<CxShopeeResponse, "chat">, rotulo: (m: string) => string): QualidadeResposta {
  const linhas = (dados.chat.nao_lidas ?? []).map((n): LinhaQualidade => {
    // lojas com app: media das respostas; Kokeshi: a media que o bot le no Seller Centre
    const media = n.tempo_resposta_fonte === "media_seller_centre" ? n.tempo_resposta_s : n.tempo_resposta_media_s;
    const detalhe = [
      n.tempo_resposta_fonte === "mediana" && n.tempo_resposta_s != null ? `mediana ${duracao(n.tempo_resposta_s)}` : null,
      n.respostas != null && n.respostas_mais_1d != null ? `${inteiro(n.respostas_mais_1d)} de ${inteiro(n.respostas)} respostas acima de 1 dia` : null,
      n.tempo_resposta_fonte === "media_seller_centre" ? "média do Seller Centre" : null,
    ].filter(Boolean);
    return {
      chave: n.marca,
      marca: rotulo(n.marca),
      tempo: duracao(media),
      tempoFora: fora(media),
      tempoDetalhe: media == null ? "Sem respostas medidas no período." : detalhe.join(" · ") || null,
      fila: n.aguardando_resposta == null ? "—" : `${inteiro(n.aguardando_resposta)} conversas`,
      filaFora: fora(n.espera_max_s),
      filaDetalhe: n.aguardando_resposta == null ? "Sem leitura da fila." : n.espera_max_s != null && n.aguardando_resposta > 0 ? `mais antiga há ${duracao(n.espera_max_s)}` : null,
    };
  });
  return {
    linhas: linhas.sort(porForaPrimeiro),
    semFonte: "Avaliação do atendimento (CSAT) e TMA (duração do atendimento): a Shopee não entrega por API.",
  };
}

export function qualidadeMl(dados: Pick<CxMlResponse, "marcas">, rotulo: (m: string) => string, agora: number): QualidadeResposta {
  const linhas = dados.marcas.map((m): LinhaQualidade => {
    const tempo = m.tempo_resposta_min == null ? null : m.tempo_resposta_min * 60;
    const antiga = m.pergunta_mais_antiga ? (agora - Date.parse(m.pergunta_mais_antiga)) / 1000 : null;
    const semResposta = m.perguntas_sem_resposta;
    return {
      chave: m.marca,
      marca: rotulo(m.marca),
      tempo: duracao(tempo),
      tempoFora: fora(tempo),
      tempoDetalhe:
        tempo == null
          ? "Sem a medida oficial do ML no período."
          : m.resposta_mediana_h != null
            ? `reclamações: 1ª ação em ${duracao(m.resposta_mediana_h * 3600)} (mediana)`
            : null,
      fila: semResposta == null ? "—" : `${inteiro(semResposta)} perguntas`,
      filaFora: (m.perguntas_sem_resposta_24h ?? 0) > 0 || fora(antiga),
      filaDetalhe: semResposta == null ? "Sem leitura das perguntas." : semResposta > 0 && antiga != null ? `mais antiga há ${duracao(antiga)}` : null,
    };
  });
  return {
    linhas: linhas.sort(porForaPrimeiro),
    semFonte: "Avaliação do atendimento (CSAT) e TMA (duração do atendimento): o Mercado Livre não entrega por API.",
  };
}
