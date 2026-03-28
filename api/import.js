export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { imageData, mediaType } = req.body;
  if (!imageData) return res.status(400).json({ erro: 'Arquivo não enviado' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ erro: 'API key não configurada' });

  const mime = mediaType || 'application/pdf';
  const ano = new Date().getFullYear();

  const prompt = `Você é um extrator de dados financeiros. Analise este extrato bancário.
Retorne SOMENTE um JSON válido, sem texto antes ou depois, sem markdown, sem explicações:
{"lancamentos":[{"data":"YYYY-MM-DD","descricao":"nome da transação","valor":0.00,"tipo":"debito"}]}
Regras obrigatórias:
- tipo: exatamente "debito" para saídas/gastos, exatamente "credito" para entradas/recebimentos
- valor: número positivo sem símbolo de moeda
- data: formato YYYY-MM-DD, ano padrão ${ano}
- Ignore completamente: linhas de saldo anterior, saldo final, totais, cabeçalhos, rodapés, textos institucionais
- Nunca duplique transações
- Se não encontrar transações retorne: {"lancamentos":[]}`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mime, data: imageData } },
            { text: prompt }
          ]}],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ erro: data?.error?.message || 'Erro no Gemini' });

    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!texto) return res.status(500).json({ erro: 'IA não retornou resposta' });

    // Tenta várias estratégias de parse
    let parsed = null;

    // 1. Parse direto
    try { parsed = JSON.parse(texto.trim()); } catch {}

    // 2. Remove markdown
    if (!parsed) {
      try { parsed = JSON.parse(texto.replace(/```json|```/g, '').trim()); } catch {}
    }

    // 3. Extrai primeiro objeto JSON encontrado
    if (!parsed) {
      const match = texto.match(/\{[\s\S]*\}/);
      if (match) try { parsed = JSON.parse(match[0]); } catch {}
    }

    // 4. Extrai array diretamente
    if (!parsed) {
      const arrMatch = texto.match(/\[[\s\S]*\]/);
      if (arrMatch) try { parsed = { lancamentos: JSON.parse(arrMatch[0]) }; } catch {}
    }

    if (!parsed) {
      return res.status(500).json({ erro: 'IA retornou formato inesperado. Tente novamente ou use uma imagem mais nítida.' });
    }

    // Garante que lancamentos existe
    if (!parsed.lancamentos) parsed = { lancamentos: [] };

    // Limpa e valida cada lançamento
    parsed.lancamentos = parsed.lancamentos
      .filter(l => l && l.descricao && l.valor && l.data)
      .map(l => ({
        data: String(l.data).trim(),
        descricao: String(l.descricao).trim(),
        valor: Math.abs(parseFloat(l.valor) || 0),
        tipo: l.tipo === 'credito' ? 'credito' : 'debito'
      }))
      .filter(l => l.valor > 0);

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ erro: 'Erro interno: ' + err.message });
  }
}
