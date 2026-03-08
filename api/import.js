export default async function handler(req, res) {
  // Só aceita POST
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const { imageData, mediaType } = req.body;

  if (!imageData) {
    return res.status(400).json({ erro: 'Arquivo não enviado' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ erro: 'API key não configurada' });
  }

  const prompt = `Você é um assistente financeiro. Analise este extrato bancário e extraia TODOS os lançamentos.

Retorne APENAS um JSON válido, sem texto antes ou depois, sem markdown, no formato:
{"lancamentos":[{"data":"YYYY-MM-DD","descricao":"nome do lançamento","valor":0.00,"tipo":"debito"}]}

Regras:
- data: formato YYYY-MM-DD obrigatório
- valor: número positivo sem sinal
- tipo: "debito" para saídas/gastos, "credito" para entradas/receitas
- descricao: nome limpo do estabelecimento
- Ignore saldo, totais, cabeçalhos — apenas transações individuais
- Se o ano não aparecer, use ${new Date().getFullYear()}`;

  try {
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mediaType || 'image/jpeg', data: imageData } },
              { text: prompt }
            ]
          }],
          generationConfig: { temperature: 0.1 }
        })
      }
    );

    if (!geminiResp.ok) {
      const err = await geminiResp.text();
      return res.status(500).json({ erro: 'Erro no Gemini: ' + err });
    }

    const geminiData = await geminiResp.json();
    const texto = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse do JSON retornado pela IA
    let parsed;
    try {
      const clean = texto.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch (e) {
      const match = texto.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else return res.status(500).json({ erro: 'IA não retornou JSON válido' });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
