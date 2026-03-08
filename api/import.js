export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

const MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { imageData, mediaType, apenasDetectarDatas, dataDe, dataAte } = req.body;
  if (!imageData) return res.status(400).json({ erro: 'Arquivo não enviado' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ erro: 'API key não configurada' });

  const mime = mediaType || 'application/pdf';
  const ano = new Date().getFullYear();

  // MODO 1: Detectar período do extrato
  if (apenasDetectarDatas) {
    const promptDatas = `Você é um leitor de extratos bancários.
Leia este extrato e encontre as datas da PRIMEIRA e ÚLTIMA transação listada.
Retorne SOMENTE este JSON, sem texto adicional, sem markdown:
{"dataInicio":"YYYY-MM-DD","dataFim":"YYYY-MM-DD"}
Ano padrão se não aparecer: ${ano}.`;

    try {
      const resp = await fetch(GEMINI_URL + '?key=' + apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mime, data: imageData } },
            { text: promptDatas }
          ]}],
          generationConfig: { temperature: 0, maxOutputTokens: 200 }
        })
      });

      const data = await resp.json();

      if (!resp.ok) {
        return res.status(200).json({ dataInicio: '', dataFim: '', _erro: data?.error?.message || 'Erro Gemini ' + resp.status });
      }

      const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const clean = texto.replace(/```json|```/g, '').trim();
      const match = clean.match(/\{[\s\S]*?\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          return res.status(200).json(parsed);
        } catch(e) {
          return res.status(200).json({ dataInicio: '', dataFim: '', _textoIA: texto });
        }
      }
      return res.status(200).json({ dataInicio: '', dataFim: '', _textoIA: texto });
    } catch(e) {
      return res.status(200).json({ dataInicio: '', dataFim: '', _erro: e.message });
    }
  }

  // MODO 2: Extrair lançamentos
  let filtroTexto = '';
  if (dataDe && dataAte) {
    filtroTexto = '\nFILTRO OBRIGATÓRIO: Retorne APENAS transações entre ' + dataDe + ' e ' + dataAte + '. Descarte tudo fora deste período.';
  } else if (dataDe) {
    filtroTexto = '\nFILTRO OBRIGATÓRIO: Retorne APENAS transações a partir de ' + dataDe + '.';
  } else if (dataAte) {
    filtroTexto = '\nFILTRO OBRIGATÓRIO: Retorne APENAS transações até ' + dataAte + '.';
  }

  const prompt = 'Você é um extrator de dados financeiros. Analise este extrato bancário.\nRetorne SOMENTE JSON sem markdown:\n{"lancamentos":[{"data":"YYYY-MM-DD","descricao":"nome","valor":0.00,"tipo":"debito"}]}\nRegras:\n- tipo: "debito" para saídas/gastos, "credito" para entradas/recebimentos\n- valor sempre positivo\n- Ignore: saldo anterior, saldo final, totais, cabeçalhos, rodapés\n- Não duplique transações\n- Ano padrão: ' + ano + filtroTexto;

  try {
    const resp = await fetch(GEMINI_URL + '?key=' + apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mime, data: imageData } },
          { text: prompt }
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
      })
    });

    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ erro: data?.error?.message || 'Erro Gemini ' + resp.status });

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
