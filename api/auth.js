export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { email, senha } = req.body;
  const emailCorreto = process.env.APP_EMAIL;
  const senhaCorreta = process.env.APP_PASSWORD;

  if (!emailCorreto || !senhaCorreta) {
    return res.status(500).json({ erro: 'Credenciais não configuradas no servidor' });
  }

  if (email === emailCorreto && senha === senhaCorreta) {
    // Token simples baseado na data — válido por 1 dia
    const token = Buffer.from(`${email}:${new Date().toDateString()}`).toString('base64');
    return res.status(200).json({ ok: true, token });
  }

  return res.status(401).json({ ok: false, erro: 'Email ou senha incorretos.' });
}
