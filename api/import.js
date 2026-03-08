export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { imageData, mediaType } = req.body;
  if (!imageData) return res.status(400).json({ erro: 'Arquivo não enviado' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ erro: 'API key não configurada' });

  const prompt = `Você é um assistente financeiro. Analise este extrato bancário e extraia TODOS os lançamentos.
Retorne APENAS um JSON válido, sem texto antes ou depois, sem markdown:
{"lancamentos":[{"data":"YYYY-MM-DD","descricao":"nome","valor":0.00,"tipo":"debito"}]}
Regras: data em YYYY-MM-DD, valor positivo, tipo "debito" ou "credito", ignore saldos e totais, ano ${new Date().getFullYear()} se não aparecer.`;

  const isPDF = mediaType === 'application/pdf';

  try {
    let parts;

    if (isPDF) {
      // Para PDF: usa Files API para upload primeiro
      const fileBuffer = Buffer.from(imageData, 'base64');

      // 1. Inicia upload resumável
      const startResp = await fetch(
        `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': fileBuffer.length,
            'X-Goog-Upload-Header-Content-Type': 'application/pdf',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ file: { display_name: 'extrato.pdf' } }),
        }
      );

      const uploadUrl = startResp.headers.get('x-goog-upload-url');
      if (!uploadUrl) return res.status(500).json({ erro: 'Falha ao iniciar upload do PDF' });

      // 2. Envia o arquivo
      const uploadResp = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Length': fileBuffer.length,
          'X-Goog-Upload-Command': 'upload, finalize',
          'X-Goog-Upload-Offset': '0',
          'Content-Type': 'application/pdf',
        },
        body: fileBuffer,
      });

      const uploadData = await uploadResp.json();
      const fileUri = uploadData?.file?.uri;
      if (!fileUri) return res.status(500).json({ erro: 'Falha no upload do PDF: ' + JSON.stringify(uploadData) });

      parts = [
        { file_data: { mime_type: 'application/pdf', file_uri: fileUri } },
        { text: prompt }
      ];
    } else {
      // Para imagens: envia inline normalmente
      parts = [
        { inline_data: { mime_type: mediaType || 'image/jpeg', data: imageData } },
        { text: prompt }
      ];
    }

    // Chama o modelo
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
        })
      }
    );

    const geminiData = await geminiResp.json();
    if (!geminiResp.ok) {
      return res.status(500).json({ erro: 'Gemini: ' + (geminiData?.error?.message || JSON.stringify(geminiData)) });
    }

    const texto = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!texto) return res.status(500).json({ erro: 'IA não retornou resposta' });

    let parsed;
    try {
      parsed = JSON.parse(texto.replace(/```json|```/g, '').trim());
    } catch {
      const match = texto.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); }
        catch { return res.status(500).json({ erro: 'JSON inválido retornado pela IA' }); }
      } else {
        return res.status(500).json({ erro: 'IA não retornou JSON válido' });
      }
    }

    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ erro: 'Erro: ' + err.message });
  }
}
