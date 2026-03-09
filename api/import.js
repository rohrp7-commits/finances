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
Retorne SOMENTE JSON sem markdown:
{"lancamentos":[{"data":"YYYY-MM-DD","descricao":"nome","valor":0.00,"tipo":"debito"}]}
Regras:
- tipo: "debito" para saídas/gastos, "credito" para entradas/recebimentos
- valor sempre positivo
- Ignore: saldo anterior, saldo final, totais, cabeçalhos, rodapés
- Não duplique transações
- Ano padrão: ${ano}`;

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
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
        })
      }
    );

    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ erro: data?.error?.message || 'Erro no Gemini' });

    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!texto) return res.status(500).json({ erro: 'IA não retornou resposta' });

    let parsed;
    try {
      parsed = JSON.parse(texto.replace(/```json|```/g, '').trim());
    } catch {
      const match = texto.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); }
        catch { return res.status(500).json({ erro: 'JSON inválido da IA' }); }
      } else {
        return res.status(500).json({ erro: 'IA não retornou JSON válido' });
      }
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
