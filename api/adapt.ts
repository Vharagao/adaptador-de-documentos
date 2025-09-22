import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from "@google/genai";

function getLuziaBasePrompt() {
    return `Você é um especialista em acessibilidade de documentos. Sua tarefa é adaptar o documento PDF fornecido, que pode ser extenso, seguindo rigorosamente as regras abaixo. É CRUCIAL que você processe o documento do início ao fim, sem pular nenhuma página. O resultado deve ser o texto adaptado, pronto para ser formatado.

**DIRETRIZ GERAL E FUNDAMENTAL:**
Transcreva literalmente todo o conteúdo de TODAS AS PÁGINAS do arquivo original, sem resumir, abreviar ou omitir qualquer texto.

**PROCESSO DE ADAPTAÇÃO (CONTEÚDO BASE):**
1.  **Extração Literal:** Transcreva 100% do texto do documento, de capa a capa.
2.  **Linearização:** Se houver quadros ou diagramas, converta-os para um formato de texto linear (use títulos e listas).
3.  **Tratamento de Tabelas (NOVA REGRA):** Ao encontrar uma tabela, NÃO a transcreva usando barras \`|\` ou hífens \`-\` para separar colunas. Em vez disso, descreva-a de forma estruturada. Para cada linha da tabela, liste o nome de cada coluna seguido pelo seu respectivo valor.
    *   **Exemplo de como fazer:**
        *   **Início da descrição da tabela: Músculos Expiratórios**
        *   Esta tabela detalha os principais músculos expiratórios.
        *   **Linha 1:**
        *   **Músculo:** Reto abdominal
        *   **Origem:** Crista púbica e sínfise púbica
        *   **Ação:** Flexiona a coluna vertebral
        *   **Linha 2:**
        *   **Músculo:** Oblíquo externo
        *   ... e assim por diante para todas as linhas.
        *   **Fim da descrição da tabela.**
4.  **Expansão de Siglas:** Expanda todas as abreviações e siglas na primeira vez que aparecerem. Exemplo: "NIOP (Núcleo de Inclusão e Orientação Psicopedógica)".
5.  **Exclusão de Cabeçalhos e Rodapés:** Ignore textos que se repetem no topo (cabeçalhos) ou no final (rodapés) de cada página. Isso inclui títulos de livros, nomes de capítulos e, principalmente, **qualquer número de página impresso no conteúdo do documento**. Não transcreva a numeração de página original do livro.
6.  **Exclusão de Elementos Decorativos:** Ignore elementos puramente visuais.
7.  **Correção de Quebras de Linha e Citações:** Junte palavras e frases que foram divididas em várias linhas ou interrompidas por notas de rodapé/citações no PDF original. Por exemplo, se o texto original for "a seu respeito impe<citação>ram falta de clareza", o resultado deve ser "a seu respeito imperam falta de clareza". O texto principal deve fluir continuamente, sem interrupções.
8.  **Gerenciamento de Citações/Notas de Rodapé:**
    *   Identifique todas as notas de rodapé ou citações no texto (geralmente numeradas ou marcadas).
    *   Remova-as do corpo do texto principal.
    *   Ao final de TODO o documento, crie uma seção única intitulada "**Referências**".
    *   Liste todas as citações compiladas nessa seção, mantendo sua numeração ou identificação original.
`;
}

function getLuziaPrompt() {
    return `${getLuziaBasePrompt()}
**VERSÃO 1: LUZIA GOMES (REGRAS ESPECÍFICAS):**
1.  **Indicação de Página Original:** No início de cada nova página do documento original, indique com a formatação: \`**Página [Número]**\`.
2.  **Títulos e Subtítulos:** Marque todos os títulos e subtítulos envolvendo-os com \`**\`. Exemplo: \`**Introdução e Histórico**\`.
3.  **Descrição de Elementos Visuais:** Para quaisquer imagens, tabelas, gráficos, etc., redija uma descrição detalhada e objetiva. Use os marcadores \`**Início da descrição da imagem**\` e \`**Fim da descrição da imagem**\` (ou 'tabela', 'gráfico', etc., conforme apropriado).

**PRODUZA APENAS O TEXTO ADAPTADO, SEM QUALQUER COMENTÁRIO ADICIONAL.**
`;
}

function getBrendaPrompt() {
    return `${getLuziaBasePrompt()}
**VERSÃO 2: BRENDA SANTOS (REGRAS ESPECÍFICAS PARA ALTA LEGIBILIDADE):**
Sua tarefa é limpar e formatar o conteúdo para alta legibilidade, separando texto de elementos visuais.

1.  **Indicação de Página Original:** NÃO inclua numeração de páginas.
2.  **Títulos e Subtítulos:** Identifique e marque todos os títulos e subtítulos envolvendo-os com \`**\`. Exemplo: \`**Introdução e Histórico**\`.
3.  **Processamento de Páginas com Conteúdo Misto (Texto e Imagem):**
    *   Para CADA PÁGINA, primeiro transcreva **TODO** o texto contido nela.
    *   Após transcrever o texto, avalie os elementos visuais. Se a página contiver um elemento visual **válido e significativo** (foto, gráfico, diagrama, etc.), insira um placeholder no final do texto daquela página, usando o formato exato: \`[IMAGEM_PAGINA_{NUMERO_DA_PAGINA}]\`.
    *   **Regra crucial:** Se um suposto "visual" for na verdade uma mensagem de erro indicando que uma imagem não pôde ser carregada (por exemplo, "Não é possível exibir esta imagem"), IGNORE esse elemento. Trate a página como se ela contivesse apenas texto e, portanto, **NÃO insira o placeholder de imagem**.
4.  **Páginas Apenas com Imagem:** Se uma página contiver principalmente um elemento visual **válido**, com pouco ou nenhum texto, insira apenas o placeholder \`[IMAGEM_PAGINA_{NUMERO_DA_PAGINA}]\`. Se o visual principal da página for um erro de imagem, ignore-o e transcreva apenas qualquer texto que possa existir na página (como títulos ou legendas).

**PRODUZA APENAS O TEXTO ADAPTADO, SEM QUALQUER COMENTÁrio ADICIONAL.**
`;
}


export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).end('Method Not Allowed');
    }

    try {
        const { pdfData } = req.body;

        if (!pdfData || !pdfData.mimeType || !pdfData.data) {
            return res.status(400).json({ error: 'Missing or invalid pdfData in request body.' });
        }

        const apiKey = process.env.API_KEY;
        if (!apiKey) {
            console.error("API_KEY is not set.");
            return res.status(500).json({ error: 'Server configuration error: API key not found.' });
        }
        
        const ai = new GoogleGenAI({ apiKey });

        const filePart = {
            inlineData: {
                mimeType: pdfData.mimeType,
                data: pdfData.data,
            },
        };

        const luziaPromise = ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ parts: [{ text: getLuziaPrompt() }, filePart] }]
        });

        const brendaPromise = ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ parts: [{ text: getBrendaPrompt() }, filePart] }]
        });

        const [luziaResult, brendaResult] = await Promise.all([
            luziaPromise,
            brendaPromise
        ]);

        const luziaAdaptedText = luziaResult.text;
        const brendaAdaptedText = brendaResult.text;

        return res.status(200).json({
            luziaAdaptedText,
            brendaAdaptedText
        });

    } catch (error) {
        console.error('Error in /api/adapt:', error);
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        return res.status(500).json({ error: 'An internal server error occurred during adaptation.', details: message });
    }
}
