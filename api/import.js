export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { imageData, mediaType } = req.body;
  if (!imageData) return res.status(400).json({ erro: 'Arquivo não enviado' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ erro: 'API key não configurada' });

  const prompt = `Analise este extrato bancário e extraia TODOS os lançamentos. Retorne APENAS JSON sem markdown:
{"lancamentos":[{"data":"YYYY-MM-DD","descricao":"nome","valor":0.00,"tipo":"debito"}]}
Regras: data YYYY-MM-DD, valor positivo, tipo "debito" ou "credito", ignore saldos/totais, ano ${new Date().getFullYear()} se não aparecer.`;

  try {
    // Gemini 1.5 Flash suporta PDF e imagens inline diretamente
    const mime = mediaType || 'application/pdf';
    
    const payload = {
      contents: [{
        parts: [
          { inline_data: { mime_type: mime, data: imageData } },
          { text: prompt }
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();

    if (!resp.ok) {
      const msg = data?.error?.message || JSON.stringify(data).slice(0, 200);
      return res.status(500).json({ erro: msg });
    }

    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!texto) return res.status(500).json({ erro: 'IA não retornou texto' });

    let parsed;
    try {
      parsed = JSON.parse(texto.replace(/```json|```/g, '').trim());
    } catch {
      const match = texto.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); }
        catch { return res.status(500).json({ erro: 'JSON inválido: ' + texto.slice(0, 100) }); }
      } else {
        return res.status(500).json({ erro: 'Sem JSON na resposta: ' + texto.slice(0, 100) });
      }
    }

    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
