export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { imageData, mediaType, apenasDetectarDatas, dataDe, dataAte } = req.body;
  if (!imageData) return res.status(400).json({ erro: 'Arquivo não enviado' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ erro: 'API key não configurada' });

  const mime = mediaType || 'application/pdf';
  const ano = new Date().getFullYear();

  // MODO 1: Apenas detectar período do extrato
  if (apenasDetectarDatas) {
    const promptDatas = `Analise este extrato bancário e identifique APENAS as datas da primeira e última transação.
Retorne SOMENTE este JSON sem nada mais:
{"dataInicio":"YYYY-MM-DD","dataFim":"YYYY-MM-DD"}
Se o ano não aparecer use ${ano}.`;

    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [
              { inline_data: { mime_type: mime, data: imageData } },
              { text: promptDatas }
            ]}],
            generationConfig: { temperature: 0, maxOutputTokens: 100 }
          })
        }
      );
      const data = await resp.json();
      const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const match = texto.match(/\{[\s\S]*\}/);
      if (match) return res.status(200).json(JSON.parse(match[0]));
      return res.status(200).json({ dataInicio: '', dataFim: '' });
    } catch(e) {
      return res.status(200).json({ dataInicio: '', dataFim: '' });
    }
  }

  // MODO 2: Extrair lançamentos com filtro de datas
  let filtroTexto = '';
  if (dataDe && dataAte) {
    filtroTexto = `\nIMPORTANTE: Inclua APENAS transações entre ${dataDe} e ${dataAte}. Ignore qualquer transação fora deste período.`;
  } else if (dataDe) {
    filtroTexto = `\nIMPORTANTE: Inclua APENAS transações a partir de ${dataDe}.`;
  } else if (dataAte) {
    filtroTexto = `\nIMPORTANTE: Inclua APENAS transações até ${dataAte}.`;
  }

  const prompt = `Analise este extrato bancário e extraia os lançamentos. Retorne APENAS JSON sem markdown:
{"lancamentos":[{"data":"YYYY-MM-DD","descricao":"nome","valor":0.00,"tipo":"debito"}]}
Regras:
- data YYYY-MM-DD, valor positivo, tipo "debito" ou "credito"
- Ignore linhas de saldo anterior, saldo final, totais e cabeçalhos
- Não duplique transações que aparecem como "saldo anterior" do mês seguinte
- Se o ano não aparecer use ${ano}${filtroTexto}`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
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
        catch { return res.status(500).json({ erro: 'JSON inválido' }); }
      } else {
        return res.status(500).json({ erro: 'IA não retornou JSON válido' });
      }
    }

    // Filtro extra por data no servidor (garantia)
    if ((dataDe || dataAte) && parsed.lancamentos) {
      parsed.lancamentos = parsed.lancamentos.filter(l => {
        if (!l.data) return true;
        if (dataDe && l.data < dataDe) return false;
        if (dataAte && l.data > dataAte) return false;
        return true;
      });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
