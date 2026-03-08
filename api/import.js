export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const { imageData, mediaType } = req.body;

  if (!imageData) {
    return res.status(400).json({ erro: 'Arquivo não enviado' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ erro: 'API key não configurada no servidor' });
  }

  const mime = (mediaType && mediaType !== 'application/octet-stream') ? mediaType : 'application/pdf';

  const prompt = `Você é um assistente financeiro. Analise este extrato bancário e extraia TODOS os lançamentos.

Retorne APENAS um JSON válido, sem texto antes ou depois, sem markdown, no formato:
{"lancamentos":[{"data":"YYYY-MM-DD","descricao":"nome do lançamento","valor":0.00,"tipo":"debito"}]}

Regras:
- data: formato YYYY-MM-DD obrigatório
- valor: número positivo sem sinal
- tipo: "debito" para saídas/gastos/pagamentos, "credito" para entradas/receitas/depósitos
- descricao: nome limpo do estabelecimento ou descrição
- Ignore saldo, totais, cabeçalhos — apenas transações individuais
- Se o ano não aparecer, use ${new Date().getFullYear()}
- Retorne APENAS o JSON, nada mais`;

  try {
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mime, data: imageData } },
              { text: prompt }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
        })
      }
    );

    const geminiData = await geminiResp.json();

    if (!geminiResp.ok) {
      const detalhe = geminiData?.error?.message || JSON.stringify(geminiData);
      return res.status(500).json({ erro: 'Gemini: ' + detalhe });
    }

    const texto = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!texto) {
      return res.status(500).json({ erro: 'IA não retornou resposta. Tente com imagem PNG/JPG.' });
    }

    let parsed;
    try {
      const clean = texto.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch (e) {
      const match = texto.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); }
        catch { return res.status(500).json({ erro: 'JSON inválido retornado pela IA' }); }
      } else {
        return res.status(500).json({ erro: 'IA não retornou JSON. Tente com imagem PNG/JPG.' });
      }
    }

    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ erro: 'Erro: ' + err.message });
  }
}
