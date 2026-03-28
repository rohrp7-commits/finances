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

  const prompt = `Analise este extrato bancário e extraia todas as transações.
Retorne APENAS o JSON abaixo, sem nenhum texto adicional:
{"lancamentos":[{"data":"YYYY-MM-DD","descricao":"nome","valor":0.00,"tipo":"debito"}]}
- tipo: "debito" para saídas, "credito" para entradas
- valor: número positivo
- data: formato YYYY-MM-DD, ano padrão ${ano}
- Ignore: saldos, totais, cabeçalhos`;

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
          generationConfig: { temperature: 0, maxOutputTokens: 8192 }
        })
      }
    );

    const data = await resp.json();

    if (!resp.ok) {
      return res.status(500).json({ erro: data?.error?.message || 'Erro Gemini ' + resp.status });
    }

    // Verifica bloqueio de segurança
    const candidate = data.candidates?.[0];
    if (!candidate) {
      const reason = data.promptFeedback?.blockReason || 'sem candidatos';
      return res.status(500).json({ erro: 'IA bloqueou resposta: ' + reason });
    }

    const texto = candidate.content?.parts?.[0]?.text || '';
    if (!texto) {
      const finishReason = candidate.finishReason || 'desconhecido';
      return res.status(500).json({ erro: 'IA não retornou texto. Motivo: ' + finishReason });
    }

    // Limpa o texto
    const limpo = texto.replace(/```json/g, '').replace(/```/g, '').trim();

    // Tenta parse direto
    let parsed = null;
    try { parsed = JSON.parse(limpo); } catch {}

    // Extrai JSON do meio do texto
    if (!parsed) {
      const match = limpo.match(/\{[\s\S]*"lancamentos"[\s\S]*\}/);
      if (match) try { parsed = JSON.parse(match[0]); } catch {}
    }

    // Tenta pegar qualquer objeto JSON
    if (!parsed) {
      const match = limpo.match(/\{[\s\S]*\}/);
      if (match) try { parsed = JSON.parse(match[0]); } catch {}
    }

    if (!parsed || !Array.isArray(parsed.lancamentos)) {
      // Retorna os primeiros 500 chars do texto para debug
      return res.status(500).json({ 
        erro: 'Formato inválido. Debug: ' + limpo.substring(0, 300)
      });
    }

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
    return res.status(500).json({ erro: 'Erro: ' + err.message });
  }
}
